// server.js - Custom Next.js server with autonomous AI wakeup scheduler + realtime ASR WebSocket
const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { WebSocketServer, WebSocket } = require('ws')
const crypto = require('crypto')

const dev = false // Always run in production mode
const port = parseInt(process.env.PORT, 10) || 3000
const app = next({ dev })
const handle = app.getRequestHandler()

// Global error handlers to prevent crash loops
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message)
  console.error(err.stack)
  // Don't exit — keep the server alive
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason)
})

// ========== DashScope Realtime ASR proxy ==========
// Frontend sends PCM16 audio chunks over WebSocket
// Backend proxies to DashScope paraformer-realtime-v2 or qwen-audio-asr-flash-streaming
function getAsrConfig() {
  try {
    const { getDb } = require('./lib/db')
    const db = getDb()
    let apiKey = '', model = 'paraformer-realtime-v2', wsUrl = '', apiBase = ''
    
    // Try pool_api_configs.stt first
    const cfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
    if (cfgRow) {
      const configs = JSON.parse(cfgRow.value)
      if (configs.stt) {
        apiKey = configs.stt.apiKey || ''
        model = configs.stt.model || model
        wsUrl = configs.stt.wsUrl || ''
        apiBase = configs.stt.apiBase || ''
      }
    }
    // Fallback to pool_stt_config
    if (!apiKey) {
      const sttRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_stt_config'").get()
      if (sttRow) {
        const sttCfg = JSON.parse(sttRow.value)
        apiKey = sttCfg.apiKey || sttCfg.key || ''
        model = sttCfg.model || model
        wsUrl = sttCfg.wsUrl || ''
        apiBase = sttCfg.apiBase || ''
      }
    }
    // Fallback to pool_api_config (main API key)
    if (!apiKey) {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
      if (row) {
        const cfg = JSON.parse(row.value)
        apiKey = cfg.apiKey || cfg.key || ''
      }
    }
    
    // Extract workspace ID from apiBase URL (e.g. https://1440889827237606.cn-beijing.maas.aliyuncs.com/...)
    let workspaceId = ''
    if (apiBase) {
      const m = apiBase.match(/https?:\/\/(\d{10,})\./)
      if (m) workspaceId = m[1]
    }
    // If key is workspace-scoped (sk-ws-*) but no workspace ID from STT apiBase,
    // try to extract from other API configs (chat/tts apiBase may have it)
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
    
    console.log('[ASR] Config loaded - key:', apiKey.slice(0, 10) + '...', 'model:', model, 'workspaceId:', workspaceId || 'NONE')
    
    return { apiKey, model, wsUrl, workspaceId }
  } catch (e) {
    console.error('[ASR] Failed to read config:', e.message)
    return { apiKey: '', model: 'paraformer-realtime-v2', wsUrl: '' }
  }
}

