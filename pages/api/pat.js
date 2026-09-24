// 拍一拍 API
import { getDb } from '../../lib/db'

export default async function handler(req, res) {
  const db = getDb()
  
  if (req.method === 'GET') {
    // 获取拍一拍配置
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_pat_config'").get()
    const config = row ? JSON.parse(row.value) : { aiSuffix: '的小脑袋', userSuffix: '的肩膀' }
    return res.json(config)
  }
  
  if (req.method === 'PUT') {
    // 更新后缀配置
    const { aiSuffix, userSuffix } = req.body || {}
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_pat_config'").get()
    const config = row ? JSON.parse(row.value) : { aiSuffix: '的小脑袋', userSuffix: '的肩膀' }
    if (aiSuffix !== undefined) config.aiSuffix = aiSuffix
    if (userSuffix !== undefined) config.userSuffix = userSuffix
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_pat_config', JSON.stringify(config))
    return res.json({ ok: true, config })
  }

  if (req.method === 'POST') {
    // 用户拍了AI → 记录历史，不自动回拍（AI通过pat_user工具自行决定回拍）
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_pat_config'").get()
    const config = row ? JSON.parse(row.value) : { aiSuffix: '的小脑袋', userSuffix: '的肩膀' }
    
    const histRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_pat_history'").get()
    const hist = histRow ? JSON.parse(histRow.value) : []
    hist.push({ who: 'user', ts: Date.now() })
    const trimmed = hist.slice(-50)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_pat_history', JSON.stringify(trimmed))
    
    return res.json({ ok: true, config })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
