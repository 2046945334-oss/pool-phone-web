// pages/api/call-chat.js - Voice call proxy
// Calls /api/chat with stream:true, pipes SSE directly to client
export const config = { api: { bodyParser: true, responseLimit: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { messages, apiBase, apiKey, model, sessionId, fcmToken } = req.body
  if (!apiBase || !apiKey) return res.status(400).json({ error: 'Missing API config' })

  const callHint = {
    role: 'system',
    content: '[当前模式：语音通话中]\n- 回复要口语化、简短，1-3句\n- 不要markdown/表情包/[img]/[voice]标签\n- 像打电话一样自然说话\n- 工具照常可用，回复要简短口语'
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  try {
    const proto = req.headers['x-forwarded-proto'] || 'http'
    const host = req.headers.host || 'localhost:3000'
    const chatRes = await fetch(`${proto}://${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [...(messages || []), callHint],
        apiBase, apiKey, model,
        sessionId: sessionId || 1,
        fcmToken,
        stream: true
      })
    })

    if (!chatRes.ok) {
      const err = await chatRes.text()
      res.write(`data: ${JSON.stringify({ error: err })}\n\n`)
      res.end()
      return
    }

    // Pipe SSE from chat.js directly to client
    const reader = chatRes.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value, { stream: true }))
      if (typeof res.flush === 'function') res.flush()
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
  }
  res.end()
}