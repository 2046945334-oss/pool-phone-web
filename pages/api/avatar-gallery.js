// pages/api/avatar-gallery.js - Avatar Gallery API
// Stores avatar images in DB, supports add/delete/list/set-active
import { getDb } from '../../lib/db'

const GALLERY_KEY = 'pool_avatar_gallery'
const THEME_KEY = 'pool_theme'

function getGallery(db) {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(GALLERY_KEY)
  if (!row) return { avatars: [] }
  try { return JSON.parse(row.value) } catch { return { avatars: [] } }
}

function saveGallery(db, gallery) {
  db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())").run(GALLERY_KEY, JSON.stringify(gallery))
}

function getTheme(db) {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(THEME_KEY)
  if (!row) return {}
  try { return JSON.parse(row.value) } catch { return {} }
}

function saveTheme(db, theme) {
  db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())").run(THEME_KEY, JSON.stringify(theme))
}

export default async function handler(req, res) {
  const db = getDb()
  const { action } = req.query

  // GET /api/avatar-gallery?action=list
  if (req.method === 'GET' && action === 'list') {
    const gallery = getGallery(db)
    const theme = getTheme(db)
    return res.json({
      avatars: gallery.avatars,
      currentAI: theme.avatarAI || '',
      currentUser: theme.avatarUser || ''
    })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = req.body || {}

  // POST action=add — add avatar(s) to gallery
  if (action === 'add') {
    const { url, urls, tag, tags, owner } = body
    // owner: 'ai' | 'user' | 'both' (default 'both')
    const gallery = getGallery(db)
    const toAdd = urls || (url ? [url] : [])
    if (toAdd.length === 0) return res.status(400).json({ error: 'url or urls required' })
    const now = new Date().toISOString()
    for (const u of toAdd) {
      // Deduplicate
      if (gallery.avatars.some(a => a.url === u)) continue
      gallery.avatars.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        url: u,
        tags: tags || (tag ? [tag] : []),
        owner: owner || 'both',
        addedAt: now,
        addedBy: body.addedBy || 'user'
      })
    }
    saveGallery(db, gallery)
    return res.json({ ok: true, count: gallery.avatars.length })
  }

  // POST action=delete — remove avatar by id
  if (action === 'delete') {
    const { id } = body
    if (!id) return res.status(400).json({ error: 'id required' })
    const gallery = getGallery(db)
    gallery.avatars = gallery.avatars.filter(a => a.id !== id)
    saveGallery(db, gallery)
    return res.json({ ok: true })
  }

  // POST action=set — set avatar as current (updates pool_theme)
  if (action === 'set') {
    const { target, url } = body
    // target: 'ai' or 'user'
    if (!target || !url) return res.status(400).json({ error: 'target and url required' })
    const theme = getTheme(db)
    if (target === 'ai') {
      theme.avatarAI = url
    } else if (target === 'user') {
      theme.avatarUser = url
    } else {
      return res.status(400).json({ error: 'target must be ai or user' })
    }
    saveTheme(db, theme)
    return res.json({ ok: true, target, url })
  }

  return res.status(400).json({ error: 'Unknown action. Use: list, add, delete, set' })
}

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
}
