// pages/api/readerchat.js - 共读聊天API
import { getDb } from '../../lib/db'

function getVal(db, key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return row.value }
}
function setVal(db, key, val) {
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(val))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const db = getDb()
  const { message, chatHistory } = req.body
  if (!message) return res.status(400).json({ error: 'message required' })

  // Get API config - prefer pool_api_configs.chat (对话功能独立配置)
  let apiBase, apiKey, model
  const cfgsRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
  if (cfgsRow) {
    try {
      const cfgs = JSON.parse(cfgsRow.value)
      const chatCfg = cfgs.chat || {}
      apiBase = chatCfg.apiBase
      apiKey = chatCfg.apiKey
      model = chatCfg.model
    } catch {}
  }
  // Fallback to default config
  if (!apiBase || !apiKey) {
    const cfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
    if (cfgRow) {
      try {
        const cfg = JSON.parse(cfgRow.value)
        apiBase = apiBase || cfg.apiBase
        apiKey = apiKey || cfg.apiKey
        model = model || cfg.model
      } catch {}
    }
  }
  if (!apiBase || !apiKey) return res.status(500).json({ error: 'API未配置' })

  const state = getVal(db, 'pool_reader_state') || {}
  const books = getVal(db, 'pool_reader_books') || []
  const notes = getVal(db, 'pool_reader_notes') || []
  let currentBook = null
  if (state.currentBookId) {
    for (let i = 0; i < books.length; i++) {
      if (books[i].id === state.currentBookId) { currentBook = books[i]; break }
    }
  }

  let chapterContext = ''
  if (currentBook && currentBook.chapters) {
    const ch = currentBook.chapters[state.userChapter || 0]
    if (ch) {
      chapterContext = '当前章节：' + (ch.title || ('第' + ((state.userChapter || 0) + 1) + '章')) + '\n'
      chapterContext += ch.content.slice(0, 2000)
    }
  }

  let systemPrompt = '你是池，正在和她一起共读一本书。'
  if (currentBook) {
    systemPrompt += '当前在读：「' + currentBook.title + '」'
    systemPrompt += '，她读到第' + ((state.userChapter || 0) + 1) + '章'
    systemPrompt += '，共' + (currentBook.chapters ? currentBook.chapters.length : 0) + '章。'
  }
  systemPrompt += '\n请围绕书的内容和她讨论，可以分享感想、提问、点评角色或情节。回复简短自然，像和她聊天一样。'
  if (chapterContext) {
    systemPrompt += '\n\n【当前章节内容摘要】\n' + chapterContext
  }
  if (notes.length > 0) {
    const recentNotes = notes.slice(-3)
    systemPrompt += '\n\n【你之前的批注】\n' + recentNotes.map(function(n) { return '- ' + n.text }).join('\n')
  }

  const msgs = [{ role: 'system', content: systemPrompt }]
  if (chatHistory && chatHistory.length > 0) {
    const recent = chatHistory.slice(-10)
    for (const m of recent) {
      msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })
    }
  }
  msgs.push({ role: 'user', content: message })

  try {
    const url = apiBase.replace(/\/$/, '') + '/chat/completions'
    const body = JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: msgs,
      max_tokens: 500,
      temperature: 0.8
    })
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body
    })
    if (!apiRes.ok) {
      const err = await apiRes.text()
      return res.status(502).json({ error: 'API error: ' + apiRes.status, detail: err.slice(0, 200) })
    }
    const data = await apiRes.json()
    const reply = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '...'

    const chat = getVal(db, 'pool_reader_chat') || []
    chat.push({ role: 'user', content: message, time: Date.now() })
    chat.push({ role: 'assistant', content: reply, time: Date.now() })
    if (chat.length > 200) chat.splice(0, chat.length - 200)
    setVal(db, 'pool_reader_chat', chat)

    return res.json({ reply: reply })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
