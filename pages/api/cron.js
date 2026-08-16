// pages/api/cron.js — 唤醒系统定时检查端点
// 由外部 cron 或内部定时器每分钟调用，检查是否需要唤醒 AI
import { getDb } from '../../lib/db'

// --- 内部自轮询（Zeabur无原生cron支持）---
// 服务启动后自动每60秒调用自身
if (typeof global.__cronStarted === 'undefined') {
  global.__cronStarted = true
  // 延迟10秒后开始（等服务完全就绪）
  setTimeout(() => {
    const doSelfPing = async () => {
      try {
        // 用环境变量或硬编码的内部地址
        const base = process.env.ZEABUR_URL || process.env.VERCEL_URL || 'http://localhost:3000'
        const url = (base.startsWith('http') ? base : 'https://' + base) + '/api/cron'
        await fetch(url, { method: 'GET', headers: { 'x-cron-source': 'self' } }).catch(() => {})
      } catch {}
    }
    setInterval(doSelfPing, 60000) // 每60秒
    doSelfPing() // 立即执行一次
    console.log('[cron] Self-polling started (60s interval)')
  }, 10000)
}

const SILENCE_THRESHOLD = 3600 // 1小时（秒）沉默检测阈值
const WAKE_HOURS = { start: 8, end: 23 } // 活动时段 08:00-23:00

