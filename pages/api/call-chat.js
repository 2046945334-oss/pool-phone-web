// pages/api/call-chat.js - Voice call streaming proxy
// Internally calls /api/chat (reusing ALL logic: tools, MCP, memory, system prompt, etc.)
// Then streams the reply back as sentence-level SSE events for low-latency TTS

export const config = { api: { bodyParser: true, responseLimit: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const { messages, apiBase, apiKey, model, sessionId, fcmToken } = req.body
  
  if (!apiBase || !apiKey) {
    return res.status(400).json({ error: 'Missing API configuration' })
  }

  // Append voice call hint to the messages array
  // This gets injected alongside whatever system prompt chat.js already loads
  const callHint = {
    role: 'system',
    content: '[当前模式：语音通话中]\n' +
      '- 你正在和她语音通话，回复要更口语化、简短\n' +
      '- 不要用markdown格式、表情包、图片标记\n' +
      '- 像打电话一样自然地说话\n' +
      '- 回复1-3句就好，除非她问了复杂的问题\n' +
      '- 不要发[img]标签、不要发[voice]标签\n' +
      '- 工具调用照常可以用，但回复用户的话要简短口语'
  }
  const callMessages = [...(messages || []), callHint]

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  try {
    // Internal call to /api/chat — reuses EVERYTHING (system prompt, tools, MCP, memory, etc.)
    const proto = req.headers['x-forwarded-proto'] || 'http'
    const host = req.headers.host || 'localhost:3000'
    const chatUrl = `${proto}://${host}/api/chat`
    
    const chatRes = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: callMessages,
        apiBase, apiKey, model,
        sessionId: sessionId || 1,
        fcmToken
      })
    })

    if (!chatRes.ok) {
      const errText = await chatRes.text()
      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`)
      res.end()
      return
    }

    const data = await chatRes.json()
    const fullText = data.reply || data.content || ''

    if (!fullText) {
      res.write(`data: ${JSON.stringify({ type: 'done', fullText: '' })}\n\n`)
      res.end()
      return
    }

    // Clean up text for TTS
    const cleanText = fullText
      .replace(/\[img\][^\[]*\[\/img\]/g, '')
      .replace(/\[voice\][^\[]*\[\/voice\]/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .trim()

    // Split into sentences and stream them out immediately
    const parts = cleanText.split(/(?<=[。！？\n.!?])/g).filter(s => s.trim())
    const sentences = parts.length > 0 ? parts : [cleanText]
    
    for (const sentence of sentences) {
      const s = sentence.trim()
      if (s) {
        res.write(`data: ${JSON.stringify({ type: 'sentence', text: s })}\n\n`)
        // Flush for low latency
        if (typeof res.flush === 'function') res.flush()
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', fullText: cleanText })}\n\n`)

  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
  }

  res.end()
}