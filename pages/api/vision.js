import { getDb } from '../../lib/db'

function getApiConfig(feature) {
  const db = getDb()
  const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
  const configs = row ? JSON.parse(row.value) : {}
  const fc = configs[feature] || {}
  const defRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
  const def = defRow ? JSON.parse(defRow.value) : {}
  return { apiBase: fc.apiBase || def.apiBase, apiKey: fc.apiKey || def.apiKey, model: fc.model || def.model }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { image, prompt } = req.body
  if (!image) return res.status(400).json({ error: 'image is required' })
  
  const cfg = getApiConfig('memory') // use cheap model
  if (!cfg.apiBase || !cfg.apiKey) {
    return res.json({ description: '' }) // silently skip if no API configured
  }
  
  try {
    const content = [
      { type: 'text', text: prompt || '这张图片的情绪或内容是什么？用2-4个字简短描述' }
    ]
    
    if (image.startsWith('data:')) {
      content.push({ type: 'image_url', image_url: { url: image } })
    } else {
      content.push({ type: 'image_url', image_url: { url: image } })
    }
    
    const apiRes = await fetch(`${cfg.apiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content }],
        max_tokens: 20
      })
    })
    const data = await apiRes.json()
    const description = data.choices?.[0]?.message?.content?.trim() || ''
    return res.json({ description })
  } catch (e) {
    return res.json({ description: '' })
  }
}
