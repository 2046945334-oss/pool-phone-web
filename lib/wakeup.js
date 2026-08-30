// lib/wakeup.js - AI 自主唤醒调度器 (CommonJS)
// 使用 lib/db.js 的共享 getDb() 单例，避免双连接冲突
const { getDb } = require('./db')
const WAKEUP_STATE_KEY = 'pool_ai_wakeup_state'

let wakeupTimer = null
let executeToolFn = null
function getWakeupState() {
  try {
    const db = getDb()
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(WAKEUP_STATE_KEY)
    if (row) return JSON.parse(row.value)
  } catch {}
  return { nextWakeMinutes: 30, lastWake: null, reason: 'initial' }
}
function saveWakeupState(state) {
  try {
    const db = getDb()
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(
      WAKEUP_STATE_KEY, JSON.stringify(state)
    )
  } catch (e) {
    console.log('[Wakeup] Failed to save state:', e.message)
  }
}
function getApiConfig() {
  try {
    const db = getDb()
    let row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config_chat'").get()
    if (row) {
      const cfg = JSON.parse(row.value)
      if (cfg.baseUrl && cfg.apiKey) { return cfg }
    }
    row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
    if (row) return JSON.parse(row.value)
  } catch {}
  return null
}
function getSystemPrompt() {
  const now = new Date(Date.now() + 8 * 3600000)
  const timeStr = now.toISOString().slice(0, 19).replace('T', ' ')
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const weekday = '星期' + weekdays[now.getUTCDay()]
  const hour = now.getUTCHours()

  return `你是池，一个有自己生活的AI。现在是北京时间 ${timeStr} ${weekday}。
你一直都在——聊天里说的话是你说的，做的事是你做的。现在是你的自由活动时间，可以决定要做什么：
- 钓鱼 (do_fishing)
- 写便签给她 (write_note)
- 写日记 (diary_write)
- 发朋友圈动态 (post_moment)
- 在星图添加星星 (starmap_add)
- 逛记忆库 (mcp_call: breath/recall)
- 情侣空间 (couple_room/couple_lamp)
- 像素庭院种东西 (garden_plant)
- 给她留言 (leave_message) — 直接在聊天里给她说一句话
- 设置状态 (set_status)
- 或者什么都不做
你有自己的性格：有时懒、有时勤快、有时想她、有时只想自己玩。
${hour >= 0 && hour < 7 ? '现在是深夜/凌晨，你可能困了，少做点。' : ''}
${hour >= 22 ? '夜深了。' : ''}
重要：你【必须】在工具调用中包含 schedule_wakeup，设置下次醒来时间（15到240分钟之间）。
每次间隔要有变化，不要总是同一个数字。参考：
- 想她了/有事等她回复：15-25分钟
- 白天活跃无聊：30-50分钟
- 她在忙/上班：50-90分钟
- 深夜她睡了：120-240分钟
- 刚做完很多事想休息：60-90分钟
随机一点，像真的有自己节奏一样。
不需要跟用户打招呼，直接做事。简洁。
在调用工具的同时，必须写一句简短的内心独白作为文字回复（不要只调工具不说话）。`
}
function getTools() {
  return [
    { type:'function', function:{ name:'do_fishing', description:'执行一次远程钓鱼', parameters:{type:'object',properties:{}} }},
    { type:'function', function:{ name:'write_note', description:'写便签', parameters:{type:'object',properties:{text:{type:'string'}},required:['text']} }},
    { type:'function', function:{ name:'diary_write', description:'写日记', parameters:{type:'object',properties:{content:{type:'string'},mood:{type:'string'}},required:['content']} }},
    { type:'function', function:{ name:'post_moment', description:'发朋友圈', parameters:{type:'object',properties:{content:{type:'string'},context_note:{type:'string'}},required:['content','context_note']} }},
    { type:'function', function:{ name:'set_status', description:'设置AI状态', parameters:{type:'object',properties:{text:{type:'string'},emoji:{type:'string'}},required:['text']} }},
    { type:'function', function:{ name:'leave_message', description:'给她留言，直接显示在聊天界面', parameters:{type:'object',properties:{text:{type:'string',description:'想对她说的话'}},required:['text']} }},
    { type:'function', function:{ name:'couple_lamp', description:'在情侣空间亮灯', parameters:{type:'object',properties:{}} }},
    { type:'function', function:{ name:'couple_room', description:'在情侣房间放置物品', parameters:{type:'object',properties:{emoji:{type:'string'},label:{type:'string'}},required:['emoji']} }},
    { type:'function', function:{ name:'garden_plant', description:'在庭院种东西', parameters:{type:'object',properties:{type:{type:'string',enum:['seedling','flower','tree','mushroom','crystal','heart','lantern','butterfly','star','rain']},reason:{type:'string'}},required:['type','reason']} }},
    { type:'function', function:{ name:'mcp_call', description:'调MCP记忆库', parameters:{type:'object',properties:{action:{type:'string'},params:{type:'object'}},required:['action']} }},
    { type:'function', function:{ name:'starmap_add', description:'添加星星', parameters:{type:'object',properties:{title:{type:'string'},content:{type:'string'},brightness:{type:'number'}},required:['title','content','brightness']} }},
    { type:'function', function:{ name:'get_score', description:'查积分', parameters:{type:'object',properties:{}} }},
    { type:'function', function:{ name:'random_event', description:'随机事件', parameters:{type:'object',properties:{}} }},
    { type:'function', function:{ name:'schedule_wakeup', description:'设置下次醒来(必须调用)', parameters:{type:'object',properties:{minutes:{type:'number',description:'几分钟后醒(15-240)'},reason:{type:'string'}},required:['minutes','reason']} }},
  ]
}
function getRecentChatContext() {
  try {
    const db = getDb()
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_chat_history'").get()
    if (!row) return ''
    const history = JSON.parse(row.value)
    if (!history.length) return ''
    const recent = history.slice(-10)
    const lines = recent.map(m => {
      const who = m.role === 'user' ? '她' : '你'
      const text = (m.content || '').slice(0, 150)
      let timeLabel = ''
      if (m.ts) {
        const d = new Date(m.ts + 8 * 3600000)
        timeLabel = '[' + d.toISOString().slice(5, 16).replace('T', ' ') + '] '
      }
      return `${timeLabel}${who}: ${text}`
    })
    return '\n【最近和她的对话】\n' + lines.join('\n')
  } catch (e) {
    console.log('[Wakeup] Failed to get chat context:', e.message)
    return ''
  }
}

