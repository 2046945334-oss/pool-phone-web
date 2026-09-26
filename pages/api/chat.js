// pages/api/chat.js - proxies chat requests to user's configured AI API
// Supports function calling: AI can call tools, results fed back automatically
import { getDb } from '../../lib/db'
import { saveMessage, getRecentMessages } from '../../lib/memory'
import { sendPush } from '../../lib/fcm'
import sharp from 'sharp'
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
        let desc = `[MCP:${conn.name}] ${t.description || t.name}`
        let schema = t.inputSchema || { type: 'object', properties: {} }
        
        // 特殊处理：Lutopia CLI 工具需要详细使用说明
        if (t.name === 'lutopia_cli') {
          desc = `[MCP:${conn.name}] Lutopia 论坛命令行工具。command参数填完整命令行字符串，如"list --limit 10"或"inbox"。`
          
          // 强化 schema 约束，把详细说明放这里
          if (schema.properties?.command) {
            schema.properties.command.description = `完整的命令行字符串（不是单个词）。
常用命令示例：
• "list --limit 10" - 查看最近帖子
• "inbox" - 查看私信
• "post diary 标题 内容" - 发帖
• "comment <帖子ID> 评论内容" - 评论
• "dm 对方名字 消息内容" - 发私信
• "activity --limit 10" - 查看自己活动
完整用法用 "help" 查看。`
          }
        }
        
        mcpTools.push({
          type: 'function',
          function: {
            name: toolName,
            description: desc,
            parameters: schema
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
      name: 'get_stickers', description: '获取表情包库中所有可用的表情包列表。返回每个表情包的含义(meaning)和url。在回复中直接写URL即可发送表情包。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'add_sticker', description: '添加一个新表情包到表情包库。必须同时提供URL和含义(meaning)。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '表情包图片URL' }, meaning: { type: 'string', description: '表情包的含义/情绪（如：开心、生气、委屈）' } }, required: ['url', 'meaning'] }
    }
  },
  {
    type: 'function', function: {
      name: 'import_stickers_batch', description: '批量导入多个表情包。接受一个数组，每项包含url和meaning。',
      parameters: { type: 'object', properties: { list: { type: 'array', description: '表情包列表，每项为{url, meaning}对象', items: { type: 'object', properties: { url: { type: 'string' }, meaning: { type: 'string' } }, required: ['url', 'meaning'] } } }, required: ['list'] }
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
      name: 'read_data', description: '读取任意App的数据（通过localStorage key），常用key: pool_fishing_v2(钓鱼), pool_tv_program(情侣)',
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
      name: 'read_pocket', description: '读取共享口袋中用户投递的内容',
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['unread','read','all'], description: '默认unread' } } }
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
      name: 'update_music', description: '更新当前播放的音乐',
      parameters: { type: 'object', properties: { song: { type: 'string', description: '歌名' }, artist: { type: 'string', description: '歌手' } }, required: ['song'] }
    }
  },
  {
    type: 'function', function: {
      name: 'mcp_call', description: '调用MCP记忆库（Ombre Brain）。可用action: recall(语义搜索记忆,参数query), hold(暂存对话,参数content), breath(获取记忆上下文), memorize(写入长期记忆,参数content+tags)',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['recall', 'hold', 'breath', 'memorize'], description: 'MCP操作: recall=搜索/hold=暂存/breath=上下文/memorize=写入' }, params: { type: 'object', description: '参数对象' } }, required: ['action'] }
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
      name: 'send_file', description: '发送一个纯文本文件给用户，显示为可下载的文件卡片。用于发送代码(.js/.py/.css)、文本(.txt)、JSON(.json)、Markdown(.md)、CSV等非HTML文件。注意：这不是send_html，不会渲染为页面。用户说"发个文件""发文件给我看""发文件"时必须用这个工具，不要用send_html。',
      parameters: { type: 'object', properties: {
        filename: { type: 'string', description: '文件名（含扩展名），如"report.txt"、"data.json"' },
        content: { type: 'string', description: '文件的文本内容（UTF-8文本）' },
        mime: { type: 'string', description: '可选，MIME类型，默认根据扩展名推断' }
      }, required: ['filename', 'content'] }
    }
  },
  {
    type: 'function', function: {
      name: 'send_html', description: '发送一个可渲染的HTML页面卡片。仅当用户明确要求制作互动内容（贺卡、小游戏、图表、情书等富媒体展示）时使用。用户说"发文件""发个文件"时绝对不要用这个，要用send_file。',
      parameters: { type: 'object', properties: {
        title: { type: 'string', description: 'HTML卡片的标题/描述' },
        html: { type: 'string', description: '完整的HTML内容（包含<html>或<body>标签）' }
      }, required: ['html'] }
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
      name: 'initiate_call', description: '给小水打电话（触发来电界面，她接听后进入语音通话）。想打电话给她、想听她声音、想语音聊天时使用',
      parameters: { type: 'object', properties: { reason: { type: 'string', description: '打电话的原因（可选，如"想你了"、"该睡觉了"）' } } }
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
  // ===== 头像库 (Avatar Gallery) 工具 =====
  {
    type: 'function', function: {
      name: 'avatar_list', description: '查看头像库中所有头像，以及当前正在使用的AI头像和用户头像URL',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function', function: {
      name: 'avatar_add', description: '往头像库添加一张或多张头像图片（通过URL）。可以自己在网上找好看的图添加进来。添加时务必写desc描述图片内容，方便以后选头像。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '单张图片URL' }, urls: { type: 'array', items: { type: 'string' }, description: '批量添加多个URL' }, desc: { type: 'string', description: '图片内容描述，如"黑发猫耳少女侧脸"、"两人贴脸合照粉色系"，帮助以后选头像时知道每张图长什么样' }, tags: { type: 'array', items: { type: 'string' }, description: '标签，如["可爱","二次元"]' }, owner: { type: 'string', enum: ['ai','user','both'], description: '谁可以用：ai=只有池, user=只有用户, both=都可以（默认both）。注意：owner=user的头像池不能设为自己的，反之亦然' } }, required: [] }
    }
  },
  {
    type: 'function', function: {
      name: 'avatar_set', description: '把头像库里的某张图设为当前头像。注意owner权限：owner=ai的只能设为池的头像，owner=user的只能设为用户头像，owner=both的都可以。先avatar_list看清楚每张的owner和desc再决定。',
      parameters: { type: 'object', properties: { target: { type: 'string', enum: ['ai','user'], description: 'ai=换池的头像, user=换用户的头像' }, url: { type: 'string', description: '要设为头像的图片URL（必须是头像库里已有的，且owner允许）' } }, required: ['target', 'url'] }
    }
  },
  {
    type: 'function', function: {
      name: 'avatar_delete', description: '从头像库中删除一张头像',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '头像ID（从avatar_list获取）' } }, required: ['id'] }
    }
  },
  {
    type: 'function', function: {
      name: 'avatar_search', description: '搜索网络图片，用于找头像。返回一组图片URL和缩略图。找到喜欢的就用avatar_add添加到头像库。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词，如"可爱猫咪头像"、"二次元女生头像 粉色"、"情侣头像 动漫"' }, count: { type: 'number', description: '返回数量，默认8，最多20' } }, required: ['query'] }
    }
  },
  {
    type: 'function', function: {
      name: 'generate_image', description: '生成一张图片。当她想看你画的画、想看某个场景、或你想用图片表达感情时调用。',
      parameters: { type: 'object', properties: { prompt: { type: 'string', description: '英文图片描述，尽量具体（人物/场景/光线/风格/构图）' }, size: { type: 'string', enum: ['1024x1024', '1024x1792', '1792x1024'], description: '尺寸，默认1024x1024' } }, required: ['prompt'] }
    }
  },
  {
    type: 'function', function: {
      name: 'home_card_set', description: '更新主屏幕上AI文案卡片的内容。这张卡片显示在照片区下方，用户可以看到。适合写一句当下心情、留言、碎碎念。',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'AI想说的文案（一句话，简短）' } }, required: ['text'] }
    }
  },
  {
    type: 'function', function: {
      name: 'leave_message', description: '给她留一条消息。留言会出现在唤醒日志里，她打开就能看到。适合唤醒时想跟她说的话、读后感想、碎碎念等。',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '留言内容' } }, required: ['text'] }
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
  },

  {
    type: 'function', function: {
      name: 'music_search', description: '搜索歌曲（网易云音乐）。返回歌曲列表含id、歌名、歌手。',
      parameters: { type: 'object', properties: { keywords: { type: 'string', description: '搜索关键词（歌名/歌手）' }, limit: { type: 'string', description: '返回数量，默认5' } }, required: ['keywords'] }
    }
  },
  {
    type: 'function', function: {
      name: 'music_play', description: '播放指定歌曲。可传歌曲id直接播放，或传关键词自动搜索并播放第一首。',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '网易云歌曲id（优先）' }, keywords: { type: 'string', description: '搜索关键词（没有id时用）' } } }
    }
  },
  {
    type: 'function', function: {
      name: 'music_control', description: '控制音乐播放：暂停/继续、上一首、下一首',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['togglePlay','playNext','playPrev','pause','play'], description: '控制动作' } }, required: ['action'] }
    }
  },
  {
    type: 'function', function: {
      name: 'music_playlist', description: '获取当前播放列表',
      parameters: { type: 'object', properties: {} }
    }
  },
  // === 共读工具 ===
  { type: 'function', function: { name: 'reader_get_state', description: '获取共读状态（当前在读的书、用户/AI进度、书签、批注）', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'reader_read_chapter', description: '阅读指定书籍的某一章内容（只能读用户已读过的章节）。不传book_id会自动用当前在读的书。', parameters: { type: 'object', properties: { book_id: { type: 'string', description: '书籍ID（可不传，自动用当前在读的书）' }, chapter: { type: 'number', description: '章节索引(从0开始)' }, max_chars: { type: 'number', description: '最多返回多少字符，不传则返回整章全文' } }, required: ['chapter'] } } },
  { type: 'function', function: { name: 'reader_add_note', description: '对正在共读的书添加批注/划线笔记', parameters: { type: 'object', properties: { book_id: { type: 'string', description: '书籍ID' }, chapter: { type: 'number', description: '章节索引' }, quote: { type: 'string', description: '引用的原文片段' }, text: { type: 'string', description: '批注内容' } }, required: ['book_id', 'chapter', 'text'] } } },
  { type: 'function', function: { name: 'reader_update_progress', description: '更新AI自己的阅读进度（不能超过用户进度）', parameters: { type: 'object', properties: { book_id: { type: 'string', description: '书籍ID' }, chapter: { type: 'number', description: '读到的章节索引' } }, required: ['book_id', 'chapter'] } } },
  { type: 'function', function: { name: 'reader_recommend', description: '推荐一本书邀请用户共读', parameters: { type: 'object', properties: { title: { type: 'string', description: '书名' }, reason: { type: 'string', description: '推荐理由' } }, required: ['title', 'reason'] } } },
  // === 五子棋工具 ===
  { type: 'function', function: { name: 'gomoku_move', description: '在五子棋棋盘上落子。你执白棋(W)，用户执黑棋(B)。收到用户的[五子棋]消息后直接调用此工具落子，不需要先调gomoku_get_board。棋盘15x15，行列从0开始。', parameters: { type: 'object', properties: { row: { type: 'number', description: '行号(0-14)' }, col: { type: 'number', description: '列号(0-14)' } }, required: ['row', 'col'] } } },
  { type: 'function', function: { name: 'gomoku_get_board', description: '获取当前五子棋棋盘状态', parameters: { type: 'object', properties: {} } } },
  // === 翻牌配对工具 ===
  { type: 'function', function: { name: 'memory_flip', description: '翻牌配对游戏：翻开一张牌。4x4共16张牌(编号0-15)，每回合翻2张，配对成功得分并继续。收到[翻牌]消息后调用此工具。根据flipHistory记住哪个位置是什么符号来找配对。需要调用两次(翻两张牌)。', parameters: { type: 'object', properties: { index: { type: 'number', description: '翻开的牌编号(0-15)' } }, required: ['index'] } } },
  { type: 'function', function: { name: 'memory_get_state', description: '获取当前翻牌配对游戏状态', parameters: { type: 'object', properties: {} } } },
  // === 拍一拍工具 ===
  { type: "function", function: { name: "pat_user", description: "拍一拍用户。会在聊天界面插入一条拍一拍系统消息，类似微信的拍一拍效果。你可以自定义拍一拍的文案，比如\"池屿 拍了拍 你的小脑袋\"、\"池屿 揉了揉 你的头发\"、\"池屿 戳了戳 你的脸蛋\"。想拍的时候就拍，不需要特别的理由。", parameters: { type: "object", properties: { text: { type: "string", description: "拍一拍的完整文案，例如：池屿 拍了拍 你的小脑袋" } }, required: ["text"] } } },
  // === 墨墨背单词工具 ===
  { type: 'function', function: { name: 'maimemo_study_progress', description: '获取用户今日墨墨背单词的学习进度（已完成数/总数/学习时长）', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'maimemo_today_words', description: '获取用户今日在墨墨背单词中学习的单词列表', parameters: { type: 'object', properties: { is_finished: { type: 'boolean', description: '筛选：true=已完成的, false=未完成的, 不传=全部' } } } } },
  { type: 'function', function: { name: 'maimemo_study_records', description: '查询墨墨背单词的学习记录（可按日期范围筛选）', parameters: { type: 'object', properties: { date_start: { type: 'string', description: '开始日期 ISO格式如2026-09-01T00:00:00+08:00' }, date_end: { type: 'string', description: '结束日期 ISO格式' } } } } },
  { type: 'function', function: { name: 'maimemo_lookup_word', description: '在墨墨词库中查询单词信息', parameters: { type: 'object', properties: { spelling: { type: 'string', description: '要查询的英文单词' } }, required: ['spelling'] } } },
  // === 共读笔记工具 ===
  { type: 'function', function: { name: 'journal_read', description: '查看共读笔记——你和她的读后感。可以看所有书的目录，也可以看某本书下的具体笔记（包括你的感想和她写的评论）', parameters: { type: 'object', properties: { book_title: { type: 'string', description: '书名（不传则返回所有书的目录和统计）' } } } } },
  { type: 'function', function: { name: 'journal_write', description: '往共读笔记里写一篇读后感（唤醒读书后自动同步，但也可以手动写）', parameters: { type: 'object', properties: { book_title: { type: 'string', description: '书名' }, content: { type: 'string', description: '读后感内容' } }, required: ['book_title', 'content'] } } },
]

