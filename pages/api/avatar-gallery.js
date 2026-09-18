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

// Atomic read-modify-write helper to prevent race conditions
function withGalleryLock(db, fn) {
  return db.transaction(() => {
    const gallery = getGallery(db)
    const result = fn(gallery)
    saveGallery(db, gallery)
    return result
  })()
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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
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
    const toAdd = urls || (url ? [url] : [])
    if (toAdd.length === 0) return res.status(400).json({ error: 'url or urls required' })
    const now = new Date().toISOString()
    const result = withGalleryLock(db, (gallery) => {
      let added = 0
      for (const u of toAdd) {
        if (gallery.avatars.some(a => a.url === u)) continue
        gallery.avatars.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          url: u,
          desc: body.desc || '',
          tags: tags || (tag ? [tag] : []),
          owner: owner || 'both',
          addedAt: now,
          addedBy: body.addedBy || 'user'
        })
        added++
      }
      return { ok: true, added, count: gallery.avatars.length }
    })
    return res.json(result)
  }

  // POST action=delete — remove avatar by id
  if (action === 'delete') {
    const { id } = body
    if (!id) return res.status(400).json({ error: 'id required' })
    withGalleryLock(db, (gallery) => {
      gallery.avatars = gallery.avatars.filter(a => a.id !== id)
    })
    return res.json({ ok: true })
  }

  // POST action=set — set avatar as current (updates pool_theme)
  if (action === 'set') {
    const { target, url } = body
    // target: 'ai' or 'user'
    if (!target || !url) return res.status(400).json({ error: 'target and url required' })
    // Check owner permission
    const gallery = getGallery(db)
    const avatar = gallery.avatars.find(a => a.url === url)
    if (avatar && avatar.owner !== 'both') {
      if (target === 'ai' && avatar.owner === 'user') return res.status(403).json({ error: '这张头像只给用户用，不能设为AI头像' })
      if (target === 'user' && avatar.owner === 'ai') return res.status(403).json({ error: '这张头像只给AI用，不能设为用户头像' })
    }
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
