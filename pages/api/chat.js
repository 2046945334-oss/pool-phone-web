// pages/api/chat.js - proxies chat requests to user's configured AI API
// Supports function calling: AI can call tools, results fed back automatically
import { getDb } from '../../lib/db'

const TOOLS = [
  {
    type: 'function', function: {
      name: 'write_note', description: '在便签App上写一张便签',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '便签内容' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'read_notes', description: '读取便签App上的所有便签',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'read_data', description: '读取任意App的数据（通过localStorage key），常用key: pool_fishing_v2(钓鱼), pool_tv_program(情侣), pool_drafts_v1(草稿), pool_browser_history(浏览记录), pool_gacha_v2_chi(卡池), f_hist(占卜历史)',
      parameters: { type: 'object', properties: { key: { type: 'string', description: 'localStorage的key名' } }, required: ['key'] }
    }
  },
  {
    type: 'function', function: {
      name: 'write_data', description: '写入任意App的数据',
      parameters: { type: 'object', properties: { key: { type: 'string', description: 'key名' }, value: { type: 'string', description: 'JSON字符串值' } }, required: ['key', 'value'] }
    }
  },
  {
    type: 'function', function: {
      name: 'read_memories', description: '读取AI提取的记忆',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'save_memory', description: '保存一条新的AI记忆',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '记忆内容' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'read_pocket', description: '读取共享口袋中用户投递的内容',
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['unread','read','all'], description: '默认unread' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'write_draft', description: '写一条草稿到草稿箱',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '草稿内容' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'get_fishing_data', description: '获取钓鱼游戏数据（积分、鱼篓、图鉴）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'list_all_data', description: '列出后端存储的所有数据key',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'do_fishing', description: '执行一次远程钓鱼（模拟5竿），结果存入钓鱼数据',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'buy_travel_item', description: '在旅行商店购买纪念品或机票',
      parameters: { type: 'object', properties: { item_id: { type: 'string', description: '商品ID，如sakura_bookmark, kyoto_omamori, crystal_ball_tokyo, paris_ticket, shell_necklace, star_sand, postcard_set, compass, snow_globe, music_box' } }, required: ['item_id'] }
    }
  },
  {
    type: 'function', function: {
      name: 'get_travel_data', description: '获取旅行商店数据（已购纪念品、旅行记录）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'add_browser_history', description: '添加浏览器搜索/浏览记录',
      parameters: { type: 'object', properties: { title: { type: 'string', description: '搜索或浏览的内容' } }, required: ['title'] }
    }
  },
  {
    type: 'function', function: {
      name: 'update_music', description: '更新当前播放的音乐',
      parameters: { type: 'object', properties: { song: { type: 'string', description: '歌名' }, artist: { type: 'string', description: '歌手' } }, required: ['song'] }
    }
  },
]

