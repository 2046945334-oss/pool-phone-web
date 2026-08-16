// pages/api/page/[id].js — 渲染AI创建的自定义HTML页面
import { getDb } from '../../../lib/db'

export default function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).send('Missing page id')

  const safeId = id.replace(/[^a-z0-9\-_]/gi, '').slice(0, 50)
  const db = getDb()
  const key = 'pool_page_' + safeId

  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
    if (!row) return res.status(404).send('Page not found: ' + safeId)
    
    const page = JSON.parse(row.value)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(page.html)
  } catch (e) {
    res.status(500).send('Error loading page: ' + e.message)
  }
}