function handleAsrWebSocket(clientWs) {
  const config = getAsrConfig()
  if (!config.apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'STT API key not configured' }))
    clientWs.close()
    return
  }

  const taskId = crypto.randomUUID()
  // DashScope realtime ASR WebSocket URL
  const dashscopeWsUrl = config.wsUrl || 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/'
  
  let dashWs = null
  let taskStarted = false

  try {
    const wsHeaders = {
      'Authorization': 'bearer ' + config.apiKey,
      'X-DashScope-DataInspection': 'enable'
    }
    // Workspace-scoped keys (sk-ws-*) require workspace ID header
    if (config.workspaceId) {
      wsHeaders['X-DashScope-WorkSpace'] = config.workspaceId
    }
    dashWs = new WebSocket(dashscopeWsUrl, {
      headers: wsHeaders
    })
  } catch (e) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'Failed to connect to ASR: ' + e.message }))
    clientWs.close()
    return
  }

  dashWs.on('open', () => {
    console.log('[ASR] DashScope WS connected, sending run-task, model:', config.model)
    // Send run-task directive (JSON text frame)
    const startMsg = {
      header: {
        action: 'run-task',
        task_id: taskId,
        streaming: 'duplex'
      },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: config.model,
        parameters: {
          format: 'pcm',
          sample_rate: 16000,
          channels: 1,
          language_hints: ['zh', 'en']
        },
        input: {}
      }
    }
    dashWs.send(JSON.stringify(startMsg))
    // Tell client we're connecting (UI feedback), but don't enable audio yet
    clientWs.send(JSON.stringify({ type: 'ready' }))
  })

  dashWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const header = msg.header || {}
      const output = msg.payload?.output || {}
      
      if (header.event === 'task-started') {
        taskStarted = true
        console.log('[ASR] Task started:', taskId.slice(0, 8))
        clientWs.send(JSON.stringify({ type: 'started' }))
      } else if (header.event === 'result-generated') {
        // Extract transcript — handle both object and array formats
        const sentence = output.sentence || (output.results && output.results[0]) || {}
        const text = sentence.text || ''
        // end_time >= 0 means sentence is finalized; -1 or absent means interim
        const isFinal = typeof sentence.end_time === 'number' && sentence.end_time >= 0
        
        if (text) {
          clientWs.send(JSON.stringify({
            type: isFinal ? 'final' : 'interim',
            text: text
          }))
        }
      } else if (header.event === 'task-finished') {
        console.log('[ASR] Task finished:', taskId.slice(0, 8))
        clientWs.send(JSON.stringify({ type: 'finished' }))
      } else if (header.event === 'task-failed') {
        const errMsg = header.error_message || header.message || output.message || 'ASR task failed'
        console.error('[ASR] Task failed:', errMsg)
        clientWs.send(JSON.stringify({ type: 'error', message: errMsg }))
      }
    } catch (e) {
      console.error('[ASR] Parse DashScope msg error:', e.message)
    }
  })

  dashWs.on('error', (err) => {
    console.error('[ASR] DashScope WS error:', err.message)
    clientWs.send(JSON.stringify({ type: 'error', message: 'ASR connection error: ' + err.message }))
  })

  dashWs.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'finished' }))
      clientWs.close()
    }
  })

  // Receive PCM audio from frontend
  clientWs.on('message', (data, isBinary) => {
    if (!taskStarted || !dashWs || dashWs.readyState !== WebSocket.OPEN) return
    
    if (!isBinary && typeof data !== 'string') {
      // Node ws may deliver Buffer even for text; check content
      try { data = data.toString(); } catch {}
    }

    if (typeof data === 'string' || (!isBinary && Buffer.isBuffer(data) && data.length < 200)) {
      // Control message from client (JSON text)
      try {
        const text = typeof data === 'string' ? data : data.toString()
        const ctrl = JSON.parse(text)
        if (ctrl.type === 'stop') {
          dashWs.send(JSON.stringify({
            header: {
              action: 'finish-task',
              task_id: taskId,
              streaming: 'duplex'
            },
            payload: { input: {} }
          }))
        }
      } catch {}
    } else {
      // Binary PCM data — DashScope requires raw binary frames, NOT base64 in JSON
      const buf = Buffer.from(data)
      dashWs.send(buf)
    }
  })

  clientWs.on('close', () => {
    if (dashWs && dashWs.readyState === WebSocket.OPEN && taskStarted) {
      try {
        dashWs.send(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} }
        }))
      } catch {}
      setTimeout(() => { try { dashWs.close() } catch {} }, 1000)
    }
  })
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  // WebSocket server for realtime ASR
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', handleAsrWebSocket)

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url)
    if (pathname === '/api/asr/stream') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  server.listen(port, '0.0.0.0', (err) => {
    if (err) throw err
    console.log('> Ready on http://0.0.0.0:' + port)

    // --- Start autonomous wakeup scheduler (delayed, non-blocking) ---
    setTimeout(() => {
      try {
        const { startWakeupScheduler, setExecuteTool } = require('./lib/wakeup')

        // Tool execution via internal HTTP call
        setExecuteTool(async (name, args) => {
          try {
            const resp = await fetch('http://127.0.0.1:' + port + '/api/wakeup-exec', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tool: name, args })
            })
            if (!resp.ok) return { error: 'HTTP ' + resp.status }
            return await resp.json()
          } catch (e) {
            return { error: e.message }
          }
        })

        startWakeupScheduler()
        console.log('> Wakeup scheduler started')
      } catch (e) {
        console.error('> Failed to start wakeup scheduler:', e.message)
        console.error(e.stack)
        // Don't crash the server — just log and continue without wakeup
      }
    }, 5000) // delay 5s to let Next.js fully warm up
  })
})

