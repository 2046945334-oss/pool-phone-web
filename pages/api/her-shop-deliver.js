// pages/api/her-shop-deliver.js - 用户（店主）给待发货订单发货 + AI查看收货
import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'GET') {
    // 获取所有订单（pending + delivered）
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_her_shop_orders'").get()
      const orders = row ? JSON.parse(row.value) : []
      const pending = orders.filter(o => o.status === 'pending')
      const delivered = orders.filter(o => o.status === 'delivered')
      return res.json({ pending, delivered, all: orders })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (req.method === 'POST') {
    // 发货：{ index: number, content: string }
    const { index, content, itemId } = req.body || {}
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_her_shop_orders'").get()
      let orders = row ? JSON.parse(row.value) : []
      
      // 找到目标订单
      let target = -1
      if (typeof index === 'number' && orders[index] && orders[index].status === 'pending') {
        target = index
      } else if (itemId) {
        target = orders.findIndex(o => o.itemId === itemId && o.status === 'pending')
      } else {
        // 默认发第一个 pending
        target = orders.findIndex(o => o.status === 'pending')
      }

      if (target < 0) {
        return res.status(404).json({ error: '没有找到待发货订单' })
      }

      orders[target].status = 'delivered'
      orders[target].content = content || ''
      orders[target].deliveredAt = new Date().toISOString()

      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_her_shop_orders', JSON.stringify(orders))
      return res.json({ ok: true, order: orders[target] })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  return res.status(405).json({ error: 'method not allowed' })
}
