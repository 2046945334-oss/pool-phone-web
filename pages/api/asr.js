// pages/api/asr.js - HTTP POST /api/asr for speech-to-text
// Uses OpenAI-compatible /v1/audio/transcriptions endpoint via user's configured API Base
const https = require('https')
const http = require('http')
const { URL } = require('url')

export const config = { api: { bodyParser: false } }

function getAsrConfig() {
  try {
    const { getDb } = require('../../lib/db')
    const db = getDb()
    let apiKey = '', model = 'paraformer-v2', apiBase = ''

    const cfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
    if (cfgRow) {
      const configs = JSON.parse(cfgRow.value)
      if (configs.stt) {
        apiKey = configs.stt.apiKey || ''
        model = configs.stt.model || model
        apiBase = configs.stt.apiBase || ''
      }
      // If no STT apiBase, try chat apiBase as fallback
      if (!apiBase && configs.chat) {
        apiBase = configs.chat.apiBase || ''
      }
    }
    if (!apiKey) {
      const sttRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_stt_config'").get()
      if (sttRow) {
        const sttCfg = JSON.parse(sttRow.value)
        apiKey = sttCfg.apiKey || sttCfg.key || ''
        model = sttCfg.model || model
        apiBase = sttCfg.apiBase || apiBase
      }
    }
    if (!apiKey) {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
      if (row) {
        const cfg = JSON.parse(row.value)
        apiKey = cfg.apiKey || cfg.key || ''
        if (!apiBase) apiBase = cfg.apiBase || ''
      }
    }

    // paraformer-realtime-v2 is WS-only; for HTTP use paraformer-v2
    if ((model || '').includes('realtime')) model = 'paraformer-v2'

    console.log('[ASR API] Config - apiBase:', apiBase, 'model:', model, 'key:', (apiKey||'').slice(0,10)+'...')
    return { apiKey, model, apiBase }
  } catch (e) {
    console.error('[ASR API] Config error:', e.message)
    return { apiKey: '', model: 'paraformer-v2', apiBase: '' }
  }
}

function parseMultipart(body, contentType) {
  let audioBuffer = body
  let audioFilename = 'audio.webm'
  if (contentType.includes('multipart/form-data')) {
    const bm = contentType.match(/boundary=([^;\s]+)/)
    if (bm) {
      const boundary = bm[1]
      const raw = body.toString('binary')
      const parts = raw.split('--' + boundary)
      for (const part of parts) {
        if (part.includes('filename=')) {
          const nm = part.match(/filename="([^"]+)"/)
          if (nm) audioFilename = nm[1]
          const idx = part.indexOf('\r\n\r\n')
          if (idx !== -1) {
            let d = part.slice(idx + 4)
            if (d.endsWith('\r\n')) d = d.slice(0, -2)
            audioBuffer = Buffer.from(d, 'binary')
          }
        }
      }
    }
  }
  return { audioBuffer, audioFilename }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const cfg = getAsrConfig()
  if (!cfg.apiKey) return res.status(500).json({ error: 'STT API key not configured' })
  if (!cfg.apiBase) return res.status(500).json({ error: 'STT API Base URL not configured' })

  try {
    // Read raw body
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const contentType = req.headers['content-type'] || ''
    const { audioBuffer, audioFilename } = parseMultipart(body, contentType)

    console.log('[ASR API] Audio:', audioBuffer.length, 'bytes, file:', audioFilename)

    // Build multipart/form-data for OpenAI-compatible /v1/audio/transcriptions
    const boundary = '----FormBoundary' + Date.now().toString(36)
    const parts = []

    // file part
    parts.push(Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="' + audioFilename + '"\r\n' +
      'Content-Type: audio/webm\r\n\r\n'
    ))
    parts.push(audioBuffer)
    parts.push(Buffer.from('\r\n'))

    // model part
    parts.push(Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="model"\r\n\r\n' +
      cfg.model + '\r\n'
    ))

    // close
    parts.push(Buffer.from('--' + boundary + '--\r\n'))

    const payload = Buffer.concat(parts)

    // Build URL: apiBase + /v1/audio/transcriptions
    let base = cfg.apiBase.replace(/\/+$/, '')
    // If apiBase ends with /compatible-mode, keep it; append /v1/audio/transcriptions
    // If apiBase already contains /v1, just append /audio/transcriptions
    let transcriptionUrl
    if (base.includes('/v1')) {
      transcriptionUrl = base + '/audio/transcriptions'
    } else {
      transcriptionUrl = base + '/v1/audio/transcriptions'
    }

    console.log('[ASR API] Calling:', transcriptionUrl)

    const url = new URL(transcriptionUrl)
    const isHttps = url.protocol === 'https:'
    const lib = isHttps ? https : http

    const result = await new Promise((resolve, reject) => {
      const reqOpt = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': payload.length,
          'Authorization': 'Bearer ' + cfg.apiKey
        }
      }

      const request = lib.request(reqOpt, (response) => {
        const respChunks = []
        response.on('data', c => respChunks.push(c))
        response.on('end', () => {
          const data = Buffer.concat(respChunks).toString()
          console.log('[ASR API] Response status:', response.statusCode, 'body:', data.slice(0, 300))
          try {
            const result = JSON.parse(data)
            if (response.statusCode !== 200) {
              resolve({ error: 'STT API error (' + response.statusCode + '): ' + (result.message || result.error?.message || data.slice(0, 200)) })
              return
            }
            // OpenAI format: { text: "..." }
            resolve({ text: result.text || '' })
          } catch (e) {
            resolve({ error: 'Parse error: ' + data.slice(0, 200) })
          }
        })
      })

      request.on('error', e => reject(e))
      request.setTimeout(30000, () => { request.destroy(); reject(new Error('timeout')) })
      request.write(payload)
      request.end()
    })

    res.json(result)
  } catch (e) {
    console.error('[ASR API] Error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