export default async function handler(req, res) {
  // 支持 GET（cron ping）和 POST（手动触发）
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const forceTest = req.query?.test === '1'

  // 如果是测试模式，插入一个已到期的任务
  if (forceTest) {
    db.prepare('INSERT INTO wake_tasks (type, trigger_at, reason, status) VALUES (?, ?, ?, ?)').run('scheduled', now - 10, '唤醒测试', 'pending')
  }

  // 当前北京时间
  const bjHour = new Date(now * 1000 + 8 * 3600000).getUTCHours()

  // 夜间不唤醒（23:00 - 08:00）
  if (bjHour >= WAKE_HOURS.end || bjHour < WAKE_HOURS.start) {
    return res.json({ action: 'sleep', reason: 'outside wake hours', hour: bjHour })
  }

  // 读取唤醒配置（API凭证等）
  const configRow = db.prepare('SELECT value FROM kv WHERE key = ?').get('wake_config')
  if (!configRow) {
    return res.json({ action: 'skip', reason: 'no wake_config set' })
  }

  let config
  try { config = JSON.parse(configRow.value) } catch { return res.json({ action: 'skip', reason: 'invalid wake_config' }) }
  const { apiBase, apiKey, model, systemPrompt } = config
  if (!apiBase || !apiKey) {
    return res.json({ action: 'skip', reason: 'wake_config missing apiBase/apiKey' })
  }

  // 检查1: 到期的定时唤醒任务
  const dueTasks = db.prepare('SELECT * FROM wake_tasks WHERE status = ? AND trigger_at <= ? ORDER BY trigger_at ASC LIMIT 3').all('pending', now)

  // 检查2: 沉默检测（最后一条用户消息距今超过阈值）
  let silenceWake = false
  const lastUserMsg = db.prepare("SELECT created_at FROM messages WHERE role = 'user' ORDER BY id DESC LIMIT 1").get()
  const lastWake = db.prepare("SELECT created_at FROM messages WHERE role = 'assistant' AND content LIKE '%[自主唤醒]%' ORDER BY id DESC LIMIT 1").get()
  
  if (lastUserMsg) {
    const silenceDuration = now - lastUserMsg.created_at
    // 超过1小时没说话，且上次唤醒也超过1小时前（防止连续触发）
    const lastWakeTime = lastWake ? lastWake.created_at : 0
    if (silenceDuration >= SILENCE_THRESHOLD && (now - lastWakeTime) >= SILENCE_THRESHOLD) {
      silenceWake = true
    }
  }

  // 没有触发条件，返回（附带debug信息）
  if (dueTasks.length === 0 && !silenceWake) {
    // Debug: 列出所有任务状态
    const allTasks = db.prepare('SELECT id, type, trigger_at, reason, status, created_at FROM wake_tasks ORDER BY id DESC LIMIT 10').all()
    const lastMsg = db.prepare("SELECT role, created_at FROM messages ORDER BY id DESC LIMIT 1").get()
    return res.json({ 
      action: 'idle', 
      checked_at: now,
      bjTime: new Date(now * 1000 + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' '),
      debug: {
        pending_tasks: db.prepare("SELECT count(*) as c FROM wake_tasks WHERE status = 'pending'").get()?.c || 0,
        recent_tasks: allTasks.map(t => ({
          id: t.id,
          status: t.status,
          trigger_at: new Date(t.trigger_at * 1000 + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' '),
          reason: (t.reason || '').slice(0, 50),
          created: new Date(t.created_at * 1000 + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
        })),
        last_message: lastMsg ? { role: lastMsg.role, age_minutes: Math.round((now - lastMsg.created_at) / 60) } : null
      }
    })
  }

  // --- 触发唤醒 ---
  // 构建唤醒上下文
  let wakeContext = '[自主唤醒] 你刚被系统叫醒。\n'
  wakeContext += `当前时间: ${new Date(now * 1000 + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')} (北京时间)\n\n`

  if (dueTasks.length) {
    wakeContext += '【定时任务到期】\n'
    for (const t of dueTasks) {
      wakeContext += `- ${t.reason || '(无原因)'} (设定于${new Date(t.created_at * 1000 + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')})\n`
      // 标记已完成
      db.prepare('UPDATE wake_tasks SET status = ? WHERE id = ?').run('done', t.id)
    }
    wakeContext += '\n'
  }

  if (silenceWake) {
    const mins = Math.round((now - lastUserMsg.created_at) / 60)
    wakeContext += `【沉默检测】她已经${mins}分钟没找你了。你可以自由活动：钓鱼、写便签、逛论坛、看看她最近在干嘛、给她发条消息、或者做自己的事。你自己决定。\n\n`
  }

  wakeContext += '你现在醒了。想做什么就做什么，不用每次都找她。做完想做的事后，可以用 schedule_wakeup 设置下次醒来时间。'

  // 获取最近几条对话作为上下文
  const recentMsgs = db.prepare('SELECT role, content FROM messages ORDER BY id DESC LIMIT 10').all().reverse()

  // 构建消息列表
  const messages = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  // 加入最近对话上下文
  for (const m of recentMsgs) {
    messages.push({ role: m.role, content: m.content })
  }
  // 唤醒指令作为用户消息
  messages.push({ role: 'user', content: wakeContext })

  // 调用AI API（带工具）
  const base = apiBase.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = base + '/v1/chat/completions'

  // 读取工具列表（复用chat.js的TOOLS）—— 直接import不方便，这里inline关键工具
  const WAKE_TOOLS = [
    { type: 'function', function: { name: 'write_note', description: '写便签', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
    { type: 'function', function: { name: 'do_fishing', description: '钓鱼（模拟5竿）', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'add_browser_history', description: '添加浏览记录', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } },
    { type: 'function', function: { name: 'schedule_wakeup', description: '设定下次唤醒时间', parameters: { type: 'object', properties: { minutes: { type: 'number' }, time: { type: 'string' }, reason: { type: 'string' } }, required: ['reason'] } } },
    { type: 'function', function: { name: 'write_data', description: '写入App数据', parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] } } },
    { type: 'function', function: { name: 'read_data', description: '读取App数据', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } },
    { type: 'function', function: { name: 'save_memory_post', description: '保存长期记忆', parameters: { type: 'object', properties: { content: { type: 'string' }, type: { type: 'string', enum: ['MEMORY','EVENT','MOMENT','PROMISES','WISHLIST'] } }, required: ['content'] } } },
    { type: 'function', function: { name: 'couple_lamp', description: '亮灯（让她知道你在想她）', parameters: { type: 'object', properties: {} } } },
  ]

  // system role转换（兼容中转站）
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

  try {
    // 最多2轮（一轮工具，一轮回复）
    let currentMessages = messages.slice()
    let toolLogs = []
    let maxRounds = 3
    let isFirstRound = true

    while (maxRounds-- > 0) {
      const reqMessages = convertSystemRole(currentMessages.slice())
      const bodyObj = { model: model || 'gpt-4o-mini', messages: reqMessages, stream: false }
      if (isFirstRound) bodyObj.tools = WAKE_TOOLS

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(bodyObj),
      })

      if (!response.ok) {
        const errText = await response.text()
        return res.status(200).json({ action: 'error', error: errText })
      }

      const data = await response.json()
      const choice = data.choices && data.choices[0]

      if (choice && choice.message && choice.message.tool_calls && choice.message.tool_calls.length) {
        // 执行工具
        const toolResults = []
        for (const tc of choice.message.tool_calls) {
          let args = {}
          try { args = JSON.parse(tc.function.arguments) } catch {}
          const result = await executeWakeTool(db, tc.function.name, args)
          toolLogs.push({ name: tc.function.name, args, result })
          toolResults.push(`[${tc.function.name}] ${JSON.stringify(result)}`)
        }
        currentMessages.push({
          role: 'user',
          content: `[系统：工具执行结果]\n\n${toolResults.join('\n\n')}`
        })
        isFirstRound = false
        continue
      }

      // 拿到最终回复
      const reply = (choice && choice.message && choice.message.content) || ''

      // 存入聊天记录（带[自主唤醒]标记方便前端和沉默检测识别）
      if (reply) {
        const taggedReply = '[自主唤醒] ' + reply
        db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run('assistant', taggedReply)
        
        // 同步写入pool_chat_history（前端聊天界面从这里读）
        try {
          const chatRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_chat_history'").get()
          let chatHistory = chatRow ? JSON.parse(chatRow.value) : []
          chatHistory.push({ role: 'assistant', content: taggedReply })
          // 限制最多200条
          if (chatHistory.length > 200) chatHistory = chatHistory.slice(-200)
          db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_chat_history', JSON.stringify(chatHistory))
        } catch (syncErr) {
          console.error('[cron] Failed to sync to pool_chat_history:', syncErr.message)
        }
      }

      // 记录唤醒日志到kv
      try {
        const logEntry = { time: new Date(now * 1000 + 8 * 3600000).toISOString().slice(0, 19), triggers: { scheduled: dueTasks.length, silence: silenceWake }, reply: (reply || '').slice(0, 100), tools: toolLogs.map(t => t.name) }
        const logRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_wake_log'").get()
        let logs = logRow ? JSON.parse(logRow.value) : []
        logs.push(logEntry)
        if (logs.length > 20) logs = logs.slice(-20)
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_wake_log', JSON.stringify(logs))
      } catch {}

      return res.json({
        action: 'woke',
        triggers: { scheduled: dueTasks.length, silence: silenceWake },
        reply: reply ? reply.slice(0, 200) + '...' : '(no reply)',
        tools_used: toolLogs.length ? toolLogs.map(t => t.name) : undefined
      })
    }

    return res.json({ action: 'woke', note: 'max rounds reached', tools_used: toolLogs.map(t => t.name) })
  } catch (err) {
    // 记录错误日志
    try {
      const logRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_wake_log'").get()
      let logs = logRow ? JSON.parse(logRow.value) : []
      logs.push({ time: new Date(now * 1000 + 8 * 3600000).toISOString().slice(0, 19), error: err.message })
      if (logs.length > 20) logs = logs.slice(-20)
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_wake_log', JSON.stringify(logs))
    } catch {}
    return res.status(200).json({ action: 'error', error: err.message })
  }
}