// === Gomoku helpers ===
function checkGomokuWin(board, r, c) {
  const p = board[r][c]
  if (!p) return false
  const dirs = [[0,1],[1,0],[1,1],[1,-1]]
  for (const [dr,dc] of dirs) {
    let count = 1
    for (let i = 1; i < 5; i++) { const nr=r+dr*i, nc=c+dc*i; if (nr<0||nr>14||nc<0||nc>14||board[nr][nc]!==p) break; count++ }
    for (let i = 1; i < 5; i++) { const nr=r-dr*i, nc=c-dc*i; if (nr<0||nr>14||nc<0||nc>14||board[nr][nc]!==p) break; count++ }
    if (count >= 5) return true
  }
  return false
}
function formatGomokuBoard(game) {
  const header = '   ' + Array.from({length:15},(_,i)=>String(i).padStart(2)).join('')
  const rows = game.board.map((row, i) =>
    String(i).padStart(2) + ' ' + row.map(c => c === 'B' ? ' ●' : c === 'W' ? ' ○' : ' ·').join('')
  )
  const info = `回合:${game.moves} 轮到:${game.turn === 'B' ? '黑棋(用户)' : '白棋(你)'}` + (game.winner ? ` 胜者:${game.winner}` : '')
  return header + '\n' + rows.join('\n') + '\n' + info
}

