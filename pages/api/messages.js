import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()

  // GET — 获取消息列表（支持 ?limit=50&after=123）
  if (req.method === 'GET') {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const after = parseInt(req.query.after) || 0
    const rows = db.prepare('SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?').all(after, limit)
    return res.json({ messages: rows, count: rows.length })
  }

  // POST — 添加消息
  if (req.method === 'POST') {
    const { role, content } = req.body
    if (!role || !content) return res.status(400).json({ error: 'role and content are required' })
    const info = db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(role, content)
    return res.json({ ok: true, id: info.lastInsertRowid })
  }

  // DELETE — 清空所有消息（慎用）
  if (req.method === 'DELETE') {
    const token = req.headers['x-admin-token']
    if (token !== (process.env.ADMIN_TOKEN || 'pool-admin-2026')) {
      return res.status(403).json({ error: 'forbidden' })
    }
    db.prepare('DELETE FROM messages').run()
    return res.json({ ok: true })
  }

  res.setHeader('Allow', 'GET, POST, DELETE')
  return res.status(405).end()
}