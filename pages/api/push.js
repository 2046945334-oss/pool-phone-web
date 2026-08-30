// pages/api/push.js - 独立 FCM 推送接口
// POST /api/push { title, body, data? }
import { getDb } from '../../lib/db'
import { sendPush } from '../../lib/fcm'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  
  const { title, body, data } = req.body || {}
  if (!title && !body) return res.status(400).json({ error: 'title or body required' })

  const db = getDb()

  // 获取 FCM token
  let fcmToken = null
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fcm_token')
    if (row) {
      fcmToken = typeof row.value === 'string' ? row.value.replace(/^"|"$/g, '') : row.value
    }
  } catch {}

  if (!fcmToken) {
    return res.status(200).json({ success: false, error: 'FCM token 未注册，设备未打开过App' })
  }

  const result = await sendPush(fcmToken, title || '池的小手机', body || '', data || {})

  // 同时写入通知队列（备用）
  try {
    const notif = { id: Date.now(), title, body, time: new Date().toISOString(), delivered: result.success }
    let queue = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_notification_queue')
      if (row) queue = JSON.parse(row.value)
    } catch {}
    queue.push(notif)
    if (queue.length > 20) queue = queue.slice(-20)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_notification_queue', JSON.stringify(queue))
  } catch {}

  return res.status(200).json({ success: result.success, fcm: result.success ? 'pushed' : result.error })
}
