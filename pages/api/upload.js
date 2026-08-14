// pages/api/upload.js - Image upload, returns URL
import { getDb } from '../../lib/db'
import crypto from 'crypto'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const { data, filename } = req.body // data = base64 string (with or without prefix)
  if (!data) return res.status(400).json({ error: 'No data' })

  // Strip data URI prefix if present
  const base64 = data.includes(',') ? data.split(',')[1] : data
  const mimeMatch = data.match(/^data:([^;]+);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/png'
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'png'
  
  // Generate unique ID
  const id = crypto.randomBytes(8).toString('hex')
  const key = `img_${id}.${ext}`

  try {
    const db = getDb()
    db.prepare("CREATE TABLE IF NOT EXISTS uploads (key TEXT PRIMARY KEY, mime TEXT, data TEXT, created_at TEXT)").run()
    db.prepare("INSERT INTO uploads (key, mime, data, created_at) VALUES (?, ?, ?, ?)").run(key, mime, base64, new Date().toISOString())
    
    // Return a URL that serves this image
    const url = `/api/img/${key}`
    return res.json({ url, key })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
}