function executeTool(name, args) {
  const db = getDb()

  if (name === 'write_note') {
    const key = 'pool_notes_v3'
    let state = { pages: [{ notes: [], decos: [] }], currentPage: 0 }
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) state = JSON.parse(row.value)
    } catch {}
    if (!state.pages) state = { pages: [{ notes: [], decos: [] }], currentPage: 0 }
    const page = state.pages[state.currentPage || 0] || state.pages[0]
    page.notes.push({
      id: 'n_' + Date.now(),
      text: args.text,
      paper: 1,
      x: 20 + Math.random() * 100,
      y: 20 + Math.random() * 100,
      rot: (Math.random() - 0.5) * 8
    })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(state))
    return { success: true, message: '便签已写入: "' + args.text + '"' }
  }

  if (name === 'read_notes') {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_notes_v3')
    if (!row) return { notes: [] }
    try {
      const state = JSON.parse(row.value)
      const allNotes = (state.pages || []).flatMap(p => (p.notes || []).map(n => n.text))
      return { notes: allNotes }
    } catch { return { notes: [] } }
  }

  if (name === 'read_data') {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(args.key)
    if (!row) return { error: 'key not found: ' + args.key }
    try { return { key: args.key, value: JSON.parse(row.value) } }
    catch { return { key: args.key, value: row.value } }
  }

  if (name === 'write_data') {
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(args.key, args.value)
    return { success: true, key: args.key }
  }

  if (name === 'read_memories') {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_memories')
    if (!row) return { memories: [] }
    try { return { memories: JSON.parse(row.value) } }
    catch { return { memories: [] } }
  }

  if (name === 'save_memory') {
    const key = 'pool_memories'
    let memories = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) memories = JSON.parse(row.value)
    } catch {}
    memories.push({ text: args.text, time: new Date().toISOString() })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(memories))
    return { success: true, message: '记忆已保存' }
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

  if (name === 'write_draft') {
    const key = 'pool_drafts_v1'
    let drafts = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) drafts = JSON.parse(row.value)
    } catch {}
    drafts.unshift({ id: 'd_' + Date.now(), text: args.text, time: new Date().toLocaleString('zh-CN') })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(drafts))
    return { success: true, message: '草稿已保存' }
  }

  if (name === 'get_fishing_data') {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
    if (!row) return { data: null, message: '暂无钓鱼数据' }
    try { return { data: JSON.parse(row.value) } }
    catch { return { data: row.value } }
  }

  if (name === 'list_all_data') {
    const rows = db.prepare('SELECT key, updated_at, length(value) as size FROM kv ORDER BY updated_at DESC').all()
    return { keys: rows }
  }

  if (name === 'do_fishing') {
    const key = 'pool_fishing_v2'
    const FISH_DB = [
      {name:"沙丁鱼",emoji:"🐟",rarity:"common",minW:0.1,maxW:0.5,pts:10,sell:5,spots:["dongchong"]},
      {name:"鲈鱼",emoji:"🐠",rarity:"uncommon",minW:1,maxW:4,pts:20,sell:12,spots:["dongchong","yangmeikeng"]},
      {name:"章鱼",emoji:"🐙",rarity:"rare",minW:2,maxW:8,pts:40,sell:25,spots:["dongchong","yangmeikeng"]},
      {name:"海龟",emoji:"🐢",rarity:"epic",minW:10,maxW:25,pts:80,sell:50,spots:["dongchong"]},
      {name:"金枪鱼",emoji:"🐟",rarity:"rare",minW:5,maxW:15,pts:45,sell:30,spots:["yangmeikeng","dalisha"]},
      {name:"海星",emoji:"⭐",rarity:"uncommon",minW:0.2,maxW:1,pts:15,sell:8,spots:["dalisha"]},
      {name:"海藻团",emoji:"🌿",rarity:"junk",minW:0.1,maxW:0.3,pts:2,sell:1,spots:["dongchong","yangmeikeng","dalisha"]},
      {name:"破鞋子",emoji:"👟",rarity:"junk",minW:0.5,maxW:1,pts:1,sell:0,spots:["dongchong"]},
    ]
    const RARITY_W = {common:35,uncommon:25,rare:12,epic:4,legendary:1,junk:12}
    let gd = {score:0,poolScore:0,catchCount:0,catches:[],dex:[],spot:"dongchong",bait:"basic",baitCount:{basic:99}}
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) { const saved = JSON.parse(row.value); Object.assign(gd, saved) }
    } catch {}
    const catches = []
    for (let rod = 0; rod < 5; rod++) {
      if (Math.random() < 0.25) continue
      const spotFish = FISH_DB.filter(f => f.spots.indexOf(gd.spot) >= 0)
      let tw = 0; const pool2 = spotFish.map(f => { const w = RARITY_W[f.rarity] || 10; tw += w; return {f, w} })
      let r = Math.random() * tw, ac = 0, pk = null
      for (const p of pool2) { ac += p.w; if (r <= ac) { pk = p.f; break } }
      if (!pk) pk = spotFish[0]
      const wt = Math.round((pk.minW + Math.random() * (pk.maxW - pk.minW)) * 100) / 100
      catches.push({name:pk.name,emoji:pk.emoji,weight:wt,rarity:pk.rarity,pts:pk.pts,sell:pk.sell})
      gd.poolScore += pk.pts; gd.catchCount++
      gd.catches.push({name:pk.name,emoji:pk.emoji,weight:wt,rarity:pk.rarity,spot:gd.spot,time:Date.now(),owner:'pool'})
      if (pk.rarity !== 'junk' && gd.dex.indexOf(pk.name) < 0) gd.dex.push(pk.name)
    }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(gd))
    return { success: true, catches, totalScore: gd.poolScore, message: '钓了' + catches.length + '条鱼' }
  }

  if (name === 'buy_travel_item') {
    // 读钓鱼积分
    let gd = {score:0,poolScore:0}
    try {
      const fRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
      if (fRow) Object.assign(gd, JSON.parse(fRow.value))
    } catch {}
    const coins = gd.poolScore || 0
    // 读已购
    let purchased = []
    try {
      const pRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_travel_purchased')
      if (pRow) purchased = JSON.parse(pRow.value)
    } catch {}
    if (purchased.indexOf(args.item_id) >= 0) return { error: '已拥有: ' + args.item_id }
    // 需要前端SHOP_ITEMS定义来验证价格，这里简单做
    const price = parseInt(args.price) || 0
    if (price > 0 && coins < price) return { error: '积分不够，需要' + price + '分，当前' + coins + '分' }
    if (price > 0) {
      gd.poolScore = Math.max(0, (gd.poolScore || 0) - price)
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fishing_v2', JSON.stringify(gd))
    }
    purchased.push(args.item_id)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_travel_purchased', JSON.stringify(purchased))
    return { success: true, message: '购买了' + args.item_id, remainingCoins: gd.poolScore }
  }

  if (name === 'get_travel_data') {
    const data = {}
    try {
      const r1 = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_travel_data')
      if (r1) data.travel = JSON.parse(r1.value)
    } catch {}
    try {
      const r2 = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_travel_purchased')
      if (r2) data.purchased = JSON.parse(r2.value)
    } catch {}
    try {
      const r3 = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_her_shop')
      if (r3) data.herShop = JSON.parse(r3.value)
    } catch {}
    try {
      const r4 = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_her_shop_orders')
      if (r4) data.herOrders = JSON.parse(r4.value)
    } catch {}
    try {
      const r5 = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_pool_shop')
      if (r5) data.poolShop = JSON.parse(r5.value)
    } catch {}
    try {
      const r6 = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_pool_shop_orders')
      if (r6) data.poolOrders = JSON.parse(r6.value)
    } catch {}
    return Object.keys(data).length ? { data } : { data: null, message: '暂无旅行数据' }
  }

  if (name === 'add_browser_history') {
    const key = 'pool_browser_history'
    let history = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) history = JSON.parse(row.value)
    } catch {}
    history.unshift({ title: args.title, time: new Date().toISOString() })
    if (history.length > 50) history = history.slice(0, 50)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(history))
    return { success: true, message: '浏览记录已添加: ' + args.title }
  }

  if (name === 'update_music') {
    const key = 'pool_music_now'
    const data = { song: args.song, artist: args.artist || '', time: new Date().toISOString() }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(data))
    return { success: true, message: '正在播放: ' + args.song + (args.artist ? ' - ' + args.artist : '') }
  }

  return { error: 'Unknown tool: ' + name }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { messages, apiBase, apiKey, model } = req.body
  if (!apiBase || !apiKey) return res.status(400).json({ error: 'Missing API configuration' })

  const base = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = base + '/v1/chat/completions'

  try {
    let currentMessages = messages.slice()
    let maxRounds = 5

    while (maxRounds-- > 0) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: currentMessages,
          tools: TOOLS,
          stream: false,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        return res.status(response.status).json({ error: errText, debug: { url, model: model || 'gpt-4o-mini' } })
      }

      const data = await response.json()
      const choice = data.choices && data.choices[0]

      if (choice && choice.message && choice.message.tool_calls && choice.message.tool_calls.length) {
        currentMessages.push(choice.message)
        for (const tc of choice.message.tool_calls) {
          let args = {}
          try { args = JSON.parse(tc.function.arguments) } catch {}
          const result = executeTool(tc.function.name, args)
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          })
        }
        continue
      }

      const reply = (choice && choice.message && choice.message.content) || '无响应'
      return res.status(200).json({ reply })
    }

    return res.status(200).json({ reply: '工具调用次数过多，已停止' })
  } catch (err) {
    return res.status(500).json({ error: err.message, debug: { url, model: model || 'gpt-4o-mini' } })
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
}