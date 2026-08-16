import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS garden_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    reason TEXT,
    x REAL,
    y REAL,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  if (req.method === 'GET') {
    const items = db.prepare('SELECT * FROM garden_items ORDER BY created_at ASC').all()
    return res.json({ items })
  }

  if (req.method === 'POST') {
    const { type, reason, x, y } = req.body || {}
    if (!type) return res.status(400).json({ error: 'type required' })

    // Valid types
    const validTypes = ['seedling', 'flower', 'tree', 'mushroom', 'crystal', 'heart', 'lantern', 'butterfly', 'star', 'rain']
    const itemType = validTypes.includes(type) ? type : 'seedling'

    // Auto-position if not provided
    const posX = x !== undefined ? x : 10 + Math.random() * 80
    const posY = y !== undefined ? y : 62 + Math.random() * 28

    const result = db.prepare('INSERT INTO garden_items (type, reason, x, y) VALUES (?, ?, ?, ?)').run(itemType, reason || null, posX, posY)

    return res.json({ success: true, id: result.lastInsertRowid, type: itemType, reason, x: posX, y: posY })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    if (id) {
      db.prepare('DELETE FROM garden_items WHERE id = ?').run(id)
    }
    return res.json({ success: true })
  }

  res.status(405).json({ error: 'method not allowed' })
}