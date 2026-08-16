// pages/api/diary.js — 日记API
import { getDb } from '../../lib/db'

export default async function handler(req, res) {
  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS diary_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL DEFAULT 'pool',
    content TEXT NOT NULL,
    mood TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  // 迁移旧数据：把kv表里的pool_diary迁移过来
  try {
    const oldData = db.prepare("SELECT value FROM kv WHERE key = 'pool_diary'").get()
    if (oldData) {
      const entries = JSON.parse(oldData.value)
      if (Array.isArray(entries) && entries.length > 0) {
        const insert = db.prepare("INSERT INTO diary_entries (author, content, mood, created_at) VALUES (?, ?, ?, ?)")
        for (const e of entries) {
          const existing = db.prepare("SELECT id FROM diary_entries WHERE content = ? AND author = ?").get(e.content || e.text, e.author || 'pool')
          if (!existing) {
            insert.run(e.author || 'pool', e.content || e.text || '', e.mood || null, e.date || e.created_at || new Date().toISOString())
          }
        }
        // 迁移完删掉旧key
        db.prepare("DELETE FROM kv WHERE key = 'pool_diary'").run()
      }
    }
  } catch {}

  if (req.method === 'GET') {
    const rows = db.prepare("SELECT * FROM diary_entries ORDER BY created_at DESC LIMIT 50").all()
    return res.json({ entries: rows })
  }

  if (req.method === 'POST') {
    const { content, mood, author } = req.body || {}
    if (!content) return res.status(400).json({ error: 'content required' })
    db.prepare("INSERT INTO diary_entries (author, content, mood) VALUES (?, ?, ?)")
      .run(author || 'user', content, mood || null)
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'method not allowed' })
}