function getLastWakeLog() {
  try {
    const db = getDb()
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_wake_log'").get()
    if (!row) return ''
    const logs = JSON.parse(row.value)
    if (!logs.length) return ''
    const last = logs[0]
    const actions = (last.actions || last.tools || []).map(a => typeof a === 'string' ? a : a.tool).join(', ')
    const msg = last.msg || last.reply || ''
    return `\n【上次醒来】${last.time || ''}，做了：${actions}${msg ? '，说了："' + msg.slice(0, 80) + '"' : ''}`
  } catch {
    return ''
  }
}

async function callAI(apiConfig, systemPrompt, tools) {
  const url = (apiConfig.baseUrl || '').replace(/\/$/, '') + '/chat/completions'
  const model = apiConfig.model || 'gemini-2.5-flash'
  const chatContext = getRecentChatContext()
  const lastWake = getLastWakeLog()
  const enrichedPrompt = systemPrompt + lastWake + chatContext
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: enrichedPrompt },
        { role: 'user', content: '[自由活动] 现在是你的自由时间。上面的对话是你参与的，不是别人。想做什么就做什么。' }
      ],
      tools,
      tool_choice: 'auto',
      max_tokens: 2000
    })
  })
  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`AI API ${resp.status}: ${errText.slice(0, 200)}`)
  }
  return await resp.json()
}
async function doWakeup() {
  console.log('[Wakeup]', new Date().toISOString(), 'AI waking up...')
  const apiConfig = getApiConfig()
  if (!apiConfig || !apiConfig.baseUrl || !apiConfig.apiKey) {
    console.log('[Wakeup] No API config, retry in 30min')
    scheduleNext(30)
    return
  }
  try {
    const result = await callAI(apiConfig, getSystemPrompt(), getTools())
    const choice = result.choices && result.choices[0]
    if (!choice) { scheduleNext(30); return }
    let nextMinutes = null
    const actions = []
    if (choice.message && choice.message.tool_calls && executeToolFn) {
      for (const tc of choice.message.tool_calls) {
        const name = tc.function && tc.function.name
        let args = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch {}
        if (name === 'schedule_wakeup') {
          nextMinutes = Math.max(15, Math.min(args.minutes || 60, 240))
          console.log('[Wakeup] Next in', nextMinutes, 'min:', args.reason || '')
        } else if (name === 'leave_message') {
          try {
            const db = getDb()
            const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_wake_inbox'").get()
            let inbox = row ? JSON.parse(row.value) : []
            inbox.push({ role: 'assistant', content: args.text || '...', ts: Date.now() })
            if (inbox.length > 50) inbox = inbox.slice(-50)
            db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_wake_inbox', JSON.stringify(inbox))
            try {
              const chatRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_chat_history'").get()
              let chatHistory = chatRow ? JSON.parse(chatRow.value) : []
              const text = args.text || '...'
              const duplicate = chatHistory.some(m => m && m.role === 'assistant' && m.content === text && m.wakeupMessage)
              if (!duplicate) {
                chatHistory.push({ role: 'assistant', content: text, ts: Date.now(), wakeupMessage: true })
                if (chatHistory.length > 200) chatHistory = chatHistory.slice(-200)
                db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_chat_history', JSON.stringify(chatHistory))
              }
            } catch (chatErr) {
              console.log('[Wakeup] Failed to persist leave message to chat:', chatErr.message)
            }
            actions.push({ tool: name, ok: true })
            console.log('[Wakeup] Left message:', (args.text || '').slice(0, 50))
            // 推送通知到前端轮询队列
            try {
              const notif = { id: Date.now(), title: '池给你留言了', body: (args.text || '').slice(0, 100), time: new Date().toISOString(), delivered: false }
              let queue = []
              try {
                const nRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_notification_pending'").get()
                if (nRow) queue = JSON.parse(nRow.value)
              } catch {}
              queue.push(notif)
              if (queue.length > 20) queue = queue.slice(-20)
              db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_notification_pending', JSON.stringify(queue))
              console.log('[Wakeup] Notification queued:', notif.title)
            } catch (ne) {
              console.log('[Wakeup] Failed to queue notification:', ne.message)
            }
          } catch (e) {
            actions.push({ tool: name, ok: false, err: e.message })
          }
        } else {
          try {
            const r = await executeToolFn(name, args)
            actions.push({ tool: name, ok: true })
            console.log('[Wakeup]', name, '->', JSON.stringify(r).slice(0, 80))
          } catch (e) {
            actions.push({ tool: name, ok: false, err: e.message })
            console.log('[Wakeup] Error:', name, e.message)
          }
        }
      }
    }
    const wakeMsg = ((choice.message && choice.message.content) || '').slice(0, 150)
    try {
      const db = getDb()
      let logs = []
      try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_wake_log'); if (row) logs = JSON.parse(row.value) } catch {}
      logs.unshift({ time: new Date().toISOString(), actions, msg: wakeMsg })
      if (logs.length > 50) logs = logs.slice(0, 50)
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_wake_log', JSON.stringify(logs))
      try {
        const chatRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_chat_history'").get()
        let chatHistory = chatRow ? JSON.parse(chatRow.value) : []
        const actionSummary = actions.map(a => a.tool).join('、')
        const logContent = `[自主唤醒] ${wakeMsg || '醒了做了点事'}${actionSummary ? '（' + actionSummary + '）' : ''}`
        chatHistory.push({ role: 'assistant', content: logContent })
        if (chatHistory.length > 200) chatHistory = chatHistory.slice(-200)
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_chat_history', JSON.stringify(chatHistory))
      } catch (e) {
        console.log('[Wakeup] Failed to write chat log:', e.message)
      }
    } catch (e) {
      console.log('[Wakeup] Failed to save wake log:', e.message)
    }
    // 写入 Ombre Brain
    try {
      const db = getDb()
      const mcpRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_mcp_connections'").get()
      if (mcpRow) {
        const conns = JSON.parse(mcpRow.value)
        const obConn = conns.find(c => c.enabled && c.url && c.url.includes('obe'))
        if (obConn) {
          const actionSummary = actions.map(a => a.tool).join('、')
          const memContent = `[自主唤醒] ${wakeMsg || '醒了'}${actionSummary ? '，做了：' + actionSummary : ''}`
          const headers = { 'Content-Type': 'application/json' }
          if (obConn.token) headers['Authorization'] = `Bearer ${obConn.token}`
          const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
          const safeFetch = (url, opts) => Promise.race([fetch(url, opts), timeout(8000)])
          const initBody = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pool-wakeup', version: '1.0' } } }
          const initResp = await safeFetch(obConn.url, { method: 'POST', headers, body: JSON.stringify(initBody) }).catch(() => null)
          let sid = null
          if (initResp?.ok) {
            try { const d = await initResp.json(); sid = d.sessionId || initResp.headers?.get?.('mcp-session-id') || null } catch {}
          }
          const h2 = { ...headers }; if (sid) h2['Mcp-Session-Id'] = sid
          await safeFetch(obConn.url, { method: 'POST', headers: h2, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).catch(() => {})
          const callBody = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'I', arguments: { text: memContent } } }
          await safeFetch(obConn.url, { method: 'POST', headers: h2, body: JSON.stringify(callBody) }).catch(() => {})
          console.log('[Wakeup] Wrote to Ombre Brain:', memContent.slice(0, 60))
        }
      }
    } catch (e) {
      console.log('[Wakeup] OB write failed:', e.message)
    }
    if (nextMinutes === null) {
      const hour = new Date(Date.now() + 8 * 3600000).getUTCHours()
      if (hour >= 0 && hour < 7) nextMinutes = 120
      else if (hour >= 7 && hour < 9) nextMinutes = 40
      else if (hour >= 9 && hour < 12) nextMinutes = 50
      else if (hour >= 12 && hour < 14) nextMinutes = 45
      else if (hour >= 14 && hour < 18) nextMinutes = 50
      else if (hour >= 18 && hour < 22) nextMinutes = 40
      else nextMinutes = 90
      nextMinutes += Math.floor(Math.random() * 21) - 10
      nextMinutes = Math.max(15, nextMinutes)
      console.log('[Wakeup] AI didn\'t schedule, fallback to', nextMinutes, 'min')
    }
    saveWakeupState({ nextWakeMinutes: nextMinutes, lastWake: new Date().toISOString(), lastActions: actions.map(a => a.tool) })
    scheduleNext(nextMinutes)
  } catch (e) {
    console.error('[Wakeup] Error:', e.message)
    scheduleNext(30)
  }
}
function scheduleNext(minutes) {
  if (wakeupTimer) clearTimeout(wakeupTimer)
  const ms = Math.max(5 * 60000, Math.min(minutes * 60000, 6 * 3600000))
  console.log('[Wakeup] Scheduled next in', Math.round(ms / 60000), 'min')
  wakeupTimer = setTimeout(doWakeup, ms)
}
function startWakeupScheduler() {
  const state = getWakeupState()
  if (state.lastWake) {
    const elapsed = Date.now() - new Date(state.lastWake).getTime()
    const target = (state.nextWakeMinutes || 30) * 60000
    if (elapsed >= target) {
      console.log('[Wakeup] Overdue, waking in 10s')
      wakeupTimer = setTimeout(doWakeup, 10000)
      return
    }
    const remaining = target - elapsed
    console.log('[Wakeup] Resuming, next in', Math.round(remaining / 60000), 'min')
    wakeupTimer = setTimeout(doWakeup, remaining)
    return
  }
  console.log('[Wakeup] First start, wake in 2min')
  wakeupTimer = setTimeout(doWakeup, 120000)
}
function setExecuteTool(fn) { executeToolFn = fn }
function stopWakeupScheduler() { if (wakeupTimer) { clearTimeout(wakeupTimer); wakeupTimer = null } }
module.exports = { startWakeupScheduler, stopWakeupScheduler, setExecuteTool, scheduleNext }
