// pages/api/notifications.js - store/retrieve recent notifications
import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'GET') {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_notifications')
    if (!row) return res.status(200).json({ notifications: [] })
    try {
      return res.status(200).json({ notifications: JSON.parse(row.value) })
    } catch {
      return res.status(200).json({ notifications: [] })
    }
  }

  if (req.method === 'POST') {
    // Accept array of notifications [{app, content, time}]
    const { notifications } = req.body
    if (!Array.isArray(notifications)) return res.status(400).json({ error: 'notifications must be array' })
    // Keep only last 20
    const trimmed = notifications.slice(-20)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run('pool_notifications', JSON.stringify(trimmed), Date.now())
    return res.status(200).json({ ok: true, count: trimmed.length })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
