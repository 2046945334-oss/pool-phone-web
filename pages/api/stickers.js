import { getDb } from '../../lib/db'

function getStickers() {
  const db = getDb()
  const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_stickers'").get()
  return row ? JSON.parse(row.value) : []
}

function setStickers(stickers) {
  const db = getDb()
  db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run('pool_stickers', JSON.stringify(stickers))
}

export default async function handler(req, res) {
  const { method } = req
  try {
    if (method === 'GET') {
      return res.json({ stickers: getStickers() })
    }
    if (method === 'POST') {
      const { name, url, data, category } = req.body
      let finalUrl = url
      if (data && data.startsWith('data:image/')) {
        try {
          const uploadRes = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data })
          })
          const uploadData = await uploadRes.json()
          if (uploadData.url) finalUrl = uploadData.url
        } catch {}
      }
      let detectedContent = name || ''
      if (finalUrl && !name) {
        try {
          const visionRes = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/vision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: finalUrl, prompt: '这张图片的情绪或内容是什么？用2-4个字简短描述' })
          })
          const visionData = await visionRes.json()
          if (visionData.description) detectedContent = visionData.description
        } catch {}
      }
      if (!detectedContent) detectedContent = '表情包'
      const stickers = getStickers()
      const newSticker = {
        id: Date.now() + Math.random(),
        name: detectedContent,
        url: finalUrl,
        category: category || 'custom',
        createdAt: new Date().toISOString()
      }
      stickers.push(newSticker)
      setStickers(stickers)
      return res.json({ success: true, sticker: newSticker })
    }
    if (method === 'DELETE') {
      const { id } = req.query
      const stickers = getStickers()
      const filtered = stickers.filter(s => s.id != id)
      setStickers(filtered)
      return res.json({ success: true })
    }
    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
