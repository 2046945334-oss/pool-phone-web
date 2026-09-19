// pages/api/asr.js - Speech-to-text using Whisper API
// Accepts JSON body: { audio: base64-encoded audio data }
// Prioritizes dedicated STT config (pool_stt_config), falls back to main API config
import { getDb } from '../../lib/db'
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { audio } = req.body || {}
  if (!audio) return res.status(400).json({ error: 'No audio data' })
  // Get API config from DB - prioritize dedicated STT config
  let apiBase = '', apiKey = '', model = 'whisper-1'
  try {
    const db = getDb()
    // 1. Try dedicated STT config first
    const sttRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_stt_config'").get()
    if (sttRow) {
      const sttCfg = JSON.parse(sttRow.value)
      apiBase = sttCfg.apiBase || sttCfg.base || ''
      apiKey = sttCfg.apiKey || sttCfg.key || ''
      if (sttCfg.model) model = sttCfg.model
    }
    // 2. Fall back to main config if STT not configured
    if (!apiBase || !apiKey) {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
      if (row) {
        const cfg = JSON.parse(row.value)
        if (!apiBase) apiBase = cfg.apiBase || cfg.base || ''
        if (!apiKey) apiKey = cfg.apiKey || cfg.key || ''
      }
      const cfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
      if (cfgRow) {
        const configs = JSON.parse(cfgRow.value)
        // Check stt slot in configs
        if (configs.stt) {
          if (!apiBase && configs.stt.apiBase) apiBase = configs.stt.apiBase
          if (!apiKey && configs.stt.apiKey) apiKey = configs.stt.apiKey
          if (configs.stt.model) model = configs.stt.model
        }
        // Final fallback to chat config
        if (!apiBase && configs.chat?.apiBase) apiBase = configs.chat.apiBase
        if (!apiKey && configs.chat?.apiKey) apiKey = configs.chat.apiKey
      }
    }
  } catch {}

  if (!apiBase || !apiKey) {
    return res.status(400).json({ error: 'API not configured. Go to Settings and configure STT (语音识别) API.' })
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
      `${model}\r\n`
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
