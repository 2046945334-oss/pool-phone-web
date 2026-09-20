// pages/api/asr.js - HTTP POST endpoint for speech-to-text
const https = require('https')

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
    }
    if (!apiKey) {
      const sttRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_stt_config'").get()
      if (sttRow) {
        const sttCfg = JSON.parse(sttRow.value)
        apiKey = sttCfg.apiKey || sttCfg.key || ''
        model = sttCfg.model || model
        apiBase = sttCfg.apiBase || ''
      }
    }
    if (!apiKey) {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
      if (row) {
        const cfg = JSON.parse(row.value)
        apiKey = cfg.apiKey || cfg.key || ''
      }
    }

    let workspaceId = ''
    if (apiBase) {
      const m = apiBase.match(/https?:\/\/(\d{10,})\./) 
      if (m) workspaceId = m[1]
    }
    if (!workspaceId && apiKey.startsWith('sk-ws-')) {
      try {
        const cfgRow2 = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
        if (cfgRow2) {
          const allCfgs = JSON.parse(cfgRow2.value)
          for (const k of ['chat', 'tts', 'memory', 'stt']) {
            const base = allCfgs[k]?.apiBase || ''
            const m2 = base.match(/https?:\/\/(\d{10,})\./) 
            if (m2) { workspaceId = m2[1]; break }
          }
        }
      } catch {}
    }

    return { apiKey, model, apiBase, workspaceId }
  } catch (e) {
    console.error('[ASR API] Config error:', e.message)
    return { apiKey: '', model: 'paraformer-v2', apiBase: '', workspaceId: '' }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const config = getAsrConfig()
  if (!config.apiKey) return res.status(500).json({ error: 'STT API key not configured' })

  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)

    const contentType = req.headers['content-type'] || ''
    let audioBuffer = body
    let audioFilename = 'audio.webm'

    if (contentType.includes('multipart/form-data')) {
      const boundaryMatch = contentType.match(/boundary=(.+)/)
      if (boundaryMatch) {
        const boundary = boundaryMatch[1]
        const parts = body.toString('binary').split('--' + boundary)
        for (const part of parts) {
          if (part.includes('filename=')) {
            const nameMatch = part.match(/filename="([^"]+)"/)
            if (nameMatch) audioFilename = nameMatch[1]
            const headerEnd = part.indexOf('\r\n\r\n')
            if (headerEnd !== -1) {
              const dataStr = part.slice(headerEnd + 4).replace(/\r\n$/, '')
              audioBuffer = Buffer.from(dataStr, 'binary')
            }
          }
        }
      }
    }

    console.log('[ASR API] Audio received:', audioBuffer.length, 'bytes')

    const audioBase64 = audioBuffer.toString('base64')

    let format = 'webm'
    if (audioFilename.endsWith('.wav')) format = 'wav'
    else if (audioFilename.endsWith('.mp3')) format = 'mp3'
    else if (audioFilename.endsWith('.ogg')) format = 'ogg'

    // Use paraformer-v2 for HTTP file recognition (not paraformer-realtime-v2 which is WS only)
    const model = (config.model || '').includes('realtime') ? 'paraformer-v2' : config.model

    const payload = JSON.stringify({
      model: model,
      input: {
        audio: 'data:audio/' + format + ';base64,' + audioBase64
      },
      parameters: {
        language_hints: ['zh', 'en']
      }
    })

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.apiKey,
    }
    if (config.workspaceId) {
      headers['X-DashScope-WorkSpace'] = config.workspaceId
    }

    const result = await new Promise((resolve, reject) => {
      const reqOpt = {
        hostname: 'dashscope.aliyuncs.com',
        port: 443,
        path: '/api/v1/services/audio/asr/recognition',
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) }
      }

      const request = https.request(reqOpt, (response) => {
        let data = ''
        response.on('data', chunk => data += chunk)
        response.on('end', () => {
          try {
            const result = JSON.parse(data)
            console.log('[ASR API] DashScope status:', response.statusCode)
            if (response.statusCode !== 200) {
              resolve({ error: 'STT API error (' + response.statusCode + '): ' + (result.message || data.slice(0, 200)) })
              return
            }
            const text = result.output?.text || result.output?.sentence?.text || ''
            resolve({ text })
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
