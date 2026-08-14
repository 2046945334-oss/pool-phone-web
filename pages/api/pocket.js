// pages/api/pocket.js - Shared pocket: drop links/text for AI to read
import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()
  db.prepare(`CREATE TABLE IF NOT EXISTS pocket (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    url TEXT,
    title TEXT,
    note TEXT,
    status TEXT DEFAULT 'unread',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run()

  if (req.method === 'GET') {
    const { status, limit } = req.query
    const where = status ? `WHERE status = ?` : ''
    const rows = status
      ? db.prepare(`SELECT * FROM pocket ${where} ORDER BY id DESC LIMIT ?`).all(status, parseInt(limit) || 50)
      : db.prepare(`SELECT * FROM pocket ORDER BY id DESC LIMIT ?`).all(parseInt(limit) || 50)
    return res.json({ items: rows, total: db.prepare(`SELECT COUNT(*) as c FROM pocket`).get().c })
  }

  if (req.method === 'POST') {
    const { content, url, title, note } = req.body
    if (!content && !url) return res.status(400).json({ error: 'Need content or url' })
    // Dedup: check if same url/content exists in last 24h
    const existing = db.prepare(`SELECT id FROM pocket WHERE (url = ? OR content = ?) AND created_at > datetime('now','-1 day','localtime')`).get(url || '', content || '')
    if (existing) return res.json({ ok: true, id: existing.id, duplicate: true })
    const result = db.prepare(`INSERT INTO pocket (content, url, title, note) VALUES (?, ?, ?, ?)`).run(content || '', url || null, title || null, note || null)
    return res.json({ ok: true, id: result.lastInsertRowid })
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body
    if (!id) return res.status(400).json({ error: 'Need id' })
    db.prepare(`UPDATE pocket SET status = ? WHERE id = ?`).run(status || 'read', id)
    return res.json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'Need id' })
    db.prepare(`DELETE FROM pocket WHERE id = ?`).run(id)
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}