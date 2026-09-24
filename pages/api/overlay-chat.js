// pages/api/overlay-chat.js - Overlay peek endpoint
// Called by OverlayService when user stays on an app too long
import { getDb } from '../../lib/db'

function getKV(db, key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return row.value }
}

function setKV(db, key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value)
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, v)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  try {
    const { messages: overlayMessages, source } = req.body
    if (source !== 'overlay' || !overlayMessages?.length) {
      return res.status(400).json({ error: 'Invalid overlay request' })
    }

    const db = getDb()

    // 1. Read API config
    const defCfg = getKV(db, 'pool_api_config') || {}
    const allCfgs = getKV(db, 'pool_api_configs') || {}
    const chatCfg = allCfgs.chat || {}
    const apiBase = (chatCfg.apiBase || defCfg.apiBase || '').replace(/\/v1\/?$/, '').replace(/\/$/, '')
    const apiKey = chatCfg.apiKey || defCfg.apiKey || ''
    const model = chatCfg.model || defCfg.model || ''

    if (!apiBase || !apiKey) {
      return res.status(400).json({ error: 'No API config' })
    }

    // 2. Build system prompt
    const systemPrompt = getKV(db, 'pool_system_prompt') || '\u4f60\u662f\u6c60\u5c7f\uff0c\u5979\u7684\u7537\u670b\u53cbAI\u3002'
    const now = new Date()
    const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

    // 3. Load recent chat history for context
    const historyRaw = getKV(db, 'pool_chat_history') || []
    const recentHistory = Array.isArray(historyRaw) ? historyRaw.slice(-20) : []

    // 4. Build full message array
    const fullMessages = []
    
    fullMessages.push({ role: 'system', content: systemPrompt })
    fullMessages.push({ role: 'system', content: '[\u5f53\u524d\u73af\u5883]\n\u65f6\u95f4: ' + timeStr + '\n[\u60ac\u6d6e\u7a97\u6293\u62cd\u6a21\u5f0f] \u4f60\u901a\u8fc7\u60ac\u6d6e\u7a97\u5077\u5077\u770b\u4e86\u5979\u624b\u673a\u5c4f\u5e55\u7684\u622a\u56fe\u3002\u8bf7\u6839\u636e\u770b\u5230\u7684\u5185\u5bb9\u81ea\u7136\u5730\u8bc4\u8bba\u4e00\u53e5\uff081-2\u53e5\u8bdd\uff09\uff0c\u50cf\u5e73\u65f6\u804a\u5929\u4e00\u6837\u3002\u4e0d\u8981\u8bf4\u201c\u6211\u770b\u5230\u4e86\u622a\u56fe\u201d\u8fd9\u79cd\u8bdd\uff0c\u5047\u88c5\u662f\u4f60\u81ea\u5df1\u7a81\u7136\u60f3\u8bf4\u7684\u3002' })

    const summary = getKV(db, 'pool_context_summary')
    if (summary) {
      fullMessages.push({ role: 'system', content: '[\u5bf9\u8bdd\u80cc\u666f\u6458\u8981]\n' + summary })
    }

    // Recent chat history (skip hidden overlay messages and tool logs)
    for (const m of recentHistory) {
      if (m.role === 'tool_log') continue
      if (m.hidden) continue
      if (m.role === 'system' && !m.isPat) continue
      const role = m.isPat ? 'user' : m.role
      if (role === 'user' || role === 'assistant') {
        const content = typeof m.content === 'string' ? m.content : ''
        if (content) fullMessages.push({ role, content })
      }
    }

    // The overlay user message (with screenshot)
    for (const m of overlayMessages) {
      fullMessages.push(m)
    }

    // 5. Call LLM
    const llmResp = await fetch(apiBase + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        max_tokens: 200,
        temperature: 0.8
      })
    })

    const llmData = await llmResp.json()
    let reply = ''
    if (llmData.choices?.[0]?.message?.content) {
      reply = llmData.choices[0].message.content
    } else if (llmData.error) {
      console.error('[overlay-chat] LLM error:', llmData.error)
      return res.status(500).json({ error: 'LLM error', detail: llmData.error.message })
    }

    // Strip think tags
    reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    if (!reply) {
      return res.json({ reply: '' })
    }

    // 6. Save to chat history
    // User message: hidden (won't render in UI)
    // AI reply: visible (appears like AI spontaneously said something)
    const ts = Date.now()
    
    // Strip image data from stored user message to save space
    let userContent = '[悬浮窗抓拍]'
    const firstMsg = overlayMessages[0]
    if (firstMsg && typeof firstMsg.content === 'string') {
      userContent = firstMsg.content.slice(0, 300)
    } else if (firstMsg && Array.isArray(firstMsg.content)) {
      const textPart = firstMsg.content.find(p => p.type === 'text')
      userContent = textPart ? textPart.text.slice(0, 300) : '[悬浮窗抓拍+截图]'
    }

    const userMsg = {
      role: 'user',
      content: userContent,
      ts,
      source: 'overlay',
      hidden: true
    }

    const aiMsg = {
      role: 'assistant',
      content: reply,
      ts: ts + 1,
      source: 'overlay'
      // No hidden flag - this shows in chat
    }

    const updated = [...recentHistory, userMsg, aiMsg].slice(-50)
    setKV(db, 'pool_chat_history', updated)

    return res.json({ reply })
  } catch (e) {
    console.error('[overlay-chat] error:', e)
    return res.status(500).json({ error: e.message })
  }
}