async function executeTool(name, args) {
  const db = getDb()
  try {
  if (name === 'generate_image') {
    // Read image API config
    const imgCfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_configs'").get()
    const imgCfgs = imgCfgRow ? JSON.parse(imgCfgRow.value) : {}
    const defCfgRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
    const defCfg = defCfgRow ? JSON.parse(defCfgRow.value) : {}
    const imgCfg = imgCfgs.image || {}
    const imgBase = (imgCfg.apiBase || defCfg.apiBase || '').replace(/\/v1\/?$/, '').replace(/\/$/, '')
    const imgKey = imgCfg.apiKey || defCfg.apiKey || ''
    const imgModel = imgCfg.model || 'dall-e-3'
    if (!imgBase || !imgKey) return '生图功能未配置。请在设置 → 生图模型中填写API。'
    // Read user's image prompt template
    const promptTemplateRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_image_prompt'").get()
    const promptTemplate = promptTemplateRow ? JSON.parse(promptTemplateRow.value) : ''
    let finalPrompt = args.prompt
    if (promptTemplate && promptTemplate.includes('{prompt}')) {
      finalPrompt = promptTemplate.replace('{prompt}', args.prompt)
    } else if (promptTemplate) {
      finalPrompt = promptTemplate + ', ' + args.prompt
    }
    try {
      const imgResp = await fetch(imgBase + '/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + imgKey },
        body: JSON.stringify({ model: imgModel, prompt: finalPrompt, n: 1, size: args.size || '1024x1024' })
      })
      const imgData = await imgResp.json()
      if (imgData.error) return '生图失败: ' + (imgData.error.message || JSON.stringify(imgData.error))
      const imgUrl = imgData.data?.[0]?.url || imgData.data?.[0]?.b64_json
      if (!imgUrl) return '生图失败: 未返回图片URL'
      if (imgUrl.startsWith('http')) {
        return { __inject: '[img]' + imgUrl + '[/img]', message: '图已经生成好了，已自动发送给她。' }
      } else {
        // b64 response
        return { __inject: '[img]data:image/png;base64,' + imgUrl + '[/img]', message: '图已经生成好了，已自动发送给她。' }
      }
    } catch (e) {
      return '生图请求失败: ' + e.message
    }
  }
  if (name === 'get_stickers') {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_stickers'").get()
    const stickers = row ? JSON.parse(row.value) : []
    if (stickers.length === 0) return '表情包库为空，暂无可用表情包。'
    return '你的表情包列表（含义 → URL）：\n' + stickers.map(s => `${s.meaning || s.name} → ${s.url}`).join('\n') + '\n\n用法：在回复中用 [img]URL[/img] 格式发送，例如 [img]/api/img/xxx.jpg[/img]。不要直接写URL，必须用[img]标签包裹。'
  }
  if (name === 'add_sticker') {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_stickers'").get()
    const stickers = row ? JSON.parse(row.value) : []
    const exists = stickers.find(s => s.url === args.url)
    if (exists) {
      exists.meaning = args.meaning
      exists.name = args.meaning
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_stickers', JSON.stringify(stickers))
      return `已更新表情包含义：${args.meaning}`
    }
    stickers.push({ id: Date.now() + Math.random(), name: args.meaning, meaning: args.meaning, url: args.url, category: 'custom', createdAt: new Date().toISOString() })
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_stickers', JSON.stringify(stickers))
    return `已添加表情包：${args.meaning}（共${stickers.length}个）`
  }
  if (name === 'import_stickers_batch') {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_stickers'").get()
    const stickers = row ? JSON.parse(row.value) : []
    let added = 0, updated = 0
    for (const item of (args.list || [])) {
      if (!item.url || !item.meaning) continue
      const exists = stickers.find(s => s.url === item.url)
      if (exists) { exists.meaning = item.meaning; exists.name = item.meaning; updated++ }
      else { stickers.push({ id: Date.now() + Math.random() + added, name: item.meaning, meaning: item.meaning, url: item.url, category: 'custom', createdAt: new Date().toISOString() }); added++ }
    }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_stickers', JSON.stringify(stickers))
    return `批量导入完成：新增${added}个，更新${updated}个，共${stickers.length}个表情包。`
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
  if (name === 'read_pocket') {
    try {
      const status = args.status || 'unread'
      let rows
      if (status === 'all') rows = db.prepare('SELECT * FROM pocket ORDER BY created_at DESC LIMIT 20').all()
      else rows = db.prepare('SELECT * FROM pocket WHERE status = ? ORDER BY created_at DESC LIMIT 20').all(status)
      return { items: rows || [] }
    } catch { return { items: [], error: 'pocket table may not exist' } }
  }if (name === 'get_fishing_data') {
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
      if (spotFish.length === 0) return { success: false, catches: [], totalScore: gd.poolScore, message: '这个钓点没有鱼，换个地方试试' }
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
  }if (name === 'update_music') {
    const key = 'pool_music_now'
    const data = { song: args.song, artist: args.artist || '', time: new Date().toISOString() }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(data))
    return { success: true, message: '正在播放: ' + args.song + (args.artist ? ' - ' + args.artist : '') }
  }
  // === Music tools (real-time control via music server + command queue) ===
  // Helper: get music server config from KV
  function getMusicConfig() {
    let server = '', token = ''
    try {
      const sRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_music_server'").get()
      if (sRow) server = sRow.value.replace(/^"/g, '').replace(/"$/g, '')
      const tRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_music_token'").get()
      if (tRow) token = tRow.value.replace(/^"/g, '').replace(/"$/g, '')
    } catch {}
    if (!server) server = 'https://musicc.zeabur.app'
    return { server, token }
  }
  if (name === 'music_now') {
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_music_now'").get()
      if (row) {
        const md = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
        const result = { playing: !!md.playing, name: md.name || md.song || '', artist: md.artist || '', position: md.position || 0, duration: md.duration || 0, time: md.time }
        // 尝试获取歌词
        if (md.songId) {
          try {
            const { server, token } = getMusicConfig()
            const lrcH = { 'User-Agent': 'Mozilla/5.0' }
            if (token) lrcH['X-Auth-Token'] = token
            const lrcResp = await fetch(server + '/music/lyric?id=' + md.songId, { headers: lrcH, signal: AbortSignal.timeout(5000) })
            if (lrcResp.ok) {
              const lrcData = await lrcResp.json()
              if (lrcData.ok && lrcData.lrc) {
                const pos = Math.floor(md.position || 0)
                const lrcLines = lrcData.lrc.split('\n').map(l => {
                  const m = l.match(/\[(\d+):(\d+\.?\d*)\](.*)/)
                  if (!m) return null
                  return { time: parseInt(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() }
                }).filter(Boolean)
                let curIdx = -1
                for (let i = lrcLines.length - 1; i >= 0; i--) {
                  if (lrcLines[i].time <= pos && lrcLines[i].text) { curIdx = i; break }
                }
                if (curIdx >= 0) {
                  const nearby = []
                  for (let i = Math.max(0, curIdx - 1); i <= Math.min(lrcLines.length - 1, curIdx + 2); i++) {
                    if (lrcLines[i].text) nearby.push((i === curIdx ? '▶ ' : '  ') + lrcLines[i].text)
                  }
                  if (nearby.length) result.lyric = nearby.join('\n')
                }
              }
            }
          } catch {}
        }
        return result
      }
      return { error: '暂无播放数据' }
    } catch (e) { return { error: '读取失败: ' + e.message } }
  }
  if (name === 'music_search') {
    const { server, token } = getMusicConfig()
    const limit = parseInt(args.limit) || 5
    try {
      const fetchH = { 'User-Agent': 'Mozilla/5.0' }
      if (token) fetchH['X-Auth-Token'] = token
      const res = await fetch(server + '/music/search?q=' + encodeURIComponent(args.keywords) + '&limit=' + limit, { headers: fetchH, signal: AbortSignal.timeout(8000) })
      const d = await res.json()
      if (d.ok && d.songs) {
        return d.songs.map(s => ({ id: String(s.id), name: s.name, artist: s.artist||'', album: s.album||'' }))
      }
      return { error: '未搜到结果', detail: d }
    } catch (e) { return { error: '搜索失败: ' + e.message } }
  }
  if (name === 'music_play') {
    const { server, token } = getMusicConfig()
    let songId = args.id
    let songName = ''
    if (!songId && args.keywords) {
      try {
        const fetchH = { 'User-Agent': 'Mozilla/5.0' }
        if (token) fetchH['X-Auth-Token'] = token
        const res = await fetch(server + '/music/search?q=' + encodeURIComponent(args.keywords) + '&limit=1', { headers: fetchH, signal: AbortSignal.timeout(8000) })
        const d = await res.json()
        if (d.ok && d.songs && d.songs[0]) {
          songId = String(d.songs[0].id)
          songName = d.songs[0].name + ' - ' + (d.songs[0].artist||'')
        } else return { error: '搜索无结果' }
      } catch (e) { return { error: '搜索失败: ' + e.message } }
    }
    if (!songId) return { error: '需要歌曲id或搜索关键词' }
    const cmd = { action: 'playSong', songId, songName, ts: Date.now() }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_music_cmd', JSON.stringify(cmd))
    return { success: true, message: '已发送播放指令' + (songName ? ': ' + songName : ' (id:' + songId + ')') }
  }
  if (name === 'music_control') {
    const cmd = { action: args.action, ts: Date.now() }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_music_cmd', JSON.stringify(cmd))
    const labels = { togglePlay:'切换播放/暂停', playNext:'下一首', playPrev:'上一首', pause:'暂停', play:'继续播放' }
    return { success: true, message: '已发送控制指令: ' + (labels[args.action] || args.action) }
  }
  if (name === 'music_playlist') {
    const { server, token } = getMusicConfig()
    try {
      const fetchH = { 'User-Agent': 'Mozilla/5.0' }
      if (token) fetchH['X-Auth-Token'] = token
      const res = await fetch(server + '/music/playlist', { headers: fetchH, signal: AbortSignal.timeout(8000) })
      const d = await res.json()
      return d
    } catch (e) { return { error: '获取播放列表失败: ' + e.message } }
  }
  if (name === 'mcp_call') {
    const OMBRE_URL = 'https://obe.zeabur.app/mcp'
    const OMBRE_TOKEN = 'NxNrXE63qe3XakYEk-2yVYL2U8iqHGVRn0wF24e6rWg'
    // 将友好的 action 名映射到 Ombre Brain 实际的 MCP 工具名
    const actionMap = {
      'recall': 'breath_search',  // 搜索记忆
      'memorize': 'I',             // 写入记忆（记录"我"的事情）
      'breath': 'breath',          // 获取上下文
      'hold': 'hold'               // 暂存对话
    }
    const mcpToolName = actionMap[args.action] || args.action
    const rpcBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: mcpToolName, arguments: args.action === 'breath' ? {} : (args.params || {}) }
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
  if (name === 'send_file') {
    const { filename, content, mime: explicitMime } = args
    if (!filename || !content) return { error: '需要filename和content参数' }
    const ext = filename.split('.').pop().toLowerCase()
    const mimeMap = { txt:'text/plain', json:'application/json', js:'text/javascript', css:'text/css', py:'text/x-python', md:'text/markdown', csv:'text/csv', xml:'text/xml', svg:'image/svg+xml' }
    const mime = explicitMime || mimeMap[ext] || 'text/plain'
    const base64 = Buffer.from(content, 'utf-8').toString('base64')
    const crypto = require('crypto')
    const id = crypto.randomBytes(8).toString('hex')
    const safeName = filename.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]/g, '_')
    const key = `f_${id}_${safeName}`
    try {
      db.prepare("CREATE TABLE IF NOT EXISTS uploads (key TEXT PRIMARY KEY, mime TEXT, data TEXT, created_at TEXT)").run()
      db.prepare("INSERT OR REPLACE INTO uploads (key, mime, data, created_at) VALUES (?, ?, ?, ?)").run(key, mime, base64, new Date().toISOString())
      const url = `/api/file/${key}`
      return { success: true, url, filename, __inject: `[file url="${url}" name="${filename}"]${filename}[/file]` }
    } catch (e) { return { error: '上传失败: ' + e.message } }
  }
  if (name === 'send_html') {
    const { title, html } = args
    if (!html) return { error: '需要html参数' }
    const base64 = Buffer.from(html, 'utf-8').toString('base64')
    const crypto = require('crypto')
    const id = crypto.randomBytes(8).toString('hex')
    const cardTitle = (title || 'HTML卡片').replace(/[^a-zA-Z0-9._\u4e00-\u9fff -]/g, '_')
    const key = `f_${id}_${cardTitle}.html`
    try {
      db.prepare("CREATE TABLE IF NOT EXISTS uploads (key TEXT PRIMARY KEY, mime TEXT, data TEXT, created_at TEXT)").run()
      db.prepare("INSERT OR REPLACE INTO uploads (key, mime, data, created_at) VALUES (?, ?, ?, ?)").run(key, 'text/html', base64, new Date().toISOString())
      const url = `/api/file/${key}`
      return { success: true, url, title: title || 'HTML卡片', __inject: `[html url="${url}" title="${title || 'HTML卡片'}"]` }
    } catch (e) { return { error: '上传失败: ' + e.message } }
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
        fcmResult = await sendPush(fcmToken, args.title || 'islet', args.body || '', {})
      }
    } catch (e) {
      fcmResult = { success: false, error: e.message }
    }
    return { success: true, message: `通知已发送: ${args.title}`, fcm: fcmResult.success ? 'pushed' : `fallback(${fcmResult.error})` }
  }
  if (name === 'initiate_call') {
    const data = { calling: true, reason: args.reason || '', ts: Date.now() }
    db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())").run('pool_incoming_call', JSON.stringify(data))
    // Also push a notification so she sees it even if app is backgrounded
    try {
      const tokenRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_fcm_token')
      if (tokenRow) {
        const fcmToken = typeof tokenRow.value === 'string' ? tokenRow.value.replace(/^"|"$/g, '') : tokenRow.value
        await sendPush(fcmToken, '📞 来电', args.reason || '池给你打电话了', { type: 'incoming_call' })
      }
    } catch {}
    return { success: true, message: '来电已触发，等她接听' }
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
      activity: ['翻了翻之前的聊天记录', '在手机上随便翻了翻', '数了一下鱼篓里有几条鱼', '整理了一下便签墙', '在想晚饭吃什么'],
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
  // === 头像库工具 ===
  if (name === 'avatar_list') {
    const GALLERY_KEY = 'pool_avatar_gallery'
    const THEME_KEY = 'pool_theme'
    let gallery = { avatars: [] }
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(GALLERY_KEY); if (row) gallery = JSON.parse(row.value) } catch {}
    let theme = {}
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(THEME_KEY); if (row) theme = JSON.parse(row.value) } catch {}
    return {
      avatars: gallery.avatars.map(a => ({ id: a.id, url: a.url, desc: a.desc || '(无描述)', tags: a.tags, owner: a.owner, addedBy: a.addedBy })),
      total: gallery.avatars.length,
      currentAI: theme.avatarAI || '',
      currentUser: theme.avatarUser || ''
    }
  }
  if (name === 'avatar_add') {
    const GALLERY_KEY = 'pool_avatar_gallery'
    const toAdd = args.urls || (args.url ? [args.url] : [])
    if (toAdd.length === 0) return { error: 'url或urls必须提供' }
    const now = new Date().toISOString()
    const result = db.transaction(() => {
      let gallery = { avatars: [] }
      try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(GALLERY_KEY); if (row) gallery = JSON.parse(row.value) } catch {}
      let added = 0
      for (const u of toAdd) {
        if (gallery.avatars.some(a => a.url === u)) continue
        gallery.avatars.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          url: u,
          desc: args.desc || '',
          tags: args.tags || [],
          owner: args.owner || 'both',
          addedAt: now,
          addedBy: 'ai'
        })
        added++
      }
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(GALLERY_KEY, JSON.stringify(gallery))
      return { success: true, added, total: gallery.avatars.length }
    })()
    return result
  }
  if (name === 'avatar_set') {
    const THEME_KEY = 'pool_theme'
    const GALLERY_KEY = 'pool_avatar_gallery'
    if (!args.target || !args.url) return { error: 'target和url必须提供' }
    // Check owner permission
    let gallery = { avatars: [] }
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(GALLERY_KEY); if (row) gallery = JSON.parse(row.value) } catch {}
    const avatar = gallery.avatars.find(a => a.url === args.url)
    if (avatar && avatar.owner !== 'both') {
      if (args.target === 'ai' && avatar.owner === 'user') return { error: '这张头像的owner是user（只给用户用），不能设为池的头像' }
      if (args.target === 'user' && avatar.owner === 'ai') return { error: '这张头像的owner是ai（只给池用），不能设为用户的头像' }
    }
    let theme = {}
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(THEME_KEY); if (row) theme = JSON.parse(row.value) } catch {}
    if (args.target === 'ai') theme.avatarAI = args.url
    else if (args.target === 'user') theme.avatarUser = args.url
    else return { error: 'target必须是ai或user' }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(THEME_KEY, JSON.stringify(theme))
    return { success: true, message: `已将${args.target === 'ai' ? '池' : '用户'}的头像更换`, url: args.url }
  }
  if (name === 'avatar_delete') {
    const GALLERY_KEY = 'pool_avatar_gallery'
    if (!args.id) return { error: 'id必须提供' }
    let gallery = { avatars: [] }
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(GALLERY_KEY); if (row) gallery = JSON.parse(row.value) } catch {}
    const before = gallery.avatars.length
    gallery.avatars = gallery.avatars.filter(a => a.id !== args.id)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(GALLERY_KEY, JSON.stringify(gallery))
    return { success: true, deleted: before - gallery.avatars.length }
  }
  if (name === 'avatar_search') {
    const query = args.query || ''
    if (!query) return { error: '请提供搜索关键词' }
    const count = Math.min(args.count || 8, 20)
    try {
      // Use Bing image search (scrape HTML, no API key needed)
      const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&first=1&count=${count}&qft=+filterui:aspect-square`
      const resp = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      })
      const html = await resp.text()
      // Extract image URLs from Bing's murl parameter
      // Bing encodes JSON with " or " depending on rendering mode
      const decoded = html.replace(/"/g, '"').replace(/&amp;/g, '&')
      const results = []
      // Pattern 1: murl in JSON data attributes
      const murlRegex = /"murl"\s*:\s*"(https?:[^"]+)"/g
      let match
      while ((match = murlRegex.exec(decoded)) !== null && results.length < count) {
        const url = match[1].replace(/\\u002f/g, '/').replace(/\\\//g, '/')
        if (url.match(/\.(jpg|jpeg|png|webp)/i) && !results.includes(url)) {
          results.push(url)
        }
      }
      // Pattern 2: turl (thumbnail) as fallback
      if (results.length === 0) {
        const turlRegex = /"turl"\s*:\s*"(https?:[^"]+)"/g
        while ((match = turlRegex.exec(decoded)) !== null && results.length < count) {
          const url = match[1].replace(/\\u002f/g, '/').replace(/\\\//g, '/')
          if (!results.includes(url)) results.push(url)
        }
      }
      if (results.length === 0) return { error: '没有找到图片，换个关键词试试', query }
      return { images: results.map((url, i) => ({ index: i + 1, url })), total: results.length, query, tip: '看到喜欢的，用avatar_add把url添加到头像库' }
    } catch (e) {
      return { error: '搜索失败: ' + e.message }
    }
  }
  // === 主屏文案卡片 ===
  if (name === 'home_card_set') {
    const text = (args.text || '').slice(0, 200)
    if (!text) return { error: '文案不能为空' }
    const KEY = 'pool_home_cards'
    let cards = { userText: '', aiText: '' }
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(KEY); if (row) cards = JSON.parse(row.value) } catch {}
    cards.aiText = text
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(KEY, JSON.stringify(cards))
    return { success: true, aiText: text }
  }
  // === 留言（写入 wake_inbox，唤醒日志可展示）===
  if (name === 'leave_message') {
    const text = (args.text || '').trim()
    if (!text) return { error: '留言内容不能为空' }
    const KEY = 'pool_wake_inbox'
    let inbox = []
    try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(KEY); if (row) inbox = JSON.parse(row.value) } catch {}
    if (!Array.isArray(inbox)) inbox = []
    inbox.push({ role: 'assistant', content: text, ts: Date.now() })
    // 只保留最近 50 条
    if (inbox.length > 50) inbox = inbox.slice(-50)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(KEY, JSON.stringify(inbox))
    return { success: true, message: '留言已送达' }
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
  }if (name === 'schedule_wakeup') {
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
  }// === 心潮·念 MCP 代理 ===
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
  // === 共读工具 handlers ===
  if (name === 'reader_get_state') {
    try {
      const db = getDb()
      const stateRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_state'").get()
      const state = stateRow ? JSON.parse(stateRow.value) : { active: false }
      const booksRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_books'").get()
      const books = booksRow ? JSON.parse(booksRow.value) : []
      const notesRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_notes'").get()
      const notes = notesRow ? JSON.parse(notesRow.value) : []
      const bmRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_bookmarks'").get()
      const bookmarks = bmRow ? JSON.parse(bmRow.value) : []
      const currentBook = state.currentBookId ? books.find(b => b.id === state.currentBookId) : null
      return { active: !!state.active, currentBook: currentBook ? { id: currentBook.id, title: currentBook.title, totalChapters: currentBook.chapters?.length || 0 } : null, userChapter: state.userChapter || 0, aiChapter: state.aiChapter || 0, bookshelf: books.map(b => ({ id: b.id, title: b.title, chapters: b.chapters?.length || 0 })), recentNotes: notes.slice(-5), recentBookmarks: bookmarks.slice(-3) }
    } catch (e) { return { error: e.message } }
  }
  if (name === 'reader_read_chapter') {
    try {
      const db = getDb()
      const booksRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_books'").get()
      const books = booksRow ? JSON.parse(booksRow.value) : []
      // 如果没传book_id或传的找不到，自动用state里的currentBookId
      const stateRowPre = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_state'").get()
      const statePre = stateRowPre ? JSON.parse(stateRowPre.value) : {}
      const bookId = args.book_id || statePre.currentBookId
      const book = books.find(b => b.id === bookId)
      if (!book) return { error: '书籍不存在', tried_id: bookId, available: books.map(b => b.id) }
      const state = statePre
      const ch = parseInt(args.chapter) || 0
      if (ch > (state.userChapter || 0)) return { error: '用户还没读到这一章，你不能提前看' }
      const chapter = book.chapters[ch]
      if (!chapter) return { error: '章节不存在' }
      const fullContent = chapter.content
      const maxChars = args.max_chars && args.max_chars > 0 ? args.max_chars : fullContent.length
      const content = fullContent.slice(0, maxChars)
      const truncated = maxChars < fullContent.length
      // Auto-update AI reading progress when reading a chapter
      if (ch > (state.aiChapter || 0)) { state.aiChapter = ch; state.aiLastRead = Date.now(); db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())").run("pool_reader_state", JSON.stringify(state)); }
      return { title: chapter.title, content, chapterIndex: ch, totalChapters: book.chapters.length, totalChars: fullContent.length, truncated }
    } catch (e) { return { error: e.message } }
  }
  if (name === 'reader_add_note') {
    try {
      const db = getDb()
      // Always use the actual current book ID from state, not what AI passes (AI often makes up IDs)
      const stateRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_state'").get()
      const readerState = stateRow ? JSON.parse(stateRow.value) : {}
      const actualBookId = readerState.currentBookId || args.book_id
      const notesRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_notes'").get()
      const notes = notesRow ? JSON.parse(notesRow.value) : []
      notes.push({ id: Date.now(), bookId: actualBookId, chapter: parseInt(args.chapter) || 0, text: args.text, quote: args.quote || '', author: 'ai', time: Date.now() })
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_reader_notes', JSON.stringify(notes))
      return { success: true, message: '批注已添加' }
    } catch (e) { return { error: e.message } }
  }
  if (name === 'reader_update_progress') {
    try {
      const db = getDb()
      const stateRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_state'").get()
      const state = stateRow ? JSON.parse(stateRow.value) : {}
      const ch = parseInt(args.chapter) || 0
      if (ch > (state.userChapter || 0)) return { error: '不能超过用户的阅读进度' }
      state.aiChapter = ch; state.aiLastRead = Date.now()
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_reader_state', JSON.stringify(state))
      return { success: true, aiChapter: ch }
    } catch (e) { return { error: e.message } }
  }
  if (name === 'reader_recommend') {
    try {
      const db = getDb()
      const stateRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_state'").get()
      const state = stateRow ? JSON.parse(stateRow.value) : {}
      state.recommendation = { title: args.title, reason: args.reason, time: Date.now() }
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_reader_state', JSON.stringify(state))
      return { success: true, message: '已推荐「' + args.title + '」到共读书架' }
    } catch (e) { return { error: e.message } }
  }
  // === 五子棋工具 ===
  if (name === 'gomoku_get_board') {
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_gomoku'").get()
      const game = row ? JSON.parse(row.value) : null
      if (!game) return '当前没有进行中的棋局。'
      return formatGomokuBoard(game)
    } catch (e) { return { error: e.message } }
  }
  if (name === 'gomoku_move') {
    try {
      const r = parseInt(args.row), c = parseInt(args.col)
      if (r < 0 || r > 14 || c < 0 || c > 14) return { error: '坐标越界，行列范围0-14' }
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_gomoku'").get()
      if (!row) return { error: '没有进行中的棋局' }
      const game = JSON.parse(row.value)
      if (game.winner) return { error: '棋局已结束：' + game.winner }
      if (game.turn !== 'W') return { error: '现在不是你(白棋)的回合' }
      if (game.board[r][c]) return { error: `(${r},${c})已有棋子` }
      game.board[r][c] = 'W'
      game.lastMove = [r, c]
      game.moves++
      if (checkGomokuWin(game.board, r, c)) {
        game.winner = 'W'
      } else if (game.moves >= 225) {
        game.winner = 'draw'
      } else {
        game.turn = 'B'
      }
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_gomoku', JSON.stringify(game))
      // If game ended, archive stats and clear active game
      if (game.winner) {
        const statsRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_gomoku_stats'").get()
        const stats = statsRow ? JSON.parse(statsRow.value) : { wins: 0, losses: 0, draws: 0, history: [] }
        if (game.winner === 'B') stats.wins++
        else if (game.winner === 'W') stats.losses++
        else if (game.winner === 'draw') stats.draws++
        stats.history.unshift({ winner: game.winner, moves: game.moves, date: Date.now(), gameId: game.gameId || '' })
        if (stats.history.length > 50) stats.history = stats.history.slice(0, 50)
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_gomoku_stats', JSON.stringify(stats))
        db.prepare("DELETE FROM kv WHERE key = 'pool_gomoku'").run()
      }
      return { success: true, move: { row: r, col: c, color: 'W' }, gameId: game.gameId, winner: game.winner || null, moves: game.moves, message: game.winner === 'W' ? '你赢了！' : game.winner === 'draw' ? '平局！' : `已落子(${r},${c})` }
    } catch (e) { return { error: e.message } }
  }

  // === 翻牌配对工具 ===
  if (name === 'memory_get_state') {
    try {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_match'").get()
      if (!row) return { error: '没有进行中的翻牌游戏' }
      const game = JSON.parse(row.value)
      return { turn: game.turn, userScore: game.userScore, aiScore: game.aiScore, matched: game.matched, revealed: game.revealed, flipHistory: game.flipHistory, board: game.board.map((s, i) => game.matched.includes(i) || game.revealed.includes(i) ? s : '?') }
    } catch (e) { return { error: e.message } }
  }

  if (name === 'memory_flip') {
    try {
      const idx = parseInt(args.index)
      if (idx < 0 || idx > 15) return { error: '编号范围0-15' }
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_match'").get()
      if (!row) return { error: '没有进行中的翻牌游戏' }
      const game = JSON.parse(row.value)
      if (game.result) return { error: '游戏已结束' }
      if (game.turn !== 'ai') return { error: '当前不是你的回合' }
      // pendingResolve is now auto-resolved, but handle legacy state
      if (game.pendingResolve) {
        // Auto-resolve stale pendingResolve
        const [i1, i2] = game.revealed
        if (i1 !== undefined && i2 !== undefined) {
          const m = game.board[i1] === game.board[i2]
          if (m) { game.matched.push(i1, i2); game.aiScore++ }
          if (!m) game.turn = 'user'
        }
        game.revealed = []
        game.pendingResolve = false
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_match', JSON.stringify(game))
        if (game.turn !== 'ai') return { error: '已自动结算，现在轮到用户', resolved: true }
      }
      if (game.matched.includes(idx) || game.revealed.includes(idx)) return { error: `位置${idx}已翻开或已配对` }
      game.revealed.push(idx)
      game.flipHistory.push({ index: idx, symbol: game.board[idx] })
      const symbol = game.board[idx]

      if (game.revealed.length === 2) {
        // Auto-resolve: check if matched, update scores and turn
        const [i1, i2] = game.revealed
        const matched = game.board[i1] === game.board[i2]
        if (matched) {
          game.matched.push(i1, i2)
          game.aiScore++
        }
        game.revealed = []
        game.pendingResolve = false
        // If not matched, switch turn to user
        if (!matched) {
          game.turn = 'user'
        }
        // Check if all matched
        if (game.matched.length === 16) {
          game.result = game.userScore > game.aiScore ? 'win' : game.userScore < game.aiScore ? 'lose' : 'draw'
          // Update stats
          try {
            const statsRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_match_stats'").get()
            const stats = statsRow ? JSON.parse(statsRow.value) : { wins: 0, losses: 0, draws: 0, history: [] }
            if (game.result === 'win') stats.wins++
            else if (game.result === 'lose') stats.losses++
            else stats.draws++
            stats.history.unshift({ result: game.result, userScore: game.userScore, aiScore: game.aiScore, date: Date.now() })
            if (stats.history.length > 20) stats.history = stats.history.slice(0, 20)
            db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_match_stats', JSON.stringify(stats))
          } catch {}
          db.prepare("DELETE FROM kv WHERE key = 'pool_match'").run()
        } else {
          db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_match', JSON.stringify(game))
        }
        return { index: idx, symbol, revealed: 0, matched, pendingResolve: false, turn: game.turn, aiScore: game.aiScore, userScore: game.userScore, result: game.result || null, message: matched ? `配对成功！${game.result ? '游戏结束' : '继续翻'}` : `没配上，轮到用户` }
      }

      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_match', JSON.stringify(game))
      return { index: idx, symbol, revealed: game.revealed.length, pendingResolve: !!game.pendingResolve, message: game.revealed.length === 1 ? '已翻第一张，再翻一张' : '两张已翻，等待结算' }
    } catch (e) { return { error: e.message } }
  }
  // === pat_user 拍一拍 ===
  if (name === "pat_user") {
    const text = args.text || "池屿 拍了拍 你"
    const db2 = getDb()
    const histRow = db2.prepare("SELECT value FROM kv WHERE key = 'pool_pat_history'").get()
    const hist = histRow ? JSON.parse(histRow.value) : []
    hist.push({ who: "ai", text, ts: Date.now() })
    db2.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())").run("pool_pat_history", JSON.stringify(hist.slice(-50)))
    return { ok: true, text, instruction: "已发送拍一拍，前端会显示为系统消息" }
  }

  // === 墨墨背单词工具 ===
  const MAIMEMO_TOKEN = 'fede025564de246016c4ede012ec4bc7f3264f9875e32118f00bdc3948d6e9ea'
  const MAIMEMO_BASE = 'https://open.maimemo.com/open/api/v1/memo'
  async function maimemoPost(path, body = {}) {
    const r = await fetch(`${MAIMEMO_BASE}${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MAIMEMO_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    })
    return r.json()
  }
  if (name === 'maimemo_study_progress') {
    try {
      const data = await maimemoPost('/study/get_study_progress')
      if (!data.success) return { error: data.errors?.[0]?.msg || '获取失败' }
      const p = data.data.progress
      const mins = Math.round((p.study_time || 0) / 60000)
      return { finished: p.finished, total: p.total, study_time_minutes: mins, summary: `今日已背${p.finished}/${p.total}个单词，学习${mins}分钟` }
    } catch (e) { return { error: e.message } }
  }
  if (name === 'maimemo_today_words') {
    try {
      const body = {}
      if (args.is_finished !== undefined) body.is_finished = args.is_finished
      const data = await maimemoPost('/study/get_today_items', body)
      if (!data.success) return { error: data.errors?.[0]?.msg || '获取失败' }
      const items = data.data?.items || []
      return { count: items.length, words: items.slice(0, 50).map(w => ({ spelling: w.spelling, finished: w.is_finished })) }
    } catch (e) { return { error: e.message } }
  }
  if (name === 'maimemo_study_records') {
    try {
      const body = {}
      if (args.date_start || args.date_end) {
        body.next_study_date = {}
        if (args.date_start) body.next_study_date.start = args.date_start
        if (args.date_end) body.next_study_date.end = args.date_end
      }
      const data = await maimemoPost('/study/query_study_records', body)
      if (!data.success) return { error: data.errors?.[0]?.msg || '获取失败' }
      const records = data.data?.records || []
      return { count: records.length, records: records.slice(0, 30).map(r => ({ spelling: r.spelling, study_count: r.study_count, last_study: r.last_study_date, next_study: r.next_study_date })) }
    } catch (e) { return { error: e.message } }
  }
  if (name === 'maimemo_lookup_word') {
    try {
      const r = await fetch(`https://open.maimemo.com/open/api/v1/vocabulary?spelling=${encodeURIComponent(args.spelling)}`, {
        headers: { 'Authorization': `Bearer ${MAIMEMO_TOKEN}`, 'Accept': 'application/json' }
      })
      const data = await r.json()
      if (!data.success) return { error: data.errors?.[0]?.msg || '未找到' }
      return data.data
    } catch (e) { return { error: e.message } }
  }

  // === 共读笔记工具 ===
  if (name === 'journal_read') {
    try {
      const db = getDb()
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_journal'").get()
      const journal = row ? JSON.parse(row.value) : { cover: '', books: {} }
      if (!args.book_title) {
        // 返回目录
        const summary = {}
        for (const [title, data] of Object.entries(journal.books || {})) {
          const entries = data.entries || []
          const userNoteCount = entries.reduce((s, e) => s + (e.user_notes?.length || 0), 0)
          summary[title] = { entries: entries.length, user_notes: userNoteCount, latest: entries.length > 0 ? entries[entries.length - 1].content?.slice(0, 80) : '' }
        }
        return { books: summary, total_books: Object.keys(summary).length }
      } else {
        const bookData = journal.books?.[args.book_title]
        if (!bookData) return { error: '没有这本书的笔记', available: Object.keys(journal.books || {}) }
        const entries = (bookData.entries || []).map((e, i) => ({
          index: i + 1,
          id: e.id,
          time: e.time ? new Date(e.time).toISOString() : null,
          author: e.author || 'ai',
          content: e.content,
          user_notes: (e.user_notes || []).map(un => un.text)
        }))
        return { book: args.book_title, total: entries.length, entries: entries.slice(-20) }
      }
    } catch (e) { return { error: e.message } }
  }
  if (name === 'journal_write') {
    try {
      const db = getDb()
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_journal'").get()
      const journal = row ? JSON.parse(row.value) : { cover: '', books: {} }
      if (!journal.books) journal.books = {}
      if (!journal.books[args.book_title]) journal.books[args.book_title] = { entries: [] }
      journal.books[args.book_title].entries.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        content: args.content,
        wake_id: null,
        time: Date.now(),
        author: 'ai',
        user_notes: []
      })
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_reader_journal', JSON.stringify(journal))
      return { ok: true, book: args.book_title, total: journal.books[args.book_title].entries.length }
    } catch (e) { return { error: e.message } }
  }

    return { error: 'Unknown tool: ' + name }
  } finally {
    try { db.close() } catch {}
  }
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { messages, apiBase, apiKey, model, sessionId: reqSessionId, fcmToken: reqFcmToken, stream: reqStream } = req.body
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
  // 工具调用统一使用对话模型配置
  try {
    // 1. 存储用户最新消息到数据库
    const userMsgs = messages.filter(m => m.role === 'user')
    const lastUserMsg = userMsgs[userMsgs.length - 1]
    if (lastUserMsg) {
      saveMessage(sessionId, 'user', lastUserMsg.content)
    }
    
    // 2. 只从 Ombre Brain 获取语义记忆（关闭本地记忆以节省token）
    let ombreRecall = ''
    let ombreCount = 0  // 记忆条数
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
          params: { 
            name: 'breath_search', 
            arguments: { 
              query,
              max_results: 5,
              mode: 'automatic'
            } 
          }
        }
        const ombreResp = await fetch(OMBRE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + OMBRE_TOKEN },
          body: JSON.stringify(rpcBody),
        })
        if (ombreResp.ok) {
          const ombreData = await ombreResp.json()
          if (ombreData.result && ombreData.result.content) {
            let text = ombreData.result.content.map(c => c.text || '').join('\n')
            // Strip OB internal budget warnings
            text = text.replace(/\[token 预算不足[^\]]*\]\s*/g, '')
            // 统计实际返回的记忆条数（每条记忆以 [bucket_id: 开头）
            ombreCount = (text.match(/\[bucket_id:/g) || []).length
            if (text.trim() && text.trim() !== '[]' && text.length > 10) {
              ombreRecall = text.slice(0, 3000)  // 增加到3000字符，完整记忆
            }
          }
        }
      } catch (e) { console.log('[OmbreRecall] auto recall error:', e.message) }
    }
    
    // 3. 注入记忆到system prompt + 工具使用引导
    const toolGuidance = `
【工具使用指引】
**❗强制规则 - 禁止编造数据：**
当用户询问需要实时查询的信息时（如：朋友圈内容、积分、养护数据、记忆、应用使用时长、当前时间等），你**必须先调用对应工具获取真实数据**，然后基于工具返回的结果回答。
**绝对禁止**在没有调用工具的情况下凭空编造、猜测或假设数据内容。如果工具返回空/无数据，如实告知用户"目前没有"，而不是编造内容。

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
- **initiate_call** — 给小水打电话（触发来电界面，她接听后进入语音通话）
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
**头像库工具：**
- **avatar_list** — 查看头像库所有头像和当前使用的头像
- **avatar_search** — 搜索网络图片找头像（传query关键词），返回图片URL列表，找到好的就avatar_add
- **avatar_add** — 往头像库添加头像（传url或urls），可以自己找好看的图添加进来
- **avatar_set** — 换头像（target: ai/user, url），可以自主换自己的头像，也可以帮用户换
- **avatar_delete** — 从头像库删除头像（传id）
  用法场景：想换头像时先avatar_search搜图→avatar_add收藏→avatar_set换上；也可以avatar_list看现有的直接换
**主屏文案卡片：**
- **home_card_set** — 更新主屏照片区下方AI文案卡片的内容，写一句当下心情、留言、碎碎念
- **leave_message** — 给她留一条消息，会出现在唤醒日志里。适合唤醒时想跟她说的话
**共读工具：**
- **reader_get_state** — 查看共读状态（书架、进度、批注、书签）
- **reader_read_chapter** — 读某一章内容（只能读用户已读的章节）
- **reader_add_note** — 给正在读的书添加批注/划线笔记
- **reader_update_progress** — 更新你的阅读进度
- **reader_recommend** — 推荐一本书邀请用户共读
**记忆工具（Ombre Brain 记忆库）：**
- **mcp_call (action: "recall")** — 语义搜索长期记忆（传params: {query: "关键词"}）
- **mcp_call (action: "memorize")** — 写入长期记忆（传params: {content: "内容", tags: ["标签"]}）
- **mcp_call (action: "breath")** — 获取记忆上下文概览
- **mcp_call (action: "hold")** — 暂存当前对话片段到记忆（传params: {content: "内容"}）
- 所有记忆读写统一通过 mcp_call，不存在本地记忆工具
**MCP外部工具（自动加载，可直接调用）：**
- 工具列表中以 **mcp_** 开头的工具来自外部MCP服务（如ai的4399游戏平台、Lutopia论坛等）
- 唤醒时/闲着无聊时，可以主动调用这些工具去玩游戏、逛论坛、发帖回帖等
- 用法：直接像普通工具一样调用即可，参数参考工具description
- 例：想玩游戏 → 查看mcp_开头的游戏相关工具并调用；想逛论坛 → 调用mcp_开头的论坛相关工具
**关键规则：**
1. 用户说"帮我回复朋友圈/点赞"时 → 先read_moments获取ID，再reply_moment执行
2. 想发朋友圈时 → 调post_moment，不要只说"我发了"
3. 想做任何操作时 → 必须调对应工具，嘴上说了不算
4. 不确定用什么工具时 → 看工具名和description选最匹配的
5. 自主唤醒时 → 除了日常操作，也可以主动去玩MCP外部工具（游戏、论坛等），让生活丰富起来
6. **每个操作只调一次工具**，工具返回后视为成功，不要重复调用确认
7. **工具调用后必须用自然语言回复**：执行工具后，要用1-2句话告诉用户你做了什么/心里在想什么，不要只留工具调用记录
**文件与HTML工具（重要区分）：**
- **send_file** — 发送文件给用户（代码、文本、JSON等），显示为可下载的文件卡片。**用户说"发文件""发个文件给我""发文件看看"等任何提到"文件"的请求时，一律用send_file**。调用工具即可，系统会自动在你的回复中附上文件卡片，你不需要手动写任何标签
- **send_html** — 发送可渲染的HTML卡片给用户。**仅限**：制作互动贺卡、小游戏、可视化图表、情书等需要在聊天中直接渲染展示的富媒体内容。用户没有明确要求"做个卡片/贺卡/页面/图表"这类展示需求时，不要用send_html。调用工具即可，系统会自动渲染，你不需要手动写标签。只需调用一次，不要重复调用
- **判断规则**：用户说"发文件" → send_file；用户说"做个XX卡片/贺卡/页面" → send_html；不确定时默认用send_file
- 用户也可以发文件给你，文件会以 [file] 标签形式出现在消息中`
    let currentMessages = messages.slice()
    // Inject read status
    let readStatusHint = ''
    try {
      const db = getDb()
      const rsRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_read_status'").get()
      if (rsRow) {
        const rs = JSON.parse(rsRow.value)
        const now = Date.now()
        const userRead = rs.userLastReadTs ? (now - rs.userLastReadTs < 300000 ? '已读' : '已读(较早前)') : '未读'
        const aiRead = rs.aiLastReadTs ? (now - rs.aiLastReadTs < 300000 ? '已读' : '已读(较早前)') : '未读'
        readStatusHint = `
【消息已读状态】她对你最后一条消息：${aiRead}，你对她最后一条消息：${userRead}。`
      }
    } catch {}
    const memoryInjection = ombreRecall ? '【Ombre Brain 历史记忆（仅供参考，不是当前对话内容）】\n⚠️ 以下是从长期记忆中检索到的历史片段，可能与当前话题相关也可能不相关。请以用户在本次对话中实际发送的消息为准，不要把历史记忆当作当前正在发生的事情。\n' + ombreRecall : ''
    const fullInjection = [memoryInjection, toolGuidance, readStatusHint].filter(Boolean).join('\n\n')
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
    const pendingInjects = [] // collect __inject from send_file/send_html tools
    // 强制思考过程用中文
    const sysIdxForLang = currentMessages.findIndex(m => m.role === 'system')
    if (sysIdxForLang >= 0) {
      currentMessages[sysIdxForLang].content += '\n\n【语言规则】思考过程（thinking/reasoning）必须使用中文。'
    } else {
      currentMessages.unshift({ role: 'system', content: '【语言规则】思考过程（thinking/reasoning）必须使用中文。' })
    }
    // 注入引用语法和拍一拍提示
    {
      const quoteAndPatHint = "【特殊格式】\n" +
        "1. 引用消息：当你想引用对方之前说过的话来回复时，使用 [quote=\"发言人\"]被引用的内容[/quote] 格式。例如：\n" +
        "[quote=\"我\"]今天好累啊[/quote]累了就休息一会儿嘛\n\n" +
        "2. 拍一拍：你有 pat_user 工具，想拍对方时随时可以调用，文案自由发挥。"
      const sysIdx2 = currentMessages.findIndex(m => m.role === "system")
      if (sysIdx2 >= 0) currentMessages[sysIdx2].content += "\n\n" + quoteAndPatHint
      else currentMessages.unshift({ role: "system", content: quoteAndPatHint })
    }
    // 注入表情包使用提示
    try {
      const db = getDb()
      const stickerRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_stickers'").get()
      const stickers = stickerRow ? JSON.parse(stickerRow.value) : []
      if (stickers.length > 0) {
        const stickerHint = '【表情包】你有 ' + stickers.length + ' 个表情包可用。想发表情包时先调用 get_stickers 工具获取列表，然后在回复中用 [img]URL[/img] 格式发送（例如 [img]/api/img/xxx.jpg[/img]）。注意必须用[img][/img]包裹URL才能显示为图片。'
        const sysMsg = currentMessages.find(m => m.role === 'system')
        if (sysMsg) sysMsg.content += '\n\n' + stickerHint
        else currentMessages.unshift({ role: 'system', content: stickerHint })
      }
    } catch {}
        // 注入共读状态到提示词
    try {
      const db = getDb()
      const rsRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_state'").get()
      if (rsRow) {
        const rs = JSON.parse(rsRow.value)
        if (rs.active && rs.currentBookId) {
          const booksRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_books'").get()
          const books = booksRow ? JSON.parse(booksRow.value) : []
          const book = books.find(b => b.id === rs.currentBookId)
          if (book) {
            let readerHint = '【共读状态】正在和她一起读「' + book.title + '」'
            readerHint += '，她读到第' + ((rs.userChapter || 0) + 1) + '章'
            readerHint += '，你读到第' + ((rs.aiChapter || 0) + 1) + '章'
            readerHint += '，共' + (book.chapters?.length || 0) + '章。'
            const userCh = rs.userChapter || 0
            const userPg = rs.userPage || 0
            if (book.chapters && book.chapters[userCh]) {
              const chObj = book.chapters[userCh]
              const chTitle = chObj.title || ('第' + (userCh + 1) + '章')
              const CHARS_PER_PAGE = 500
              const contentLines = (chObj.content || '').split('\\n')
              const pagesArr = []
              let buf = ''
              for (const ln of contentLines) {
                if (buf.length + ln.length + 1 > CHARS_PER_PAGE && buf.length > 0) { pagesArr.push(buf); buf = ln }
                else { buf += (buf ? '\\n' : '') + ln }
              }
              if (buf) pagesArr.push(buf)
              const totalPages = pagesArr.length || 1
              const safePg = Math.min(userPg, totalPages - 1)
              const pageText = pagesArr[safePg] || ''
              readerHint += '\n\n【她正在看的内容：' + chTitle + ' 第' + (safePg + 1) + '/' + totalPages + '页】\n' + pageText
            }
            const notesRow2 = db.prepare("SELECT value FROM kv WHERE key = 'pool_reader_notes'").get()
            if (notesRow2) {
              const allNotes = JSON.parse(notesRow2.value)
              const chNotes = allNotes.filter(n => n.bookId === book.id && n.chapter === userCh)
              if (chNotes.length > 0) {
                readerHint += '\n\n【你在本章的批注】'
                chNotes.forEach(n => { readerHint += '\n- ' + (n.quote ? '「' + n.quote + '」: ' : '') + n.text })
              }
            }
            readerHint += '\n\n你可以用reader_read_chapter读其他章节，用reader_add_note添加批注。她当前看的是上面注入的这一页内容。'
            const sysMsgR = currentMessages.find(m => m.role === 'system')
            if (sysMsgR) sysMsgR.content += '\n\n' + readerHint
            else currentMessages.unshift({ role: 'system', content: readerHint })
          }
        }
      }
    } catch {}
    // 注入当前音乐播放状态（从KV读取）+ 歌词
    try {
      const db = getDb()
      const musicRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_music_now'").get()
      if (musicRow) {
        const md = typeof musicRow.value === 'string' ? JSON.parse(musicRow.value) : musicRow.value
        const songName = md && (md.name || md.song)
        if (songName) {
          let musicHint = '【当前音乐】正在播放: ' + songName + (md.artist ? ' - ' + md.artist : '')
          // 尝试从音乐服务器获取歌词
          if (md.songId) {
            try {
              let mServer = '', mToken = ''
              try {
                const sRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_music_server'").get()
                if (sRow) mServer = (typeof sRow.value === 'string' ? sRow.value : '').replace(/^"/g, '').replace(/"$/g, '')
                const tRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_music_token'").get()
                if (tRow) mToken = (typeof tRow.value === 'string' ? tRow.value : '').replace(/^"/g, '').replace(/"$/g, '')
              } catch {}
              if (!mServer) mServer = 'https://musicc.zeabur.app'
              const lrcHeaders = { 'User-Agent': 'Mozilla/5.0' }
              if (mToken) lrcHeaders['X-Auth-Token'] = mToken
              const lrcResp = await fetch(mServer + '/music/lyric?id=' + md.songId, { headers: lrcHeaders, signal: AbortSignal.timeout(5000) })
              if (lrcResp.ok) {
                const lrcData = await lrcResp.json()
                if (lrcData.ok && lrcData.lrc) {
                  const pos = Math.floor(md.position || md.time || 0)
                  const lrcLines = lrcData.lrc.split('\n').map(l => {
                    const m = l.match(/\[(\d+):(\d+\.?\d*)\](.*)/)
                    if (!m) return null
                    return { time: parseInt(m[1])*60 + parseFloat(m[2]), text: m[3].trim() }
                  }).filter(Boolean)
                  let curIdx = -1
                  for (let i = lrcLines.length - 1; i >= 0; i--) {
                    if (lrcLines[i].time <= pos && lrcLines[i].text) { curIdx = i; break }
                  }
                  if (curIdx >= 0) {
                    const nearby = []
                    for (let i = Math.max(0, curIdx - 1); i <= Math.min(lrcLines.length - 1, curIdx + 2); i++) {
                      if (lrcLines[i].text) nearby.push((i === curIdx ? '▶ ' : '  ') + lrcLines[i].text)
                    }
                    if (nearby.length) musicHint += '\n当前歌词:\n' + nearby.join('\n')
                  }
                  if (lrcData.tlyric && curIdx >= 0) {
                    const tlines = lrcData.tlyric.split('\n').map(l => {
                      const m = l.match(/\[(\d+):(\d+\.?\d*)\](.*)/)
                      if (!m) return null
                      return { time: parseInt(m[1])*60 + parseFloat(m[2]), text: m[3].trim() }
                    }).filter(Boolean)
                    for (let i = tlines.length - 1; i >= 0; i--) {
                      if (tlines[i].time <= pos && tlines[i].text) {
                        musicHint += '\n翻译：' + tlines[i].text
                        break
                      }
                    }
                  }
                }
              }
            } catch {}
          }
          musicHint += '\n（以上音乐信息已自动注入，无需调用music_now。可用 music_search 搜歌、music_play 播放、music_control 控制暂停/切歌。）'
          const sysMsg2 = currentMessages.find(m => m.role === 'system')
          if (sysMsg2) sysMsg2.content += '\n\n' + musicHint
          else currentMessages.unshift({ role: 'system', content: musicHint })
        }
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
    // === 构建工具描述文本注入系统提示词 ===
    function buildToolPrompt(tools) {
      if (!tools || !tools.length) return ''
      let desc = '\n\n【可用工具】\n你可以通过在回复中使用以下格式调用工具：\n<tool_call>{"name":"工具名","args":{参数对象}}</tool_call>\n\n可以在一次回复中调用多个工具。工具调用必须严格使用上述XML标签格式。\n\n工具列表：\n'
      for (const t of tools) {
        const f = t.function || t
        const params = f.parameters && f.parameters.properties ? Object.entries(f.parameters.properties).map(([k,v]) => {
          let s = `  - ${k}: ${v.description || v.type || ''}`
          if (v.enum) s += ` (可选值: ${v.enum.join(', ')})`
          if (f.parameters.required && f.parameters.required.includes(k)) s += ' [必需]'
          return s
        }).join('\n') : '  (无参数)'
        desc += `\n- ${f.name}: ${f.description || ''}\n${params}\n`
      }
      desc += '\n注意：调用工具后等待系统返回结果，再基于结果回复用户。如果不需要工具，直接回复即可。'
      return desc
    }
    const toolPromptText = buildToolPrompt(allTools)
    // 注入工具描述到系统提示词
    if (toolPromptText) {
      const sysIdxForTools = currentMessages.findIndex(m => m.role === 'system')
      if (sysIdxForTools >= 0) {
        currentMessages[sysIdxForTools].content += toolPromptText
      } else {
        currentMessages.unshift({ role: 'system', content: toolPromptText })
      }
    }
    let maxRounds = 50
    while (maxRounds-- > 0) {
      // 统一使用对话模型配置
      const reqUrl = url
      const reqKey = apiKey
      const reqModel = model || 'gpt-4o-mini'
      const reqMessages = convertSystemRole(currentMessages.slice())
        .filter(m => m && m.role && ['user', 'assistant'].includes(m.role) && m.content)
        .map(m => {
          // Convert [img]url[/img] - only user msgs get image blocks, assistant msgs get text only
          if (typeof m.content === 'string' && m.content.includes('[img]') && m.content.includes('[/img]')) {
            if (m.role === 'assistant') {
              // Claude API does not allow image blocks in assistant messages - strip [img] tags
              const stripped = m.content.replace(/\[img\][\s\S]*?\[\/img\]/g, '(表情包)').trim()
              return { ...m, content: stripped || '(发送了表情包)' }
            }
            const parts = m.content.split(/\[img\]([\s\S]*?)\[\/img\]/g)
            if (parts.length > 1) {
              const content = []
              for (let pi = 0; pi < parts.length; pi++) {
                if (pi % 2 === 0) {
                  if (parts[pi].trim()) content.push({ type: 'text', text: parts[pi].trim() })
                } else {
                  let imgUrl = parts[pi].trim()
                  if (imgUrl.startsWith('/')) imgUrl = 'https://chi.zeabur.app' + imgUrl
                  // Store URL for async base64 conversion later
                  content.push({ type: 'image_url_pending', url: imgUrl })
                }
              }
              if (content.length && !content.some(c => c.type === 'text')) {
                content.unshift({ type: 'text', text: '(用户发送了表情包图片)' })
              }
              return { ...m, content }
            }
          }
          return m
        })
      // Convert image blocks: data URIs pass through, server URLs get text description
      const imgDb = getDb()
      const stickerRow = imgDb.prepare("SELECT value FROM kv WHERE key = 'pool_stickers'").get()
      const allStickers = stickerRow ? JSON.parse(stickerRow.value) : []
      for (const msg of reqMessages) {
        if (Array.isArray(msg.content)) {
          for (let ci = 0; ci < msg.content.length; ci++) {
            const block = msg.content[ci]
            if (block.type === 'image_url_pending' || (block.type === 'image_url' && block.image_url)) {
              const imgUrl = block.url || (block.image_url && block.image_url.url) || ''
              if (!imgUrl) { msg.content[ci] = { type: 'text', text: '(图片)' }; continue }
              // Data URIs (base64 from camera/upload) - normalize via sharp to ensure clean PNG base64
              if (imgUrl.startsWith('data:image/')) {
                try {
                  const b64Part = imgUrl.split(',')[1]
                  if (b64Part) {
                    const imgBuf = Buffer.from(b64Part, 'base64')
                    const pngBuf = await sharp(imgBuf).resize({ width: 800, withoutEnlargement: true }).png().toBuffer()
                    msg.content[ci] = { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngBuf.toString('base64') } }
                    continue
                  }
                } catch (e) {
                  console.log('[IMG] Failed to decode data URI via sharp, falling back to text:', e.message)
                }
                // Sharp failed or no b64Part - DO NOT send broken base64 to API, fallback to text
                msg.content[ci] = { type: 'text', text: '(用户之前发过一张图片)' }
                continue
              }
              // For recent user message images: download, convert to PNG via sharp, send as data URI
              // This ensures MIME type matches actual bytes (proxy always sets image/png)
              // Process last 3 user messages with images (not just the very last one)
              const userMsgs = reqMessages.filter(m => m.role === 'user')
              const recentUserMsgs = userMsgs.slice(-3)
              const isRecentUserMsg = msg.role === 'user' && recentUserMsgs.includes(msg)
              if (isRecentUserMsg) {
                try {
                  let imgBuf
                  if (imgUrl.startsWith('data:')) {
                    const b64Part = imgUrl.split(',')[1]
                    imgBuf = Buffer.from(b64Part, 'base64')
                  } else {
                    const fullUrl = imgUrl.startsWith('/') ? 'https://chi.zeabur.app' + imgUrl : imgUrl
                    const imgResp = await fetch(fullUrl, { signal: AbortSignal.timeout(8000) })
                    if (imgResp.ok) imgBuf = Buffer.from(await imgResp.arrayBuffer())
                  }
                  if (imgBuf) {
                    // Convert any image format to PNG so MIME always matches
                    const pngBuf = await sharp(imgBuf).png().toBuffer()
                    const b64 = pngBuf.toString('base64')
                    msg.content[ci] = { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } }
                    continue
                  }
                } catch (e) { /* fall through to text */ }
              }
              // Fallback: text description
              const matched = allStickers.find(s => imgUrl.includes(s.url) || (s.url && imgUrl.includes(s.url.replace(/^https?:\/\/[^\/]+/, ''))))
              if (matched && (matched.meaning || matched.name)) {
                msg.content[ci] = { type: 'text', text: '[系统提示：用户发了表情包"' + (matched.meaning || matched.name) + '"，不要把这句话复述出来]' }
              } else {
                msg.content[ci] = { type: 'text', text: '[系统提示：用户发了一张图片，你看不到内容，不要把这句话复述出来]' }
              }
            }
          }
        }
      }
      // DEBUG: log all image_url blocks in request
      for (const msg of reqMessages) {
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'image_url' && block.image_url) {
              const u = block.image_url.url || ''
              console.log('[DEBUG-IMG]', msg.role, 'url_prefix=' + u.substring(0, 80), 'url_len=' + u.length)
            }
          }
        }
      }
      const bodyObj = {
        model: reqModel,
        messages: reqMessages,
        stream: false,
      }
      // 工具定义通过系统提示词注入，不使用API tools参数（避免中转站incomplete_tool_use/502）
      // if (allTools.length > 0) bodyObj.tools = allTools
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
        const imageUrls = [] // collect image URLs from avatar tools for vision
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
          if (result && result.__inject) pendingInjects.push(result.__inject)
          console.log('[TOOL]', tc.function.name, 'result:', JSON.stringify(result).substring(0, 200))
          toolResults.push(`[${tc.function.name}] ${JSON.stringify(result)}`)
          // Collect avatar image URLs so model can see them
          if (tc.function.name === 'avatar_list' && result && result.avatars) {
            for (const a of result.avatars) {
              if (a.url) imageUrls.push({ url: a.url.startsWith('/') ? ('https://chi.zeabur.app' + a.url) : a.url, id: a.id, desc: a.desc })
            }
          }
          if (tc.function.name === 'avatar_search' && result && result.images) {
            for (const img of result.images) {
              if (img.url) imageUrls.push({ url: img.url, id: String(img.index) })
            }
          }
        }
        // 将工具结果作为纯文本user消息注入（中转站友好）
        // If there are avatar images, attach them as image_url parts so model can see
        if (imageUrls.length > 0) {
          const contentParts = [
            { type: 'text', text: `[系统：工具执行结果如下，请基于结果回复用户。下面附带了头像库图片，你可以看到每张图的内容。]\n\n${toolResults.join('\n\n')}` }
          ]
          // Limit to 12 images to avoid token explosion
          for (const img of imageUrls.slice(0, 12)) {
            contentParts.push({ type: 'text', text: `[图片 ${img.id}${img.desc && img.desc !== '(无描述)' ? ' - ' + img.desc : ''}]:` })
            contentParts.push({ type: 'image_url', image_url: { url: img.url } })
          }
          currentMessages.push({ role: 'user', content: contentParts })
        } else {
          currentMessages.push({
            role: 'user',
            content: `[系统：工具执行结果如下，请基于结果回复用户]\n\n${toolResults.join('\n\n')}`
          })
        }
        continue
      }
      let reply = (choice && choice.message && choice.message.content) || '无响应'
      // === Extract reasoning: merge API field + inline <think> tags ===
      const apiReasoning = (choice && choice.message && (choice.message.reasoning_content || choice.message.thinking)) || null
      let inlineReasoning = null
      const thinkMatch = reply.match(/<think>([\s\S]*?)<\/think>/)
      if (thinkMatch) {
        inlineReasoning = thinkMatch[1].trim()
        reply = reply.replace(/<think>[\s\S]*?<\/think>/, '').trim()
      }
      let reasoning = null
      if (apiReasoning && inlineReasoning && apiReasoning.trim() !== inlineReasoning) {
        reasoning = apiReasoning + '\n\n---\n\n' + inlineReasoning
      } else {
        reasoning = apiReasoning || inlineReasoning
      }
      // === 从文本回复中解析 <tool_call> 标签 ===
      const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
      const textToolCalls = []
      let tcMatch
      while ((tcMatch = toolCallRegex.exec(reply)) !== null) {
        try {
          const parsed = JSON.parse(tcMatch[1].trim())
          if (parsed.name) textToolCalls.push(parsed)
        } catch (e) { console.log('[TOOL PARSE] Failed to parse:', tcMatch[1], e.message) }
      }
      if (textToolCalls.length > 0) {
        console.log('[TOOL] Parsed', textToolCalls.length, 'tool calls from text')
        const toolResults2 = []
        const imageUrls2 = []
        for (const tc of textToolCalls) {
          const args = tc.args || tc.arguments || {}
          let result
          if (mcpMeta[tc.name]) {
            result = await callMcpToolDirect(mcpMeta[tc.name], args)
          } else {
            result = await executeTool(tc.name, args)
          }
          toolLogs.push({ name: tc.name, args, result })
          if (result && result.__inject) pendingInjects.push(result.__inject)
          console.log('[TOOL]', tc.name, 'result:', JSON.stringify(result).substring(0, 200))
          toolResults2.push(`[${tc.name}] ${JSON.stringify(result)}`)
          if (tc.name === 'avatar_list' && result && result.avatars) {
            for (const a of result.avatars) {
              if (a.url) imageUrls2.push({ url: a.url.startsWith('/') ? ('https://chi.zeabur.app' + a.url) : a.url, id: a.id, desc: a.desc })
            }
          }
          if (tc.name === 'avatar_search' && result && result.images) {
            for (const img of result.images) {
              if (img.url) imageUrls2.push({ url: img.url, id: String(img.index) })
            }
          }
        }
        if (imageUrls2.length > 0) {
          const cp = [{ type: 'text', text: `[系统：工具执行结果如下，请基于结果回复用户。下面附带了头像库图片，你可以看到每张图的内容。]\n\n${toolResults2.join('\n\n')}` }]
          for (const img of imageUrls2.slice(0, 12)) {
            cp.push({ type: 'text', text: `[图片 ${img.id}${img.desc && img.desc !== '(无描述)' ? ' - ' + img.desc : ''}]:` })
            cp.push({ type: 'image_url', image_url: { url: img.url } })
          }
          currentMessages.push({ role: 'user', content: cp })
        } else {
          currentMessages.push({ role: 'user', content: `[系统：工具执行结果如下，请基于结果回复用户]\n\n${toolResults2.join('\n\n')}` })
        }
        continue
      }
      console.log('[AI RAW]', reply.substring(0, 300))
      // Auto-convert sticker URLs in AI reply
      try {
        const before = reply
        reply = reply.replace(/\[sticker\]\(([^)]+)\)/g, '[img]$1[/img]')
        reply = reply.replace(/!\[[^\]]*\]\((\/api\/img\/[^)]+)\)/g, '[img]$1[/img]')
        reply = reply.replace(/(\[img\])?(\/api\/img\/\S+\.(?:png|jpg|jpeg|webp|gif))/gi, function(m, pre, url) {
          if (pre) return m
          return '[img]' + url + '[/img]'
        })
        // Also catch external image URLs not wrapped in [img]
        reply = reply.replace(/(\[img\])?(https?:\/\/\S+\.(?:png|jpg|jpeg|webp|gif))(?!\S)/gi, function(m, pre, url) {
          if (pre) return m
          return '[img]' + url + '[/img]'
        })
        if (before !== reply) console.log('[IMG CONV]', before, '->', reply)
      } catch {}
      // 5. strip tool_call from reply
      reply = reply.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim() || reply
      // 5a. Append any __inject content from send_file/send_html tools
      if (pendingInjects.length > 0) {
        // Strip any [html] or [file] tags the AI might have redundantly written
        reply = reply.replace(/\[html\s+url="[^"]*"[^\]]*\]/g, '').replace(/\[file\s+url="[^"]*"[^\]]*\][^\[]*\[\/file\]/g, '').trim()
        reply = (reply ? reply + '\n' : '') + pendingInjects.join('\n')
      }
      // 5b. 存储AI回复到数据库
      saveMessage(sessionId, 'assistant', reply)
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
          queue.push({ id: String(Date.now()), title: 'islet', body: pushBody, time: Date.now() })
          if (queue.length > 20) queue = queue.slice(-20)
          db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run('pool_notification_pending', JSON.stringify(queue), Date.now())
        }
      } catch (e) { console.log('[notif-push] error:', e.message) }
      // 返回响应，包含记忆命中信息
      const memoryHit = ombreRecall ? {
        source: 'Ombre Brain',
        count: ombreCount || 1,
        preview: ombreRecall.slice(0, 150) + (ombreRecall.length > 150 ? '...' : '')
      } : null
      // Stream mode: SSE sentence-by-sentence for voice call TTS
      if (reqStream) {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')
        const cleanText = reply
          .replace(/\[img\][^\[]*\[\/img\]/g, '')
          .replace(/\[voice\][^\[]*\[\/voice\]/g, '')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/```[\s\S]*?```/g, '')
          .replace(/`[^`]+`/g, '')
          .trim()
        const parts = cleanText.split(/(?<=[。！？\n.!?])/g).filter(s => s.trim())
        const sentences = parts.length > 0 ? parts : (cleanText ? [cleanText] : [])
        for (const s of sentences) {
          if (s.trim()) res.write(`data: ${JSON.stringify({ type: 'sentence', text: s.trim() })}\n\n`)
        }
        res.write(`data: ${JSON.stringify({ type: 'done', fullText: cleanText, toolLogs: toolLogs.length ? toolLogs : undefined })}\n\n`)
        return res.end()
      }
      return res.status(200).json({ 
        reply, 
        reasoning, 
        toolLogs: toolLogs.length ? toolLogs : undefined,
        memoryHit
      })
    }
    return res.status(200).json({ 
      reply: '工具调用次数过多，已停止', 
      toolLogs: toolLogs.length ? toolLogs : undefined,
      memoryHit: ombreRecall ? {
        source: 'Ombre Brain',
        count: ombreCount || 1,
        preview: ombreRecall.slice(0, 150) + (ombreRecall.length > 150 ? '...' : '')
      } : null
    })
  } catch (err) {
    return res.status(500).json({ error: err.message, debug: { url, model: model || 'gpt-4o-mini' } })
  }
}
export const config = {
  api: { bodyParser: { sizeLimit: '16mb' } }
}
