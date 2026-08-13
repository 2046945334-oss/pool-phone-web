import { getDb } from '../../../lib/db'

export default function handler(req, res) {
  const { key } = req.query
  if (!key) return res.status(400).json({ error: 'key is required' })

  const db = getDb()

  if (req.method === 'GET') {
    const row = db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get(key)
    if (!row) return res.status(404).json({ error: 'not found' })
    try {
      return res.json({ key, value: JSON.parse(row.value), updated_at: row.updated_at })
    } catch {
      return res.json({ key, value: row.value, updated_at: row.updated_at })
    }
  }

  if (req.method === 'PUT') {
    const { value } = req.body
    if (value === undefined) return res.status(400).json({ error: 'value is required' })
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, serialized)
    return res.json({ ok: true, key })
  }

  if (req.method === 'DELETE') {
    db.prepare('DELETE FROM kv WHERE key = ?').run(key)
    return res.json({ ok: true })
  }

  res.setHeader('Allow', 'GET, PUT, DELETE')
  return res.status(405).end()
}

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
}