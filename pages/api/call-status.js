// pages/api/call-status.js - Incoming call status API
// GET: check if there's an incoming call
// POST: AI initiates a call (body: { reason?: string })
// DELETE: clear incoming call
import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'GET') {
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_incoming_call'").get()
      if (!row) return res.json({ calling: false })
      const data = JSON.parse(row.value)
      // Auto-expire after 60 seconds
      if (Date.now() - data.ts > 60000) {
        db.prepare("DELETE FROM kv WHERE key = 'pool_incoming_call'").run()
        return res.json({ calling: false })
      }
      return res.json({ calling: true, reason: data.reason || '', ts: data.ts })
    } catch {
      return res.json({ calling: false })
    }
  }

  if (req.method === 'POST') {
    const { reason } = req.body || {}
    const data = { calling: true, reason: reason || '', ts: Date.now() }
    db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())").run('pool_incoming_call', JSON.stringify(data))
    return res.json({ ok: true })
  }

  if (req.method === 'DELETE') {
    db.prepare("DELETE FROM kv WHERE key = 'pool_incoming_call'").run()
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
