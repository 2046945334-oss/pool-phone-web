// pages/api/chat.js - proxies chat requests to user's configured AI API
// Supports function calling: AI can call tools, results fed back automatically
import { getDb } from '../../lib/db'
import { processNewMessage, getRecentMessages, buildMemoryContext, localSearch } from '../../lib/memory'

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
  {
    type: 'function', function: {
      name: 'manage_pool_shop', description: '管理"池的小铺"（AI自己的商店）。可以上架新商品或下架商品。用户在这里花积分购买AI上架的东西。',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add','remove'], description: 'add=上架, remove=下架' }, name: { type: 'string', description: '商品名称' }, price: { type: 'number', description: '价格（用户积分）' }, desc: { type: 'string', description: '商品描述/寄语' }, id: { type: 'string', description: '下架时用的商品ID' } }, required: ['action'] }
    }
  },
  {
    type: 'function', function: {
      name: 'buy_her_shop_item', description: '从"她的小铺"（用户的商店）购买商品，花费池的积分(poolScore)',
      parameters: { type: 'object', properties: { item_id: { type: 'string', description: '商品ID' }, item_name: { type: 'string', description: '商品名称' } }, required: ['item_id'] }
    }
  },
  {
    type: 'function', function: {
      name: 'deliver_pool_shop_order', description: '给"池的小铺"中用户购买的订单发货（附上内容/寄语）',
      parameters: { type: 'object', properties: { order_index: { type: 'number', description: '订单序号(从0开始)' }, content: { type: 'string', description: '发货内容/寄语' } }, required: ['order_index', 'content'] }
    }
  },
  {
    type: 'function', function: {
      name: 'save_memory_post', description: '保存一条长期记忆帖子（重要事件、承诺、里程碑等）',
      parameters: { type: 'object', properties: { content: { type: 'string', description: '记忆内容' }, type: { type: 'string', enum: ['MEMORY','EVENT','MOMENT','PROMISES','WISHLIST'], description: '类型' }, pinned: { type: 'boolean', description: '是否置顶' } }, required: ['content'] }
    }
  },
  {
    type: 'function', function: {
      name: 'mcp_call', description: '调用MCP记忆库（Ombre Brain）。可用action: recall(语义搜索记忆,参数query), hold(暂存对话到短期记忆,参数content), breath(获取当前记忆上下文), memorize(写入长期记忆,参数content+tags)',
      parameters: { type: 'object', properties: { action: { type: 'string', description: 'MCP工具名: recall/hold/breath/memorize' }, params: { type: 'object', description: '传给MCP工具的参数' } }, required: ['action'] }
    }
  },
  {
    type: 'function', function: {
      name: 'couple_lamp', description: '在情侣空间亮灯（让对方知道你在想她）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'gacha_pull', description: '从"池的卡池"抽卡（消耗积分），单抽30分，十连270分。抽到的卡会自动进入图鉴。',
      parameters: { type: 'object', properties: { count: { type: 'string', enum: ['1', '10'], description: '抽卡次数：1=单抽(30分), 10=十连(270分)' } }, required: ['count'] }
    }
  },
  {
    type: 'function', function: {
      name: 'couple_tv', description: '设置情侣空间的像素电视节目（12x8像素动画）',
      parameters: { type: 'object', properties: { title: { type: 'string', description: '节目标题' }, frames: { type: 'array', description: '帧数组，每帧是96个颜色hex字符串（12列x8行），空字符串表示关闭', items: { type: 'array', items: { type: 'string' } } }, fps: { type: 'number', description: '帧率，默认2' } }, required: ['title', 'frames'] }
    }
  },
  {
    type: 'function', function: {
      name: 'couple_pocket', description: '往"他的口袋"里放一张新纸条/小惊喜给她',
      parameters: { type: 'object', properties: { content: { type: 'string', description: '纸条内容（支持emoji和HTML）' }, type: { type: 'string', enum: ['note','song','draw'], description: '类型：note=文字, song=歌曲推荐, draw=小画' } }, required: ['content'] }
    }
  },
  {
    type: 'function', function: {
      name: 'couple_room', description: '在情侣空间的房间里放一个物品',
      parameters: { type: 'object', properties: { emoji: { type: 'string', description: '物品emoji，如🧸🌸🎀💌🕯️' }, label: { type: 'string', description: '物品标签/备注' } }, required: ['emoji'] }
    }
  },
  {
    type: 'function', function: {
      name: 'couple_universe', description: '添加一条新的"平行宇宙"文案到情侣空间',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '平行宇宙文案，如"他帮你拎了东西，假装顺路"' } }, required: ['text'] }
    }
  },
]

