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
    const dbPath = require('path').join(process.cwd(), 'data', 'pool.db')
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })
    let apiKey = '', model = 'paraformer-realtime-v2', wsUrl = ''
    
    // Try pool_api_configs.stt first
    const cfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
    if (cfgRow) {
      const configs = JSON.parse(cfgRow.value)
      if (configs.stt) {
        apiKey = configs.stt.apiKey || ''
        model = configs.stt.model || model
        wsUrl = configs.stt.wsUrl || ''
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
    db.close()
    return { apiKey, model, wsUrl }
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
  let started = false

  try {
    dashWs = new WebSocket(dashscopeWsUrl, {
      headers: {
        'Authorization': 'bearer ' + config.apiKey,
        'X-DashScope-DataInspection': 'enable'
      }
    })
  } catch (e) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'Failed to connect to ASR: ' + e.message }))
    clientWs.close()
    return
  }

  dashWs.on('open', () => {
    // Send run-task directive
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
          language_hints: ['zh', 'en']
        },
        input: {}
      }
    }
    dashWs.send(JSON.stringify(startMsg))
    started = true
    clientWs.send(JSON.stringify({ type: 'ready' }))
  })

  dashWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      const header = msg.header || {}
      const output = msg.payload?.output || {}
      
      if (header.event === 'task-started') {
        clientWs.send(JSON.stringify({ type: 'started' }))
      } else if (header.event === 'result-generated') {
        // Extract transcript from sentence array
        const sentence = output.sentence || {}
        const text = sentence.text || ''
        const isFinal = sentence.end_time !== undefined && sentence.end_time > 0
        
        if (text) {
          clientWs.send(JSON.stringify({
            type: isFinal ? 'final' : 'interim',
            text: text,
            begin_time: sentence.begin_time,
            end_time: sentence.end_time
          }))
        }
      } else if (header.event === 'task-finished') {
        clientWs.send(JSON.stringify({ type: 'finished' }))
      } else if (header.event === 'task-failed') {
        const errMsg = header.error_message || output.message || 'ASR task failed'
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
  clientWs.on('message', (data) => {
    if (!started || !dashWs || dashWs.readyState !== WebSocket.OPEN) return
    
    if (typeof data === 'string') {
      // Control message from client
      try {
        const ctrl = JSON.parse(data)
        if (ctrl.type === 'stop') {
          // Send finish-task
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
      // Binary PCM data — wrap in continue-task and forward
      const continueMsg = {
        header: {
          action: 'continue-task',
          task_id: taskId,
          streaming: 'duplex'
        },
        payload: {
          input: {
            audio: Buffer.from(data).toString('base64')
          }
        }
      }
      dashWs.send(JSON.stringify(continueMsg))
    }
  })

  clientWs.on('close', () => {
    if (dashWs && dashWs.readyState === WebSocket.OPEN) {
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
