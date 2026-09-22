// Proxy endpoint to download external images with correct Content-Disposition header
// This is needed because Android WebView can't use <a download> for cross-origin URLs
export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'Missing url parameter' })

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000)
    })
    if (!resp.ok) return res.status(resp.status).json({ error: 'Fetch failed: ' + resp.status })

    const contentType = resp.headers.get('content-type') || 'image/png'
    const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : contentType.includes('gif') ? '.gif' : '.jpg'
    const filename = 'chi_image_' + Date.now() + ext

    const buf = Buffer.from(await resp.arrayBuffer())

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', buf.length)
    res.status(200).end(buf)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
