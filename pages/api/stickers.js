import Keyv from 'keyv'
import { KeyvFile } from 'keyv-file'
import path from 'path'

const store = new KeyvFile({ filename: path.join(process.cwd(), '.data/kv.json') })
const kv = new Keyv({ store })

export default async function handler(req, res) {
  const { method } = req

  try {
    if (method === 'GET') {
      // 获取表情包列表
      const stickers = await kv.get('pool_stickers') || []
      return res.json({ stickers })
    }

    if (method === 'POST') {
      // 上传表情包
      const { name, url, data, category } = req.body
      
      let finalUrl = url
      
      // 如果是base64数据，上传到后端
      if (data && data.startsWith('data:image/')) {
        const uploadRes = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data })
        })
        const uploadData = await uploadRes.json()
        if (uploadData.url) finalUrl = uploadData.url
      }

      // OCR识别内容（可选）
      let detectedContent = name || '未命名'
      if (finalUrl && !name) {
        try {
          // 调用vision API识别图片内容
          const visionRes = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/vision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: finalUrl, prompt: '这张图片的情绪或内容是什么？用2-4个字简短描述' })
          })
          const visionData = await visionRes.json()
          if (visionData.description) detectedContent = visionData.description
        } catch {}
      }

      const stickers = await kv.get('pool_stickers') || []
      const newSticker = {
        id: Date.now() + Math.random(),
        name: detectedContent,
        url: finalUrl,
        category: category || 'custom',
        createdAt: new Date().toISOString()
      }
      stickers.push(newSticker)
      await kv.set('pool_stickers', stickers)

      return res.json({ success: true, sticker: newSticker })
    }

    if (method === 'DELETE') {
      // 删除表情包
      const { id } = req.query
      const stickers = await kv.get('pool_stickers') || []
      const filtered = stickers.filter(s => s.id != id)
      await kv.set('pool_stickers', filtered)
      return res.json({ success: true })
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
