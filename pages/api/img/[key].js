// pages/api/img/[key].js - Serve uploaded images
import { getDb } from '../../../lib/db'

export default function handler(req, res) {
  const { key } = req.query
  if (!key) return res.status(400).end()

  try {
    const db = getDb()
    const row = db.prepare("SELECT mime, data FROM uploads WHERE key = ?").get(key)
    if (!row) return res.status(404).json({ error: 'Not found' })

    const buffer = Buffer.from(row.data, 'base64')
    res.setHeader('Content-Type', row.mime)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.status(200).end(buffer)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}