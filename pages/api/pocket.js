// pages/api/pocket.js - 投递箱 API（统一使用 lib/db 的表结构）
import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()
  // pocket 表已由 lib/db.js 统一创建，这里不再重复建表

  if (req.method === 'GET') {
    const { status, limit } = req.query
    try {
      let rows
      if (status) {
        rows = db.prepare('SELECT * FROM pocket WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, parseInt(limit) || 50)
      } else {
        rows = db.prepare('SELECT * FROM pocket ORDER BY id DESC LIMIT ?').all(parseInt(limit) || 50)
      }
      return res.json({ items: rows, total: db.prepare('SELECT COUNT(*) as c FROM pocket').get().c })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (req.method === 'POST') {
    const { content, type, priority, deadline, needs_wakeup } = req.body
    if (!content) return res.status(400).json({ error: 'Need content' })
    // Dedup: check if same content exists in last 24h
    try {
      const existing = db.prepare("SELECT id FROM pocket WHERE content = ? AND created_at > unixepoch() - 86400").get(content)
      if (existing) return res.json({ ok: true, id: existing.id, duplicate: true })
      const result = db.prepare('INSERT INTO pocket (type, content, priority, deadline, needs_wakeup) VALUES (?, ?, ?, ?, ?)').run(
        type || 'todo', content, priority || 'normal', deadline || '', needs_wakeup ? 1 : 0
      )
      return res.json({ ok: true, id: result.lastInsertRowid })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (req.method === 'PATCH') {
    const { id, status, result, result_type } = req.body
    if (!id) return res.status(400).json({ error: 'Need id' })
    try {
      const updates = []
      const params = []
      if (status) { updates.push('status = ?'); params.push(status) }
      if (result) { updates.push('result = ?'); params.push(result) }
      if (result_type) { updates.push('result_type = ?'); params.push(result_type) }
      if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' })
      updates.push('updated_at = unixepoch()')
      params.push(id)
      db.prepare('UPDATE pocket SET ' + updates.join(', ') + ' WHERE id = ?').run(...params)
      return res.json({ ok: true })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'Need id' })
    try {
      db.prepare('DELETE FROM pocket WHERE id = ?').run(id)
      return res.json({ ok: true })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
