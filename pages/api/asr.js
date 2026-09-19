// pages/api/asr.js - Speech-to-text using Whisper-compatible API
// Supports both FormData (file upload) and JSON (base64) input
// Prioritizes: pool_api_configs.stt > pool_stt_config > pool_api_config (fallback)
import { getDb } from '../../lib/db'
export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Parse input: FormData or JSON
  let audioBuffer = null
  const contentType = req.headers['content-type'] || ''

  if (contentType.includes('multipart/form-data')) {
    // FormData upload - read raw body and extract file part
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks)
    const boundaryMatch = contentType.match(/boundary=(.+)/)
    if (boundaryMatch) {
      const boundary = boundaryMatch[1]
      const parts = raw.toString('binary').split('--' + boundary)
      for (const part of parts) {
        if (part.includes('name="file"')) {
          const headerEnd = part.indexOf('\r\n\r\n')
          if (headerEnd !== -1) {
            const bodyStart = headerEnd + 4
            let bodyEnd = part.length
            if (part.endsWith('\r\n')) bodyEnd -= 2
            audioBuffer = Buffer.from(part.slice(bodyStart, bodyEnd), 'binary')
          }
          break
        }
      }
    }
  } else {
    // JSON with base64 (legacy compat)
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString())
      if (body.audio) audioBuffer = Buffer.from(body.audio, 'base64')
    } catch {}
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    return res.status(400).json({ error: 'No audio data' })
  }

  let apiBase = '', apiKey = '', model = 'whisper-1'
  let configSource = 'none'
  try {
    const db = getDb()
    const cfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
    if (cfgRow) {
      const configs = JSON.parse(cfgRow.value)
      if (configs.stt) {
        if (configs.stt.apiBase) apiBase = configs.stt.apiBase
        if (configs.stt.apiKey) apiKey = configs.stt.apiKey
        if (configs.stt.model) model = configs.stt.model
        if (apiBase && apiKey) configSource = 'pool_api_configs.stt'
      }
    }
    if (!apiBase || !apiKey) {
      const sttRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_stt_config'").get()
      if (sttRow) {
        const sttCfg = JSON.parse(sttRow.value)
        if (!apiBase) apiBase = sttCfg.apiBase || sttCfg.base || ''
        if (!apiKey) apiKey = sttCfg.apiKey || sttCfg.key || ''
        if (sttCfg.model) model = sttCfg.model
        if (apiBase && apiKey) configSource = 'pool_stt_config'
      }
    }
    if (!apiBase || !apiKey) {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
      if (row) {
        const cfg = JSON.parse(row.value)
        if (!apiBase) apiBase = cfg.apiBase || cfg.base || ''
        if (!apiKey) apiKey = cfg.apiKey || cfg.key || ''
        if (apiBase && apiKey) configSource = 'pool_api_config (fallback)'
      }
    }
  } catch (e) {
    return res.status(500).json({ error: 'DB read failed: ' + e.message })
  }
  if (!apiBase || !apiKey) {
    return res.status(400).json({ error: 'STT API not configured. Set it in Settings > STT.' })
  }

  const base = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = base + '/v1/audio/transcriptions'
  try {
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
      return res.status(whisperRes.status).json({
        error: `STT API error (${whisperRes.status}): ${errText}`,
        configSource, url, model
      })
    }
    const data = await whisperRes.json()
    return res.json({ text: data.text || '', configSource })
  } catch (err) {
    return res.status(500).json({ error: 'STT request failed: ' + err.message, configSource, url, model })
  }
}