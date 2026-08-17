// Star Map API - CRUD for stars
import fs from 'fs'
import path from 'path'

const DATA_FILE = path.join(process.cwd(), 'data', 'starmap.json')

function ensureDir() {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function load() {
  ensureDir()
  if (!fs.existsSync(DATA_FILE)) return []
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) } catch { return [] }
}

function save(stars) {
  ensureDir()
  fs.writeFileSync(DATA_FILE, JSON.stringify(stars, null, 2))
}

export default function handler(req, res) {
  // CORS for srcdoc iframe (origin: null)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method === 'GET') {
    return res.json({ stars: load() })
  }

  if (req.method === 'POST') {
    const { title, date, content, brightness, from } = req.body || {}
    if (!title || !content) return res.status(400).json({ error: 'title and content required' })
    const stars = load()
    const star = {
      id: 'star-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      title: title.slice(0, 100),
      date: date || new Date().toISOString().slice(0, 10),
      content: content.slice(0, 2000),
      brightness: Math.max(1, Math.min(5, parseInt(brightness) || 3)),
      from: from === 'ai' ? 'ai' : 'user',
      createdAt: new Date().toISOString()
    }
    stars.unshift(star)
    save(stars)
    return res.json({ star })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    let stars = load()
    stars = stars.filter(s => s.id !== id)
    save(stars)
    return res.json({ ok: true })
  }

  res.status(405).json({ error: 'method not allowed' })
}
