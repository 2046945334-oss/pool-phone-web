// Music API proxy - forwards requests to NeteaseCloudMusicApi server
// Avoids CORS issues when calling from frontend
export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Music server URL: env > KV store > default
  const musicServer = process.env.MUSIC_SERVER_URL || 'https://musicc.zeabur.app'

  const { path, ...query } = req.query
  const apiPath = Array.isArray(path) ? path.join('/') : (path || '')
  const params = new URLSearchParams(query)
  const url = `${musicServer}/${apiPath}${params.toString() ? '?' + params : ''}`

  try {
    const resp = await fetch(url, {
      method: req.method,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    const data = await resp.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
