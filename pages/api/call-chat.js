// pages/api/call-chat.js - Voice call streaming with sentence-level SSE
// Streams directly from LLM, splits into sentences as they arrive for low-latency TTS
import { getDb } from '../../lib/db'

export const config = { api: { bodyParser: true, responseLimit: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const { messages, apiBase, apiKey, model } = req.body
  
  if (!apiBase || !apiKey) {
    return res.status(400).json({ error: 'Missing API configuration' })
  }

  // Load system prompt from DB (same as chat.js uses)
  let systemPrompt = ''
  try {
    const db = getDb()
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_system_prompt'").get()
    if (row) systemPrompt = row.value
  } catch {}

  // Load recent chat history for context continuity
  let chatHistory = []
  try {
    const db = getDb()
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_chat_history'").get()
    if (row) {
      const history = JSON.parse(row.value)
      // Take last 10 messages for context
      chatHistory = (history || []).slice(-10).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content || m.text || ''
      })).filter(m => m.content)
    }
  } catch {}

  // Build messages array
  const callSystemMsg = (systemPrompt ? systemPrompt + '\n\n' : '') +
    '[当前模式：语音通话中]\n' +
    '- 你正在和她语音通话，回复要更口语化、简短\n' +
    '- 不要用markdown格式、表情包、图片标记\n' +
    '- 像打电话一样自然地说话\n' +
    '- 回复1-3句就好，除非她问了复杂的问题\n' +
    '- 不要发[img]标签、不要发[voice]标签'

  const allMessages = [
    { role: 'system', content: callSystemMsg },
    ...chatHistory,
    ...(messages || [])
  ]

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const base = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = base + '/v1/chat/completions'

  try {
    const llmRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: allMessages,
        stream: true,
        max_tokens: 300,
        temperature: 0.8
      })
    })

    if (!llmRes.ok) {
      const errText = await llmRes.text()
      res.write(`data: ${JSON.stringify({ error: `LLM error (${llmRes.status}): ${errText.slice(0, 200)}` })}\n\n`)
      res.end()
      return
    }

    const reader = llmRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let sentenceBuffer = ''

    // Sentence boundary pattern: Chinese or English punctuation
    const sentenceEnd = /[。！？\n.!?]/

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        
        try {
          const data = JSON.parse(payload)
          const delta = data.choices?.[0]?.delta?.content
          if (!delta) continue

          fullText += delta
          sentenceBuffer += delta

          // Check if we have a complete sentence
          const match = sentenceBuffer.match(sentenceEnd)
          if (match) {
            const idx = sentenceBuffer.lastIndexOf(match[0])
            const sentence = sentenceBuffer.slice(0, idx + 1).trim()
            sentenceBuffer = sentenceBuffer.slice(idx + 1)
            
            if (sentence) {
              // Clean for TTS
              const clean = sentence
                .replace(/\[img\][^\[]*\[\/img\]/g, '')
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/\*([^*]+)\*/g, '$1')
                .trim()
              if (clean) {
                res.write(`data: ${JSON.stringify({ type: 'sentence', text: clean })}\n\n`)
                // Flush immediately for low latency
                if (typeof res.flush === 'function') res.flush()
              }
            }
          }
        } catch {}
      }
    }

    // Flush any remaining text
    if (sentenceBuffer.trim()) {
      const clean = sentenceBuffer.trim()
        .replace(/\[img\][^\[]*\[\/img\]/g, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .trim()
      if (clean) {
        res.write(`data: ${JSON.stringify({ type: 'sentence', text: clean })}\n\n`)
      }
    }

    // Clean full text for storage
    const cleanFull = fullText
      .replace(/\[img\][^\[]*\[\/img\]/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .trim()

    res.write(`data: ${JSON.stringify({ type: 'done', fullText: cleanFull })}\n\n`)

  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
  }

  res.end()
}