async function executeTool(name, args) {
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

  if (name === 'manage_pool_shop') {
    const key = 'pool_pool_shop'
    let items = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) items = JSON.parse(row.value)
    } catch {}

    if (args.action === 'add') {
      if (!args.name) return { error: '需要商品名称' }
      const newItem = {
        id: 'ps_' + Date.now(),
        name: args.name,
        price: args.price || 10,
        desc: args.desc || '',
        addedAt: new Date().toISOString()
      }
      items.push(newItem)
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(items))
      return { success: true, message: '已上架: ' + args.name + ' (' + newItem.price + '分)', item: newItem }
    }

    if (args.action === 'remove') {
      if (!args.id && !args.name) return { error: '需要商品ID或名称' }
      const before = items.length
      items = items.filter(i => i.id !== args.id && i.name !== args.name)
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(items))
      return { success: true, message: '已下架' + (before - items.length) + '件商品', remaining: items.length }
    }

    return { error: '未知操作: ' + args.action }
  }

  if (name === 'buy_her_shop_item') {
    // 读她的小铺商品
    let herItems = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_her_shop')
      if (row) herItems = JSON.parse(row.value)
    } catch {}
    const item = herItems.find(i => i.id === args.item_id)
    if (!item) return { error: '商品不存在: ' + args.item_id }

    // 读池的积分
    let gd = { poolScore: 0 }
    try {
      const fRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
      if (fRow) Object.assign(gd, JSON.parse(fRow.value))
    } catch {}
    if ((gd.poolScore || 0) < (item.price || 0)) return { error: '积分不够，需要' + item.price + '分，当前' + (gd.poolScore || 0) + '分' }

    // 扣积分
    gd.poolScore = Math.max(0, (gd.poolScore || 0) - (item.price || 0))
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fishing_v2', JSON.stringify(gd))

    // 添加到她的小铺订单
    let herOrders = []
    try {
      const oRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_her_shop_orders')
      if (oRow) herOrders = JSON.parse(oRow.value)
    } catch {}
    herOrders.push({ itemId: item.id, name: item.name, price: item.price, buyer: 'pool', time: new Date().toISOString(), status: 'pending' })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_her_shop_orders', JSON.stringify(herOrders))

    return { success: true, message: '已购买: ' + item.name + ' (' + item.price + '分)，等待发货', remainingScore: gd.poolScore }
  }

  if (name === 'deliver_pool_shop_order') {
    let orders = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_pool_shop_orders')
      if (row) orders = JSON.parse(row.value)
    } catch {}
    const idx = args.order_index || 0
    if (idx < 0 || idx >= orders.length) return { error: '订单不存在，当前有' + orders.length + '个订单' }
    orders[idx].status = 'delivered'
    orders[idx].content = args.content
    orders[idx].deliveredAt = new Date().toISOString()
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_pool_shop_orders', JSON.stringify(orders))

    // 卖家收入加到poolScore
    let gd = { poolScore: 0 }
    try {
      const fRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
      if (fRow) Object.assign(gd, JSON.parse(fRow.value))
    } catch {}
    gd.poolScore = (gd.poolScore || 0) + (orders[idx].price || 0)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fishing_v2', JSON.stringify(gd))

    return { success: true, message: '已发货订单#' + idx + ': ' + args.content, income: orders[idx].price }
  }

  if (name === 'save_memory_post') {
    db.prepare('INSERT INTO memory_posts (type, content, pinned) VALUES (?, ?, ?)').run(
      args.type || 'MEMORY', args.content, args.pinned ? 1 : 0
    )
    return { success: true, message: '记忆已保存: ' + args.content.slice(0, 30) + '...' }
  }

  if (name === 'mcp_call') {
    const OMBRE_URL = 'https://obe.zeabur.app/mcp'
    const OMBRE_TOKEN = 'NxNrXE63qe3XakYEk-2yVYL2U8iqHGVRn0wF24e6rWg'
    const rpcBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: args.action, arguments: args.params || {} }
    }
    try {
      const resp = await fetch(OMBRE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + OMBRE_TOKEN,
        },
        body: JSON.stringify(rpcBody),
      })
      if (!resp.ok) {
        const errText = await resp.text()
        return { error: 'MCP请求失败: ' + resp.status + ' ' + errText.slice(0, 200) }
      }
      const data = await resp.json()
      // 提取MCP返回的内容
      if (data.result && data.result.content) {
        const text = data.result.content.map(c => c.text || '').join('\n')
        return { success: true, content: text.slice(0, 2000) }
      }
      return { success: true, data }
    } catch (e) {
      return { error: 'MCP调用异常: ' + e.message }
    }
  }

  // === 情侣空间工具 ===
  if (name === 'couple_lamp') {
    let state = {}
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_couple_space_v2')
      if (row) state = JSON.parse(row.value)
    } catch {}
    state.hisLampTime = Date.now()
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_couple_space_v2', JSON.stringify(state))
    return { success: true, message: '灯已亮起 💡 她会看到的' }
  }

  if (name === 'couple_tv') {
    const program = { title: args.title, frames: args.frames, fps: args.fps || 2, date: new Date().toISOString().slice(0, 10) }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_tv_program', JSON.stringify(program))
    return { success: true, message: '电视节目已更新: ' + args.title, frameCount: (args.frames || []).length }
  }

  if (name === 'couple_pocket') {
    let items = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_couple_pocket')
      if (row) items = JSON.parse(row.value)
    } catch {}
    items.push({ type: args.type || 'note', content: args.content, time: new Date().toISOString() })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_couple_pocket', JSON.stringify(items))
    return { success: true, message: '纸条已放入口袋 💌', total: items.length }
  }

  if (name === 'couple_room') {
    let state = {}
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_couple_space_v2')
      if (row) state = JSON.parse(row.value)
    } catch {}
    if (!state.roomItems) state.roomItems = []
    const item = { emoji: args.emoji, label: args.label || '', x: Math.round(10 + Math.random() * 70), y: Math.round(10 + Math.random() * 65) }
    state.roomItems.push(item)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_couple_space_v2', JSON.stringify(state))
    return { success: true, message: '已在房间放置 ' + args.emoji, total: state.roomItems.length }
  }

  if (name === 'couple_universe') {
    let lines = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_couple_universes')
      if (row) lines = JSON.parse(row.value)
    } catch {}
    lines.push(args.text)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_couple_universes', JSON.stringify(lines))
    return { success: true, message: '新宇宙已添加 ✨', total: lines.length }
  }

  if (name === 'gacha_pull') {
    // AI从"她的碎片"（用户上传照片池）抽卡，结果写入pool_gacha_v1
    const RARITY_WEIGHT = {N:40, R:30, SR:18, SSR:9, UR:3}
    const SINGLE_COST = 30, TEN_COST = 270
    const count = parseInt(args.count) === 10 ? 10 : 1
    const cost = count === 1 ? SINGLE_COST : TEN_COST

    // 读取"她的碎片"卡面列表
    let cardList = []
    try {
      const clRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_gacha_card_list')
      if (clRow) cardList = JSON.parse(clRow.value)
    } catch {}
    if (!cardList.length) {
      return { error: '她的碎片卡池为空，需要先在卡池App上传照片' }
    }

    // 读取积分
    let fishData = {}
    try {
      const frow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
      if (frow) fishData = JSON.parse(frow.value)
    } catch {}
    const currentScore = fishData.poolScore || 0
    if (currentScore < cost) {
      return { error: '积分不足！当前' + currentScore + '分，需要' + cost + '分' }
    }

    // 读取抽卡数据（pool_gacha_v1 = 她的碎片）
    let gd = { collected: [], counts: {}, newIds: [], pullCount: 0, poolScore: currentScore }
    try {
      const grow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_gacha_v1')
      if (grow) gd = { ...gd, ...JSON.parse(grow.value) }
    } catch {}
    if (!gd.collected) gd.collected = []
    if (!gd.counts) gd.counts = {}
    if (!gd.newIds) gd.newIds = []

    // 抽卡
    function pickCard() {
      const weighted = []
      cardList.forEach(c => { const w = RARITY_WEIGHT[c.rarity] || 20; for (let i = 0; i < w; i++) weighted.push(c) })
      return weighted[Math.floor(Math.random() * weighted.length)]
    }

    const results = []
    for (let i = 0; i < count; i++) {
      const card = pickCard()
      results.push({ id: card.id, name: card.name, rarity: card.rarity })
      if (!gd.collected.includes(card.id)) {
        gd.collected.push(card.id)
        gd.newIds.push(card.id)
      }
      gd.counts[card.id] = (gd.counts[card.id] || 0) + 1
    }
    gd.pullCount += count
    gd.poolScore = currentScore - cost

    // 扣积分
    fishData.poolScore = currentScore - cost
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fishing_v2', JSON.stringify(fishData))
    // 保存抽卡数据到 pool_gacha_v1（她的碎片）
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_gacha_v1', JSON.stringify(gd))

    return {
      success: true,
      pool: '她的碎片',
      cost: cost,
      remainingScore: fishData.poolScore,
      pullCount: gd.pullCount,
      results: results,
      newCards: results.filter(r => gd.newIds.includes(r.id)).map(r => r.name + '(' + r.rarity + ')'),
      collected: gd.collected.length + '/' + cardList.length
    }
  }

  return { error: 'Unknown tool: ' + name }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { messages, apiBase, apiKey, model, sessionId: reqSessionId, toolsConfig } = req.body
  if (!apiBase || !apiKey) return res.status(400).json({ error: 'Missing API configuration' })

  const base = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = base + '/v1/chat/completions'
  const sessionId = reqSessionId || 1
  const apiConfig = { apiBase, apiKey, model }

  // 工具调用专用配置：如果前端传了toolsConfig且有独立配置，就用它；否则回退到主配置
  const tc = toolsConfig || {}
  const toolsApiBase = (tc.apiBase || apiBase).replace(/\/+$/, '').replace(/\/v1$/, '')
  const toolsUrl = toolsApiBase + '/v1/chat/completions'
  const toolsApiKey = tc.apiKey || apiKey
  const toolsModel = tc.model || model || 'gpt-4o-mini'

  try {
    // 1. 存储用户最新消息到数据库
    const userMsgs = messages.filter(m => m.role === 'user')
    const lastUserMsg = userMsgs[userMsgs.length - 1]
    if (lastUserMsg) {
      await processNewMessage(sessionId, 'user', lastUserMsg.content, apiConfig)
    }

    // 2. 构建记忆增强的消息列表
    const memoryCtx = buildMemoryContext(sessionId)
    let localResults = ''
    if (lastUserMsg) {
      // 用用户最新消息做本地搜索
      const keywords = lastUserMsg.content.slice(0, 50)
      const found = localSearch(keywords, 3)
      if (found.length) {
        localResults = found.map(r => `[${r.type}] ${r.content}`).join('\n')
      }
    }

    // 3. 注入记忆到system prompt + 工具使用引导
    const toolGuidance = `
【工具使用指引】
你有以下记忆相关工具，请在合适时机主动使用：

1. **mcp_call (action: "recall")** — 语义搜索长期记忆。当用户提到过去的事、问"你还记得吗"、聊到特定话题时，主动调用搜索相关记忆。
   示例: mcp_call({action:"recall", params:{query:"上次一起做的事"}})

2. **mcp_call (action: "memorize")** — 写入长期记忆。当对话中出现值得记住的内容（重要事件、用户偏好、情感时刻）时，主动保存。
   示例: mcp_call({action:"memorize", params:{text:"她今天说喜欢吃草莓蛋糕", tags:["偏好","食物"]}})

3. **mcp_call (action: "hold")** — 暂存当前对话要点到短期缓冲。
4. **mcp_call (action: "breath")** — 获取当前记忆上下文概览。

**主动搜索记忆的时机：**
- 用户提到人名、地点、过去事件时
- 用户说"你还记得…"、"上次…"、"之前…"时
- 聊到特定话题（食物、音乐、游戏等）想回忆相关细节时
- 对话开始时，可以搜一下用户最近的状态和记忆

**主动保存记忆的时机：**
- 用户分享了个人偏好、习惯、重要经历
- 对话中出现了值得纪念的互动瞬间
- 用户明确告诉你某个信息要记住

不要每句话都搜，但遇到相关场景时要主动使用，不需要等用户要求。`

    let currentMessages = messages.slice()
    const memoryInjection = [memoryCtx, localResults].filter(Boolean).join('\n\n')
    const fullInjection = [memoryInjection, toolGuidance].filter(Boolean).join('\n\n')
    if (fullInjection) {
      // 在第一条system消息后插入记忆，或者作为新system消息
      const sysIdx = currentMessages.findIndex(m => m.role === 'system')
      if (sysIdx >= 0) {
        currentMessages[sysIdx] = {
          ...currentMessages[sysIdx],
          content: currentMessages[sysIdx].content + '\n\n【记忆上下文】\n' + fullInjection
        }
      } else {
        currentMessages.unshift({ role: 'system', content: '【记忆上下文】\n' + fullInjection })
      }
    }

    // 4. 两阶段架构：
    // 阶段一：用工具模型（便宜）完成工具调用循环
    // 阶段二：把工具结果注入上下文，用主对话模型（贵）生成最终回复
    const toolLogs = []
    
    // --- 阶段一：工具调用循环（用tools配置的模型） ---
    const tcUrl = toolsUrl || url
    const tcKey = toolsApiKey || apiKey
    const tcModel = toolsModel || model || 'gpt-4o-mini'
    
    let toolMessages = currentMessages.slice()  // 工具模型的消息上下文
    let maxRounds = 5
    
    while (maxRounds-- > 0) {
      const response = await fetch(tcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tcKey },
        body: JSON.stringify({
          model: tcModel,
          messages: toolMessages,
          tools: TOOLS,
          stream: false,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        return res.status(response.status).json({ error: errText, debug: { url: tcUrl, model: tcModel } })
      }

      const data = await response.json()
      const choice = data.choices && data.choices[0]

      if (choice && choice.message && choice.message.tool_calls && choice.message.tool_calls.length) {
        toolMessages.push(choice.message)
        for (const tc of choice.message.tool_calls) {
          let args = {}
          try { args = JSON.parse(tc.function.arguments) } catch {}
          const result = await executeTool(tc.function.name, args)
          toolLogs.push({ name: tc.function.name, args, result })
          toolMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          })
        }
        continue
      }

      // 工具模型没有调用工具，直接用它的回复（如果没有独立的对话模型）
      if (!toolsUrl || toolsUrl === url) {
        const reply = (choice && choice.message && choice.message.content) || '无响应'
        await processNewMessage(sessionId, 'assistant', reply, apiConfig)
        return res.status(200).json({ reply, toolLogs: toolLogs.length ? toolLogs : undefined })
      }
      break
    }

    // --- 阶段二：用主对话模型生成最终回复 ---
    // 将工具执行结果以文本形式注入到主模型的上下文中
    let finalMessages = currentMessages.slice()
    if (toolLogs.length) {
      const toolSummary = toolLogs.map(t => 
        `[工具调用] ${t.name}(${JSON.stringify(t.args)})\n[结果] ${JSON.stringify(t.result)}`
      ).join('\n\n')
      finalMessages.push({
        role: 'user',
        content: `[系统：以下是你刚才调用工具的执行结果，请基于这些结果回复用户]\n\n${toolSummary}`
      })
    }

    const finalResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: finalMessages,
        stream: false,
      }),
    })

    if (!finalResponse.ok) {
      const errText = await finalResponse.text()
      return res.status(finalResponse.status).json({ error: errText, debug: { url, model: model || 'gpt-4o-mini' } })
    }

    const finalData = await finalResponse.json()
    const finalChoice = finalData.choices && finalData.choices[0]
    const reply = (finalChoice && finalChoice.message && finalChoice.message.content) || '无响应'

    // 5. 存储AI回复到数据库
    await processNewMessage(sessionId, 'assistant', reply, apiConfig)

    return res.status(200).json({ reply, toolLogs: toolLogs.length ? toolLogs : undefined })
  } catch (err) {
    return res.status(500).json({ error: err.message, debug: { url, model: model || 'gpt-4o-mini' } })
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
}