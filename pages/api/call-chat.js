// pages/api/call-chat.js - Streaming chat API for voice calls (SSE)
// Returns AI response as SSE events, sentence by sentence
import { getDb } from '../../lib/db'
import { saveMessage } from '../../lib/memory'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const { messages, text, sessionId: reqSessionId } = req.body
  
  // Load API config from DB
  let apiConfig = {}
  try {
    const db = getDb()
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
    if (row) apiConfig = JSON.parse(row.value)
    // Try chat-specific config
    const cfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
    if (cfgRow) {
      const configs = JSON.parse(cfgRow.value)
      if (configs.chat?.apiBase && configs.chat?.apiKey) {
        apiConfig = { ...apiConfig, ...configs.chat }
      }
    }
  } catch {}

  if (!apiConfig.apiBase || !apiConfig.apiKey) {
    return res.status(400).json({ error: 'API not configured' })
  }

  const base = apiConfig.apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = base + '/v1/chat/completions'
  const model = apiConfig.model || 'gpt-4o-mini'
  const sessionId = reqSessionId || 1

  // Save user message
  if (text) {
    saveMessage(sessionId, 'user', text)
  }

  // Load system prompt
  let systemPrompt = ''
  try {
    const db = getDb()
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_system_prompt'").get()
    if (row) systemPrompt = JSON.parse(row.value) || ''
  } catch {}
  if (!systemPrompt) systemPrompt = 'You are a helpful assistant.'

  // Add voice call context hint
  systemPrompt += '\n\n[当前模式：语音通话中]\n- 你正在和她语音通话，回复要更口语化、简短\n- 不要用markdown格式、表情包或特殊标记\n- 像打电话一样自然地说话\n- 回复1-2句就好，除非她问了复杂的问题'

  // Build messages array
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...(messages || []).slice(-20) // Keep last 20 messages for context
  ]

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        stream: true
      })
    })

    if (!apiRes.ok) {
      const err = await apiRes.text()
      res.write(`data: ${JSON.stringify({ error: err })}\n\n`)
      res.end()
      return
    }

    let fullText = ''
    let buffer = ''
    const reader = apiRes.body.getReader()
    const decoder = new TextDecoder()

    // Sentence splitting helper
    function extractSentences(text) {
      const sentences = []
      // Split on Chinese/English sentence endings
      const parts = text.split(/(?<=[。！？\n.!?])/g)
      for (let i = 0; i < parts.length - 1; i++) {
        if (parts[i].trim()) sentences.push(parts[i].trim())
      }
      // Return extracted sentences and remaining buffer
      const remaining = parts[parts.length - 1] || ''
      return { sentences, remaining }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            fullText += delta
            buffer += delta

            // Try to extract complete sentences
            const { sentences, remaining } = extractSentences(buffer)
            buffer = remaining

            for (const sentence of sentences) {
              res.write(`data: ${JSON.stringify({ type: 'sentence', text: sentence })}\n\n`)
            }
          }
        } catch {}
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      res.write(`data: ${JSON.stringify({ type: 'sentence', text: buffer.trim() })}\n\n`)
    }

    // Send completion event
    res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`)

    // Save assistant message
    if (fullText) {
      saveMessage(sessionId, 'assistant', fullText)
    }

  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
  }

  res.end()
}
