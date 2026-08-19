// server.js - Custom Next.js server with autonomous AI wakeup scheduler
const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(async () => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  }).listen(3000, '0.0.0.0', async (err) => {
    if (err) throw err
    console.log('> Ready on http://0.0.0.0:3000')

    // --- Start autonomous wakeup scheduler ---
    try {
      // Dynamic import ESM module
      const { startWakeupScheduler, setExecuteTool } = await import('./lib/wakeup.js')

      // Import executeToolFn from chat.js (the tool execution logic)
      // We need to dynamically import it
      const chatModule = await import('./pages/api/chat.js')
      if (chatModule.executeTool) {
        setExecuteTool(chatModule.executeTool)
      } else {
        // Create a wrapper that imports and calls executeTool
        const { getDb } = await import('./lib/db.js')
        // We'll use a simpler approach: import executeTool at wakeup time
        setExecuteTool(async (name, args) => {
          // Re-import to get fresh executeTool
          const mod = await import('./pages/api/chat.js')
          if (mod.executeTool) return await mod.executeTool(name, args)
          return { error: 'executeTool not available' }
        })
      }

      startWakeupScheduler()
      console.log('> Wakeup scheduler started')
    } catch (e) {
      console.error('> Failed to start wakeup scheduler:', e.message)
      // Non-fatal: server still works for regular requests
    }
  })
})
