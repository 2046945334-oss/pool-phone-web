// pages/api/wake-inbox.js - 读取唤醒留言（只读，不清空）
const { getDb } = require('../../lib/db')

export default function handler(req, res) {
  const db = getDb()
  try {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_wake_inbox'").get()
    const inbox = row ? JSON.parse(row.value) : []
    // 该接口供聊天界面和唤醒日志读取，必须保持幂等，不能读后删除。
    return res.status(200).json({ messages: Array.isArray(inbox) ? inbox : [] })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
