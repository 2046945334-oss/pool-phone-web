// lib/memory.js — 记忆系统核心：消息压缩、chunk管理、记忆召回
const { getDb } = require('./db')

const COMPRESS_THRESHOLD = 40  // 超过40条触发压缩
const KEEP_RECENT = 20         // 压缩后保留最近20条原文
const CHUNK_SIZE = 10          // 每10条消息切一个chunk

// === 消息存储 ===

function saveMessage(sessionId, role, content, msgType = 'text') {
  const db = getDb()
  // content可能是multimodal数组(图片消息)，需要序列化为字符串
  const serialized = typeof content === 'string' ? content : JSON.stringify(content)
  const r = db.prepare(
    'INSERT INTO chat_messages (session_id, role, content, msg_type) VALUES (?, ?, ?, ?)'
  ).run(sessionId, role, serialized, msgType)
  db.prepare('UPDATE chat_sessions SET updated_at = unixepoch() WHERE id = ?').run(sessionId)
  return r.lastInsertRowid
}

function getRecentMessages(sessionId, limit = 20) {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
  ).all(sessionId, limit).reverse()
}

function getSessionSummary(sessionId) {
  const db = getDb()
  const row = db.prepare('SELECT summary FROM chat_sessions WHERE id = ?').get(sessionId)
  return row?.summary || ''
}

function getMessageCount(sessionId) {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE session_id = ?').get(sessionId)
  return row?.cnt || 0
}

// === 消息压缩 ===

async function compressOldMessages(sessionId, apiBase, apiKey, model) {
  const db = getDb()
  const messages = db.prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id'
  ).all(sessionId)

  if (messages.length <= COMPRESS_THRESHOLD) return null

  const oldMessages = messages.slice(0, -KEEP_RECENT)
  const total = oldMessages.length

  // 分三层构建压缩文本
  const earlyEnd = Math.floor(total * 0.3)
  const midEnd = Math.floor(total * 0.6)

  let layerText = ''

  // 早期（前30%）→ 极简
  layerText += '【早期对话】\n'
  for (let i = 0; i < earlyEnd; i++) {
    const m = oldMessages[i]
    layerText += `${m.role}: ${m.content.slice(0, 80)}\n`
  }

  // 中期（30%-60%）→ 概括
  layerText += '\n【中期对话】\n'
  for (let i = earlyEnd; i < midEnd; i++) {
    const m = oldMessages[i]
    layerText += `${m.role}: ${m.content.slice(0, 150)}\n`
  }

  // 近期（60%-100%）→ 详细
  layerText += '\n【近期对话】\n'
  for (let i = midEnd; i < total; i++) {
    const m = oldMessages[i]
    layerText += `${m.role}: ${m.content.slice(0, 300)}\n`
  }

  const compressPrompt = `请将以下分层对话历史压缩成摘要。

${layerText}

输出要求：
用第三人称。按以下格式输出：
【近期】（500-800字）详细记录最近的对话
【中期】（200-350字）概括较早的对话
【早期】（80-150字）极简记录最早的对话

关键规则：
1. 必须保留所有日程、日期、时间、约定
2. 必须保留具体的数字、人名、地点
3. 必须保留所有承诺和待办
4. 禁止用"讨论了""聊到了"这种空话替代具体内容`

  // 调用API做压缩
  const base = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = `${base}/v1/chat/completions`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '你是对话压缩器。将对话历史压缩为结构化摘要，保留所有具体细节。' },
          { role: 'user', content: compressPrompt }
        ],
        max_tokens: 2000,
      }),
    })

    if (!response.ok) return null
    const data = await response.json()
    const summary = data.choices?.[0]?.message?.content || ''

    if (summary) {
      // 保存摘要到session
      const existingSummary = getSessionSummary(sessionId)
      const newSummary = existingSummary
        ? `${summary}\n\n---（更早的摘要）---\n${existingSummary.slice(0, 1000)}`
        : summary
      db.prepare('UPDATE chat_sessions SET summary = ? WHERE id = ?').run(newSummary, sessionId)

      // 删除已压缩的旧消息
      const oldIds = oldMessages.map(m => m.id)
      db.prepare(`DELETE FROM chat_messages WHERE id IN (${oldIds.join(',')})`).run()

      return summary
    }
  } catch (e) {
    console.error('[memory] compress failed:', e.message)
  }
  return null
}

// === Chunk 管理 ===

