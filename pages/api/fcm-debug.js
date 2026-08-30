// pages/api/fcm-debug.js - 诊断推送状态
import { getDb } from '../../lib/db'

const CODE_VERSION = 'v3-poll-only-20260830'

export default async function handler(req, res) {
  const db = getDb()
  
  // GET: 查看状态
  if (req.method === 'GET') {
    const tokenRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fcm_token')
    const queueRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_notification_queue')
    let queueLen = 0
    let lastItem = null
    try {
      const q = queueRow ? JSON.parse(queueRow.value) : []
      queueLen = q.length
      lastItem = q.length > 0 ? q[q.length - 1] : null
    } catch {}
    const hasFirebaseKey = !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    return res.json({
      codeVersion: CODE_VERSION,
      hasToken: !!tokenRow,
      hasFirebaseKey,
      queueLength: queueLen,
      lastQueueItem: lastItem
    })
  }
  
  // POST: 手动存 token 并测试推送
  if (req.method === 'POST') {
    const { token, testPush } = req.body || {}
    
    if (token) {
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fcm_token', token)
    }
    
    if (testPush) {
      const tokenRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fcm_token')
      if (!tokenRow) return res.json({ error: 'no token stored' })
      const fcmToken = typeof tokenRow.value === 'string' ? tokenRow.value.replace(/^"|"$/g, '') : tokenRow.value
      const result = await sendPush(fcmToken, '推送测试', '如果你看到这条，说明FCM推送正常工作', {})
      return res.json({ pushResult: result })
    }
    
    return res.json({ ok: true })
  }
  
  return res.status(405).end()
}
