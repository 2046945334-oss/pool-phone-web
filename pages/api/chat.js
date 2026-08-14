// pages/api/chat.js - proxies chat requests to user's configured AI API
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { messages, apiBase, apiKey, model } = req.body
  if (!apiBase || !apiKey) return res.status(400).json({ error: 'Missing API configuration. apiBase=' + (apiBase||'empty') + ' apiKey=' + (apiKey ? 'set('+apiKey.length+'chars)' : 'empty') })

  const base = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = `${base}/v1/chat/completions`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages,
        stream: false,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return res.status(response.status).json({ error: errText, debug: { url, model: model || 'gpt-4o-mini', status: response.status } })
    }

    const data = await response.json()
    const reply = data.choices?.[0]?.message?.content || ''
    return res.status(200).json({ reply })
  } catch (err) {
    return res.status(500).json({ error: err.message, debug: { url, model: model || 'gpt-4o-mini' } })
  }
}
