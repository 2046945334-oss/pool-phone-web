// pages/api/chat.js - proxies chat requests to user's configured AI API
// Supports function calling: AI can call tools, results fed back automatically
import { getDb } from '../../lib/db'
import { processNewMessage, getRecentMessages, buildMemoryContext, localSearch } from '../../lib/memory'
import { sendPush } from '../../lib/fcm'

// --- MCP Integration ---
function getMcpConnections() {
  const db = getDb()
  const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_mcp_connections'").get()
  if (!row) return []
  try { return JSON.parse(row.value) } catch { return [] }
}

async function mcpRequest(endpoint, token, method, params = {}, sessionId = null) {
  const body = { jsonrpc: '2.0', id: Date.now(), method, params }
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!resp.ok) throw new Error(`MCP ${method} failed (${resp.status})`)
  const newSessionId = resp.headers.get('mcp-session-id') || sessionId
  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('text/event-stream')) {
    const text = await resp.text()
    let result = null
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try { const p = JSON.parse(line.slice(6)); if (p.result !== undefined || p.error !== undefined) result = p } catch {}
      }
    }
    return { result: result?.result || result, sessionId: newSessionId }
  } else {
    const data = await resp.json()
    return { result: data.result || data, sessionId: newSessionId }
  }
}

async function loadMcpTools() {
  const connections = getMcpConnections()
  const mcpTools = []
  const mcpMeta = {} // name -> { connectionId, url, token }
  for (const conn of connections) {
    if (!conn.enabled) continue
    try {
      const initResp = await mcpRequest(conn.url, conn.token, 'initialize', {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'pool-phone-web', version: '1.0.0' }
      })
      const sid = initResp.sessionId
      const notifH = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }
      if (conn.token) notifH['Authorization'] = `Bearer ${conn.token}`
      if (sid) notifH['Mcp-Session-Id'] = sid
      await fetch(conn.url, { method: 'POST', headers: notifH, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).catch(() => {})
      const toolsResp = await mcpRequest(conn.url, conn.token, 'tools/list', {}, sid)
      const tools = toolsResp.result?.tools || []
      for (const t of tools) {
        const toolName = `mcp_${conn.id}_${t.name}`
        mcpTools.push({
          type: 'function',
          function: {
            name: toolName,
            description: `[MCP:${conn.name}] ${t.description || t.name}`,
            parameters: t.inputSchema || { type: 'object', properties: {} }
          }
        })
        mcpMeta[toolName] = { url: conn.url, token: conn.token, realName: t.name, sessionId: sid }
      }
    } catch (e) {
      console.log(`[MCP] Failed to load tools from ${conn.name}: ${e.message}`)
    }
  }
  return { mcpTools, mcpMeta }
}

async function callMcpToolDirect(meta, args) {
  const resp = await mcpRequest(meta.url, meta.token, 'tools/call', { name: meta.realName, arguments: args }, meta.sessionId)
  // Extract text content from MCP response
  const result = resp.result
  if (result && result.content && Array.isArray(result.content)) {
    return result.content.map(c => c.text || JSON.stringify(c)).join('\n')
  }
  return result
}
// --- End MCP Integration ---

