// pages/api/file/upload.js - General file upload (images, HTML, any file)
import { getDb } from '../../../lib/db'
import crypto from 'crypto'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const { data, filename, mime: explicitMime } = req.body
  if (!data) return res.status(400).json({ error: 'No data' })

  // Strip data URI prefix if present
  const base64 = data.includes(',') ? data.split(',')[1] : data
  const mimeMatch = data.match(/^data:([^;]+);/)
  const mime = explicitMime || (mimeMatch ? mimeMatch[1] : 'application/octet-stream')
  
  // Derive extension from filename or mime
  const origExt = filename ? filename.split('.').pop().toLowerCase() : ''
  const ext = origExt || (mime.includes('html') ? 'html' : mime.includes('json') ? 'json' : mime.includes('text') ? 'txt' : 'bin')
  const safeName = filename ? filename.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, '_') : `file_${Date.now()}`
  
  const id = crypto.randomBytes(8).toString('hex')
  const key = `f_${id}_${safeName}`

  try {
    const db = getDb()
    db.prepare("CREATE TABLE IF NOT EXISTS uploads (key TEXT PRIMARY KEY, mime TEXT, data TEXT, created_at TEXT)").run()
    db.prepare("INSERT OR REPLACE INTO uploads (key, mime, data, created_at) VALUES (?, ?, ?, ?)").run(key, mime, base64, new Date().toISOString())
    
    const url = `/api/file/${key}`
    return res.json({ url, key, filename: safeName, mime })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
}
