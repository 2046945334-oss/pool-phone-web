# pool-phone-web 自主唤醒系统技术文档

> 本文档详细说明 pool-phone-web 项目中 AI 自主唤醒调度器的工作原理、架构设计和代码流程。

---

## 一、概述

唤醒系统让 AI 能在没有用户主动对话的情况下**定时自主醒来**，执行钓鱼、写便签、发朋友圈、逛论坛等操作，并自行决定下次醒来的时间。整个过程完全在服务器端运行，不依赖客户端轮询或外部 cron 服务。

**核心思路：**
```
server.js 启动 → 注册工具执行函数 → 启动调度器
    ↓
调度器 setTimeout → 时间到 → doWakeup()
    ↓
读取 API 配置 → 构建 system prompt → 调用 AI API（带工具定义）
    ↓
AI 返回工具调用 → 逐个执行 → 记录日志 → 写入 OB 记忆
    ↓
从 AI 返回的 schedule_wakeup 参数读取下次间隔 → setTimeout → 循环
```

---

## 二、文件结构

| 文件 | 职责 |
|---|---|
| `server.js` | 自定义 Next.js 服务器，启动时注册工具执行函数并启动调度器 |
| `lib/wakeup.js` | **核心调度器**：定时逻辑、AI 调用、状态管理、MCP 工具加载 |
| `pages/api/wakeup-exec.js` | 内部 HTTP 端点，执行具体工具（钓鱼、写便签等） |
| `pages/api/wakeup-trigger.js` | 手动触发唤醒（重启调度器） |
| `pages/api/wakeup-status.js` | 查看唤醒状态和历史日志 |
| `pages/api/wakeup-reschedule.js` | 从聊天侧重新设定唤醒间隔 |
| `pages/api/wake-config.js` | 唤醒系统的 API 配置管理（CRUD） |
| `pages/api/wake-inbox.js` | 读取唤醒期间 AI 的留言（只读） |

---

## 三、启动流程

### 3.1 server.js — 入口

```js
// server.js（关键部分）
app.prepare().then(() => {
  server.listen(port, '0.0.0.0', () => {
    // 延迟 5 秒，等 Next.js 热身完毕
    setTimeout(() => {
      const { startWakeupScheduler, setExecuteTool } = require('./lib/wakeup')
      
      // 注册工具执行函数：通过内部 HTTP 调用 wakeup-exec 端点
      setExecuteTool(async (name, args) => {
        const resp = await fetch('http://127.0.0.1:' + port + '/api/wakeup-exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: name, args })
        })
        return await resp.json()
      })
      
      startWakeupScheduler()
    }, 5000)
  })
})
```

**为什么通过 HTTP 调用工具而不是直接调函数？**

wakeup-exec.js 是 Next.js API Route，和 chat.js 共享同一套数据库连接和工具逻辑。通过 HTTP 内部调用（`127.0.0.1`），让唤醒系统的工具执行走和聊天一样的代码路径，避免重复实现。

### 3.2 startWakeupScheduler() — 调度器初始化

```js
function startWakeupScheduler() {
  const state = getWakeupState()  // 从数据库读取上次唤醒状态
  
  if (state.lastWake) {
    const elapsed = Date.now() - new Date(state.lastWake).getTime()
    const target = (state.nextWakeMinutes || 30) * 60000
    
    if (elapsed >= target) {
      // 已过期（比如服务器重启后），10秒后立即唤醒
      setTimeout(doWakeup, 10000)
    } else {
      // 还没到时间，继续等剩余时间
      setTimeout(doWakeup, target - elapsed)
    }
  } else {
    // 首次启动，2分钟后唤醒
    setTimeout(doWakeup, 120000)
  }
}
```

**关键设计：跨重启恢复。** 状态持久化在 SQLite 的 `kv` 表中（key = `pool_ai_wakeup_state`），所以即使 Zeabur 容器重启，调度器也能根据 `lastWake` 时间和 `nextWakeMinutes` 计算出正确的下次唤醒时间。

---

## 四、核心唤醒流程 — doWakeup()

`doWakeup()` 是整个系统的核心，每次触发执行以下步骤：

### 4.1 每日自动整理 OB 记忆

```
凌晨 2-6 点窗口 → 检查今天是否已整理 → 调用 /api/organize-memory
```

每天只执行一次，通过 `pool_organize_last_date` 记录日期来去重。

### 4.2 获取 API 配置

从数据库读取 AI API 配置，优先使用 `pool_api_config_chat`（聊天专用配置），其次 `pool_api_config`（通用配置）。

如果没有配置，30分钟后重试。

### 4.3 加载工具列表

```
基础工具（钓鱼、写便签、日记...）+ MCP 外部工具（论坛、游戏...）
```

**MCP 工具加载流程：**

1. 从数据库读取 `pool_mcp_connections`（MCP 连接配置列表）
2. 对每个启用的连接：
   - 发送 `initialize` RPC 请求
   - 发送 `notifications/initialized`
   - 调用 `tools/list` 获取工具列表
3. 工具名加前缀 `mcp_{connectionId}_{toolName}`，避免冲突
4. 保存每个工具的元数据（URL、token、sessionId），用于后续调用

### 4.4 构建 System Prompt

Prompt 包含：
- 当前北京时间、星期
- 可用操作列表（含 MCP 工具）
- 当前播放的音乐状态（实时歌词）
- 共读书架状态
- 上次唤醒日志（做了什么、说了什么）
- 最近 20 条聊天记录（过滤掉唤醒日志）
- 消息已读状态
- 时段感知提示（深夜少做、白天活跃等）

**核心规则注入：**
- 必须调用 `schedule_wakeup` 设置下次间隔（15-240 分钟）
- 说了要做的事就必须调工具，不能只说不做
- 必须写 1-2 句话描述心情

### 4.5 调用 AI API

```js
const resp = await fetch(apiConfig.baseUrl + '/chat/completions', {
  body: JSON.stringify({
    model: apiConfig.model || 'gemini-2.5-flash',
    messages: [
      { role: 'system', content: enrichedPrompt },
      { role: 'user', content: '[自由活动] 现在是你的自由时间...' }
    ],
    tools,
    tool_choice: 'auto',
    max_tokens: 2000
  })
})
```

### 4.6 执行工具调用

AI 返回 `tool_calls` 数组后，逐个执行：

| 工具类型 | 处理方式 |
|---|---|
| `schedule_wakeup` | 提取 `minutes` 作为下次间隔，不执行外部操作 |
| `leave_message` | 写入 `pool_wake_inbox` + `pool_chat_history` + 推送通知队列 |
| `music_*` | 调用音乐服务器 API |
| `mcp_*` | 通过 MCP RPC 协议调用外部工具 |
| 其他 | 通过 `executeToolFn`（HTTP 调用 wakeup-exec.js）执行 |

### 4.7 记录日志 & 写入 OB

- 唤醒日志写入 `pool_wake_log`（保留最近 50 条）
- 摘要写入 Ombre Brain 记忆库（`I` 工具，即"记录'我'做的事"）

### 4.8 调度下次唤醒

```js
// AI 设定了间隔
if (nextMinutes !== null) {
  scheduleNext(nextMinutes)  // 直接用 AI 给的值
}
// AI 没设定，使用时段默认值
else {
  // 深夜: 120min, 早间: 40min, 上午: 50min, ...
  // 加随机抖动 ±10min
  scheduleNext(fallbackMinutes)
}
```

```js
function scheduleNext(minutes) {
  clearTimeout(wakeupTimer)
  const ms = clamp(minutes * 60000, 5分钟, 6小时)
  wakeupTimer = setTimeout(doWakeup, ms)
}
```

---

## 五、工具执行层 — wakeup-exec.js

这是唤醒系统的"手脚"，实现了和 chat.js 相同的工具逻辑子集：

```
do_fishing     → 模拟5竿钓鱼，更新积分和鱼篓
write_note     → 写入便签到 pool_notes_v3
diary_write    → 写日记到 pool_diary
post_moment    → 发朋友圈到 pool_moments
set_status     → 更新 AI 状态显示
couple_lamp    → 情侣空间亮灯
couple_room    → 放置房间物品
garden_plant   → 像素庭院种植
mcp_call       → 调用 Ombre Brain 记忆库
starmap_add    → 星图添加星星
get_score      → 查询积分
random_event   → 随机生成小事件
...
```

安全限制：只接受来自 `127.0.0.1` 的请求。

---

## 六、辅助 API 端点

### GET /api/wakeup-status
返回当前唤醒状态和最近 50 条唤醒日志。
```json
{
  "state": {
    "nextWakeMinutes": 45,
    "lastWake": "2026-09-13T10:00:00.000Z",
    "lastActions": ["do_fishing", "post_moment", "schedule_wakeup"]
  },
  "recentLogs": [...]
}
```

### GET /api/wakeup-trigger
手动重启调度器（停止当前计时器 → 重新初始化）。

### GET/POST /api/wakeup-reschedule?minutes=30
从聊天侧（当 AI 在对话中调用 `schedule_wakeup` 工具时）重新设定唤醒间隔。

### CRUD /api/wake-config
管理唤醒系统的 API 配置（baseUrl、apiKey、model）。

### GET /api/wake-inbox
读取唤醒期间 AI 留下的消息（只读，不清空）。

---

## 七、状态持久化

所有状态存储在 SQLite `kv` 表中：

| Key | 内容 |
|---|---|
| `pool_ai_wakeup_state` | 调度器状态（上次唤醒时间、下次间隔、上次操作） |
| `pool_wake_log` | 唤醒日志数组（最近 50 条） |
| `pool_wake_inbox` | AI 留言收件箱 |
| `pool_chat_history` | 聊天历史（唤醒留言也会追加进来） |
| `pool_notification_pending` | 推送通知队列 |
| `pool_organize_last_date` | 每日记忆整理标记 |
| `pool_api_config_chat` | AI API 配置（优先） |
| `pool_api_config` | AI API 配置（备选） |
| `pool_mcp_connections` | MCP 外部工具连接列表 |

---

## 八、数据流图

```
┌─────────────────────────────────────────────────┐
│                   server.js                      │
│  app.prepare() → listen → setTimeout(5s) →       │
│  setExecuteTool(httpCallback) →                  │
│  startWakeupScheduler()                          │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│              lib/wakeup.js                       │
│                                                  │
│  startWakeupScheduler()                          │
│    ├─ 读 kv[pool_ai_wakeup_state]               │
│    ├─ 计算距下次唤醒的剩余时间                      │
│    └─ setTimeout(doWakeup, remainingMs)          │
│                                                  │
│  doWakeup()                                      │
│    ├─ tryOrganizeMemory()  (凌晨2-6点)           │
│    ├─ getApiConfig()       → kv[pool_api_config] │
│    ├─ getTools()           → 基础工具 + MCP工具   │
│    ├─ getSystemPrompt()    → 时间+上下文+规则     │
│    ├─ callAI()             → AI API 请求         │
│    │   ├─ getRecentChatContext()  最近20条对话     │
│    │   ├─ getLastWakeLog()        上次唤醒摘要     │
│    │   ├─ getMusicStatus()        当前播放+歌词    │
│    │   └─ getReaderStatus()       共读进度         │
│    ├─ 遍历 tool_calls:                            │
│    │   ├─ schedule_wakeup → 记录下次间隔          │
│    │   ├─ leave_message   → 写inbox+chat+通知     │
│    │   ├─ music_*         → 音乐服务器API         │
│    │   ├─ mcp_*           → MCP RPC 调用          │
│    │   └─ 其他            → executeToolFn(HTTP)   │
│    ├─ 保存唤醒日志到 kv[pool_wake_log]            │
│    ├─ 写入 Ombre Brain 记忆                       │
│    ├─ saveWakeupState()                           │
│    └─ scheduleNext(minutes) → setTimeout → 循环   │
└──────────────────────┬──────────────────────────┘
                       │ HTTP 127.0.0.1
                       ▼
┌─────────────────────────────────────────────────┐
│          pages/api/wakeup-exec.js                │
│                                                  │
│  POST { tool, args }                             │
│    ├─ do_fishing      → kv[pool_fishing_v2]      │
│    ├─ write_note      → kv[pool_notes_v3]        │
│    ├─ diary_write     → kv[pool_diary]            │
│    ├─ post_moment     → kv[pool_moments]          │
│    ├─ set_status      → kv[pool_ai_status]        │
│    ├─ couple_lamp     → kv[pool_couple_space_v2]  │
│    ├─ garden_plant    → kv[pool_pixel_garden]     │
│    ├─ mcp_call        → Ombre Brain API           │
│    ├─ starmap_add     → data/starmap.json         │
│    └─ ...                                         │
└─────────────────────────────────────────────────┘
```

---

## 九、容错机制

1. **API 配置缺失** → 30分钟后重试，不崩溃
2. **AI API 调用失败** → catch 后 30分钟重试
3. **AI 未返回 schedule_wakeup** → 按时段生成默认间隔（±随机抖动）
4. **工具执行失败** → 记录错误，继续执行后续工具
5. **服务器重启** → 从 SQLite 恢复状态，计算剩余时间
6. **全局异常** → `process.on('uncaughtException')` 捕获，不退出进程
7. **MCP 工具加载失败** → 跳过该连接，使用基础工具继续

---

## 十、唤醒间隔策略

AI 通过 `schedule_wakeup` 工具自行决定间隔，prompt 中给出参考：

| 场景 | 建议间隔 |
|---|---|
| 想她了 / 等她回复 | 15-25 分钟 |
| 白天活跃无聊 | 30-50 分钟 |
| 她在忙 / 上班 | 50-90 分钟 |
| 深夜她睡了 | 120-240 分钟 |
| 刚做完很多事想休息 | 60-90 分钟 |

如果 AI 没有调用 `schedule_wakeup`，系统会根据当前小时生成默认值并加 ±10 分钟随机抖动。

硬限制：最短 5 分钟，最长 6 小时（`scheduleNext` 中 clamp）。
