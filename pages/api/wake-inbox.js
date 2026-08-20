// pages/api/wake-inbox.js - 读取唤醒留言（读后清空）
const { getDb } = require('../../lib/db')

export default function handler(req, res) {
  const db = getDb()
  try {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_wake_inbox'").get()
    const inbox = row ? JSON.parse(row.value) : []
    if (inbox.length > 0) {
      // 清空收件箱
      db.prepare("DELETE FROM kv WHERE key = 'pool_wake_inbox'").run()
    }
    return res.status(200).json({ messages: inbox })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
