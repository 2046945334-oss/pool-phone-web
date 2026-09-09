// Music API proxy - forwards requests to music server
// Passes X-Auth-Token for authentication
import { getDb } from '../../../lib/db'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token')
  if (req.method === 'OPTIONS') return res.status(200).end()

  let musicServer = process.env.MUSIC_SERVER_URL || ''
  let musicToken = ''
  try {
    const db = getDb()
    const serverRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_music_server'").get()
    if (serverRow) musicServer = serverRow.value.replace(/^"/g, '').replace(/"$/g, '')
    const tokenRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_music_token'").get()
    if (tokenRow) musicToken = tokenRow.value.replace(/^"/g, '').replace(/"$/g, '')
  } catch {}
  if (!musicServer) musicServer = 'https://musicc.zeabur.app'

  const reqToken = req.headers['x-auth-token'] || req.query.token || musicToken

  const { path, token: _t, ...query } = req.query
  const apiPath = Array.isArray(path) ? path.join('/') : (path || '')

  const params = new URLSearchParams(query)
  const url = `${musicServer}/${apiPath}${params.toString() ? '?' + params : ''}`

  try {
    const fetchHeaders = { 'User-Agent': 'Mozilla/5.0' }
    if (reqToken) fetchHeaders['X-Auth-Token'] = reqToken
    const resp = await fetch(url, {
      method: req.method,
      headers: fetchHeaders,
    })
    const data = await resp.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
