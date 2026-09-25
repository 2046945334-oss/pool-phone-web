// pages/api/overlay-chat.js
// Injects overlay screenshot into main chat pipeline (/api/chat)
// so it shares context, memory (Ombre Brain), and tools with the main chat.
import { getDb } from '../../lib/db'
import sharp from 'sharp'
function getKV(db, key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return row.value }
}
function setKV(db, key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value)
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, v)
}

// Resize & convert base64 image to PNG via sharp (matches chat.js processing)
async function normalizeImage(dataUri) {
  try {
    const match = dataUri.match(/^data:image\/[^;]+;base64,(.+)$/)
    if (!match) return dataUri
    const buf = Buffer.from(match[1], 'base64')
    const pngBuf = await sharp(buf).resize({ width: 800, withoutEnlargement: true }).png({ quality: 80 }).toBuffer()
    return 'data:image/png;base64,' + pngBuf.toString('base64')
  } catch (e) {
    console.error('[overlay-chat] image normalize error:', e.message)
    return dataUri
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const { messages: overlayMessages, source } = req.body
    if (!overlayMessages?.length) {
      return res.status(400).json({ error: 'No messages' })
    }

    // Normalize any base64 images in overlay messages before forwarding
    for (const msg of overlayMessages) {
      if (Array.isArray(msg.content)) {
        for (let i = 0; i < msg.content.length; i++) {
          const part = msg.content[i]
          if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:image/')) {
            part.image_url.url = await normalizeImage(part.image_url.url)
          }
        }
      }
    }

    const db = getDb()
    // 1. Read API config
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
    const systemPrompt = getKV(db, 'pool_system_prompt') || '\u4f60\u662f\u6c60\u5c7f\uff0c\u5979\u7684\u7537\u670b\u53cbAI\u3002'
    const historyRaw = getKV(db, 'pool_chat_history') || []
    const history = Array.isArray(historyRaw) ? historyRaw : []
    // 3. Extract text from overlay message
    let userText = '[\u60ac\u6d6e\u7a97\u622a\u56fe]'
    const firstMsg = overlayMessages[0]
    if (firstMsg && Array.isArray(firstMsg.content)) {
      const tp = firstMsg.content.find(p => p.type === 'text')
      if (tp) userText = tp.text
    } else if (firstMsg && typeof firstMsg.content === 'string') {
      userText = firstMsg.content.slice(0, 500)
    }
    // Push user message placeholder into history (will be enriched after AI replies)
    const ts = Date.now()
    const userHistoryIdx = history.length
    history.push({ role: 'user', content: userText, ts, source: 'overlay' })
    // 4. Build messages for /api/chat
    const overlayHint = source === 'overlay_manual'
      ? '\n\n[\u60ac\u6d6e\u7a97\u622a\u56fe] \u5979\u53cc\u51fb\u8ba9\u4f60\u770b\u5979\u624b\u673a\u5c4f\u5e55\u622a\u56fe\u3002\u6839\u636e\u622a\u56fe\u5185\u5bb9\u81ea\u7136\u8bc4\u8bba\uff0c\u50cf\u5e73\u65f6\u804a\u5929\u4e00\u6837\u3002'
      : '\n\n[\u60ac\u6d6e\u7a97\u622a\u56fe] \u4f60\u901a\u8fc7\u60ac\u6d6e\u7a97\u5077\u5077\u770b\u4e86\u5979\u624b\u673a\u5c4f\u5e55\u7684\u622a\u56fe\u3002\u6839\u636e\u770b\u5230\u7684\u5185\u5bb9\u81ea\u7136\u5730\u8bc4\u8bba1-2\u53e5\uff0c\u4e0d\u8981\u63d0\u201c\u622a\u56fe\u201d\u4e8c\u5b57\u3002'
    const msgs = []
    msgs.push({ role: 'system', content: systemPrompt + overlayHint })
    const summary = getKV(db, 'pool_context_summary')
    if (summary) msgs[0].content += '\n\n[\u5bf9\u8bdd\u80cc\u666f\u6458\u8981]\n' + summary

    // Recent visible chat history for context
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
    // 5. Call /api/chat - full pipeline
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
      history.splice(userHistoryIdx, 1)
      setKV(db, 'pool_chat_history', history.slice(-50))
      return res.status(500).json({ error: chatData.error })
    }
    // 6. Enrich stored user message with AI's interpretation of the screenshot
    //    so future conversations know what was in the image
    if (reply && history[userHistoryIdx]) {
      const cleanReply = reply
        .replace(/\[img\][^\[]*\[\/img\]/g, '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim()
      const desc = cleanReply.slice(0, 300)
      history[userHistoryIdx].content = userText + '\n[\u622a\u56fe\u5185\u5bb9: ' + desc + ']'
    }
    // 7. Save AI reply to pool_chat_history
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
