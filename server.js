// server.js - Custom Next.js server with autonomous AI wakeup scheduler
const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT, 10) || 3000
const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  server.listen(port, '0.0.0.0', (err) => {
    if (err) throw err
    console.log('> Ready on http://0.0.0.0:' + port)

    // --- Start autonomous wakeup scheduler ---
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
    }
  })
})
