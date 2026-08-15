// pages/api/wake-config.js — 唤醒系统配置管理
import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()

  // GET — 读取当前唤醒配置（脱敏）
  if (req.method === 'GET') {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('wake_config')
    if (!row) return res.json({ configured: false })
    try {
      const config = JSON.parse(row.value)
      return res.json({
        configured: true,
        apiBase: config.apiBase || '',
        model: config.model || '',
        hasApiKey: !!config.apiKey,
        systemPrompt: config.systemPrompt ? config.systemPrompt.slice(0, 100) + '...' : '',
      })
    } catch {
      return res.json({ configured: false })
    }
  }

  // POST — 保存唤醒配置
  if (req.method === 'POST') {
    const { apiBase, apiKey, model, systemPrompt } = req.body
    if (!apiBase || !apiKey) {
      return res.status(400).json({ error: 'apiBase and apiKey are required' })
    }
    const config = { apiBase, apiKey, model: model || '', systemPrompt: systemPrompt || '' }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('wake_config', JSON.stringify(config))
    return res.json({ ok: true })
  }

  // DELETE — 清除唤醒配置（停用唤醒系统）
  if (req.method === 'DELETE') {
    db.prepare('DELETE FROM kv WHERE key = ?').run('wake_config')
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
