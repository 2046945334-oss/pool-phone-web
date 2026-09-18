// pages/api/debug-db.js - Temporary debug endpoint
import { getDb } from '../../lib/db'
const path = require('path')

export default function handler(req, res) {
  const DATA_DIR = process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data' : path.join(process.cwd(), '.data'))
  const DB_PATH = path.join(DATA_DIR, 'pool.db')
  
  const db = getDb()
  const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_avatar_gallery'").get()
  let count = 0
  try { count = JSON.parse(row?.value || '{}').avatars?.length || 0 } catch {}
  
  res.json({
    DATA_DIR,
    DB_PATH,
    NODE_ENV: process.env.NODE_ENV || '(not set)',
    HAS_DATA_DIR_ENV: !!process.env.DATA_DIR,
    cwd: process.cwd(),
    avatarCount: count
  })
}
