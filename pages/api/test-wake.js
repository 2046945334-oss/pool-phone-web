// pages/api/test-wake.js — 测试用：插入一个即将到期的唤醒任务
import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  // 插入一个10秒后到期的任务
  const triggerAt = now + 10
  db.prepare('INSERT INTO wake_tasks (type, trigger_at, reason, status) VALUES (?, ?, ?, ?)').run('scheduled', triggerAt, '唤醒测试', 'pending')
  
  const wakeAt = new Date(triggerAt * 1000 + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
  
  // 也返回当前所有pending任务和最近日志
  const pending = db.prepare("SELECT * FROM wake_tasks WHERE status = 'pending'").all()
  const logRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_wake_log'").get()
  const logs = logRow ? JSON.parse(logRow.value) : []
  
  res.json({ ok: true, wake_at: wakeAt, pending_count: pending.length, recent_logs: logs.slice(-5) })
}
