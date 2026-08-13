export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).end()
  }

  const { apiBase, apiKey } = req.body
  if (!apiBase || !apiKey) {
    return res.status(400).json({ error: 'apiBase and apiKey required' })
  }

  try {
    const base = apiBase.replace(/\/+$/, '')
    const url = `${base}/v1/models`
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    })
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `API returned ${response.status}` })
    }

    const data = await response.json()
    const models = (data.data || []).map(m => m.id).sort()
    return res.json({ models })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}