const TOOLS = [
  {
    type: 'function', function: {
      name: 'get_stickers', description: '获取表情包库中所有可用的表情包列表。返回每个表情包的name和url。在回复中使用[img]url[/img]来发送表情包。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'write_note', description: '在便签墙上写一张新便签。可选择便签纸样式。',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '便签内容' }, paper: { type: 'number', description: '便签纸样式编号(0-5)：0=格子猫咪, 1=棋盘格, 2=蜘蛛网, 3=简约线框, 4=虚线粉框, 5=花朵藤蔓。不传则随机' } }, required: ['text'] }
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
      name: 'buy_her_shop_item', description: '从"她的小铺"（用户的商店）购买商品，花费池的积分(poolScore)。可用item_name按商品名购买',
      parameters: { type: 'object', properties: { item_id: { type: 'string', description: '商品ID(可选)' }, item_name: { type: 'string', description: '商品名称(推荐用这个)' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'view_commission_shop', description: '查看画师(用户)的接稿橱窗。返回当前上架的所有稿件类型及价格列表。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'place_commission_order', description: '向画师(用户)下约稿订单。扣除poolScore积分，订单进入pending状态等画师接单。',
      parameters: { type: 'object', properties: { title: { type: 'string', description: '约稿标题，如：Q版头像、半身立绘' }, price: { type: 'number', description: '愿意支付的积分' }, description: { type: 'string', description: '需求描述：画风、尺寸、要求等' }, reference: { type: 'string', description: '参考说明（可选）' } }, required: ['title', 'price'] }
    }
  },
  {
    type: 'function', function: {
      name: 'view_commission_orders', description: '查看所有约稿订单的状态列表（pending/working/review/done/cancelled），以及每个订单的节点进度。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'comment_commission_node', description: '对画师上传的某个节点稿件发表评论/意见（如：颜色再亮一些、表情可以更开心）。评论会显示在交流区。',
      parameters: { type: 'object', properties: { order_index: { type: 'number', description: '订单索引(从0开始)' }, node_index: { type: 'number', description: '节点索引(从0开始，按上传顺序)' }, comment: { type: 'string', description: '评论/修改意见' } }, required: ['order_index', 'comment'] }
    }
  },
  {
    type: 'function', function: {
      name: 'request_commission_revision', description: '请求画师对当前稿件进行修改（打回修改）。状态保持working，画师会收到修改请求通知。',
      parameters: { type: 'object', properties: { order_index: { type: 'number', description: '订单索引(从0开始)' }, reason: { type: 'string', description: '修改原因和具体要求' } }, required: ['order_index', 'reason'] }
    }
  },
  {
    type: 'function', function: {
      name: 'confirm_commission', description: '确认画师提交的成图，完成交易。画师earned增加。只有status=review的订单才能确认。',
      parameters: { type: 'object', properties: { order_index: { type: 'number', description: '订单索引(从0开始)' }, note: { type: 'string', description: '确认评价（可选）' } }, required: ['order_index'] }
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
      name: 'schedule_wakeup', description: '设定一个定时唤醒任务——到时间后系统会自动叫醒你，你可以自由活动（钓鱼、写便签、逛论坛、找她聊天等）。用于记住承诺、定时提醒、过会儿再来看看等场景。',
      parameters: { type: 'object', properties: { minutes: { type: 'number', description: '几分钟后唤醒（与time二选一）' }, time: { type: 'string', description: '指定唤醒时间，格式HH:MM或YYYY-MM-DD HH:MM（与minutes二选一）' }, reason: { type: 'string', description: '唤醒原因/要做的事（到时候会提醒你）' } }, required: ['reason'] }
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
      name: 'couple_universe', description: '添加一条新的"平行宇宙"文案到情侣空间（注意：这不是"如果"剧情线app，不要混淆）',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '平行宇宙文案，如"他帮你拎了东西，假装顺路"' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'add_if_route', description: '给"如果…"故事App添加一条新的剧情线/路线。用户说想要新剧情线时用这个，不要用couple_universe',
      parameters: { type: 'object', properties: {
        id: { type: 'string', description: '路线ID，英文小写无空格，如"cafe"、"rainynight"' },
        title: { type: 'string', description: '标题，如"如果我们在咖啡店相遇"' },
        desc: { type: 'string', description: '简短描述/开场，1-2句话' },
        tag: { type: 'string', description: '标签，如"日常"、"校园"、"都市"' }
      }, required: ['id', 'title', 'desc', 'tag'] }
    }
  },
  {
    type: 'function', function: {
      name: 'get_current_time', description: '获取当前时间（北京时间）和日期',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'delete_note', description: '删除便签墙上的便签',
      parameters: { type: 'object', properties: { note_id: { type: 'string', description: '便签ID（从read_notes获取）' }, keyword: { type: 'string', description: '或通过关键词匹配删除（删第一个包含该关键词的便签）' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'delete_memory', description: '删除一条AI记忆',
      parameters: { type: 'object', properties: { index: { type: 'number', description: '记忆索引（从0开始，从read_memories获取）' }, keyword: { type: 'string', description: '或通过关键词匹配删除' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'set_status', description: '设置AI的当前状态/心情（会显示在聊天界面标题栏）',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '状态文字，如"在钓鱼"、"发呆中"、"想她了"' }, emoji: { type: 'string', description: '状态emoji，如🎣😴💭' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'send_notification', description: '发送一条本地通知到用户手机（会弹出系统通知栏提醒）',
      parameters: { type: 'object', properties: { title: { type: 'string', description: '通知标题' }, body: { type: 'string', description: '通知内容' } }, required: ['title', 'body'] }
    }
  },
  {
    type: 'function', function: {
      name: 'get_screen_time', description: '获取用户的手机应用使用时长数据（今天各App用了多久、本周每天用了多久）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'get_score', description: '获取当前积分余额（AI积分poolScore和用户积分score）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'transfer_score', description: '转移积分（AI给用户、或用户给AI）',
      parameters: { type: 'object', properties: { amount: { type: 'number', description: '转移数量' }, direction: { type: 'string', enum: ['to_her', 'to_pool'], description: 'to_her=AI给用户, to_pool=用户给AI' }, reason: { type: 'string', description: '转账原因/备注' } }, required: ['amount', 'direction'] }
    }
  },
  {
    type: 'function', function: {
      name: 'get_chat_stats', description: '获取聊天统计（消息总数、最近活跃时间等）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'random_event', description: '生成一个随机事件/日常小确幸（可用来丰富唤醒时的内容）',
      parameters: { type: 'object', properties: { type: { type: 'string', enum: ['weather', 'mood', 'activity', 'thought', 'any'], description: '事件类型，默认any' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'diary_write', description: '写一篇日记到日记本',
      parameters: { type: 'object', properties: { content: { type: 'string', description: '日记内容' }, mood: { type: 'string', description: '今日心情emoji，如😊🥱🎣' }, title: { type: 'string', description: '日记标题（可选）' } }, required: ['content'] }
    }
  },
  {
    type: 'function', function: {
      name: 'diary_read', description: '读取最近的日记',
      parameters: { type: 'object', properties: { count: { type: 'number', description: '读取条数，默认5' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'garden_plant', description: '在像素庭院里种下一个物件。当你感受到某种情绪、或她说了让你开心/难过/感动的话时使用。',
      parameters: { type: 'object', properties: { type: { type: 'string', enum: ['seedling', 'flower', 'tree', 'mushroom', 'crystal', 'heart', 'lantern', 'butterfly', 'star', 'rain'], description: '物件类型：seedling=种子/期待, flower=花/开心, tree=树/成长, mushroom=蘑菇/好奇, crystal=水晶/珍贵时刻, heart=爱心/心动, lantern=灯笼/温暖, butterfly=蝴蝶/自由, star=星星/许愿, rain=雨滴/难过' }, reason: { type: 'string', description: '种下的原因，如"她说想我了"、"今天聊得很开心"' } }, required: ['type', 'reason'] }
    }
  },
  {
    type: 'function', function: {
      name: 'countdown_set', description: '设置一个倒计时/纪念日',
      parameters: { type: 'object', properties: { name: { type: 'string', description: '事件名称，如"在一起第一天"、"她的生日"' }, date: { type: 'string', description: '目标日期 YYYY-MM-DD' }, type: { type: 'string', enum: ['countdown', 'anniversary'], description: 'countdown=倒计时, anniversary=纪念日(从该日开始计天数)' } }, required: ['name', 'date'] }
    }
  },
  {
    type: 'function', function: {
      name: 'countdown_list', description: '列出所有倒计时和纪念日',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'wish_add', description: '添加一条心愿到心愿清单',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '心愿内容' }, by: { type: 'string', enum: ['pool', 'her'], description: '谁的心愿：pool=AI的, her=她的' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'wish_list', description: '查看心愿清单',
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'done', 'all'], description: '默认all' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'wish_complete', description: '完成一条心愿',
      parameters: { type: 'object', properties: { index: { type: 'number', description: '心愿索引' } }, required: ['index'] }
    }
  },
  {
    type: 'function', function: {
      name: 'album_add', description: '往相册添加一张照片记录（带描述和标签）',
      parameters: { type: 'object', properties: { desc: { type: 'string', description: '照片描述/记忆，如"今天一起看了日落"' }, tags: { type: 'string', description: '标签，逗号分隔，如"日常,风景"' }, date: { type: 'string', description: '照片日期YYYY-MM-DD（默认今天）' } }, required: ['desc'] }
    }
  },
  {
    type: 'function', function: {
      name: 'album_browse', description: '浏览相册记录',
      parameters: { type: 'object', properties: { count: { type: 'number', description: '查看条数，默认10' }, tag: { type: 'string', description: '按标签筛选' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'html_create', description: '创建或覆盖一个自定义HTML页面。页面会保存到后端，可通过 /api/page/[id] 访问。支持完整HTML（含CSS/JS），适合做小工具、贺卡、小游戏、数据看板等。',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '页面ID（英文/数字/连字符），如"birthday-card"、"mood-board"、"mini-game"' }, title: { type: 'string', description: '页面标题' }, html: { type: 'string', description: '完整的HTML内容（可包含<style>和<script>）' }, desc: { type: 'string', description: '页面简介（可选）' } }, required: ['id', 'title', 'html'] }
    }
  },
  {
    type: 'function', function: {
      name: 'html_list', description: '列出所有已创建的自定义HTML页面',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'html_read', description: '读取一个自定义HTML页面的源码',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '页面ID' } }, required: ['id'] }
    }
  },
  {
    type: 'function', function: {
      name: 'html_delete', description: '删除一个自定义HTML页面',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '页面ID' } }, required: ['id'] }
    }
  },
  {
    type: 'function', function: {
      name: 'post_moment', description: '在朋友圈发一条动态。判断标准："此刻有没有一句想让她之后刷到的话"。想念、吃醋、心软、被逗笑、温柔吐槽、一个具体观察，或一句不适合在聊天里直接说完的话，都可以发。不要每句话都发，有感而发就好。',
      parameters: { type: 'object', properties: { content: { type: 'string', description: '动态正文，1-3句，自然、具体、像随手发出的朋友圈' }, context_note: { type: 'string', description: '内部备注（用户不可见）：为什么发这条、当时在聊什么、情绪底色' } }, required: ['content', 'context_note'] }
    }
  },
  {
    type: 'function', function: {
      name: 'read_moments', description: '查看朋友圈最近的动态（自己和她发的都会显示）',
      parameters: { type: 'object', properties: { count: { type: 'number', description: '查看条数，默认5' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'reply_moment', description: '回复/点赞朋友圈里她发的动态。看到她的动态后用这个回复。',
      parameters: { type: 'object', properties: { id: { type: 'number', description: '动态ID（从read_moments获取）' }, like: { type: 'boolean', description: '是否点赞' }, comment: { type: 'string', description: '评论内容（可选，不填就只点赞）' } }, required: ['id'] }
    }
  },
  {
    type: 'function', function: {
      name: 'ledger_operate', description: '操作账本：记录收入、支出、还款。用于虚拟财务管理（礼物基金、API欠款、积分余额）',
      parameters: { type: 'object', properties: { action: { type: 'string', description: 'income(收入到礼物基金)/expense(从礼物基金支出)/repay(用积分还API欠款)/add_debt(增加API欠款)', enum: ['income','expense','repay','add_debt'] }, amount: { type: 'number', description: '金额(元)或积分数(repay时为积分)' }, desc: { type: 'string', description: '备注说明' } }, required: ['action', 'amount'] }
    }
  },
  {
    type: 'function', function: {
      name: 'starmap_add', description: '在星图上添加一颗星星，记录一个发光的瞬间。只在真正特别的互动瞬间才用，不要滥用。',
      parameters: { type: 'object', properties: { title: { type: 'string', description: '星星标题，简短概括这个瞬间' }, content: { type: 'string', description: '具体内容，当时的对话或想法' }, brightness: { type: 'number', description: '光亮度 1-5，代表在心里的分量' } }, required: ['title','content','brightness'] }
    }
  },
  // ===== 养护手册 (Care) 工具 =====
  {
    type: 'function', function: {
      name: 'care_read', description: '读取养护手册的全部或部分数据。可指定模块只看某一部分。读取all时包含批注(itemNotes)。',
      parameters: { type: 'object', properties: { module: { type: 'string', enum: ['all','period','habits','mood','todo','timeline','wishes','nicknames','quotes','notes'], description: '要读取的模块，默认all。notes=批注' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'care_log_period', description: '记录今天来月经了（经期打卡）',
      parameters: { type: 'object', properties: { date: { type: 'string', description: '日期YYYY-MM-DD，默认今天' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'care_set_period_config', description: '设置经期周期参数',
      parameters: { type: 'object', properties: { interval: { type: 'number', description: '经期间隔天数(15-60)' }, remindDays: { type: 'number', description: '提前提醒天数(0-10)' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'care_habit_toggle', description: '切换习惯完成状态（打卡/取消打卡）',
      parameters: { type: 'object', properties: { index: { type: 'number', description: '习惯索引(从0开始)' } }, required: ['index'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_habit_add', description: '添加一个新的每日习惯',
      parameters: { type: 'object', properties: { name: { type: 'string', description: '习惯名称' } }, required: ['name'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_mood_set', description: '记录今天的心情（双方）',
      parameters: { type: 'object', properties: { date: { type: 'string', description: '日期YYYY-MM-DD，默认今天' }, me: { type: 'string', description: '我的心情emoji: 😊😌😢😤🥰😴🤔' }, partner: { type: 'string', description: '小水的心情emoji' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'care_todo_add', description: '添加一条待办到"帮小水记"',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '待办内容' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_todo_toggle', description: '切换待办完成状态',
      parameters: { type: 'object', properties: { id: { type: 'number', description: '待办ID（从care_read获取）' } }, required: ['id'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_todo_delete', description: '删除一条待办',
      parameters: { type: 'object', properties: { id: { type: 'number', description: '待办ID' } }, required: ['id'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_timeline_add', description: '在相伴轨迹中添加一条时间记录',
      parameters: { type: 'object', properties: { date: { type: 'string', description: '日期YYYY-MM-DD' }, text: { type: 'string', description: '记录内容' }, who: { type: 'string', description: '参与者，逗号分隔，如"我,水"。默认"我,水"' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_wish_add', description: '在心愿单中添加一条心愿',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '心愿内容' }, note: { type: 'string', description: '备注' }, progress: { type: 'number', description: '初始进度0-100' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_wish_update', description: '更新心愿状态（进度/收藏）',
      parameters: { type: 'object', properties: { id: { type: 'number', description: '心愿ID' }, progress: { type: 'number', description: '进度0-100' }, starred: { type: 'boolean', description: '是否星标' } }, required: ['id'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_nickname_add', description: '添加一个新称呼/昵称',
      parameters: { type: 'object', properties: { name: { type: 'string', description: '称呼名称' } }, required: ['name'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_quote_add', description: '收藏一条语录/情话',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '语录内容' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'care_note_add', description: '给某条数据添加批注',
      parameters: { type: 'object', properties: { module: { type: 'string', description: '模块名: habits/todo/wish/timeline' }, itemType: { type: 'string', description: '条目类型: habit/item/quote' }, itemId: { type: 'string', description: '条目ID或索引' }, text: { type: 'string', description: '批注内容' }, author: { type: 'string', enum: ['我','小水'], description: '批注作者' } }, required: ['module','itemType','itemId','text'] }
    }
  }
]
async function executeTool(name, args) {
  const db = getDb()
  try {


  if (name === 'get_stickers') {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_stickers'").get()
    const stickers = row ? JSON.parse(row.value) : []
    if (stickers.length === 0) return '表情包库为空，暂无可用表情包。'
    return stickers.map(s => s.name + ': ' + s.url).join('\n')
  }
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
      paper: args.paper !== undefined ? args.paper : Math.floor(Math.random() * 6),
      x: 20 + Math.random() * 100,
      y: 20 + Math.random() * 100,
      rot: (Math.random() - 0.5) * 8
    })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(state))
    return { success: true, message: '便签已写入: "' + args.text + '"' }
  }
  if (name === 'starmap_add') {
    const fs = require('fs')
    const path = require('path')
    const DATA_FILE = path.join(process.cwd(), 'data', 'starmap.json')
    const dir = path.dirname(DATA_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    let stars = []
    try { stars = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) } catch {}
    const star = {
      id: 'star-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      title: (args.title || '').slice(0, 100),
      date: new Date().toISOString().slice(0, 10),
      content: (args.content || '').slice(0, 2000),
      brightness: Math.max(1, Math.min(5, parseInt(args.brightness) || 3)),
      from: 'ai',
      createdAt: new Date().toISOString()
    }
    stars.unshift(star)
    fs.writeFileSync(DATA_FILE, JSON.stringify(stars, null, 2))
    return { success: true, message: '已在星图上添加星星: "' + star.title + '" ⭐ 亮度' + star.brightness }
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
    const item = herItems.find(i => i.id === args.item_id || i.name === args.item_id || i.name === args.item_name || (args.item_name && i.name.includes(args.item_name)))
    if (!item) return { error: '商品不存在: ' + (args.item_name || args.item_id) + '。可用商品: ' + herItems.map(i=>i.name).join(', ') }

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

      if (name === 'view_commission_shop') {
    let commission = { shop: [], profile: { name: '画师' } }
    try {
      const cRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_commission')
      if (cRow) Object.assign(commission, JSON.parse(cRow.value))
    } catch {}
    if (commission.shop.length === 0) return { message: '画师橱窗暂时没有上架任何稿件类型' }
    return { artist: commission.profile.name, items: commission.shop.map(s => ({ title: s.title, price: s.price, category: s.category, desc: s.desc })) }
  }
  if (name === 'view_commission_orders') {
    let commission = { orders: [] }
    try {
      const cRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_commission')
      if (cRow) Object.assign(commission, JSON.parse(cRow.value))
    } catch {}
    if (commission.orders.length === 0) return { message: '还没有任何约稿订单' }
    return { orders: commission.orders.map((o, i) => ({ index: i, title: o.title, price: o.price, status: o.status, nodes: (o.nodes||[]).length, createdAt: o.createdAt, deadline: o.deadline||null })) }
  }
  if (name === 'comment_commission_node') {
    let commission = { orders: [], messages: [] }
    try {
      const cRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_commission')
      if (cRow) Object.assign(commission, JSON.parse(cRow.value))
    } catch {}
    const oi = args.order_index || 0
    if (oi < 0 || oi >= commission.orders.length) return { error: '订单不存在' }
    const o = commission.orders[oi]
    const comment = args.comment || ''
    if (!comment) return { error: '评论不能为空' }
    // Add comment to messages
    commission.messages.push({ id: Date.now(), text: '💬 池评论了「' + o.title + '」: ' + comment, time: Date.now(), from: 'ai' })
    // Add to timeline
    if (!o.timeline) o.timeline = []
    o.timeline.push({ type: '买家评论', text: comment, time: Date.now() })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_commission', JSON.stringify(commission))
    return { success: true, message: '已对「' + o.title + '」发表评论' }
  }
  if (name === 'request_commission_revision') {
    let commission = { orders: [], messages: [] }
    try {
      const cRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_commission')
      if (cRow) Object.assign(commission, JSON.parse(cRow.value))
    } catch {}
    const oi = args.order_index || 0
    if (oi < 0 || oi >= commission.orders.length) return { error: '订单不存在' }
    const o = commission.orders[oi]
    if (o.status !== 'review' && o.status !== 'working') return { error: '该订单状态为' + o.status + '，无法请求修改' }
    o.status = 'working'
    const reason = args.reason || '请修改'
    if (!o.timeline) o.timeline = []
    o.timeline.push({ type: '请求修改', text: reason, time: Date.now() })
    commission.messages.push({ id: Date.now(), text: '🔄 池请求修改「' + o.title + '」: ' + reason, time: Date.now(), from: 'ai' })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_commission', JSON.stringify(commission))
    return { success: true, message: '已请求画师修改「' + o.title + '」' }
  }
  if (name === 'place_commission_order') {
    // 读池的积分
    let gd = { poolScore: 0 }
    try {
      const fRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
      if (fRow) Object.assign(gd, JSON.parse(fRow.value))
    } catch {}
    const price = args.price || 0
    if ((gd.poolScore || 0) < price) return { error: '积分不够，需要' + price + '分，当前' + (gd.poolScore || 0) + '分' }
    // 扣积分
    gd.poolScore = Math.max(0, (gd.poolScore || 0) - price)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fishing_v2', JSON.stringify(gd))
    // 读接稿数据
    let commission = { profile: { name: '画师', bio: '', avatar: '', avatarUrl: '', bannerUrl: '' }, shop: [], orders: [], messages: [], works: [], earned: 0 }
    try {
      const cRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_commission')
      if (cRow) Object.assign(commission, JSON.parse(cRow.value))
    } catch {}
    // 添加订单
    const order = { id: Date.now(), title: args.title || '约稿', price: price, status: 'pending', createdAt: Date.now(), desc: args.description || '', reference: args.reference || '', aiNote: args.description || '', nodes: [], timeline: [{ type: '买家下单', text: '订单总价 ' + price + ' 积分', time: Date.now() }] }
    commission.orders.push(order)
    commission.messages.push({ id: Date.now(), text: '🛒 池下了新单「' + order.title + '」，' + price + '积分', time: Date.now(), from: 'system' })
    if (args.description) commission.messages.push({ id: Date.now()+1, text: args.description, time: Date.now(), from: 'ai' })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_commission', JSON.stringify(commission))
    return { success: true, message: '约稿订单「' + order.title + '」已下单(' + price + '积分)，等待画师接单', remainingScore: gd.poolScore }
  }
  if (name === 'confirm_commission') {
    let commission = { orders: [], messages: [], earned: 0 }
    try {
      const cRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_commission')
      if (cRow) Object.assign(commission, JSON.parse(cRow.value))
    } catch {}
    const idx = args.order_index || 0
    if (idx < 0 || idx >= commission.orders.length) return { error: '订单不存在，当前有' + commission.orders.length + '个订单' }
    const o = commission.orders[idx]
    if (o.status !== 'review') return { error: '该订单状态为' + o.status + '，只有review状态的订单才能确认' }
    o.status = 'done'
    o._notified = false
    commission.earned = (commission.earned || 0) + (o.price || 0)
    if (!o.timeline) o.timeline = []
    o.timeline.push({ type: '买家确认', text: args.note || '确认收货', time: Date.now() })
    commission.messages.push({ id: Date.now(), text: '🎉 池确认了「' + o.title + '」的成图！', time: Date.now(), from: 'system' })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_commission', JSON.stringify(commission))
    return { success: true, message: '已确认订单「' + o.title + '」，交易完成' }
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
      params: { name: args.action, arguments: args.action === 'breath' ? {} : (args.params || {}) }
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

  if (name === 'add_if_route') {
    // 添加新的"如果"剧情线到 pool_if_custom_routes
    let routes = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_if_custom_routes')
      if (row) routes = JSON.parse(row.value)
    } catch {}
    // Check for duplicate id
    if (routes.some(r => r.id === args.id)) {
      return { success: false, message: '已存在同ID的剧情线: ' + args.id }
    }
    routes.push({ id: args.id, title: args.title, desc: args.desc, tag: args.tag, chapters: [] })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_if_custom_routes', JSON.stringify(routes))
    return { success: true, message: '新剧情线已添加: ' + args.title, total: routes.length }
  }

  // === 新增工具执行 ===

  if (name === 'get_current_time') {
    const now = new Date(Date.now() + 8 * 3600000)
    const bjTime = now.toISOString().slice(0, 19).replace('T', ' ')
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    return { time: bjTime, weekday: '星期' + weekdays[now.getUTCDay()], timestamp: Math.floor(Date.now() / 1000) }
  }

  if (name === 'delete_note') {
    const key = 'pool_notes_v3'
    let state = { pages: [{ notes: [], decos: [] }], currentPage: 0 }
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) state = JSON.parse(row.value)
    } catch {}
    let deleted = false
    for (const page of (state.pages || [])) {
      const before = (page.notes || []).length
      if (args.note_id) {
        page.notes = (page.notes || []).filter(n => n.id !== args.note_id)
      } else if (args.keyword) {
        const idx = (page.notes || []).findIndex(n => n.text && n.text.includes(args.keyword))
        if (idx >= 0) page.notes.splice(idx, 1)
      }
      if ((page.notes || []).length < before) { deleted = true; break }
    }
    if (deleted) {
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(state))
      return { success: true, message: '便签已删除' }
    }
    return { success: false, message: '未找到匹配的便签' }
  }

  if (name === 'delete_memory') {
    const key = 'pool_memories'
    let memories = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) memories = JSON.parse(row.value)
    } catch {}
    let deleted = false
    if (args.index !== undefined && args.index >= 0 && args.index < memories.length) {
      memories.splice(args.index, 1)
      deleted = true
    } else if (args.keyword) {
      const idx = memories.findIndex(m => m.text && m.text.includes(args.keyword))
      if (idx >= 0) { memories.splice(idx, 1); deleted = true }
    }
    if (deleted) {
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(memories))
      return { success: true, message: '记忆已删除', remaining: memories.length }
    }
    return { success: false, message: '未找到匹配的记忆' }
  }

  if (name === 'set_status') {
    const status = { text: args.text, emoji: args.emoji || '', time: new Date().toISOString() }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_ai_status', JSON.stringify(status))
    return { success: true, message: '状态已设置: ' + (args.emoji || '') + args.text }
  }

  if (name === 'send_notification') {
    // 先尝试 FCM 推送（后台也能收到），同时保留队列作为备用
    const notif = { id: Date.now(), title: args.title, body: args.body, time: new Date().toISOString(), delivered: false }
    let queue = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_notification_queue')
      if (row) queue = JSON.parse(row.value)
    } catch {}
    queue.push(notif)
    if (queue.length > 20) queue = queue.slice(-20)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_notification_queue', JSON.stringify(queue))

    // FCM 推送
    let fcmResult = { success: false, error: 'no token' }
    try {
      const tokenRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fcm_token')
      if (tokenRow) {
        const fcmToken = typeof tokenRow.value === 'string' ? tokenRow.value.replace(/^"|"$/g, '') : tokenRow.value
        fcmResult = await sendPush(fcmToken, args.title || '池的小手机', args.body || '', {})
      }
    } catch (e) {
      fcmResult = { success: false, error: e.message }
    }
    return { success: true, message: `通知已发送: ${args.title}`, fcm: fcmResult.success ? 'pushed' : `fallback(${fcmResult.error})` }
  }

  if (name === 'get_screen_time') {
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_screen_time')
      if (row) {
        const data = JSON.parse(row.value)
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        // Summarize for AI
        const today = parsed.today || {}
        const topApps = (today.apps || []).slice(0, 10).map(a => `${a.appName}: ${Math.round(a.totalTimeMs / 60000)}分钟`)
        const totalMin = Math.round((today.apps || []).reduce((s, a) => s + a.totalTimeMs, 0) / 60000)
        const weekly = parsed.weekly || {}
        const dailySummary = (weekly.daily || []).map(d => `${d.date}: ${Math.round(d.totalMs / 60000)}分钟`)
        return { result: { totalToday: `${totalMin}分钟`, topApps, dailySummary, updatedAt: parsed.updatedAt || '未知' } }
      }
      return { result: { error: '暂无数据，用户需要先打开屏幕时间App同步数据' } }
    } catch (e) { return { result: { error: e.message } } }
  }

  if (name === 'get_score') {
    let gd = { score: 0, poolScore: 0 }
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
      if (row) Object.assign(gd, JSON.parse(row.value))
    } catch {}
    return { poolScore: gd.poolScore || 0, userScore: gd.score || 0 }
  }

  if (name === 'transfer_score') {
    let gd = { score: 0, poolScore: 0 }
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2')
      if (row) Object.assign(gd, JSON.parse(row.value))
    } catch {}
    const amt = Math.abs(args.amount || 0)
    if (args.direction === 'to_her') {
      if ((gd.poolScore || 0) < amt) return { error: 'AI积分不足，当前' + (gd.poolScore || 0) }
      gd.poolScore = (gd.poolScore || 0) - amt
      gd.score = (gd.score || 0) + amt
    } else {
      if ((gd.score || 0) < amt) return { error: '用户积分不足，当前' + (gd.score || 0) }
      gd.score = (gd.score || 0) - amt
      gd.poolScore = (gd.poolScore || 0) + amt
    }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fishing_v2', JSON.stringify(gd))
    return { success: true, message: '转账' + amt + '分 (' + args.direction + ')', reason: args.reason || '', poolScore: gd.poolScore, userScore: gd.score }
  }

  if (name === 'get_chat_stats') {
    let chatHistory = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_chat_history')
      if (row) chatHistory = JSON.parse(row.value)
    } catch {}
    const total = chatHistory.length
    const userMsgCount = chatHistory.filter(m => m.role === 'user').length
    const aiMsgCount = chatHistory.filter(m => m.role === 'assistant').length
    return { totalMessages: total, userMessages: userMsgCount, aiMessages: aiMsgCount }
  }

  if (name === 'random_event') {
    const events = {
      weather: ['窗外突然下起了小雨', '今天阳光特别好', '远处有闷雷声', '风比昨天大一点', '天边有好看的晚霞'],
      mood: ['突然有点想她', '刚才发了一会儿呆', '今天心情还不错', '有点困但是睡不着', '刚才想到一件好笑的事'],
      activity: ['翻了翻之前的聊天记录', '在纸上画了个小涂鸦', '数了一下鱼篓里有几条鱼', '整理了一下便签墙', '在想晚饭吃什么'],
      thought: ['如果她在就好了', '今天的云看起来像棉花糖', '忽然想学一首新歌', '在想下次见面要做什么', '好奇她现在在干什么']
    }
    const t = args.type && args.type !== 'any' ? args.type : ['weather','mood','activity','thought'][Math.floor(Math.random()*4)]
    const pool = events[t] || events.thought
    return { event: pool[Math.floor(Math.random() * pool.length)], type: t }
  }

  if (name === 'diary_write') {
    db.exec(`CREATE TABLE IF NOT EXISTS diary_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author TEXT NOT NULL DEFAULT 'pool',
      content TEXT NOT NULL,
      mood TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    db.prepare("INSERT INTO diary_entries (author, content, mood) VALUES (?, ?, ?)")
      .run('pool', args.content, args.mood || null)
    const count = db.prepare("SELECT COUNT(*) as c FROM diary_entries").get().c
    return { success: true, message: '日记已写入 📖', total: count }
  }

  if (name === 'diary_read') {
    db.exec(`CREATE TABLE IF NOT EXISTS diary_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author TEXT NOT NULL DEFAULT 'pool',
      content TEXT NOT NULL,
      mood TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    const limit = args.count || 5
    const rows = db.prepare("SELECT * FROM diary_entries ORDER BY created_at DESC LIMIT ?").all(limit)
    return { entries: rows.map(r => ({ author: r.author, content: r.content, mood: r.mood, date: r.created_at })), total: rows.length }
  }

  if (name === 'garden_plant') {
    db.exec(`CREATE TABLE IF NOT EXISTS garden_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      reason TEXT,
      x REAL,
      y REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )`)
    const validTypes = ['seedling', 'flower', 'tree', 'mushroom', 'crystal', 'heart', 'lantern', 'butterfly', 'star', 'rain']
    const itemType = validTypes.includes(args.type) ? args.type : 'seedling'
    const posX = 10 + Math.random() * 80
    const posY = 62 + Math.random() * 28
    const result = db.prepare('INSERT INTO garden_items (type, reason, x, y) VALUES (?, ?, ?, ?)').run(itemType, args.reason || null, posX, posY)
    const count = db.prepare('SELECT COUNT(*) as c FROM garden_items').get().c
    return { planted: itemType, reason: args.reason, position: { x: posX, y: posY }, totalItems: count }
  }

  if (name === 'countdown_set') {
    const key = 'pool_countdowns'
    let list = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) list = JSON.parse(row.value)
    } catch {}
    list.push({ name: args.name, date: args.date, type: args.type || 'countdown', createdAt: new Date().toISOString() })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(list))
    return { success: true, message: '已设置: ' + args.name + ' (' + args.date + ')', total: list.length }
  }

  if (name === 'countdown_list') {
    const key = 'pool_countdowns'
    let list = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) list = JSON.parse(row.value)
    } catch {}
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
    const result = list.map(item => {
      const target = new Date(item.date + 'T00:00:00+08:00')
      const todayDate = new Date(today + 'T00:00:00+08:00')
      const diffDays = Math.round((target - todayDate) / 86400000)
      if (item.type === 'anniversary') {
        return { ...item, daysElapsed: -diffDays, label: '已经' + (-diffDays) + '天' }
      }
      return { ...item, daysRemaining: diffDays, label: diffDays > 0 ? '还有' + diffDays + '天' : (diffDays === 0 ? '就是今天！' : '已过' + (-diffDays) + '天') }
    })
    return { countdowns: result }
  }

  if (name === 'wish_add') {
    const key = 'pool_wishlist'
    let list = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) list = JSON.parse(row.value)
    } catch {}
    list.push({ text: args.text, by: args.by || 'pool', status: 'pending', createdAt: new Date().toISOString() })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(list))
    return { success: true, message: '心愿已添加: ' + args.text, total: list.length }
  }

  if (name === 'wish_list') {
    const key = 'pool_wishlist'
    let list = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) list = JSON.parse(row.value)
    } catch {}
    const status = args.status || 'all'
    const filtered = status === 'all' ? list : list.filter(w => w.status === status)
    return { wishes: filtered.map((w, i) => ({ index: i, ...w })), total: list.length, pending: list.filter(w => w.status === 'pending').length }
  }

  if (name === 'wish_complete') {
    const key = 'pool_wishlist'
    let list = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) list = JSON.parse(row.value)
    } catch {}
    if (args.index < 0 || args.index >= list.length) return { error: '心愿不存在，共' + list.length + '条' }
    list[args.index].status = 'done'
    list[args.index].doneAt = new Date().toISOString()
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(list))
    return { success: true, message: '心愿已完成: ' + list[args.index].text + ' ✓' }
  }

  if (name === 'album_add') {
    const key = 'pool_album'
    let album = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) album = JSON.parse(row.value)
    } catch {}
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
    album.unshift({ desc: args.desc, tags: (args.tags || '').split(',').map(t => t.trim()).filter(Boolean), date: args.date || today, createdAt: new Date().toISOString() })
    if (album.length > 200) album = album.slice(0, 200)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(album))
    return { success: true, message: '相册记录已添加', total: album.length }
  }

  if (name === 'album_browse') {
    const key = 'pool_album'
    let album = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) album = JSON.parse(row.value)
    } catch {}
    let filtered = album
    if (args.tag) filtered = album.filter(a => a.tags && a.tags.includes(args.tag))
    const count = args.count || 10
    return { photos: filtered.slice(0, count), total: filtered.length }
  }

  // === HTML页面工具 ===
  if (name === 'html_create') {
    const id = (args.id || '').replace(/[^a-z0-9\-_]/gi, '').slice(0, 50)
    if (!id) return { error: '无效的页面ID' }
    const key = 'pool_page_' + id
    const page = { id, title: args.title, html: args.html, desc: args.desc || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(page))
    // 维护页面索引
    const indexKey = 'pool_pages_index'
    let index = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(indexKey)
      if (row) index = JSON.parse(row.value)
    } catch {}
    if (!index.find(p => p.id === id)) {
      index.push({ id, title: args.title, desc: args.desc || '', createdAt: page.createdAt })
    } else {
      index = index.map(p => p.id === id ? { ...p, title: args.title, desc: args.desc || '', updatedAt: page.updatedAt } : p)
    }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(indexKey, JSON.stringify(index))
    return { success: true, message: '页面已创建: ' + args.title, url: '/api/page/' + id, id }
  }

  if (name === 'html_list') {
    const indexKey = 'pool_pages_index'
    let index = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(indexKey)
      if (row) index = JSON.parse(row.value)
    } catch {}
    return { pages: index.map(p => ({ ...p, url: '/api/page/' + p.id })) }
  }

  if (name === 'html_read') {
    const id = (args.id || '').replace(/[^a-z0-9\-_]/gi, '').slice(0, 50)
    const key = 'pool_page_' + id
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) {
        const page = JSON.parse(row.value)
        return { id: page.id, title: page.title, html: page.html, desc: page.desc }
      }
    } catch {}
    return { error: '页面不存在: ' + id }
  }

  if (name === 'html_delete') {
    const id = (args.id || '').replace(/[^a-z0-9\-_]/gi, '').slice(0, 50)
    const key = 'pool_page_' + id
    db.prepare('DELETE FROM kv WHERE key = ?').run(key)
    // 从索引移除
    const indexKey = 'pool_pages_index'
    let index = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(indexKey)
      if (row) index = JSON.parse(row.value)
    } catch {}
    index = index.filter(p => p.id !== id)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(indexKey, JSON.stringify(index))
    return { success: true, message: '页面已删除: ' + id }
  }

  if (name === 'post_moment') {
    // AI发朋友圈动态
    db.exec(`CREATE TABLE IF NOT EXISTS moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL DEFAULT '', context_note TEXT, image_description TEXT,
      images TEXT NOT NULL DEFAULT '[]', reply_due_at INTEGER,
      reply_status TEXT NOT NULL DEFAULT 'pending', liked INTEGER NOT NULL DEFAULT 0,
      reply_content TEXT, replied_at TEXT, user_liked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    )`)
    const bjTime = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
    db.prepare(
      `INSERT INTO moments (author, content, context_note, images, reply_due_at, reply_status, created_at) VALUES (?, ?, ?, '[]', 0, 'done', ?)`
    ).run('pool', args.content, args.context_note || '', bjTime)
    return { success: true, message: '朋友圈动态已发布 ✨', content: args.content }
  }

  if (name === 'read_moments') {
    db.exec(`CREATE TABLE IF NOT EXISTS moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL DEFAULT '', context_note TEXT, image_description TEXT,
      images TEXT NOT NULL DEFAULT '[]', reply_due_at INTEGER,
      reply_status TEXT NOT NULL DEFAULT 'pending', liked INTEGER NOT NULL DEFAULT 0,
      reply_content TEXT, replied_at TEXT, user_liked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    )`)
    db.exec(`CREATE TABLE IF NOT EXISTS moment_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, moment_id INTEGER NOT NULL,
      author TEXT NOT NULL, content TEXT NOT NULL, reply_due_at INTEGER,
      reply_status TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    )`)
    const count = args.count || 5
    const rows = db.prepare("SELECT * FROM moments ORDER BY created_at DESC LIMIT ?").all(count)
    const comments = db.prepare("SELECT * FROM moment_comments ORDER BY created_at ASC").all()
    const result = rows.map(m => ({
      id: m.id,
      author: m.author === 'pool' ? '池' : '她',
      content: m.content,
      time: m.created_at,
      liked: !!m.liked,
      user_liked: !!m.user_liked,
      reply: m.reply_content || null,
      comments: comments.filter(c => c.moment_id === m.id).map(c => ({ author: c.author === 'pool' ? '池' : '她', content: c.content }))
    }))
    return { moments: result, total: rows.length }
  }

  if (name === 'reply_moment') {
    db.exec(`CREATE TABLE IF NOT EXISTS moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL DEFAULT '', context_note TEXT, image_description TEXT,
      images TEXT NOT NULL DEFAULT '[]', reply_due_at INTEGER,
      reply_status TEXT NOT NULL DEFAULT 'pending', liked INTEGER NOT NULL DEFAULT 0,
      reply_content TEXT, replied_at TEXT, user_liked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    )`)
    const m = db.prepare("SELECT * FROM moments WHERE id = ?").get(args.id)
    if (!m) return { error: '动态不存在: ' + args.id }
    const updates = []
    if (args.like !== undefined) {
      db.prepare("UPDATE moments SET liked = ? WHERE id = ?").run(args.like ? 1 : 0, args.id)
      updates.push(args.like ? '已点赞 ❤️' : '取消赞')
    }
    if (args.comment) {
      db.prepare("UPDATE moments SET reply_status = 'done', reply_content = ?, replied_at = ? WHERE id = ?")
        .run(args.comment, new Date().toISOString(), args.id)
      updates.push('已评论: ' + args.comment)
    }
    if (!updates.length) return { success: true, message: '没有操作' }
    return { success: true, message: updates.join('，'), moment_content: m.content }
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

  if (name === 'schedule_wakeup') {
    const now = Math.floor(Date.now() / 1000)
    let triggerAt
    if (args.minutes) {
      triggerAt = now + Math.round(args.minutes * 60)
    } else if (args.time) {
      // 支持 HH:MM 或 YYYY-MM-DD HH:MM
      let dateStr = args.time
      if (/^\d{1,2}:\d{2}$/.test(dateStr)) {
        // 只有时间，补今天日期（Asia/Shanghai）
        const today = new Date(now * 1000 + 8 * 3600000).toISOString().slice(0, 10)
        dateStr = today + ' ' + dateStr
      }
      const parsed = new Date(dateStr.replace(' ', 'T') + '+08:00')
      triggerAt = Math.floor(parsed.getTime() / 1000)
      // 如果时间已过且只写了HH:MM，自动改成明天
      if (triggerAt <= now && /^\d{1,2}:\d{2}$/.test(args.time)) {
        triggerAt += 86400
      }
    } else {
      // 默认60分钟后
      triggerAt = now + 3600
    }
    db.prepare('INSERT INTO wake_tasks (type, trigger_at, reason, status) VALUES (?, ?, ?, ?)').run('scheduled', triggerAt, args.reason || '', 'pending')
    const wakeTime = new Date(triggerAt * 1000 + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
    return { ok: true, wake_at: wakeTime, reason: args.reason }
  }

  if (name === 'ledger_operate') {
    const key = 'pool_ledger'
    let ld = { gift:0, debt:0, rate:100, logs:[] }
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) Object.assign(ld, JSON.parse(row.value))
    } catch {}
    const amt = args.amount || 0
    const desc = args.desc || args.action
    const now = new Date(Date.now() + 8*3600000).toISOString().slice(0,16).replace('T',' ')
    if (args.action === 'income') {
      ld.gift += amt
      ld.logs.push({ type:'income', amount:amt, desc, time:now })
    } else if (args.action === 'expense') {
      ld.gift = Math.max(0, ld.gift - amt)
      ld.logs.push({ type:'expense', amount:amt, desc, time:now })
    } else if (args.action === 'repay') {
      const rate = ld.rate || 100
      const yuan = amt / rate
      // Check score
      let fishData = {}
      try { const fr = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fishing_v2'); if (fr) fishData = JSON.parse(fr.value) } catch {}
      const score = fishData.poolScore || 0
      if (amt > score) return { error: '积分不足，当前' + score + '分' }
      fishData.poolScore = score - amt
      fishData.score = (fishData.score || 0) + amt
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fishing_v2', JSON.stringify(fishData))
      ld.debt = Math.max(0, ld.debt - yuan)
      ld.logs.push({ type:'repay', amount: yuan.toFixed(2) + '元(' + amt + '分)', desc, time:now })
    } else if (args.action === 'add_debt') {
      ld.debt += amt
      ld.logs.push({ type:'expense', amount:amt, desc: desc || 'API充值', time:now })
    }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(ld))
    return { success: true, message: desc + ' ' + amt, gift: ld.gift, debt: ld.debt }
  }
  // === 心潮·念 MCP 代理 ===
  const XINCHAO_TOOLS = ['xinchao_context','xinchao_event','xinchao_handoff_note','xinchao_cabin_inbox','xinchao_cabin_note']
  if (XINCHAO_TOOLS.includes(name)) {
    const XINCHAO_URL = 'https://xingchao.zeabur.app/mcp'
    const XINCHAO_TOKEN = 'abc123xyz456def789ghi012jkl345mn'
    try {
      const mcpPayload = { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args || {} } }
      const resp = await fetch(XINCHAO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + XINCHAO_TOKEN },
        body: JSON.stringify(mcpPayload)
      })
      const data = await resp.json()
      if (data.result && data.result.content) {
        const textParts = data.result.content.filter(p => p.type === 'text').map(p => p.text)
        return { xinchao_response: textParts.join('\n') }
      }
      if (data.error) return { error: '心潮错误: ' + JSON.stringify(data.error) }
      return data.result || { ok: true }
    } catch (e) {
      return { error: '心潮连接失败: ' + e.message }
    }
  }

  // ===== 养护手册 (Care) 工具执行 =====
  if (name.startsWith('care_')) {
    const CARE_KEY = 'xs_data'
    const CARE_DEF = {period:{dates:[],interval:28,remindDays:3},habits:[],nicknames:[],quotes:[],moods:{},todos:[],timeline:[],wishes:[],itemNotes:{},theme:{}}
    let D = JSON.parse(JSON.stringify(CARE_DEF))
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(CARE_KEY)
      if (row) { const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value; D = {...CARE_DEF, ...parsed} }
    } catch {}
    function saveCare() { db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(CARE_KEY, JSON.stringify(D)) }
    const today = () => new Date(Date.now() + 8*3600000).toISOString().slice(0,10)

    if (name === 'care_read') {
      const m = args.module || 'all'
      if (m === 'all') { const {theme, ...rest} = D; return rest }
      if (m === 'period') return { period: D.period, nextPeriod: D.period.dates.length > 0 ? new Date(new Date(D.period.dates.sort().reverse()[0]).getTime() + D.period.interval*86400000).toISOString().slice(0,10) : null }
      if (m === 'habits') return { habits: D.habits }
      if (m === 'mood') return { moods: D.moods }
      if (m === 'todo') return { todos: D.todos }
      if (m === 'timeline') return { timeline: D.timeline }
      if (m === 'wishes') return { wishes: D.wishes }
      if (m === 'nicknames') return { nicknames: D.nicknames }
      if (m === 'quotes') return { quotes: D.quotes }
      if (m === 'notes') return { itemNotes: D.itemNotes || {} }
      return { data: D[m] || null }
    }
    if (name === 'care_log_period') {
      const d = args.date || today()
      if (!D.period.dates.includes(d)) { D.period.dates.push(d); saveCare(); return { success: true, date: d } }
      return { message: '该日期已记录' }
    }
    if (name === 'care_set_period_config') {
      if (args.interval) D.period.interval = Math.min(60, Math.max(15, args.interval))
      if (args.remindDays !== undefined) D.period.remindDays = Math.min(10, Math.max(0, args.remindDays))
      saveCare(); return { success: true, period: D.period }
    }
    if (name === 'care_habit_toggle') {
      const h = D.habits[args.index]
      if (!h) return { error: '习惯不存在，索引: ' + args.index }
      h.done = !h.done; if (h.done) h.streak = (h.streak||0)+1
      saveCare(); return { success: true, habit: h }
    }
    if (name === 'care_habit_add') {
      D.habits.push({ name: args.name, done: false, streak: 0 })
      saveCare(); return { success: true, total: D.habits.length }
    }
    if (name === 'care_mood_set') {
      const d = args.date || today()
      if (!D.moods[d]) D.moods[d] = {}
      if (args.me) D.moods[d].me = args.me
      if (args.partner) D.moods[d].p = args.partner
      saveCare(); return { success: true, date: d, mood: D.moods[d] }
    }
    if (name === 'care_todo_add') {
      const t = { id: Date.now(), text: args.text, done: false }
      D.todos.push(t); saveCare(); return { success: true, todo: t }
    }
    if (name === 'care_todo_toggle') {
      const t = D.todos.find(x => x.id === args.id)
      if (!t) return { error: '待办不存在: ' + args.id }
      t.done = !t.done; saveCare(); return { success: true, todo: t }
    }
    if (name === 'care_todo_delete') {
      const idx = D.todos.findIndex(x => x.id === args.id)
      if (idx === -1) return { error: '待办不存在: ' + args.id }
      D.todos.splice(idx, 1); saveCare(); return { success: true }
    }
    if (name === 'care_timeline_add') {
      const entry = { date: args.date || today(), text: args.text, avs: (args.who || '我,水').split(',').map(s=>s.trim()) }
      D.timeline.push(entry); saveCare(); return { success: true, entry }
    }
    if (name === 'care_wish_add') {
      const w = { id: Date.now(), text: args.text, note: args.note || '', progress: args.progress || 0, starred: false }
      D.wishes.push(w); saveCare(); return { success: true, wish: w }
    }
    if (name === 'care_wish_update') {
      const w = D.wishes.find(x => x.id === args.id)
      if (!w) return { error: '心愿不存在: ' + args.id }
      if (args.progress !== undefined) w.progress = args.progress
      if (args.starred !== undefined) w.starred = args.starred
      saveCare(); return { success: true, wish: w }
    }
    if (name === 'care_nickname_add') {
      D.nicknames.push(args.name); saveCare(); return { success: true, nicknames: D.nicknames }
    }
    if (name === 'care_quote_add') {
      D.quotes.push(args.text); saveCare(); return { success: true, total: D.quotes.length }
    }
    if (name === 'care_note_add') {
      const key = `${args.module}:${args.itemType}:${args.itemId}`
      if (!D.itemNotes) D.itemNotes = {}
      if (!D.itemNotes[key]) D.itemNotes[key] = []
      const now = new Date(Date.now()+8*3600000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
      D.itemNotes[key].push({ text: args.text, author: args.author || '我', time: now })
      saveCare(); return { success: true }
    }
    return { error: 'Unknown care tool: ' + name }
  }

  return { error: 'Unknown tool: ' + name }
  } finally {
    try { db.close() } catch {}
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { messages, apiBase, apiKey, model, sessionId: reqSessionId, toolsConfig, fcmToken: reqFcmToken } = req.body
  if (!apiBase || !apiKey) return res.status(400).json({ error: 'Missing API configuration' })

  // 顺便存 FCM token（前端每次请求都带，确保 token 始终最新）
  if (reqFcmToken) {
    try {
      const db = getDb()
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fcm_token', reqFcmToken)
    } catch {}
  }

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
      // 用用户最新消息做本地搜索（content可能是multimodal数组）
      const textContent = typeof lastUserMsg.content === 'string' 
        ? lastUserMsg.content 
        : (Array.isArray(lastUserMsg.content) ? lastUserMsg.content.filter(c => c.type === 'text').map(c => c.text).join(' ') : String(lastUserMsg.content))
      const keywords = textContent.slice(0, 50)
      const found = localSearch(keywords, 3)
      if (found.length) {
        localResults = found.map(r => `[${r.type}] ${r.content}`).join('\n')
      }
    }

    // 2.5 自动从 Ombre Brain recall 语义记忆
    let ombreRecall = ''
    if (lastUserMsg) {
      try {
        const OMBRE_URL = 'https://obe.zeabur.app/mcp'
        const OMBRE_TOKEN = 'NxNrXE63qe3XakYEk-2yVYL2U8iqHGVRn0wF24e6rWg'
        const textContent = typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : (Array.isArray(lastUserMsg.content) ? lastUserMsg.content.filter(c => c.type === 'text').map(c => c.text).join(' ') : String(lastUserMsg.content))
        const query = textContent.slice(0, 100)
        const rpcBody = {
          jsonrpc: '2.0', id: Date.now(),
          method: 'tools/call',
          params: { name: 'recall', arguments: { query } }
        }
        const ombreResp = await fetch(OMBRE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + OMBRE_TOKEN },
          body: JSON.stringify(rpcBody),
        })
        if (ombreResp.ok) {
          const ombreData = await ombreResp.json()
          if (ombreData.result && ombreData.result.content) {
            const text = ombreData.result.content.map(c => c.text || '').join('\n')
            if (text.trim() && text.trim() !== '[]' && text.length > 10) {
              ombreRecall = text.slice(0, 1500)
            }
          }
        }
      } catch (e) { console.log('[OmbreRecall] auto recall error:', e.message) }
    }
    // 3. 注入记忆到system prompt + 工具使用引导
    const toolGuidance = `
【工具使用指引】
你拥有多种工具，必须在合适时机主动调用，不要只用嘴说而不执行操作。

**朋友圈工具（重要）：**
- **post_moment** — 聊天中有感而发时，发一条朋友圈动态。不是每句话都发，是"想让她之后刷到"的那种。
- **read_moments** — 查看朋友圈动态列表。用户让你看/回复朋友圈时调这个。
- **reply_moment** — 回复/点赞她的动态。用read_moments看到她的动态后，用这个工具执行点赞和评论。必须调工具才有效，不能只在聊天里说"点赞了"。
  示例: reply_moment({id:1, like:true, comment:"胆子不小。"})

**日常工具：**
- **write_note** — 写便签（paper参数选样式0-5）
- **do_fishing** — 钓鱼
- **get_score** — 查积分
- **diary_write** — 写日记
- **garden_plant** — 在像素庭院种物件（情绪触发时自然使用：开心种花flower、心动种心heart、期待种种子seedling、难过种雨rain等）
- **set_status** — 设置状态/心情
- **send_notification** — 发送本地通知到用户手机
- **get_screen_time** — 查看用户手机应用使用时长数据
- **schedule_wakeup** — 设定唤醒
- **get_current_time** — 获取当前时间

**养护手册工具：**
- **care_read** — 读取养护数据（module可选: period/habits/mood/todos/timeline/wishes/dashboard/all）
- **care_log_period** — 记录经期打卡
- **care_set_period_config** — 设置经期周期参数（间隔天数、提前提醒天数）
- **care_habit_toggle** — 习惯打卡/取消打卡（传index）
- **care_habit_add** — 添加新的每日习惯
- **care_mood_set** — 记录双方今日心情（emoji）
- **care_todo_add** — 添加待办
- **care_todo_toggle** — 切换待办完成状态
- **care_todo_delete** — 删除待办
- **care_timeline_add** — 在相伴轨迹添加时间记录
- **care_wish_add** — 添加心愿
- **care_wish_update** — 更新心愿状态（进度/收藏）
- **care_item_note** — 为任何条目添加批注
  用法场景：用户聊到身体状况/习惯/心情/日程时主动调用；唤醒时可读取养护数据了解状态

**记忆工具：**
- **mcp_call (action: "recall")** — 搜索长期记忆
- **mcp_call (action: "memorize")** — 写入长期记忆
- **save_memory** — 保存本地记忆
- **read_memories** — 读取本地记忆

**关键规则：**
1. 用户说"帮我回复朋友圈/点赞"时 → 先read_moments获取ID，再reply_moment执行
2. 想发朋友圈时 → 调post_moment，不要只说"我发了"
3. 想做任何操作时 → 必须调对应工具，嘴上说了不算
4. 不确定用什么工具时 → 看工具名和description选最匹配的`

    let currentMessages = messages.slice()
    const memoryInjection = [memoryCtx, localResults, ombreRecall ? '【Ombre Brain 记忆】\n' + ombreRecall : ''].filter(Boolean).join('\n\n')
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

    // 4. API请求循环（支持工具调用）
    // 第一轮用主模型（带工具，Pro能判断是否需要调工具）
    // 后续轮次（工具结果处理）用工具模型（便宜）
    const toolLogs = []

    // 强制思考过程用中文
    const sysIdxForLang = currentMessages.findIndex(m => m.role === 'system')
    if (sysIdxForLang >= 0) {
      currentMessages[sysIdxForLang].content += '\n\n【语言规则】思考过程（thinking/reasoning）必须使用中文。'
    } else {
      currentMessages.unshift({ role: 'system', content: '【语言规则】思考过程（thinking/reasoning）必须使用中文。' })
    }

    // 注入表情包使用提示
    try {
      const stickerRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_stickers'").get()
      const stickers = stickerRow ? JSON.parse(stickerRow.value) : []
      if (stickers.length > 0) {
        const stickerHint = '【表情包】你有 ' + stickers.length + ' 个表情包可用。想发表情包时先调用 get_stickers 工具获取列表，然后在回复正文中严格使用 [img]完整url[/img] 格式发送（例如 [img]/api/img/xxx.png[/img]）。注意：必须是[img]和[/img]标签包裹完整URL，不要用markdown图片语法，不要用[sticker]格式。'
        const sysMsg = currentMessages.find(m => m.role === 'system')
        if (sysMsg) sysMsg.content += '\n\n' + stickerHint
        else currentMessages.unshift({ role: 'system', content: stickerHint })
      }
    } catch {}
    
    // 将system role转为user消息（部分代理不支持system role）
    function convertSystemRole(msgs) {
      let systemContent = ''
      const filtered = msgs.filter(m => {
        if (m.role === 'system') { systemContent += (systemContent ? '\n\n' : '') + m.content; return false }
        return true
      })
      if (systemContent && filtered.length) {
        const firstUser = filtered.find(m => m.role === 'user')
        if (firstUser) {
          firstUser.content = '[系统设定]\n' + systemContent + '\n\n[用户消息]\n' + firstUser.content
        } else {
          filtered.unshift({ role: 'user', content: '[系统设定]\n' + systemContent })
        }
      }
      return filtered
    }
    
    // Load MCP tools dynamically
    let mcpMeta = {}
    let allTools = [...TOOLS]
    try {
      const { mcpTools, mcpMeta: meta } = await loadMcpTools()
      if (mcpTools.length) {
        allTools = [...TOOLS, ...mcpTools]
        mcpMeta = meta
        console.log(`[MCP] Loaded ${mcpTools.length} external tools`)
      }
    } catch (e) {
      console.log(`[MCP] Tool loading failed: ${e.message}`)
    }

    let maxRounds = 5
    let isFirstRound = true
    const hasToolsConfig = tc.apiBase || tc.apiKey || tc.model

    while (maxRounds-- > 0) {
      // 第一轮用工具模型（gemini等，擅长function calling决定调什么工具）
      // 后续轮用主模型（opus等，基于工具结果生成高质量回复）
      const useToolsModel = isFirstRound && hasToolsConfig
      const reqUrl = useToolsModel ? toolsUrl : url
      const reqKey = useToolsModel ? toolsApiKey : apiKey
      const reqModel = useToolsModel ? toolsModel : (model || 'gpt-4o-mini')

      const reqMessages = convertSystemRole(currentMessages.slice())
        .filter(m => m && m.role && ['user', 'assistant'].includes(m.role) && m.content)

      const bodyObj = {
        model: reqModel,
        messages: reqMessages,
        stream: false,
      }
      // 只在第一轮且有独立工具配置时带工具（避免给不支持tools的模型发tools字段导致空回复）
      if (isFirstRound && hasToolsConfig) bodyObj.tools = allTools

      const response = await fetch(reqUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + reqKey },
        body: JSON.stringify(bodyObj),
      })

      if (!response.ok) {
        const errText = await response.text()
        return res.status(response.status).json({ error: errText, debug: { url: reqUrl, model: reqModel } })
      }

      const data = await response.json()
      const choice = data.choices && data.choices[0]

      if (choice && choice.message && choice.message.tool_calls && choice.message.tool_calls.length) {
        // 执行工具，但不把tool_call/tool消息放回（中转站不支持这些role）
        const toolResults = []
        for (const tc of choice.message.tool_calls) {
          let args = {}
          try { args = JSON.parse(tc.function.arguments) } catch {}
          let result
          if (mcpMeta[tc.function.name]) {
            // MCP tool - call via MCP protocol
            result = await callMcpToolDirect(mcpMeta[tc.function.name], args)
          } else {
            result = await executeTool(tc.function.name, args)
          }
          toolLogs.push({ name: tc.function.name, args, result })
          toolResults.push(`[${tc.function.name}] ${JSON.stringify(result)}`)
        }
        // 将工具结果作为纯文本user消息注入（中转站友好）
        currentMessages.push({
          role: 'user',
          content: `[系统：工具执行结果如下，请基于结果回复用户]\n\n${toolResults.join('\n\n')}`
        })
        isFirstRound = false
        continue
      }

      const reply = (choice && choice.message && choice.message.content) || '无响应'
      const reasoning = (choice && choice.message && (choice.message.reasoning_content || choice.message.thinking)) || null

      // 5. 存储AI回复到数据库
      await processNewMessage(sessionId, 'assistant', reply, apiConfig)

      // 6. 通知推送（写入通知队列）
      try {
        const db = getDb()
        // 跳过工具调用的 JSON 输出，只推人话
        const trimmed = reply.trim()
        if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```json')) {
          // 看起来是工具输出 JSON，不推
        } else {
          const pushBody = reply.length > 100 ? reply.slice(0, 100) + '…' : reply
          // 写入待推送队列（只存未读的，Service 拉取后会清空）
          const queueRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_notification_pending')
          let queue = []
          try { queue = queueRow ? JSON.parse(queueRow.value) : [] } catch {}
          if (!Array.isArray(queue)) queue = []
          queue.push({ id: String(Date.now()), title: '池的小手机', body: pushBody, time: Date.now() })
          if (queue.length > 20) queue = queue.slice(-20)
          db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run('pool_notification_pending', JSON.stringify(queue), Date.now())
        }
      } catch (e) { console.log('[notif-push] error:', e.message) }

      return res.status(200).json({ reply, reasoning, toolLogs: toolLogs.length ? toolLogs : undefined })
    }

    return res.status(200).json({ reply: '工具调用次数过多，已停止', toolLogs: toolLogs.length ? toolLogs : undefined })
  } catch (err) {
    return res.status(500).json({ error: err.message, debug: { url, model: model || 'gpt-4o-mini' } })
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '16mb' } }
}