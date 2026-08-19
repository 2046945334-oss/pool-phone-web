// pages/api/wakeup-exec.js - Internal endpoint for wakeup scheduler to execute tools
// Only accepts requests from localhost (127.0.0.1)

import { getDb } from '../../lib/db'

export default async function handler(req, res) {
  // Security: only allow from localhost
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === ''
  if (!isLocal) {
    return res.status(403).json({ error: 'forbidden' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  const { tool, args } = req.body || {}
  if (!tool) {
    return res.status(400).json({ error: 'missing tool name' })
  }

  try {
    // Dynamic import the chat module to get executeTool
    const chatModule = await import('./chat.js')
    if (chatModule.executeTool) {
      const result = await chatModule.executeTool(tool, args || {})
      return res.status(200).json(result)
    }

    // Fallback: execute inline for known tools
    const result = await executeToolLocal(tool, args || {})
    return res.status(200).json(result)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

// Minimal fallback executor for critical tools if chat.js export fails
async function executeToolLocal(name, args) {
  const db = getDb()

  if (name === 'schedule_wakeup') {
    // schedule_wakeup is handled by the wakeup module itself, just acknowledge
    return { success: true, message: 'scheduled', minutes: args.minutes }
  }

  if (name === 'get_current_time') {
    const now = new Date(Date.now() + 8 * 3600000)
    const bjTime = now.toISOString().slice(0, 19).replace('T', ' ')
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    return { time: bjTime, weekday: '星期' + weekdays[now.getUTCDay()] }
  }

  if (name === 'get_score') {
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
      if (row) {
        const data = JSON.parse(row.value)
        return { poolScore: data.poolScore || 0, score: data.score || 0 }
      }
    } catch {}
    return { poolScore: 0, score: 0 }
  }

  return { error: 'tool not available in fallback mode: ' + name }
}