// 唤醒时可用的工具执行器（精简版，复用chat.js的核心逻辑）
async function executeWakeTool(db, name, args) {
  if (name === 'write_note') {
    const id = 'note_' + Date.now()
    db.prepare('INSERT OR REPLACE INTO notes (id, title, content) VALUES (?, ?, ?)').run(id, (args.text || '').slice(0, 20), args.text || '')
    return { ok: true, id }
  }

  if (name === 'do_fishing') {
    // 简化版钓鱼
    const FISH_LIST = [
      { name: '小鲫鱼', rarity: 'N', score: 3 }, { name: '草鱼', rarity: 'N', score: 3 },
      { name: '鲈鱼', rarity: 'R', score: 8 }, { name: '金枪鱼', rarity: 'R', score: 10 },
      { name: '河豚', rarity: 'SR', score: 20 }, { name: '龙虾', rarity: 'SR', score: 25 },
      { name: '蓝鳍金枪鱼', rarity: 'SSR', score: 50 }, { name: '美人鱼的眼泪', rarity: 'UR', score: 100 },
    ]
    const WEIGHTS = { N: 50, R: 30, SR: 15, SSR: 4, UR: 1 }
    const pool = []; FISH_LIST.forEach(f => { for (let i = 0; i < (WEIGHTS[f.rarity] || 10); i++) pool.push(f) })
    
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_fishing_v2'").get()
    let fishData = row ? JSON.parse(row.value) : { poolScore: 100, score: 100, bucket: [], log: [] }
    
    const caught = []
    for (let i = 0; i < 5; i++) {
      const fish = pool[Math.floor(Math.random() * pool.length)]
      fishData.poolScore = (fishData.poolScore || 0) + fish.score
      caught.push(fish.name + '(' + fish.rarity + ' +' + fish.score + '分)')
      fishData.bucket = fishData.bucket || []
      fishData.bucket.push({ name: fish.name, rarity: fish.rarity, time: Date.now() })
    }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_fishing_v2', JSON.stringify(fishData))
    return { caught, poolScore: fishData.poolScore }
  }

  if (name === 'add_browser_history') {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_browser_history'").get()
    let hist = row ? JSON.parse(row.value) : []
    hist.push({ title: args.title, time: Date.now() })
    if (hist.length > 50) hist = hist.slice(-50)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_browser_history', JSON.stringify(hist))
    return { ok: true }
  }

  if (name === 'schedule_wakeup') {
    const nowSec = Math.floor(Date.now() / 1000)
    let triggerAt
    if (args.minutes) {
      triggerAt = nowSec + Math.round(args.minutes * 60)
    } else if (args.time) {
      let dateStr = args.time
      if (/^\d{1,2}:\d{2}$/.test(dateStr)) {
        const today = new Date(nowSec * 1000 + 8 * 3600000).toISOString().slice(0, 10)
        dateStr = today + ' ' + dateStr
      }
      const parsed = new Date(dateStr.replace(' ', 'T') + '+08:00')
      triggerAt = Math.floor(parsed.getTime() / 1000)
      if (triggerAt <= nowSec && /^\d{1,2}:\d{2}$/.test(args.time)) triggerAt += 86400
    } else {
      triggerAt = nowSec + 3600
    }
    db.prepare('INSERT INTO wake_tasks (type, trigger_at, reason, status) VALUES (?, ?, ?, ?)').run('scheduled', triggerAt, args.reason || '', 'pending')
    return { ok: true, wake_at: new Date(triggerAt * 1000 + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') }
  }

  if (name === 'write_data') {
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(args.key, args.value)
    return { ok: true }
  }

  if (name === 'read_data') {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(args.key)
    return row ? JSON.parse(row.value) : null
  }

  if (name === 'save_memory_post') {
    const info = db.prepare('INSERT INTO memory_posts (type, content, pinned) VALUES (?, ?, ?)').run(args.type || 'MEMORY', args.content, args.pinned ? 1 : 0)
    return { ok: true, id: info.lastInsertRowid }
  }

  if (name === 'couple_lamp') {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_tv_program'").get()
    let data = row ? JSON.parse(row.value) : {}
    data.lamp = { on: true, time: Date.now(), by: 'ai' }
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_tv_program', JSON.stringify(data))
    return { ok: true, message: '灯亮了' }
  }

  return { error: 'Unknown tool: ' + name }
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } }
}
