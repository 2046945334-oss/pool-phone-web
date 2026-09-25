// pages/api/video-proxy.js
// Proxy Bilibili video stream with correct Referer header
// This allows <video> tag to play B站 videos (same-origin = canvas screenshot possible)

export const config = {
  api: { responseLimit: false, bodyParser: false }
}

export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).end('url required')

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/',
      'Origin': 'https://www.bilibili.com'
    }

    // Forward Range header for seeking support
    if (req.headers.range) {
      headers['Range'] = req.headers.range
    }

    const upstream = await fetch(url, { headers, redirect: 'follow' })

    // Forward status and key headers
    res.status(upstream.status)
    const ct = upstream.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    const cl = upstream.headers.get('content-length')
    if (cl) res.setHeader('Content-Length', cl)
    const cr = upstream.headers.get('content-range')
    if (cr) res.setHeader('Content-Range', cr)
    const ar = upstream.headers.get('accept-ranges')
    if (ar) res.setHeader('Accept-Ranges', ar)
    else res.setHeader('Accept-Ranges', 'bytes')

    // Allow cross-origin for canvas
    res.setHeader('Access-Control-Allow-Origin', '*')

    // Stream the body
    const reader = upstream.body.getReader()
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { res.end(); return }
        const ok = res.write(Buffer.from(value))
        if (!ok) {
          await new Promise(resolve => res.once('drain', resolve))
        }
      }
    }

    req.on('close', () => { try { reader.cancel() } catch {} })
    await pump()
  } catch (e) {
    if (!res.headersSent) res.status(500).end('Proxy error: ' + e.message)
  }
}
