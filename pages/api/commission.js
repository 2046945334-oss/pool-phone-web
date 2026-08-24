// pages/api/commission.js
// AI（池）用来下单和确认成图的接口
// GET  ?action=list   → 返回当前所有订单和橱窗
// POST ?action=order  → AI下单
// POST ?action=confirm → AI确认成图（完成交易）
// POST ?action=feedback → AI发修改意见到交流页

import { getKV, setKV } from '../../lib/db'

const DATA_KEY = 'pool_commission'

async function getData() {
  const raw = await getKV(DATA_KEY)
  if (!raw) return { profile: {}, shop: [], orders: [], messages: [], works: [], earned: 0 }
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { profile: {}, shop: [], orders: [], messages: [], works: [], earned: 0 }
  }
}

async function saveData(data) {
  await setKV(DATA_KEY, JSON.stringify(data))
}

export default async function handler(req, res) {
  const action = req.query.action || (req.body && req.body.action)

  if (req.method === 'GET' && action === 'list') {
    const data = await getData()
    return res.json({
      shop: data.shop || [],
      orders: (data.orders || []).map(o => ({
        id: o.id, title: o.title, price: o.price, status: o.status,
        deadline: o.deadline, nodes: o.nodes, createdAt: o.createdAt
      }))
    })
  }

  if (req.method === 'POST' && action === 'order') {
    const { shopItemId, title, price, note } = req.body
    if (!title || !price) return res.status(400).json({ error: 'missing title or price' })
    const data = await getData()
    const order = {
      id: Date.now(),
      shopItemId: shopItemId || null,
      title: title,
      price: parseInt(price) || 0,
      status: 'pending',
      deadline: null,
      nodes: [],
      createdAt: Date.now(),
      aiNote: note || null
    }
    data.orders.push(order)
    // 推消息到交流页
    data.messages.push({
      id: Date.now(),
      text: '🛒 池下了新单「' + title + '」，' + price + '积分',
      time: Date.now(),
      from: 'system'
    })
    if (note) {
      data.messages.push({
        id: Date.now() + 1,
        text: note,
        time: Date.now(),
        from: 'ai'
      })
    }
    await saveData(data)
    return res.json({ ok: true, orderId: order.id })
  }

  if (req.method === 'POST' && action === 'confirm') {
    const { orderId } = req.body
    if (!orderId) return res.status(400).json({ error: 'missing orderId' })
    const data = await getData()
    const order = data.orders.find(o => o.id === orderId)
    if (!order) return res.status(404).json({ error: 'order not found' })
    if (order.status !== 'review') return res.status(400).json({ error: 'order not in review status' })
    order.status = 'done'
    data.earned = (data.earned || 0) + order.price
    data.messages.push({
      id: Date.now(),
      text: '🎉 订单「' + order.title + '」已确认完成！' + order.price + '积分已入账',
      time: Date.now(),
      from: 'system'
    })
    await saveData(data)
    return res.json({ ok: true })
  }

  if (req.method === 'POST' && action === 'feedback') {
    const { orderId, text } = req.body
    if (!text) return res.status(400).json({ error: 'missing text' })
    const data = await getData()
    // 推AI消息到交流页
    data.messages.push({
      id: Date.now(),
      text: text,
      time: Date.now(),
      from: 'ai'
    })
    // 如果指定了订单，也加到节点里
    if (orderId) {
      const order = data.orders.find(o => o.id === orderId)
      if (order && order.nodes) {
        order.nodes.push({ type: '修改意见', text: text, time: Date.now() })
      }
    }
    await saveData(data)
    return res.json({ ok: true })
  }

  return res.status(400).json({ error: 'unknown action: ' + action })
}
