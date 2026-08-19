// pages/api/wakeup-status.js - View AI wakeup state and logs
import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()

  // Get wakeup state
  let state = null
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_ai_wakeup_state')
    if (row) state = JSON.parse(row.value)
  } catch {}

  // Get recent wake logs
  let logs = []
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_wake_log')
    if (row) logs = JSON.parse(row.value)
  } catch {}

  return res.status(200).json({
    state: state || { status: 'not started' },
    recentLogs: logs.slice(0, 10)
  })
}
