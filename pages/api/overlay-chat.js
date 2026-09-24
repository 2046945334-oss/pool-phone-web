// pages/api/overlay-chat.js
// Injects overlay screenshot into main chat pipeline (/api/chat)
// so it shares context, memory (Ombre Brain), and tools with the main chat.
// Like 共读小窗: message appears in chat history, AI responds via full pipeline.
import { getDb } from '../../lib/db'

function getKV(db, key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return row.value }
}

function setKV(db, key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value)
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, v)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  try {
    const { messages: overlayMessages, source } = req.body
    if (!overlayMessages?.length) {
      return res.status(400).json({ error: 'No messages' })
    }

    const db = getDb()

    // 1. Read API config (same config the main chat uses)
    const defCfg = getKV(db, 'pool_api_config') || {}
    const allCfgs = getKV(db, 'pool_api_configs') || {}
    const chatCfg = allCfgs.chat || {}
    const apiBase = chatCfg.apiBase || defCfg.apiBase || ''
    const apiKey = chatCfg.apiKey || defCfg.apiKey || ''
    const model = chatCfg.model || defCfg.model || ''

    if (!apiBase || !apiKey) {
      return res.status(400).json({ error: 'No API config' })
    }

    // 2. Read system prompt & chat history
    const systemPrompt = getKV(db, 'pool_system_prompt') || '你是池屿，她的男朋友AI。'
    const historyRaw = getKV(db, 'pool_chat_history') || []
    const history = Array.isArray(historyRaw) ? historyRaw : []

    // 3. Extract text-only version for chat history display (no base64 image)
    let userText = '[悬浮窗截图]'
    const firstMsg = overlayMessages[0]
    if (firstMsg && Array.isArray(firstMsg.content)) {
      const tp = firstMsg.content.find(p => p.type === 'text')
      if (tp) userText = tp.text
    } else if (firstMsg && typeof firstMsg.content === 'string') {
      userText = firstMsg.content.slice(0, 500)
    }

    // Inject into pool_chat_history as a visible user message (like 共读小窗)
    const ts = Date.now()
    history.push({ role: 'user', content: userText, ts, source: 'overlay' })

    // 4. Build messages array for /api/chat (same format as frontend sends)
    const overlayHint = source === 'overlay_manual'
      ? '\n\n[悬浮窗截图] 她双击让你看她手机屏幕截图。根据截图内容自然评论，像平时聊天一样。'
      : '\n\n[悬浮窗截图] 你通过悬浮窗偷偷看了她手机屏幕截图。根据截图内容自然评论1-2句，不要提“截图”二字。'

    const msgs = []
    msgs.push({ role: 'system', content: systemPrompt + overlayHint })

    const summary = getKV(db, 'pool_context_summary')
    if (summary) msgs[0].content += '\n\n[对话背景摘要]\n' + summary

    // Add recent visible chat history for context
    for (const m of history.slice(-20)) {
      if (m.role === 'tool_log' || m.hidden) continue
      if (m.role === 'system' && !m.isPat) continue
      const role = m.isPat ? 'user' : m.role
      if ((role === 'user' || role === 'assistant') && m.content) {
        msgs.push({ role, content: String(m.content) })
      }
    }

    // Replace last user msg (text-only) with full overlay msg (with screenshot image)
    msgs.pop()
    for (const m of overlayMessages) msgs.push(m)

    // 5. Call /api/chat internally — full pipeline (Ombre Brain, tools, notifications)
    const port = process.env.PORT || 3000
    console.log('[overlay-chat] proxying to /api/chat, msgs:', msgs.length, 'source:', source)

    const chatResp = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs, apiBase, apiKey, model })
    })

    const chatData = await chatResp.json()
    let reply = chatData.reply || ''

    if (!reply && chatData.error) {
      console.error('[overlay-chat] /api/chat error:', chatData.error)
      history.pop() // remove the failed user message
      setKV(db, 'pool_chat_history', history.slice(-50))
      return res.status(500).json({ error: chatData.error })
    }

    // 6. Save AI reply to pool_chat_history (visible in main chat)
    if (reply) {
      history.push({ role: 'assistant', content: reply, ts: Date.now(), source: 'overlay' })
    }
    setKV(db, 'pool_chat_history', history.slice(-50))

    return res.json({ reply })
  } catch (e) {
    console.error('[overlay-chat] error:', e)
    return res.status(500).json({ error: e.message })
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '16mb' } }
}
