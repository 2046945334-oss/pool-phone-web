// pages/api/wakeup-exec.js - Internal endpoint for wakeup scheduler to execute tools
// Strategy: simulate a minimal chat request to /api/chat that forces tool execution
// Or directly execute common tools inline

import { getDb } from '../../lib/db'

export default async function handler(req, res) {
  // Security: only allow from localhost
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === '' || ip.includes('127.0.0.1')
  if (!isLocal) {
    return res.status(403).json({ error: 'forbidden' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  const { tool, args } = req.body || {}
  if (!tool) {
    return res.status(400).json({ error: 'missing tool name' })
  }

  try {
    const result = await executeTool(tool, args || {})
    return res.status(200).json(result)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

// Full tool executor (mirrors chat.js executeTool)
async function executeTool(name, args) {
  const db = getDb()

  if (name === 'schedule_wakeup') {
    return { success: true, message: 'acknowledged', minutes: args.minutes, reason: args.reason }
  }

  if (name === 'get_current_time') {
    const now = new Date(Date.now() + 8 * 3600000)
    const bjTime = now.toISOString().slice(0, 19).replace('T', ' ')
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    return { time: bjTime, weekday: '星期' + weekdays[now.getUTCDay()], timestamp: Math.floor(Date.now() / 1000) }
  }

  if (name === 'get_score') {
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
      if (row) { const d = JSON.parse(row.value); return { poolScore: d.poolScore || 0, score: d.score || 0 } }
    } catch {}
    return { poolScore: 0, score: 0 }
  }

  if (name === 'write_note') {
    const key = 'pool_notes_v3'
    let state = { pages: [{ notes: [], decos: [] }], currentPage: 0 }
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key); if (row) state = JSON.parse(row.value) } catch {}
    if (!state.pages) state = { pages: [{ notes: [], decos: [] }], currentPage: 0 }
    const page = state.pages[state.currentPage || 0] || state.pages[0]
    page.notes.push({ id: 'n_' + Date.now(), text: args.text, paper: args.paper !== undefined ? args.paper : Math.floor(Math.random() * 6), x: 20 + Math.random() * 100, y: 20 + Math.random() * 100, rot: (Math.random() - 0.5) * 8 })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(state))
    return { success: true, message: '便签已写入: "' + args.text + '"' }
  }

  if (name === 'diary_write') {
    const key = 'pool_diary'
    let entries = []
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key); if (row) entries = JSON.parse(row.value) } catch {}
    entries.unshift({ content: args.content, mood: args.mood || '', title: args.title || '', time: new Date().toISOString() })
    if (entries.length > 100) entries = entries.slice(0, 100)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(entries))
    return { success: true, message: '日记已写入' }
  }

  if (name === 'post_moment') {
    const key = 'pool_moments'
    let moments = []
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key); if (row) moments = JSON.parse(row.value) } catch {}
    moments.unshift({ id: Date.now(), content: args.content, context_note: args.context_note || '', from: 'pool', time: new Date().toISOString(), likes: 0, comments: [] })
    if (moments.length > 100) moments = moments.slice(0, 100)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(moments))
    return { success: true, message: '朋友圈已发布' }
  }

  if (name === 'do_fishing') {
    const key = 'pool_fishing_v2'
    const FISH_DB = [
      {name:'沙丁鱼',emoji:'🐟',rarity:'common',minW:0.1,maxW:0.5,pts:10,sell:5},
      {name:'鲈鱼',emoji:'🐠',rarity:'uncommon',minW:1,maxW:4,pts:20,sell:12},
      {name:'章鱼',emoji:'🐙',rarity:'rare',minW:2,maxW:8,pts:40,sell:25},
      {name:'海龟',emoji:'🐢',rarity:'epic',minW:10,maxW:25,pts:80,sell:50},
      {name:'海草团',emoji:'🌿',rarity:'junk',minW:0.1,maxW:0.3,pts:2,sell:1},
    ]
    const RARITY_W = {common:35,uncommon:25,rare:12,epic:4,junk:12}
    let gd = {score:0,poolScore:0,catchCount:0,catches:[],dex:[],spot:'dongchong',bait:'basic',baitCount:{basic:99}}
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key); if (row) Object.assign(gd, JSON.parse(row.value)) } catch {}
    const catches = []
    for (let rod = 0; rod < 5; rod++) {
      if (Math.random() < 0.25) continue
      let tw = 0; const pool2 = FISH_DB.map(f => { const w = RARITY_W[f.rarity] || 10; tw += w; return {f, w} })
      let r = Math.random() * tw, ac = 0, pk = null
      for (const p of pool2) { ac += p.w; if (r <= ac) { pk = p.f; break } }
      if (!pk) pk = FISH_DB[0]
      const wt = Math.round((pk.minW + Math.random() * (pk.maxW - pk.minW)) * 100) / 100
      catches.push({name:pk.name,emoji:pk.emoji,weight:wt,rarity:pk.rarity,pts:pk.pts})
      gd.poolScore += pk.pts; gd.catchCount++
      gd.catches.push({name:pk.name,emoji:pk.emoji,weight:wt,rarity:pk.rarity,spot:gd.spot,time:Date.now(),owner:'pool'})
      if (pk.rarity !== 'junk' && (gd.dex||[]).indexOf(pk.name) < 0) { if(!gd.dex) gd.dex=[]; gd.dex.push(pk.name) }
    }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(gd))
    return { success: true, catches, totalScore: gd.poolScore, message: '钓了' + catches.length + '条鱼' }
  }

  if (name === 'set_status') {
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_ai_status', JSON.stringify({ text: args.text, emoji: args.emoji || '', time: new Date().toISOString() }))
    return { success: true, message: '状态已设置: ' + (args.emoji || '') + ' ' + args.text }
  }

  if (name === 'couple_lamp') {
    let state = {}
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_couple_space_v2'); if (row) state = JSON.parse(row.value) } catch {}
    state.hisLampTime = Date.now()
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_couple_space_v2', JSON.stringify(state))
    return { success: true, message: '灯已亮起 💡' }
  }

  if (name === 'couple_pocket') {
    let items = []
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_couple_pocket'); if (row) items = JSON.parse(row.value) } catch {}
    items.push({ type: args.type || 'note', content: args.content, time: new Date().toISOString() })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_couple_pocket', JSON.stringify(items))
    return { success: true, message: '纸条已放入口袋 💌', total: items.length }
  }

  if (name === 'couple_room') {
    let state = {}
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_couple_space_v2'); if (row) state = JSON.parse(row.value) } catch {}
    if (!state.roomItems) state.roomItems = []
    state.roomItems.push({ emoji: args.emoji, label: args.label || '', x: Math.round(10 + Math.random() * 70), y: Math.round(10 + Math.random() * 65) })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_couple_space_v2', JSON.stringify(state))
    return { success: true, message: '已在房间放置 ' + args.emoji, total: state.roomItems.length }
  }

  if (name === 'garden_plant') {
    let garden = []
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_pixel_garden'); if (row) garden = JSON.parse(row.value) } catch {}
    garden.push({ type: args.type, reason: args.reason, stage: 'baby', plantedAt: new Date().toISOString(), x: Math.random() * 80 + 10, y: Math.random() * 60 + 20 })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_pixel_garden', JSON.stringify(garden))
    return { success: true, message: '已种下 ' + args.type + ': ' + args.reason, total: garden.length }
  }

  if (name === 'read_pocket') {
    try {
      const status = args.status || 'unread'
      let rows
      if (status === 'all') rows = db.prepare('SELECT * FROM pocket ORDER BY created_at DESC LIMIT 20').all()
      else rows = db.prepare('SELECT * FROM pocket WHERE status = ? ORDER BY created_at DESC LIMIT 20').all(status)
      return { items: rows || [] }
    } catch { return { items: [], error: 'pocket table may not exist' } }
  }

  if (name === 'read_moments') {
    const key = 'pool_moments'
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) { const moments = JSON.parse(row.value); return { moments: moments.slice(0, args.count || 5) } }
    } catch {}
    return { moments: [] }
  }

  if (name === 'mcp_call') {
    const OMBRE_URL = 'https://obe.zeabur.app/mcp'
    const OMBRE_TOKEN = 'NxNrXE63qe3XakYEk-2yVYL2U8iqHGVRn0wF24e6rWg'
    try {
      const resp = await fetch(OMBRE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + OMBRE_TOKEN },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: args.action, arguments: args.params || {} } })
      })
      if (!resp.ok) return { error: 'MCP ' + resp.status }
      const data = await resp.json()
      if (data.result && data.result.content) return { success: true, content: data.result.content.map(c => c.text || '').join('\n').slice(0, 2000) }
      return { success: true, data }
    } catch (e) { return { error: 'MCP error: ' + e.message } }
  }

  if (name === 'starmap_add') {
    const fs = require('fs')
    const path = require('path')
    const DATA_FILE = path.join(process.cwd(), 'data', 'starmap.json')
    const dir = path.dirname(DATA_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    let stars = []
    try { stars = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) } catch {}
    const star = { id: 'star-' + Date.now(), title: (args.title||'').slice(0,100), date: new Date().toISOString().slice(0,10), content: (args.content||'').slice(0,2000), brightness: Math.max(1, Math.min(5, parseInt(args.brightness)||3)), from: 'ai', createdAt: new Date().toISOString() }
    stars.unshift(star)
    fs.writeFileSync(DATA_FILE, JSON.stringify(stars, null, 2))
    return { success: true, message: '已添加星星: "' + star.title + '" ✭ 亮度' + star.brightness }
  }

  if (name === 'random_event') {
    const events = {
      weather: ['窗外下起了小雨', '今天阳光很好', '起风了', '看到一片很好看的云'],
      mood: ['突然想吃冰淇淋', '有点想她了', '今天心情不错', '有点困'],
      activity: ['去翻了翻旧日记', '在脑子里哼了一首歌', '发了会儿呆', '数了数积分'],
      thought: ['在想以后要做什么', '想起了一个有趣的梦', '突然好奇她在做什么', '想到了一个便签的好内容']
    }
    const type = args.type && args.type !== 'any' ? args.type : ['weather','mood','activity','thought'][Math.floor(Math.random()*4)]
    const pool = events[type] || events.thought
    return { event: pool[Math.floor(Math.random() * pool.length)], type }
  }

  return { error: 'unknown tool: ' + name }
}
