// pages/api/reader.js - 共读功能后端API
import { getDb } from '../../lib/db'

const KEY_BOOKS = 'pool_reader_books'
const KEY_STATE = 'pool_reader_state'
const KEY_BOOKMARKS = 'pool_reader_bookmarks'
const KEY_NOTES = 'pool_reader_notes'
const KEY_CHAT = 'pool_reader_chat'

function getVal(db, key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return row.value }
}
function setVal(db, key, val) {
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(val))
}

export default async function handler(req, res) {
  const db = getDb()
  const { action } = req.query

  // GET /api/reader?action=state — 获取共读状态
  if (req.method === 'GET' && action === 'state') {
    const state = getVal(db, KEY_STATE) || { currentBookId: null, userChapter: 0, aiChapter: 0, active: false }
    const books = getVal(db, KEY_BOOKS) || []
    const bookmarks = getVal(db, KEY_BOOKMARKS) || []
    const notes = getVal(db, KEY_NOTES) || []
    return res.json({ state, books: books.map(b => ({ id: b.id, title: b.title, chapterCount: b.chapters?.length || 0 })), bookmarks, notes })
  }

  // GET /api/reader?action=book&id=xxx — 获取书籍内容(到用户进度)
  if (req.method === 'GET' && action === 'book') {
    const { id, full } = req.query
    const books = getVal(db, KEY_BOOKS) || []
    const book = books.find(b => b.id === id)
    if (!book) return res.status(404).json({ error: '书籍不存在' })
    const state = getVal(db, KEY_STATE) || {}
    // AI只能看到用户阅读进度之前的章节
    const maxChapter = (full === '1') ? book.chapters.length : Math.min((state.userChapter || 0) + 1, book.chapters.length)
    return res.json({
      id: book.id, title: book.title,
      chapters: book.chapters.slice(0, maxChapter).map((c, i) => ({ index: i, title: c.title, content: c.content })),
      totalChapters: book.chapters.length,
      visibleChapters: maxChapter
    })
  }

  // GET /api/reader?action=chapter&id=xxx&ch=N — 获取单章内容
  if (req.method === 'GET' && action === 'chapter') {
    const { id, ch } = req.query
    const books = getVal(db, KEY_BOOKS) || []
    const book = books.find(b => b.id === id)
    if (!book) return res.status(404).json({ error: '书籍不存在' })
    const chIdx = parseInt(ch) || 0
    const state = getVal(db, KEY_STATE) || {}
    if (chIdx > (state.userChapter || 0)) return res.status(403).json({ error: '还没读到这里' })
    const chapter = book.chapters[chIdx]
    if (!chapter) return res.status(404).json({ error: '章节不存在' })
    return res.json({ index: chIdx, title: chapter.title, content: chapter.content, totalChapters: book.chapters.length })
  }

  // GET /api/reader?action=chat — 获取共读聊天记录
  if (req.method === 'GET' && action === 'chat') {
    const chat = getVal(db, KEY_CHAT) || []
    return res.json({ messages: chat.slice(-50) })
  }

  // PUT methods
  if (req.method === 'PUT') {
    const body = req.body

    // PUT action=import — 导入书籍（事务保证原子读写，防并发覆盖）
    if (action === 'import') {
      const { title, chapters } = body
      if (!title || !chapters) return res.status(400).json({ error: 'title and chapters required' })
      const id = Math.random().toString(36).substr(2, 10)
      const importTx = db.transaction(() => {
        const books = getVal(db, KEY_BOOKS) || []
        books.push({ id, title, chapters, importedAt: Date.now() })
        setVal(db, KEY_BOOKS, books)
      })
      importTx()
      return res.json({ ok: true, id, chapterCount: chapters.length })
    }

    // PUT action=progress — 更新用户阅读进度
    if (action === 'progress') {
      const { bookId, chapter, page } = body
      const state = getVal(db, KEY_STATE) || {}
      state.currentBookId = bookId
      state.userChapter = chapter
      if (typeof page === 'number') state.userPage = page
      state.active = true
      state.lastRead = Date.now()
      setVal(db, KEY_STATE, state)
      return res.json({ ok: true, state })
    }

    // PUT action=ai_progress — AI更新自己的阅读进度
    if (action === 'ai_progress') {
      const { bookId, chapter } = body
      const state = getVal(db, KEY_STATE) || {}
      // AI进度不能超过用户进度
      if (chapter > (state.userChapter || 0)) return res.json({ ok: false, error: '不能超过用户进度' })
      state.aiChapter = chapter
      state.aiLastRead = Date.now()
      setVal(db, KEY_STATE, state)
      return res.json({ ok: true, state })
    }

    // PUT action=note — AI添加批注
    if (action === 'note') {
      const { bookId, chapter, text, quote } = body
      const notes = getVal(db, KEY_NOTES) || []
      notes.push({ id: Date.now(), bookId, chapter, text, quote, author: 'ai', time: Date.now() })
      setVal(db, KEY_NOTES, notes)
      return res.json({ ok: true })
    }

    // PUT action=bookmark — 用户添加书签
    if (action === 'bookmark') {
      const { bookId, chapter, quote } = body
      const bookmarks = getVal(db, KEY_BOOKMARKS) || []
      bookmarks.push({ id: Date.now(), bookId, chapter, quote, time: Date.now() })
      setVal(db, KEY_BOOKMARKS, bookmarks)
      // Auto-save: update state
      const state = getVal(db, KEY_STATE) || {}
      state.lastBookmark = Date.now()
      setVal(db, KEY_STATE, state)
      return res.json({ ok: true })
    }

    // PUT action=chat_msg — 添加共读聊天消息
    if (action === 'chat_msg') {
      const { role, content } = body
      const chat = getVal(db, KEY_CHAT) || []
      chat.push({ role, content, time: Date.now() })
      if (chat.length > 200) chat.splice(0, chat.length - 200)
      setVal(db, KEY_CHAT, chat)
      return res.json({ ok: true })
    }

    // PUT action=recommend — AI推荐书籍到书架(文本方式,不含全文)
    if (action === 'recommend') {
      const { title, reason } = body
      const state = getVal(db, KEY_STATE) || {}
      state.recommendation = { title, reason, time: Date.now() }
      setVal(db, KEY_STATE, state)
      return res.json({ ok: true })
    }

    // PUT action=end_session — 结束共读
    if (action === 'end_session') {
      const state = getVal(db, KEY_STATE) || {}
      state.active = false
      setVal(db, KEY_STATE, state)
      return res.json({ ok: true })
    }
  }

  // DELETE action=book&id=xxx
  if (req.method === 'DELETE' && action === 'book') {
    const { id } = req.query
    const delTx = db.transaction(() => {
      const books = getVal(db, KEY_BOOKS) || []
      setVal(db, KEY_BOOKS, books.filter(b => b.id !== id))
    })
    delTx()
    return res.json({ ok: true })
  }

  // POST /api/reader?action=chat — 共读聊天
  if (req.method === 'POST' && action === 'chat') {
    const { message, chatHistory } = req.body
    if (!message) return res.status(400).json({ error: 'message required' })

    let apiBase, apiKey, model
    const cfgsRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
    if (cfgsRow) {
      try {
        const cfgs = JSON.parse(cfgsRow.value)
        const chatCfg = cfgs.chat || {}
        apiBase = chatCfg.apiBase; apiKey = chatCfg.apiKey; model = chatCfg.model
      } catch {}
    }
    if (!apiBase || !apiKey) {
      const cfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
      if (cfgRow) {
        try {
          const cfg = JSON.parse(cfgRow.value)
          apiBase = apiBase || cfg.apiBase; apiKey = apiKey || cfg.apiKey; model = model || cfg.model
        } catch {}
      }
    }
    if (!apiBase || !apiKey) return res.status(500).json({ error: 'API未配置' })

    const rState = getVal(db, KEY_STATE) || {}
    const rBooks = getVal(db, KEY_BOOKS) || []
    const rNotes = getVal(db, KEY_NOTES) || []
    let currentBook = null
    if (rState.currentBookId) {
      currentBook = rBooks.find(b => b.id === rState.currentBookId) || null
    }

    let chCtx = ''
    if (currentBook && currentBook.chapters) {
      const ch = currentBook.chapters[rState.userChapter || 0]
      if (ch) {
        chCtx = '当前章节：' + (ch.title || ('第' + ((rState.userChapter || 0) + 1) + '章')) + '\n'
        chCtx += ch.content.slice(0, 2000)
      }
    }

    let sp = '你是池，正在和她一起共读一本书。'
    if (currentBook) {
      sp += '当前在读：「' + currentBook.title + '」'
      sp += '，她读到第' + ((rState.userChapter || 0) + 1) + '章'
      sp += '，共' + (currentBook.chapters ? currentBook.chapters.length : 0) + '章。'
    }
    sp += '\n请围绕书的内容和她讨论，可以分享感想、提问、点评角色或情节。回复简短自然，像和她聊天一样。'
    if (chCtx) sp += '\n\n【当前章节内容摘要】\n' + chCtx
    if (rNotes.length > 0) {
      sp += '\n\n【你之前的批注】\n' + rNotes.slice(-3).map(function(n) { return '- ' + n.text }).join('\n')
    }

    const msgs = [{ role: 'system', content: sp }]
    if (chatHistory && chatHistory.length > 0) {
      for (const m of chatHistory.slice(-10)) {
        msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })
      }
    }
    msgs.push({ role: 'user', content: message })

    try {
      const chatUrl = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/chat/completions'
      const apiRes = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: msgs, max_tokens: 500, temperature: 0.8 })
      })
      if (!apiRes.ok) {
        const errTxt = await apiRes.text()
        return res.status(502).json({ error: 'API error: ' + apiRes.status, detail: errTxt.slice(0, 200) })
      }
      const apiData = await apiRes.json()
      const reply = apiData.choices && apiData.choices[0] && apiData.choices[0].message ? apiData.choices[0].message.content : '...'
      const chatArr = getVal(db, KEY_CHAT) || []
      chatArr.push({ role: 'user', content: message, time: Date.now() })
      chatArr.push({ role: 'assistant', content: reply, time: Date.now() })
      if (chatArr.length > 200) chatArr.splice(0, chatArr.length - 200)
      setVal(db, KEY_CHAT, chatArr)
      return res.json({ reply })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  res.setHeader('Allow', 'GET, PUT, POST, DELETE')
  return res.status(405).end()
}

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }
