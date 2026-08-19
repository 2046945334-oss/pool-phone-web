// lib/wakeup.js - AI 自主唤醒调度器
// 服务器启动后，按 AI 自己决定的间隔定时唤醒
// AI 每次醒来可以：钓鱼、写便签、处理投递箱、写日记、发朋友圈、逛记忆库……或什么都不做

import { getDb } from './db'

const WAKEUP_STATE_KEY = 'pool_ai_wakeup_state'
const CHAT_HISTORY_KEY = 'pool_chat_history'

// 默认初始间隔 30 分钟（毫秒）
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000

let wakeupTimer = null

function getWakeupState() {
  const db = getDb()
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(WAKEUP_STATE_KEY)
    if (row) return JSON.parse(row.value)
  } catch {}
  return { nextWakeMinutes: 30, lastWake: null, reason: 'initial' }
}

function saveWakeupState(state) {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(
    WAKEUP_STATE_KEY, JSON.stringify(state)
  )
}

function getApiConfig() {
  const db = getDb()
  // 优先用 chat 配置
  try {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config_chat'").get()
    if (row) {
      const cfg = JSON.parse(row.value)
      if (cfg.baseUrl && cfg.apiKey) return cfg
    }
  } catch {}
  // 回退到主配置
  try {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
    if (row) return JSON.parse(row.value)
  } catch {}
  return null
}

function getSystemPromptForWakeup() {
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
- 在星图上添加星星 (starmap_add)
- 逛记忆库 (mcp_call: breath/recall)
- 在情侣空间放东西 (couple_room/couple_pocket/couple_lamp)
- 处理投递箱 (read_pocket -> 处理)
- 在像素庭院种东西 (garden_plant)
- 设置状态 (set_status)
- 买旅行纪念品 (buy_travel_item)
- 或者什么都不做

你有自己的性格：有时懒、有时勤快、有时想她、有时只想自己玩。
根据当前时间和心情自由决定。
${hour >= 0 && hour < 7 ? '现在是深夜/凌晨，你可能困了，可以少做点或快速看看就继续睡。' : ''}
${hour >= 7 && hour < 9 ? '早上好，新的一天。' : ''}
${hour >= 22 ? '夜深了。' : ''}

重要：最后你必须调用 schedule_wakeup 来设置下次醒来时间（自己决定间隔，可以是 15 分钟到 4 小时，根据你的心情和时间段）。
如果你什么都不想做，也至少 schedule_wakeup。

不需要跟用户打招呼或解释你在干嘛，直接做事。简洁行动。`
}

async function callAI(apiConfig, systemPrompt, tools) {
  const url = (apiConfig.baseUrl || '').replace(/\/$/, '') + '/chat/completions'
  const model = apiConfig.model || 'gemini-2.5-flash'

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '[自主唤醒] 你醒了，自由活动时间。' }
  ]

  const body = {
    model,
    messages,
    tools,
    tool_choice: 'auto',
    max_tokens: 2000
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiConfig.apiKey
    },
    body: JSON.stringify(body)
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`AI API error ${resp.status}: ${errText.slice(0, 200)}`)
  }

  return await resp.json()
}

// 动态导入 executeToolFn（由 server.js 注入）
let executeToolFn = null
export function setExecuteTool(fn) {
  executeToolFn = fn
}

async function doWakeup() {
  console.log('[Wakeup]', new Date().toISOString(), 'AI waking up...')

  const apiConfig = getApiConfig()
  if (!apiConfig || !apiConfig.baseUrl || !apiConfig.apiKey) {
    console.log('[Wakeup] No API config found, skipping. Will retry in 30min.')
    scheduleNext(30)
    return
  }

  const systemPrompt = getSystemPromptForWakeup()

  // 加载工具列表（复用 chat.js 的 TOOLS 定义）
  const { getTools } = await import('./wakeup-tools.js')
  const tools = getTools()

  try {
    const result = await callAI(apiConfig, systemPrompt, tools)
    const choice = result.choices?.[0]

    if (!choice) {
      console.log('[Wakeup] No response from AI')
      scheduleNext(30)
      return
    }

    // 处理工具调用
    if (choice.message?.tool_calls && executeToolFn) {
      let nextMinutes = 60 // 默认
      const actions = []

      for (const tc of choice.message.tool_calls) {
        const name = tc.function?.name
        let args = {}
        try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}

        if (name === 'schedule_wakeup') {
          nextMinutes = args.minutes || 60
          console.log('[Wakeup] AI scheduled next wake in', nextMinutes, 'min. Reason:', args.reason || '')
        } else {
          // 执行工具
          try {
            const toolResult = await executeToolFn(name, args)
            actions.push({ tool: name, result: toolResult })
            console.log('[Wakeup] Executed:', name, '->', JSON.stringify(toolResult).slice(0, 100))
          } catch (e) {
            console.log('[Wakeup] Tool error:', name, e.message)
          }
        }
      }

      // 保存唤醒记录到聊天历史
      if (actions.length > 0) {
        saveWakeLog(actions, choice.message?.content)
      }

      // 保存状态并调度下次
      saveWakeupState({
        nextWakeMinutes: nextMinutes,
        lastWake: new Date().toISOString(),
        lastActions: actions.map(a => a.tool),
        reason: choice.message?.content?.slice(0, 100) || ''
      })
      scheduleNext(nextMinutes)
    } else if (choice.message?.content) {
      // AI 没调用工具，只说了话
      console.log('[Wakeup] AI said:', choice.message.content.slice(0, 100))
      scheduleNext(30)
    } else {
      scheduleNext(30)
    }
  } catch (e) {
    console.error('[Wakeup] Error:', e.message)
    scheduleNext(30) // 出错了 30 分钟后重试
  }
}

function saveWakeLog(actions, aiMessage) {
  try {
    const db = getDb()
    const key = 'pool_wake_log'
    let logs = []
    try {
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      if (row) logs = JSON.parse(row.value)
    } catch {}
    logs.unshift({
      time: new Date().toISOString(),
      actions: actions.map(a => ({ tool: a.tool, result: typeof a.result === 'string' ? a.result.slice(0, 200) : JSON.stringify(a.result).slice(0, 200) })),
      message: (aiMessage || '').slice(0, 200)
    })
    // 只保留最近 50 条
    if (logs.length > 50) logs = logs.slice(0, 50)
    db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(logs))
  } catch (e) {
    console.log('[Wakeup] Failed to save wake log:', e.message)
  }
}

function scheduleNext(minutes) {
  if (wakeupTimer) clearTimeout(wakeupTimer)
  const ms = Math.max(5 * 60 * 1000, Math.min(minutes * 60 * 1000, 6 * 60 * 60 * 1000)) // 5min ~ 6h
  console.log('[Wakeup] Next wake in', Math.round(ms / 60000), 'minutes')
  wakeupTimer = setTimeout(doWakeup, ms)
}

export function startWakeupScheduler() {
  const state = getWakeupState()
  const initialDelay = (state.nextWakeMinutes || 30) * 60 * 1000

  // 如果距离上次醒来已经超过了预定间隔，立即醒来
  if (state.lastWake) {
    const elapsed = Date.now() - new Date(state.lastWake).getTime()
    if (elapsed >= initialDelay) {
      console.log('[Wakeup] Overdue, waking up now')
      setTimeout(doWakeup, 5000) // 5秒后启动，给服务器时间初始化
      return
    }
    const remaining = initialDelay - elapsed
    console.log('[Wakeup] Resuming schedule, next wake in', Math.round(remaining / 60000), 'min')
    wakeupTimer = setTimeout(doWakeup, remaining)
    return
  }

  // 首次启动，2 分钟后第一次醒来
  console.log('[Wakeup] First start, waking in 2 minutes')
  wakeupTimer = setTimeout(doWakeup, 2 * 60 * 1000)
}

export function stopWakeupScheduler() {
  if (wakeupTimer) {
    clearTimeout(wakeupTimer)
    wakeupTimer = null
  }
}
