// Proxy for dwell-on-something chat interface
// Maps dwell's api/tell and api/said to our chat system
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const DB = join(process.cwd(), 'data')
const CHAT_FILE = join(DB, 'dwell_chat.json')

function load() {
  try { return JSON.parse(readFileSync(CHAT_FILE, 'utf8')) }
  catch { return { items: [] } }
}
function save(data) { writeFileSync(CHAT_FILE, JSON.stringify(data)) }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { action } = req.query

  // GET /api/dwell-chat?action=said - return message history
  if (action === 'said' && req.method === 'GET') {
    const data = load()
    return res.json(data)
  }

  // POST /api/dwell-chat?action=tell - send a message and get AI response
  if (action === 'tell' && req.method === 'POST') {
    const { text } = req.body || {}
    if (!text) return res.status(400).json({ error: 'no text' })

    const data = load()
    const seq = (data.items.length || 0) + 1
    data.items.push({ seq, kind: 'her', text, ts: Date.now() })

    // Call AI using stored config
    try {
      const cfgRaw = existsSync(join(DB, 'pool_api_config_chat.json'))
        ? readFileSync(join(DB, 'pool_api_config_chat.json'), 'utf8')
        : existsSync(join(DB, 'pool_api_config.json'))
          ? readFileSync(join(DB, 'pool_api_config.json'), 'utf8')
          : '{}'
      const cfg = JSON.parse(cfgRaw)
      const apiBase = cfg.apiBase || cfg.base || ''
      const apiKey = cfg.apiKey || cfg.key || ''
      const model = cfg.model || 'gemini-2.5-flash'

      const messages = data.items.map(m => ({
        role: m.kind === 'her' ? 'user' : 'assistant',
        content: m.text || ''
      })).filter(m => m.content)

      const aiRes = await fetch(`${apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, stream: false })
      })
      const aiData = await aiRes.json()
      const reply = aiData.choices?.[0]?.message?.content || '...'

      const seq2 = seq + 1
      data.items.push({ seq: seq2, kind: 'gu', text: reply, ts: Date.now() })
      save(data)
      return res.json({ ok: true, reply, seq: seq2 })
    } catch (e) {
      save(data)
      return res.status(500).json({ error: e.message })
    }
  }

  // GET /api/dwell-chat?action=chats - return chat list
  if (action === 'chats') {
    return res.json({ items: [{ id: 'main', title: 'Chat', updatedAt: Date.now() }] })
  }

  return res.json({ ok: true })
}
