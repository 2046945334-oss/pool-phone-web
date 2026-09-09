// Music API proxy - forwards requests to music server with auth token
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const musicServer = process.env.MUSIC_SERVER_URL || 'https://musicc.zeabur.app'
  // Accept token from: request header > query param > env var
  const musicToken = req.headers['x-auth-token'] || req.query.token || process.env.MUSIC_TOKEN || ''

  const { path, token: _t, ...query } = req.query
  const apiPath = Array.isArray(path) ? path.join('/') : (path || '')

  const params = new URLSearchParams(query)
  const url = `${musicServer}/${apiPath}${params.toString() ? '?' + params : ''}`

  try {
    const fetchHeaders = { 'User-Agent': 'Mozilla/5.0' }
    if (musicToken) fetchHeaders['X-Auth-Token'] = musicToken
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
