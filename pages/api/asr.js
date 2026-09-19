// pages/api/asr.js - Speech-to-text using Whisper API
// Accepts JSON body: { audio: base64-encoded audio data }
import { getDb } from '../../lib/db'

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { audio } = req.body || {}
  if (!audio) return res.status(400).json({ error: 'No audio data' })

  // Get API config from DB
  let apiBase = '', apiKey = ''
  try {
    const db = getDb()
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
    if (row) {
      const cfg = JSON.parse(row.value)
      apiBase = cfg.apiBase || cfg.base || ''
      apiKey = cfg.apiKey || cfg.key || ''
    }
    const cfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
    if (cfgRow) {
      const configs = JSON.parse(cfgRow.value)
      if (configs.chat?.apiBase) apiBase = apiBase || configs.chat.apiBase
      if (configs.chat?.apiKey) apiKey = apiKey || configs.chat.apiKey
    }
  } catch {}

  if (!apiBase || !apiKey) {
    return res.status(400).json({ error: 'API not configured' })
  }

  const base = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = base + '/v1/audio/transcriptions'

  try {
    // Decode base64 audio
    const audioBuffer = Buffer.from(audio, 'base64')
    
    // Build multipart/form-data manually
    const boundary = '----ASRBoundary' + Date.now().toString(36)
    const parts = []
    
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
      `Content-Type: audio/webm\r\n\r\n`
    ))
    parts.push(audioBuffer)
    parts.push(Buffer.from(
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `whisper-1\r\n`
    ))
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `zh\r\n`
    ))
    parts.push(Buffer.from(`--${boundary}--\r\n`))
    
    const body = Buffer.concat(parts)

    const whisperRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    })

    if (!whisperRes.ok) {
      const errText = await whisperRes.text()
      return res.status(whisperRes.status).json({ error: errText })
    }

    const data = await whisperRes.json()
    return res.json({ text: data.text || '' })
    
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}