function createChunksIfNeeded(sessionId) {
  const db = getDb()

  // 找到最后一个chunk覆盖到的msg_id
  const lastChunk = db.prepare(
    'SELECT msg_id_end FROM chat_chunks WHERE session_id = ? ORDER BY msg_id_end DESC LIMIT 1'
  ).get(sessionId)
  const lastId = lastChunk?.msg_id_end || 0

  // 获取新消息
  const newMsgs = db.prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id'
  ).all(sessionId, lastId)

  // 每CHUNK_SIZE条切一个chunk
  const chunks = []
  for (let i = 0; i + CHUNK_SIZE <= newMsgs.length; i += CHUNK_SIZE) {
    const slice = newMsgs.slice(i, i + CHUNK_SIZE)
    const chunkText = slice.map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n')
    db.prepare(
      'INSERT INTO chat_chunks (session_id, msg_id_start, msg_id_end, chunk_text) VALUES (?, ?, ?, ?)'
    ).run(sessionId, slice[0].id, slice[slice.length - 1].id, chunkText)
    chunks.push({ start: slice[0].id, end: slice[slice.length - 1].id })
  }
  return chunks
}

// === Chunk 摘要（用LLM生成一句话摘要）===

async function summarizeChunks(apiBase, apiKey, model, batchSize = 5) {
  const db = getDb()
  const rows = db.prepare(
    "SELECT id, chunk_text FROM chat_chunks WHERE summary = '' LIMIT ?"
  ).all(batchSize)

  if (!rows.length) return 0

  const base = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = `${base}/v1/chat/completions`
  let count = 0

  for (const row of rows) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: '你是对话摘要器。用一到两句中文概括这段对话。不超过80字。必须保留所有具体细节：日期、时间、地点、人名、数字。禁止抽象化。' },
            { role: 'user', content: `请概括这段对话：\n\n${row.chunk_text.slice(0, 800)}` }
          ],
          max_tokens: 200,
        }),
      })
      if (resp.ok) {
        const data = await resp.json()
        const summary = data.choices?.[0]?.message?.content || ''
        if (summary) {
          db.prepare('UPDATE chat_chunks SET summary = ? WHERE id = ?').run(summary, row.id)
          count++
        }
      }
    } catch {}
  }
  return count
}

// === 记忆召回（本地文本搜索）===

function localSearch(query, limit = 5) {
  const db = getDb()
  const results = []

  // 搜索记忆帖子
  const posts = db.prepare(
    "SELECT * FROM memory_posts WHERE content LIKE ? ORDER BY pinned DESC, created_at DESC LIMIT ?"
  ).all(`%${query}%`, limit)
  for (const p of posts) {
    results.push({ type: 'memory', content: p.content, pinned: p.pinned, time: p.created_at })
  }

  // 搜索chunk摘要
  const chunks = db.prepare(
    "SELECT * FROM chat_chunks WHERE summary LIKE ? OR chunk_text LIKE ? ORDER BY created_at DESC LIMIT ?"
  ).all(`%${query}%`, `%${query}%`, limit)
  for (const c of chunks) {
    results.push({ type: 'chunk', content: c.summary || c.chunk_text.slice(0, 200), time: c.created_at })
  }

  return results
}

// === 获取置顶记忆 ===

function getPinnedMemories() {
  const db = getDb()
  return db.prepare('SELECT * FROM memory_posts WHERE pinned = 1 ORDER BY created_at DESC LIMIT 10').all()
}

// === 构建记忆上下文（给System Prompt用）===

function buildMemoryContext(sessionId) {
  const parts = []

  // 1. 置顶记忆
  const pinned = getPinnedMemories()
  if (pinned.length) {
    parts.push('【置顶记忆】\n' + pinned.map(p => `- ${p.content}`).join('\n'))
  }

  // 2. Session摘要（压缩后的历史）
  const summary = getSessionSummary(sessionId)
  if (summary) {
    parts.push('【对话历史摘要】\n' + summary.slice(0, 2000))
  }

  return parts.join('\n\n')
}

// === 消息入口（保存 + 自动chunk + 检查是否需要压缩）===

async function processNewMessage(sessionId, role, content, apiConfig) {
  // 1. 保存消息
  const msgId = saveMessage(sessionId, role, content)

  // 2. 创建新chunk（如果积累够了）
  createChunksIfNeeded(sessionId)

  // 3. 检查是否需要压缩
  const count = getMessageCount(sessionId)
  if (count > COMPRESS_THRESHOLD && apiConfig?.apiBase && apiConfig?.apiKey) {
    await compressOldMessages(sessionId, apiConfig.apiBase, apiConfig.apiKey, apiConfig.model)
  }

  return msgId
}

module.exports = {
  saveMessage,
  getRecentMessages,
  getSessionSummary,
  getMessageCount,
  compressOldMessages,
  createChunksIfNeeded,
  summarizeChunks,
  localSearch,
  getPinnedMemories,
  buildMemoryContext,
  processNewMessage,
}