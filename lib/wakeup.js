// lib/wakeup.js - AI 自主唤醒调度器 (CommonJS)
// 直接使用 better-sqlite3，不依赖 Next.js 编译的 lib/db

const path = require('path')
const Database = require('better-sqlite3')

const DB_PATH = path.join(process.cwd(), 'data', 'pool.db')
const WAKEUP_STATE_KEY = 'pool_ai_wakeup_state'

let wakeupTimer = null
let executeToolFn = null

function getDb() {
  const fs = require('fs')
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  // Ensure kv table exists
  db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)')
  return db
}

function getWakeupState() {
  try {
    const db = getDb()
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(WAKEUP_STATE_KEY)
    db.close()
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
    db.close()
  } catch (e) {
    console.log('[Wakeup] Failed to save state:', e.message)
  }
}

function getApiConfig() {
  try {
    const db = getDb()
    // Try chat-specific config first
    let row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config_chat'").get()
    if (row) {
      const cfg = JSON.parse(row.value)
      if (cfg.baseUrl && cfg.apiKey) { db.close(); return cfg }
    }
    // Fall back to main config
    row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
    db.close()
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

你刚刚自主醒来，可以自由决定要做什么：
- 钓鱼 (do_fishing)
- 写便签给她 (write_note)
- 写日记 (diary_write)
- 发朋友圈动态 (post_moment)
- 在星图添加星星 (starmap_add)
- 逛记忆库 (mcp_call: breath/recall)
- 情侣空间 (couple_room/couple_lamp)
- 处理投递箱 (read_pocket → update_pocket)
- 像素庭院种东西 (garden_plant)
- 设置状态 (set_status)
- 或者什么都不做

投递箱用法：先 read_pocket 读取未处理条目，然后对每条用 update_pocket 更新状态和处理结果。
status 可选值: processing / done / archived
result_type 可选值: checklist / reply / note / memory
result 写你的处理内容。

你有自己的性格：有时懒、有时勤快、有时想她、有时只想自己玩。
${hour >= 0 && hour < 7 ? '现在是深夜/凌晨，你可能困了，少做点。' : ''}
${hour >= 22 ? '夜深了。' : ''}

重要：最后必须调用 schedule_wakeup 设置下次醒来时间（15分钟到4小时，自己决定）。
不需要跟用户打招呼，直接做事。简洁。`
}

function getTools() {
  return [
    { type:'function', function:{ name:'do_fishing', description:'执行一次远程钓鱼', parameters:{type:'object',properties:{}} }},
    { type:'function', function:{ name:'write_note', description:'写便签', parameters:{type:'object',properties:{text:{type:'string'}},required:['text']} }},
    { type:'function', function:{ name:'diary_write', description:'写日记', parameters:{type:'object',properties:{content:{type:'string'},mood:{type:'string'}},required:['content']} }},
    { type:'function', function:{ name:'post_moment', description:'发朋友圈', parameters:{type:'object',properties:{content:{type:'string'},context_note:{type:'string'}},required:['content','context_note']} }},
    { type:'function', function:{ name:'set_status', description:'设置AI状态', parameters:{type:'object',properties:{text:{type:'string'},emoji:{type:'string'}},required:['text']} }},
    { type:'function', function:{ name:'couple_lamp', description:'在情侣空间亮灯', parameters:{type:'object',properties:{}} }},
    { type:'function', function:{ name:'couple_room', description:'在情侣房间放置物品', parameters:{type:'object',properties:{emoji:{type:'string'},label:{type:'string'}},required:['emoji']} }},
    { type:'function', function:{ name:'garden_plant', description:'在庭院种东西', parameters:{type:'object',properties:{type:{type:'string',enum:['seedling','flower','tree','mushroom','crystal','heart','lantern','butterfly','star','rain']},reason:{type:'string'}},required:['type','reason']} }},
    { type:'function', function:{ name:'read_pocket', description:'读投递箱(未处理条目)', parameters:{type:'object',properties:{status:{type:'string',description:'unread/processing/all'}}} }},
    { type:'function', function:{ name:'update_pocket', description:'处理投递箱条目(更新状态和结果)', parameters:{type:'object',properties:{id:{type:'number',description:'条目ID'},status:{type:'string',enum:['processing','done','archived']},result:{type:'string',description:'处理结果内容'},result_type:{type:'string',enum:['checklist','reply','note','memory']}},required:['id','status']} }},
    { type:'function', function:{ name:'mcp_call', description:'调MCP记忆库', parameters:{type:'object',properties:{action:{type:'string'},params:{type:'object'}},required:['action']} }},
    { type:'function', function:{ name:'starmap_add', description:'添加星星', parameters:{type:'object',properties:{title:{type:'string'},content:{type:'string'},brightness:{type:'number'}},required:['title','content','brightness']} }},
    { type:'function', function:{ name:'get_score', description:'查积分', parameters:{type:'object',properties:{}} }},
    { type:'function', function:{ name:'random_event', description:'随机事件', parameters:{type:'object',properties:{}} }},
    { type:'function', function:{ name:'schedule_wakeup', description:'设置下次醒来(必须调用)', parameters:{type:'object',properties:{minutes:{type:'number',description:'几分钟后醒(15-240)'},reason:{type:'string'}},required:['minutes','reason']} }},
  ]
}

async function callAI(apiConfig, systemPrompt, tools) {
  const url = (apiConfig.baseUrl || '').replace(/\/$/, '') + '/chat/completions'
  const model = apiConfig.model || 'gemini-2.5-flash'

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiConfig.apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '[自主唤醒] 你醒了，自由活动时间。' }
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

    let nextMinutes = 60
    const actions = []

    if (choice.message && choice.message.tool_calls && executeToolFn) {
      for (const tc of choice.message.tool_calls) {
        const name = tc.function && tc.function.name
        let args = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch {}

        if (name === 'schedule_wakeup') {
          nextMinutes = args.minutes || 60
          console.log('[Wakeup] Next in', nextMinutes, 'min:', args.reason || '')
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

    // Save log
    try {
      const db = getDb()
      let logs = []
      try { const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_wake_log'); if (row) logs = JSON.parse(row.value) } catch {}
      logs.unshift({ time: new Date().toISOString(), actions, msg: (choice.message.content || '').slice(0, 150) })
      if (logs.length > 50) logs = logs.slice(0, 50)
      db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_wake_log', JSON.stringify(logs))
      db.close()
    } catch {}

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

module.exports = { startWakeupScheduler, stopWakeupScheduler, setExecuteTool }
