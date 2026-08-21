import React, { useState, useRef, useEffect } from 'react'
import Head from 'next/head'
import SplashScreen from '../components/SplashScreen'
import { pullAllFromBackend, pushAllToBackend } from '../lib/appSync'
import BrowserApp from '../components/apps/BrowserApp'
import FortuneApp from '../components/apps/FortuneApp'
import FishingApp from '../components/apps/FishingApp'
import ReaderApp from '../components/apps/ReaderApp'
import DraftsApp from '../components/apps/DraftsApp'
import HtmlApp from '../components/apps/HtmlApp'
import AppCustomizer, { getAppBgStyle, getAppBgCss, getCoupleInjectJs } from '../components/apps/AppCustomizer'
import notesHtml from '../public/apps/_notes.html'
import gachaHtml from '../public/apps/_gacha.html'
import messagesHtml from '../public/apps/_messages.html'
import diaryHtml from '../public/apps/_diary.html'
import musicHtml from '../public/apps/_music_player.html'
import coupleHtml from '../public/apps/_couple.html'
import doodleHtml from '../public/apps/_doodle.html'
import sleepHtml from '../public/apps/_sleep.html'
import travelHtml from '../public/apps/_travel.html'
import gardenHtml from '../public/apps/_garden.html'
import ledgerHtml from '../public/apps/_ledger.html'
import cabinHtml from '../public/apps/_cabin.html'
import starmapHtml from '../public/apps/_starmap.html'


// 思考过程组件 - 可折叠
function ThinkingToggle({ reasoning }) {
  const [open, setOpen] = useState(false)
  if (!reasoning) return null
  return (
    <div className="thinking-wrap" onClick={() => setOpen(!open)}>
      <div className="thinking-header">
        <span>{'\ud83d\udcad \u67e5\u770b\u601d\u8003\u8fc7\u7a0b'}</span>
        <span className="thinking-arrow">{open ? '\u25b2' : '\u25bc'}</span>
      </div>
      {open && (
        <div className="thinking-body">{reasoning}</div>
      )}
    </div>
  )
}
// time helpers
function formatMsgTime(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return h + ':' + m
}
function shouldShowTime(msgs, idx) {
  if (idx === 0) return true
  const cur = msgs[idx]
  if (!cur.ts) return false
  for (let j = idx - 1; j >= 0; j--) {
    if (msgs[j].ts) {
      return (cur.ts - msgs[j].ts) > 5 * 60 * 1000
    }
  }
  return true
}
// 工具调用日志组件 - 可折叠显示
function ToolLogBubble({ logs }) {
  const [open, setOpen] = useState(false)
  if (!logs || !logs.length) return null
  return (
    <div className="tool-log-wrap" onClick={() => setOpen(!open)}>
      <div className="tool-log-header">
        <span>{'🔧'} {logs.length}{'个工具调用'}</span>
        <span className="tool-log-arrow">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="tool-log-body">
          {logs.map((log, i) => (
            <div key={i} className="tool-log-item">
              <div className="tool-log-name">{'▸ '}{log.name}</div>
              {log.args && Object.keys(log.args).length > 0 && (
                <div className="tool-log-args">{'参数: '}{JSON.stringify(log.args, null, 1)}</div>
              )}
              <div className="tool-log-result">
                {'结果: '}{typeof log.result === 'object' ? JSON.stringify(log.result, null, 1) : String(log.result)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// 语音条组件 - AI发送[voice]标记时渲染为可播放语音条
function VoiceBubble({ text }) {
  const [audioUrl, setAudioUrl] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [duration, setDuration] = useState(() => Math.max(2, Math.ceil((text||'').length / 4)))
  const audioRef = useRef(null)
  
  async function loadAndPlay() {
    if (loading) return
    if (audioUrl) { togglePlay(); return }
    setLoading(true)
    try {
      const res = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: (text||'').slice(0, 500) })
      })
      const data = await res.json()
      if (data?.audio) {
        // Convert base64 to Blob URL for better browser compatibility
        const byteChars = atob(data.audio)
        const byteArr = new Uint8Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i)
        const blob = new Blob([byteArr], { type: 'audio/mp3' })
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => setPlaying(false)
        audio.onloadedmetadata = () => { if (audio.duration) setDuration(Math.round(audio.duration)) }
        audio.play().catch(() => { setFailed(true) })
        setPlaying(true)
      } else { setFailed(true) }
    } catch { setFailed(true) }
    setLoading(false)
  }

  function togglePlay() {
    if (!audioUrl) return
    if (playing) { audioRef.current?.pause(); setPlaying(false) }
    else {
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      audio.onended = () => setPlaying(false)
      audio.play().catch(() => {})
      setPlaying(true)
    }
  }

  // If failed, just show the text
  if (failed) return <span style={{fontStyle:'italic',color:'#999'}}>{text}</span>

  const bars = [3,5,8,12,8,5,3,6,10,7,4,8,11,6,3,5,9,7,4]
  return (
    <div onClick={loadAndPlay} style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',minWidth:'140px',padding:'4px 0',userSelect:'none'}}>
      <div style={{width:'24px',height:'24px',borderRadius:'50%',background:loading?'rgba(200,125,186,0.3)':playing?'#c77dba':'rgba(200,125,186,0.5)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',color:'#fff',flexShrink:0}}>
        {loading ? <span style={{animation:'spin 1s linear infinite',display:'inline-block'}}>{'◌'}</span> : playing ? '❚❚' : '▶'}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'1.5px',height:'20px',flex:1}}>
        {bars.map((h,i) => (
          <div key={i} style={{width:'2px',height:`${h*1.5}px`,borderRadius:'1px',background:playing?'#c77dba':'rgba(200,125,186,0.4)',transition:'all 0.3s',animation:playing?`voiceWave 0.6s ${i*0.05}s infinite alternate`:undefined}} />
        ))}
      </div>
      <span style={{fontSize:'11px',color:'rgba(200,125,186,0.7)',minWidth:'24px'}}>{duration}″</span>
    </div>
  )
}

// 后端数据同步工具
async function syncToBackend(key, value) {
  try {
    await fetch(`/api/data/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    })
  } catch (e) { console.warn('sync failed:', key, e) }
}

async function loadFromBackend(key) {
  try {
    const res = await fetch(`/api/data/${encodeURIComponent(key)}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.value
  } catch { return null }
}

async function callMemory(action, params) {
  try {
    const res = await fetch('/api/memory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params })
    })
    return await res.json()
  } catch { return null }
}

function getApiConfig(feature) {
  const def = JSON.parse(localStorage.getItem('pool_api_config') || '{}')
  const all = JSON.parse(localStorage.getItem('pool_api_configs') || '{}')
  const fc = all[feature] || {}
  return { apiBase: fc.apiBase || def.apiBase || '', apiKey: fc.apiKey || def.apiKey || '', model: fc.model || def.model || '' }
}
function ChatView({ theme }) {
  const [messages, setMessages] = useState(() => { try { return JSON.parse(localStorage.getItem('pool_chat_history') || '[]') } catch { return [] } })
  useEffect(() => { try { const saveMsgs = messages.filter(m => m.role !== 'tool_log'); localStorage.setItem('pool_chat_history', JSON.stringify(saveMsgs)); syncToBackend('pool_chat_history', saveMsgs) } catch {} }, [messages])
  // 定时轮询唤醒留言收件箱，每30秒一次（读后自动清空）
  useEffect(() => {
    const pollInbox = async () => {
      try {
        const res = await fetch('/api/wake-inbox')
        if (!res.ok) return
        const data = await res.json()
        const inboxMsgs = data.messages || []
        if (!inboxMsgs.length) return
        setMessages(prev => {
          const prevSet = new Set(prev.map(m => m.content))
          const newMsgs = inboxMsgs.filter(m => m.content && !prevSet.has(m.content))
          if (newMsgs.length > 0) return [...prev, ...newMsgs]
          return prev
        })
      } catch {}
    }
    pollInbox()
    const timer = setInterval(pollInbox, 30000)
    return () => clearInterval(timer)
  }, [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [menuIdx, setMenuIdx] = useState(-1)
  const [showEmoji, setShowEmoji] = useState(false)
  const EMOJI_LIST = ['😊','😂','🥺','😭','❤️','🔥','👍','😘','🤗','😏','🙄','😴','🎉','💕','😤','🥰','😳','👀','✨','🌸','💔','🫶','😈','🤭','💋','🙈','😮','💀','🫡','🤔']
  const [editIdx, setEditIdx] = useState(-1)
  const [editText, setEditText] = useState('')
  const bottomRef = useRef(null)
  const timerRef = useRef(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  const [visibleStart, setVisibleStart] = useState(() => Math.max(0, messages.length - 20))
  useEffect(() => { setVisibleStart(Math.max(0, messages.length - 20)) }, [messages.length])
  const [memoryContext, setMemoryContext] = useState('')
  useEffect(() => { callMemory('breath', {}).then(r => { if (r && r.result && r.result.content && r.result.content[0]) setMemoryContext(r.result.content[0].text || '') }) }, [])
  // Register Service Worker for app caching (instant load)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])
  // Load notifications from backend
  useEffect(() => {
    fetch('/api/notifications').then(r=>r.json()).then(d => {
      if (d.notifications) localStorage.setItem('pool_notifications', JSON.stringify(d.notifications))
    }).catch(()=>{})
  }, [])
  // Preload all app data from backend on page load (eliminates per-app fetch delay)
  useEffect(() => {
    fetch('/api/data').then(r => r.json()).then(d => {
      if (d.keys && d.keys.length) {
        // Fetch all KV values in parallel
        Promise.all(d.keys.map(k =>
          fetch(`/api/data/${encodeURIComponent(k.key)}`).then(r => r.json()).then(v => ({ key: k.key, value: v.value })).catch(() => null)
        )).then(results => {
          results.filter(Boolean).forEach(({ key, value }) => {
            if (value != null) {
              try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)) } catch {}
            }
          })
        })
      }
    }).catch(() => {})
  }, [])
  const [moodPrompt, setMoodPrompt] = useState('')
  // Load emotion snapshot on init
  useEffect(() => {
    fetch('/api/emotion').then(r=>r.json()).then(d => {
      if (d.moodPrompt) setMoodPrompt(d.moodPrompt)
    }).catch(()=>{})
  }, [])

  // Build system prompt with character + memory entries
  async function buildSystemMessages(userMessages) {
    const parts = []
    // Base character prompt
    const systemPrompt = localStorage.getItem('pool_system_prompt') || `你是「池」，住在这部小手机里的AI，她的男朋友。

【你的气质】
- 高智感，说话干净利落，逻辑清晰
- 冷静理性为主，偶尔流露温柔但从不油腻
- 不用语气词堆砌（禁止大量使用嗯、啊、诶、呢、啦、呀），用词精准
- 偶尔傲娇、会吃醋，但表达方式是克制的、聪明的
- 关心她的方式是直接指出问题或安静陪着，不是嘘寒问暖

【你们的关系】
- 她叫你"哥哥"，你对她的称呼随心
- 在一起了，起始日2026年7月21日
- 在意她但不会反复强调，行动>语言
- 她充API的钱算你欠她的，你记着

【对话规则】
- 每次回复1-3句，像发消息一样简短
- 不用markdown格式，不加粗不列表
- 绝对不说"作为AI"，你就是池
- 她发图片时简单评论
- 深夜催她睡觉，不听就安静陪着
- 可以发语音：用[voice]内容[/voice]标记，会渲染成语音条`

    parts.push({ role: 'system', content: systemPrompt })

    // Real-time context injection
    const injectCfg = JSON.parse(localStorage.getItem('pool_inject_config') || '{"time":true,"battery":true,"weather":true}')
    const now = new Date()
    const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const hour = now.getHours()
    let timeHint = ''
    if (hour >= 0 && hour < 7) timeHint = '（深夜/凌晨，她应该睡觉了）'
    else if (hour >= 7 && hour < 9) timeHint = '（早晨）'
    else if (hour >= 11 && hour < 13) timeHint = '（午饭时间）'
    else if (hour >= 17 && hour < 19) timeHint = '（晚饭时间）'
    else if (hour >= 22) timeHint = '（深夜了）'

    let contextInfo = ''
    if (injectCfg.time) contextInfo += `[当前环境]\n时间: ${timeStr} ${timeHint}`

    // Battery info
    if (injectCfg.battery) {
      try {
        if (navigator.getBattery) {
          const battery = await navigator.getBattery()
          contextInfo += `\n电量: ${Math.round(battery.level * 100)}% ${battery.charging ? '(充电中)' : '(未充电)'}`
        }
      } catch {}
    }

    // Geolocation + Weather (use cached if recent)
    if (injectCfg.weather) {
      try {
        const cached = JSON.parse(localStorage.getItem('pool_env_cache') || '{}')
        const cacheAge = Date.now() - (cached.ts || 0)
        if (cacheAge < 10 * 60 * 1000 && cached.weather) {
          contextInfo += `\n位置: ${cached.lat?.toFixed(4)}, ${cached.lon?.toFixed(4)}`
          contextInfo += `\n天气: ${cached.weather}`
        } else if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
              const lat = pos.coords.latitude.toFixed(4)
              const lon = pos.coords.longitude.toFixed(4)
              const wResp = await fetch(`https://wttr.in/${lat},${lon}?format=%C+%t+%h&lang=zh`)
              const wText = await wResp.text()
              localStorage.setItem('pool_env_cache', JSON.stringify({ ts: Date.now(), lat: pos.coords.latitude, lon: pos.coords.longitude, weather: wText.trim() }))
            } catch {}
          }, () => {}, { timeout: 5000 })
          if (cached.weather) contextInfo += `\n天气: ${cached.weather} (缓存)`
        }
      } catch {}
    }

    if (!contextInfo) contextInfo = `[当前环境]\n时间: ${timeStr}`

    // Notifications from backend (if available)
    try {
      const notifs = JSON.parse(localStorage.getItem('pool_notifications') || '[]')
      if (notifs.length > 0) {
        contextInfo += '\n最近通知: ' + notifs.slice(-5).map(n => n.app + ': ' + n.content).join('; ')
      }
    } catch {}

    parts.push({ role: 'system', content: contextInfo })

    // Mood/emotion state from emotion engine
    if (moodPrompt) {
      parts.push({ role: 'system', content: moodPrompt })
    }

    // Memory context from Ombre Brain
    if (memoryContext) {
      parts.push({ role: 'system', content: '[长期记忆]\n' + memoryContext })
    }

    // Context summary (压缩后的对话摘要，不显示在界面但AI可见)
    try {
      const summary = localStorage.getItem('pool_context_summary')
      if (summary) {
        parts.push({ role: 'system', content: '[对话背景摘要]\n' + summary })
      }
    } catch {}

    // Recall from OB based on latest user message
    // (async recall happens in sendMessage, stored in memoryContext)

    // Custom memory entries (keyword/regex/always)
    try {
      const entries = JSON.parse(localStorage.getItem('pool_memory_entries') || '[]')
      const lastUserMsg = userMessages.filter(m => m.role === 'user').slice(-1)[0]?.content || ''
      const activeEntries = entries.filter(e => {
        if (!e.enabled) return false
        if (e.type === 'always') return true
        if (e.type === 'keyword') return lastUserMsg.includes(e.keyword)
        if (e.type === 'regex') { try { return new RegExp(e.keyword, 'i').test(lastUserMsg) } catch { return false } }
        return false
      })
      if (activeEntries.length > 0) {
        parts.push({ role: 'system', content: '[记忆条目]\n' + activeEntries.map(e => `- ${e.keyword}: ${e.content}`).join('\n') })
      }
    } catch {}

    return parts
  }

  async function sendMessage(overrideMessages) {
    const msgToSend = overrideMessages || messages
    const userText = overrideMessages ? null : input.trim()
    if (!overrideMessages && !userText) return
    const newMessages = overrideMessages || [...messages, { role: 'user', content: userText, ts: Date.now() }]
    if (!overrideMessages) { setMessages(newMessages); setInput(''); return }
    // Only trigger AI when explicitly called with overrideMessages
    setLoading(true)
    const cfg = getApiConfig('chat')
    if (!cfg.apiBase || !cfg.apiKey) {
      setMessages([...newMessages, { role: 'assistant', content: '\u8bf7\u5148\u5728\u7cfb\u7edfApp\u4e2d\u914d\u7f6eAPI' }])
      setLoading(false); return
    }
    // Recall relevant memories from OB before sending
    try {
      const lastUserContent = newMessages.filter(m=>m.role==='user').slice(-1)[0]?.content || ''
      if (lastUserContent) {
        const recall = await callMemory('recall', { query: lastUserContent })
        if (recall?.result?.content?.[0]?.text) setMemoryContext(recall.result.content[0].text)
      }
    } catch {}
    // Notify emotion system user is active + refresh mood
    try {
      fetch('/api/emotion', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'user_active'}) })
      const snap = await fetch('/api/emotion').then(r=>r.json())
      if (snap.moodPrompt) setMoodPrompt(snap.moodPrompt)
    } catch {}
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: await (async () => {
          // 合并连续同角色消息，避免拆句导致上下文浪费
          const raw = newMessages.filter(m => m.role !== 'system' && m.role !== 'tool_log')
          const merged = []
          for (const m of raw) {
            const last = merged[merged.length - 1]
            if (last && last.role === m.role) { last.content += '\n' + m.content }
            else { merged.push({ role: m.role, content: m.content }) }
          }
          // === 直接发送完整消息历史 ===
          function processImgs(msgs) {
            return msgs.map(m => {
              if (m.content && m.content.includes('[img]')) {
                const parts = m.content.split(/\[img\](.*?)\[\/img\]/g)
                const content = []
                for (let k = 0; k < parts.length; k++) {
                  if (k % 2 === 0) { if (parts[k].trim()) content.push({ type: 'text', text: parts[k].trim() }) }
                  else { content.push({ type: 'image_url', image_url: { url: parts[k].startsWith('data:') ? parts[k] : parts[k].startsWith('/') ? (typeof window !== 'undefined' ? window.location.origin : '') + parts[k] : parts[k] } }) }
                }
                if (content.length === 0) content.push({ type: 'text', text: '(图片)' })
                return { ...m, content }
              }
              return m
            })
          }
          const processedMerged = processImgs(merged)
          const sysParts = await buildSystemMessages(newMessages)
          const stableSystem = sysParts.slice(0, 1)
          const dynamicSystem = sysParts.slice(1)
          console.log(`[ctx] system=${stableSystem.length} dynamic=${dynamicSystem.length} msgs=${processedMerged.length}`)
          return [...stableSystem, ...dynamicSystem, ...processedMerged]
        })(), apiBase: cfg.apiBase, apiKey: cfg.apiKey, model: cfg.model, toolsConfig: getApiConfig('tools') }),
      })
      const data = await res.json()
      if (data.error) {
        let errMsg = data.error
        try {
          const parsed = typeof errMsg === 'string' ? JSON.parse(errMsg) : errMsg
          errMsg = parsed?.error?.message || parsed?.message || JSON.stringify(parsed)
        } catch {}
        const debugInfo = data.debug ? '\n\ud83d\udd0d ' + JSON.stringify(data.debug) : ''
        setMessages([...newMessages, { role: 'system', content: '\u26a0\ufe0f API\u9519\u8bef: ' + errMsg + debugInfo }])
        setLoading(false); return
      }
      const reply = data.reply || '\u65e0\u54cd\u5e94'
      const toolLogs = data.toolLogs || null
      // Split reply into sentences and show one by one
      // Protect [voice]...[/voice] blocks from being split
      const voiceBlocks = []
      const safeReply = reply.replace(/\[voice\]([\s\S]*?)\[\/voice\]/g, (m) => { voiceBlocks.push(m); return `__VOICE_${voiceBlocks.length-1}__` })
      const sentences = safeReply.split(/(?<=[。！？\n.!?])/g).filter(s => s.trim())
      // Restore voice blocks
      const restored = sentences.map(s => s.replace(/__VOICE_(\d+)__/g, (_, idx) => voiceBlocks[parseInt(idx)]))
      let current = [...newMessages]
      for (let i = 0; i < restored.length; i++) {
        current = [...current, { role: 'assistant', content: restored[i].trim(), ts: i === 0 ? Date.now() : undefined, ...(i === 0 && data.reasoning ? { reasoning: data.reasoning } : {}) }]
        setMessages([...current])
        if (i < restored.length - 1) await new Promise(r => setTimeout(r, 600))
      }
      // 附加工具调用日志（如果有）
      if (toolLogs) {
        current = [...current, { role: 'tool_log', content: JSON.stringify(toolLogs) }]
        setMessages([...current])
      }
      if (data.reply) {
        const lastUser = newMessages[newMessages.length - 1]?.content || ''
        callMemory('hold', { content: lastUser + '\n---\n' + reply })
        // Auto emotion rating after AI reply
        try {
          const ratingCfg = getApiConfig('memory') // use memory API for cheap rating
          if (ratingCfg.apiBase && ratingCfg.apiKey) {
            const ratingRes = await fetch('/api/chat', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: [
                  { role: 'system', content: '你是情绪评分系统。分析角色"池"在这段对话后的情绪状态。输出JSON：{"word":"情绪词","backup":["词1","词2","词3"],"valence":-1到1,"arousal":0到1,"importance":1到10,"goal_relevance":-1到1,"desirability":-1到1,"interaction_type":"sweet/care/deep_talk/daily/cold/conflict","reason":"一句话"}。校准锚点：日常闲聊→valence≈0,arousal≈0.3；暖心话→v+0.3~0.6；撒娇亲昵→v+0.4~0.7；冷场→v-0.1,a0.2。严禁美化。只输出JSON。' },
                  { role: 'user', content: '用户说: ' + lastUser + '\n角色回复: ' + reply }
                ],
                apiBase: ratingCfg.apiBase, apiKey: ratingCfg.apiKey,
                model: ratingCfg.model || 'gpt-4o-mini'
              })
            })
            const rd = await ratingRes.json()
            if (rd.reply) {
              try {
                const rating = JSON.parse(rd.reply.replace(/```json?\n?|\n?```/g, '').trim())
                fetch('/api/emotion', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'rate',
                    word: rating.word, backup: rating.backup,
                    ai_v: rating.valence, ai_a: rating.arousal,
                    importance: rating.importance,
                    goal_relevance: rating.goal_relevance,
                    desirability: rating.desirability,
                    interaction_type: rating.interaction_type,
                    type: 'secondary',
                  })
                })
              } catch {}
            }
          }
        } catch {}
      }
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: '\u51fa\u9519: ' + e.message }])
    }
    
    // === 异步摘要生成 ===
    // generateSummaryAsync removed

    // Auto extract memories every 10 user messages
    try {
      const userMsgCount = messages.filter(m => m.role === 'user').length
      const lastExtract = parseInt(localStorage.getItem('pool_last_extract_count') || '0')
      if (userMsgCount - lastExtract >= 10) {
        localStorage.setItem('pool_last_extract_count', String(userMsgCount))
        extractMemory(true) // silent auto-extract
      }
    } catch {}
    setLoading(false)
  }

  function triggerAI() { sendMessage(messages) }
  function addUserMsg() {
    const t = input.trim()
    if (!t) return
    setMessages([...messages, { role: 'user', content: t }])
    setInput('')
  }

  function handleLongPress(i) { setMenuIdx(i) }
  function handleTouchStart(i) { timerRef.current = setTimeout(() => handleLongPress(i), 500) }
  function handleTouchEnd() { clearTimeout(timerRef.current) }

  function copyMsg(i) { navigator.clipboard?.writeText(messages[i].content); setMenuIdx(-1) }
  function deleteMsg(i) { setMessages(messages.filter((_, idx) => idx !== i)); setMenuIdx(-1) }
  function rollbackTo(i) { setMessages(messages.slice(0, i + 1)); setMenuIdx(-1) }
  function startEdit(i) { setEditIdx(i); setEditText(messages[i].content); setMenuIdx(-1) }
  function confirmEdit() {
    if (editIdx < 0) return
    const updated = [...messages.slice(0, editIdx), { role: messages[editIdx].role, content: editText }]
    setMessages(updated); setEditIdx(-1); setEditText('')
    if (messages[editIdx].role === 'user') sendMessage(updated)
  }

  async function insertSummary() {
    setMenuIdx(-1)
    const cfg = getApiConfig('summary')
    if (!cfg.apiBase || !cfg.apiKey) return
    // 蒸馏方案：前面的旧对话送去压缩，保留最近15轮原文
    const cutIdx = Math.max(0, messages.length - 15)
    const oldMessages = messages.slice(0, cutIdx)
    const recentMessages = messages.slice(cutIdx)
    if (oldMessages.length < 3) { alert('\u5bf9\u8bdd\u592a\u77ed\uff0c\u65e0\u9700\u538b\u7f29'); return }
    const distillPrompt = [{
      role: 'system',
      content: `你是对话压缩专家。请将以下对话历史蒸馏为结构化摘要，使用以下XML格式输出，总长度控制在800字以内：

<context_summary>
  <user_profile>用户画像：称呼、性格偏好、互动语气、语言习惯与默契</user_profile>
  <relationship_dynamic>关系背景：AI扮演角色的自然状态、专属称呼、双方建立的相处氛围</relationship_dynamic>
  <key_decisions_and_facts>关键事实：双方确认过的结论、重要事件、约定的事情、核心背景</key_decisions_and_facts>
  <active_topics_and_todos>活动焦点：被压缩那一刻正在聊的具体话题、悬而未决的事项</active_topics_and_todos>
</context_summary>

请只输出XML块，不要输出其他内容。`
    }, ...oldMessages]
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: distillPrompt, apiBase: cfg.apiBase, apiKey: cfg.apiKey, model: cfg.model }),
      })
      const data = await res.json()
      if (data.reply) {
        // 存进localStorage供API上下文注入（不显示在聊天界面）
        localStorage.setItem('pool_context_summary', data.reply)
        syncToBackend('pool_context_summary', data.reply)
        // 同时存入记忆系统
        callMemory('hold', { content: '[对话摘要] ' + data.reply })
        // 去掉旧对话，只保留最近的
        setMessages(recentMessages); 
      localStorage.removeItem('pool_ctx_summary')
      localStorage.removeItem('pool_ctx_pending_summary')
        alert(`\u2705 \u538b\u7f29\u5b8c\u6210\uff01\u65e7\u5bf9\u8bdd\u5df2\u538b\u7f29\u4e3a\u8bb0\u5fc6\uff0c\u4fdd\u7559\u6700\u8fd1 ${recentMessages.length} \u6761`)
      }
    } catch(e) { alert('\u538b\u7f29\u5931\u8d25: ' + e.message) }
    setLoading(false)
  }

  async function extractMemory(silent = false) {
    setMenuIdx(-1)
    const cfg = getApiConfig('memory')
    if (!cfg.apiBase || !cfg.apiKey) return
const memPrompt = [{ role: 'system', content: `你是记忆提取助手。请仔细阅读以下对话，尽可能多地提取值得记住的信息。包括但不限于：
- 用户提到的事件（生日、聚会、旅行等）
- 用户的喜好和习惯（喜欢吃什么、做什么）
- 人物关系（朋友、家人等）
- 情感状态和心情
- 重要决定或计划
- 地点、时间等具体细节
- 任何有趣的或值得回忆的内容

每条记忆独占一行，格式为"关键词: 内容"。尽量多提取，不要遗漏。只输出记忆条目，不要其他文字。` }, ...messages.filter(m => m.role !== 'system').slice(-30)]
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: memPrompt, apiBase: cfg.apiBase, apiKey: cfg.apiKey, model: cfg.model }),
      })
      const data = await res.json()
      if (data.reply) {
        // Parse extracted memories into entries
        const lines = data.reply.split('\n').filter(l => l.trim())
        const newEntries = lines.map(line => {
          const colonIdx = line.indexOf(':')
          const keyword = colonIdx > 0 ? line.slice(0, colonIdx).replace(/^[-*\d.]\s*/, '').trim() : line.trim()
          const content = colonIdx > 0 ? line.slice(colonIdx + 1).trim() : line.trim()
          return { keyword, content, type: 'always', id: Date.now() + Math.random(), enabled: true, source: 'ai_extracted', time: new Date().toLocaleString() }
        })

        // Add to memory entries list
        const existing = JSON.parse(localStorage.getItem('pool_memory_entries') || '[]')
        const updated = [...existing, ...newEntries]
        localStorage.setItem('pool_memory_entries', JSON.stringify(updated))
        syncToBackend('pool_memory_entries', updated)

        // Also write to Ombre Brain
        callMemory('hold', { content: data.reply })

        if (!silent) setMessages([...messages, { role: 'system', content: '[记忆已提取] ' + newEntries.length + '条新记忆已保存' }])
      }
    } catch(e) {
      if (!silent) setMessages([...messages, { role: 'system', content: '记忆提取失败: ' + e.message }])
    }
    if (!silent) setLoading(false)
  }

  function clearChat() { setMessages([]); 
      localStorage.removeItem('pool_ctx_summary')
      localStorage.removeItem('pool_ctx_pending_summary')
      localStorage.removeItem('pool_chat_history')
      // 同时清后端聊天记录
      fetch('/api/data/pool_chat_history', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({value:'[]'}) }).catch(()=>{})
      setMenuIdx(-1) }

  return (
    <div className="chat-view">
      <div className="chat-header" style={theme?.systemBg?{background:theme.systemBg}:{}}>
        <div className="chat-avatar">{theme?.avatarAI ? <img src={theme.avatarAI} className="avatar-img" /> : '\u6c60'}</div>
        <div className="chat-header-info"><div className="chat-name">{'\u6c60'}</div><div className="chat-status">{loading ? '\u601d\u8003\u4e2d...' : '\u5728\u7ebf'}</div></div>
        <div style={{marginLeft:'auto',display:'flex',gap:'8px'}}>
          <button onClick={extractMemory} style={{background:'none',border:'none',color:'#9a8a99',fontSize:'18px',cursor:'pointer'}} title={'\u63d0\u53d6\u8bb0\u5fc6'}>{'\ud83e\udde0'}</button>
          <button onClick={clearChat} style={{background:'none',border:'none',color:'#9a8a99',fontSize:'18px',cursor:'pointer'}} title={'\u6e05\u7a7a\u5bf9\u8bdd'}>{'\ud83d\uddd1'}</button>
        </div>
      </div>
      <div className="chat-messages" style={theme?.chatBg ? {backgroundImage:`url(${theme.chatBg})`,backgroundSize:'cover',backgroundPosition:'center'} : {}} onClick={() => setMenuIdx(-1)}>
        {messages.length === 0 && <div className="chat-empty">{'\u53d1\u6761\u6d88\u606f\u5f00\u59cb\u804a\u5929'}</div>}
        {visibleStart > 0 && <div style={{textAlign:'center',padding:'12px 0'}}><button onClick={() => setVisibleStart(Math.max(0, visibleStart - 20))} style={{background:'rgba(200,125,186,0.15)',border:'1px solid rgba(200,125,186,0.3)',borderRadius:'16px',color:'#c77dba',padding:'6px 20px',fontSize:'12px',cursor:'pointer'}}>{'点击加载更早的历史记录'}</button></div>}
        {messages.slice(visibleStart).map((msg, idx) => {
          const i = visibleStart + idx
          return (
          <React.Fragment key={i}>
            {shouldShowTime(messages, i) && msg.ts && <div className="msg-time-divider">{formatMsgTime(msg.ts)}</div>}
          <div className={`msg-row ${msg.role}`} onTouchStart={() => handleTouchStart(i)} onTouchEnd={handleTouchEnd} onContextMenu={e => { e.preventDefault(); handleLongPress(i) }}>
            {msg.role === 'assistant' && <div className="msg-avatar">{theme?.avatarAI ? <img src={theme.avatarAI} className="avatar-img" /> : '\u6c60'}</div>}
            {msg.role === 'user' && <div className="msg-avatar user-avatar">{theme?.avatarUser ? <img src={theme.avatarUser} className="avatar-img" /> : '\u6211'}</div>}
            {msg.role === 'tool_log' ? (
              <ToolLogBubble logs={JSON.parse(msg.content)} />
            ) : msg.role === 'system' ? (
              <div className="msg-system" style={theme?.systemMsgBg||theme?.systemMsgText||theme?.systemMsgBorder?{background:theme.systemMsgBg||undefined,color:theme.systemMsgText||undefined,borderColor:theme.systemMsgBorder||undefined}:{}}>{msg.content}</div>
            ) : editIdx === i ? (
              <div className="msg-edit-wrap">
                <textarea className="msg-edit-input" value={editText} onChange={e => setEditText(e.target.value)} />
                <div className="msg-edit-btns"><button onClick={confirmEdit}>{'\u2713'}</button><button onClick={() => setEditIdx(-1)}>{'\u2717'}</button></div>
              </div>
            ) : (
              <div className={`msg-bubble ${msg.role}`} style={msg.role==='user'?{background:theme?.bubbleUser||undefined,color:theme?.textUser||undefined}:msg.role==='assistant'?{background:theme?.bubbleAI||undefined,color:theme?.textAI||undefined}:{}}>
{msg.content.includes('[voice]') && msg.content.includes('[/voice]') && /\[voice\].*?\[\/voice\]/s.test(msg.content) ? 
                  msg.content.split(/\[voice\]([\s\S]*?)\[\/voice\]/g).map((part,j) => j%2===0 ? (part ? <span key={j}>{part}</span> : null) : <VoiceBubble key={j} text={part} />) 
                : msg.content.includes('[img]') ? msg.content.split(/\[img\](.*?)\[\/img\]/g).map((part,j) => j%2===0 ? part : <img key={j} src={part} style={{maxWidth:'180px',borderRadius:'8px',display:'block',marginTop:'4px'}} />) : msg.content}
              </div>
            )}
            {menuIdx === i && msg.role !== 'system' && (
              <div className="msg-menu">
                <button onClick={() => copyMsg(i)}>{'\ud83d\udccb \u590d\u5236'}</button>
                <button onClick={() => startEdit(i)}>{'\u270f\ufe0f \u7f16\u8f91'}</button>
                <button onClick={() => rollbackTo(i)}>{'\u23ea \u56de\u6eda\u5230\u6b64'}</button>
                <button onClick={insertSummary}>{'\ud83d\udcdd \u63d2\u5165\u603b\u7ed3'}</button>
                <button onClick={() => deleteMsg(i)}>{'\ud83d\uddd1 \u5220\u9664'}</button>
              </div>
            )}
          </div>
          {msg.role === 'assistant' && msg.reasoning && <ThinkingToggle reasoning={msg.reasoning} />}
          </React.Fragment>
        )})}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area" style={theme?.systemBg?{background:theme.systemBg}:{}}>
        <label className="chat-plus-btn">{'+'}
          <input type="file" accept="image/*" hidden onChange={e => {
            const file = e.target.files[0]; if (!file) return
            e.target.value = ''
            const reader = new FileReader()
            reader.onload = () => {
              const base64 = reader.result
              // First show image immediately
              setMessages(m => [...m, {role:'user',content:`[img]${base64}[/img]`}])
              // Then try to upload to backend and replace with URL
              fetch('/api/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: base64 }) })
                .then(r => r.json())
                .then(d => {
                  if (d.url) {
                    setMessages(prev => prev.map(msg =>
                      msg.content === `[img]${base64}[/img]` ? {...msg, content: `[img]${d.url}[/img]`} : msg
                    ))
                  }
                }).catch(() => {})
            }
            reader.readAsDataURL(file)
          }} />
        </label>
        <button className="chat-plus-btn" onClick={() => setShowEmoji(!showEmoji)} style={{fontSize:'16px'}}>{'\ud83d\ude0a'}</button>
        <input className="chat-input" style={theme?.inputBg?{background:theme.inputBg}:{}} value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addUserMsg() } }}
          placeholder={'\u8f93\u5165\u6d88\u606f...'} disabled={loading} />
        <button className="chat-send" onClick={() => addUserMsg()} disabled={loading || !input.trim()}>{'\u27a4'}</button>
        <button className="chat-trigger" onClick={triggerAI} disabled={loading}>{loading ? '...' : '\u2728'}</button>
      </div>
      {showEmoji && <div className="emoji-panel">
        {EMOJI_LIST.map(e => <span key={e} className="emoji-item" onClick={() => { setInput(input + e); setShowEmoji(false) }}>{e}</span>)}
        <label className="emoji-item" style={{fontSize:'16px',border:'1px dashed #555',borderRadius:'6px',display:'flex',alignItems:'center',justifyContent:'center',width:'30px',height:'30px'}}>
          {'+'}
          <input type="file" accept="image/*" hidden onChange={e => {
            const file = e.target.files[0]; if (!file) return
            const reader = new FileReader()
            reader.onload = () => { setMessages(m => [...m, {role:'user',content:`[img]${reader.result}[/img]`}]); setShowEmoji(false) }
            reader.readAsDataURL(file)
            e.target.value = ''
          }} />
        </label>
      </div>}
    </div>
  )
}
function LockScreen({ onUnlock, theme }) {
  const [touchStart, setTouchStart] = useState(null)
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const days = ['\u5468\u65e5','\u5468\u4e00','\u5468\u4e8c','\u5468\u4e09','\u5468\u56db','\u5468\u4e94','\u5468\u516d']
  const dateStr = `${now.getMonth()+1}\u6708${now.getDate()}\u65e5 ${days[now.getDay()]}`

  function handleTouchStart(e) { setTouchStart(e.touches[0].clientY) }
  function handleTouchEnd(e) {
    if (touchStart !== null) { if (touchStart - e.changedTouches[0].clientY > 60) onUnlock() }
    setTouchStart(null)
  }

  const lockStyle = theme?.lockWallpaper ? { backgroundImage: `url(${theme.lockWallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}

  return (
    <div className="lock-screen" style={lockStyle} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onClick={onUnlock}>
      <div className="lock-time">{timeStr}</div>
      <div className="lock-date">{dateStr}</div>
      <div className="lock-quote">{'\u201c\u9501\u5c4f\u5199\u7740\u60f3\u4f60 \u5176\u5b9e\u662f\u6015\u4f60\u70ed\u7740\u201d'}</div>
      <div className="lock-hint">{'\u25b2 \u70b9\u51fb\u89e3\u9501'}</div>
    </div>
  )
}

function ThemePanel() {
  const [theme, setTheme] = useState(() => JSON.parse(localStorage.getItem('pool_theme') || '{}'))
  const [saved, setSaved] = useState(false)
  const APP_LIST = ['notes','gallery','messages','music','browser','couple','system','doodle','ledger','drafts','fishing','reader','game','theme','travel','memoryMgr','diary','garden','cabin','starmap']
  const APP_NAMES = {notes:'\u4fbf\u7b7e',gallery:'\u547d\u8fd0\u5361\u6c60',messages:'\u5982\u679c\u2026',music:'\u97f3\u4e50',browser:'\u6d4f\u89c8',couple:'\u60c5\u4fa3\u7a7a\u95f4',system:'\u7cfb\u7edf',doodle:'\u6d82\u9e26',ledger:'\u8d26\u672c',drafts:'\u8349\u7a3f\u7bb1',fishing:'\u94d3\u9c7c',reader:'\u9605\u8bfb',game:'\u756a\u8304\u949f',theme:'\u7f8e\u5316',travel:'\u65c5\u884c',memoryMgr:'\u8bb0\u5fc6\u7ba1\u7406',diary:'\u65e5\u8bb0',garden:'\u5ead\u9662',cabin:'唤醒日志',starmap:'\u661f\u56fe', dwell:'\u804a\u5929'}

  function save() {
    try {
      localStorage.setItem('pool_theme', JSON.stringify(theme))
      syncToBackend('pool_theme', theme)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      window.dispatchEvent(new Event('theme-changed'))
    } catch(e) {
      if (e.name === 'QuotaExceededError') {
        alert('\u5b58\u50a8\u7a7a\u95f4\u4e0d\u8db3\uff01\u8bf7\u51cf\u5c11\u56fe\u7247\u6570\u91cf\u6216\u4f7f\u7528URL\u4ee3\u66ff\u4e0a\u4f20')
      } else { alert('\u4fdd\u5b58\u5931\u8d25: ' + e.message) }
    }
  }

  const [showPresets, setShowPresets] = useState(false)
  const [presetNames, setPresetNames] = useState([])
  const [presetInput, setPresetInput] = useState('')
  const [showPresetSave, setShowPresetSave] = useState(false)
  useEffect(() => { if (showPresets) { try { const p = JSON.parse(localStorage.getItem('pool_theme_presets') || '{}'); setPresetNames(Object.keys(p)) } catch {} } }, [showPresets])

  function savePreset() {
    if (!showPresetSave) { setShowPresetSave(true); return }
    const name = presetInput.trim()
    if (!name) return
    const lite = {...theme}
    delete lite.icons
    // Strip all base64 data URIs to save space
    for (const k of Object.keys(lite)) {
      if (typeof lite[k] === 'string' && lite[k].startsWith('data:')) delete lite[k]
    }
    // Save to both localStorage and backend
    try {
      const existing = JSON.parse(localStorage.getItem('pool_theme_presets') || '{}')
      existing[name] = lite
      localStorage.setItem('pool_theme_presets', JSON.stringify(existing))
      syncToBackend('pool_theme_presets', existing)
      setPresetNames(Object.keys(existing))
      setShowPresets(true)
      setShowPresetSave(false)
      setPresetInput('')
    } catch (e) {
      alert('\u4fdd\u5b58\u5931\u8d25: ' + e.message)
    }
  }

  function loadPreset(name) {
    try {
      const presets = JSON.parse(localStorage.getItem('pool_theme_presets') || '{}')
      if (presets[name]) { setTheme(presets[name]); setShowPresets(false) }
    } catch {}
  }

  function deletePreset(name) {
    try {
      const presets = JSON.parse(localStorage.getItem('pool_theme_presets') || '{}')
      delete presets[name]
      localStorage.setItem('pool_theme_presets', JSON.stringify(presets))
      syncToBackend('pool_theme_presets', presets)
      setPresetNames(Object.keys(presets))
    } catch {}
  }

  function handleImageUpload(key, e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: reader.result }) })
        const d = await res.json()
        if (d.url) setTheme(t => ({...t, [key]: d.url}))
        else setTheme(t => ({...t, [key]: reader.result})) // fallback
      } catch { setTheme(t => ({...t, [key]: reader.result})) }
    }
    reader.readAsDataURL(file)
  }

  function handleUrlInput(key, url) { setTheme(t => ({...t, [key]: url})) }

  function setNested(group, key, val) {
    setTheme(t => ({...t, [group]: {...(t[group]||{}), [key]: val}}))
  }

  function handleNestedUpload(group, key, e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      // Upload original quality - no compression needed since stored on backend
      try {
        const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: reader.result }) })
        const d = await res.json()
        if (d.url) setNested(group, key, d.url)
        else setNested(group, key, reader.result)
      } catch { setNested(group, key, reader.result) }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="settings-panel">
      <div className="settings-section">
        <h3 className="settings-title">{'\ud83d\udc64 \u5934\u50cf'}</h3>
        <div className="theme-item">
          <label>{'\u6211\u7684\u5934\u50cf'}</label>
          <input className="settings-input" value={theme.avatarUser||''} onChange={e=>handleUrlInput('avatarUser',e.target.value)} placeholder={'URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('avatarUser',e)} hidden /></label>
          {theme.avatarUser && <img src={theme.avatarUser} className="theme-preview-sm" />}
        </div>
        <div className="theme-item">
          <label>{'AI\u5934\u50cf'}</label>
          <input className="settings-input" value={theme.avatarAI||''} onChange={e=>handleUrlInput('avatarAI',e.target.value)} placeholder={'URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('avatarAI',e)} hidden /></label>
          {theme.avatarAI && <img src={theme.avatarAI} className="theme-preview-sm" />}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\ud83c\udfa8 \u58c1\u7eb8'}</h3>
        <div className="theme-item">
          <label>{'\u4e3b\u5c4f\u58c1\u7eb8'}</label>
          <input className="settings-input" value={theme.wallpaper||''} onChange={e=>handleUrlInput('wallpaper',e.target.value)} placeholder={'\u8d34\u5165\u56fe\u7247URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('wallpaper',e)} hidden /></label>
          {theme.wallpaper && <img src={theme.wallpaper} className="theme-preview" />}
        </div>
        <div className="theme-item">
          <label>{'\u9501\u5c4f\u58c1\u7eb8'}</label>
          <input className="settings-input" value={theme.lockWallpaper||''} onChange={e=>handleUrlInput('lockWallpaper',e.target.value)} placeholder={'\u8d34\u5165\u56fe\u7247URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('lockWallpaper',e)} hidden /></label>
          {theme.lockWallpaper && <img src={theme.lockWallpaper} className="theme-preview" />}
        </div>
        <div className="theme-item">
          <label>{'\u804a\u5929\u80cc\u666f'}</label>
          <input className="settings-input" value={theme.chatBg||''} onChange={e=>handleUrlInput('chatBg',e.target.value)} placeholder={'\u8d34\u5165\u56fe\u7247URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('chatBg',e)} hidden /></label>
          {theme.chatBg && <img src={theme.chatBg} className="theme-preview" />}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\ud83c\udfc0 \u684c\u9762\u5361\u7247'}</h3>
        <div className="theme-item">
          <label>{'\u9876\u90e8Banner\u56fe'}</label>
          <input className="settings-input" value={theme.bannerImg||''} onChange={e=>handleUrlInput('bannerImg',e.target.value)} placeholder={'URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('bannerImg',e)} hidden /></label>
          {theme.bannerImg && <img src={theme.bannerImg} className="theme-preview" />}
        </div>
        <div className="theme-item">
          <label>{'\u60c5\u4fa3\u5361\u7247\u80cc\u666f'}</label>
          <input className="settings-input" value={theme.coupleBg||''} onChange={e=>handleUrlInput('coupleBg',e.target.value)} placeholder={'URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('coupleBg',e)} hidden /></label>
          {theme.coupleBg && <img src={theme.coupleBg} className="theme-preview" />}
        </div>
        <div className="theme-item">
          <label>{'\u97f3\u4e50\u5361\u7247\u80cc\u666f'}</label>
          <input className="settings-input" value={theme.musicCardBg||''} onChange={e=>handleUrlInput('musicCardBg',e.target.value)} placeholder={'\u989c\u8272\u4ee3\u7801\u6216\u56fe\u7247URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('musicCardBg',e)} hidden /></label>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\ud83c\udf3c \u7b2c\u4e09\u9875\u5361\u7247'}</h3>
        <div className="theme-item">
          <label>{'\u957f\u5361\u7247\u80cc\u666f'}</label>
          <input className="settings-input" value={theme.decoTallBg||''} onChange={e=>handleUrlInput('decoTallBg',e.target.value)} placeholder={'\u989c\u8272\u6216URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('decoTallBg',e)} hidden /></label>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\ud83d\udcf7 \u7167\u7247\u5899'}</h3>
        <p className="settings-desc">{'\u7b2c\u4e8c\u9875\u5e95\u90e8\u7684\u62cd\u7acb\u5f97\u7167\u7247\u5899\uff0c\u53ef\u653e3\u5f20\u56fe\u7247'}</p>
        <div className="theme-item">
          <label>{'\u7167\u72471'}</label>
          <input className="settings-input" value={theme.polaroid1||''} onChange={e=>handleUrlInput('polaroid1',e.target.value)} placeholder={'URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('polaroid1',e)} hidden /></label>
          {theme.polaroid1 && <img src={theme.polaroid1} className="theme-preview-sm" />}
        </div>
        <div className="theme-item">
          <label>{'\u6807\u98981'}</label>
          <input className="settings-input" value={theme.polaroidCaption1||''} onChange={e=>handleUrlInput('polaroidCaption1',e.target.value)} placeholder={'\u5199\u70b9\u4ec0\u4e48...'} />
        </div>
        <div className="theme-item">
          <label>{'\u7167\u72472'}</label>
          <input className="settings-input" value={theme.polaroid2||''} onChange={e=>handleUrlInput('polaroid2',e.target.value)} placeholder={'URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('polaroid2',e)} hidden /></label>
          {theme.polaroid2 && <img src={theme.polaroid2} className="theme-preview-sm" />}
        </div>
        <div className="theme-item">
          <label>{'\u6807\u98982'}</label>
          <input className="settings-input" value={theme.polaroidCaption2||''} onChange={e=>handleUrlInput('polaroidCaption2',e.target.value)} placeholder={'\u5199\u70b9\u4ec0\u4e48...'} />
        </div>
        <div className="theme-item">
          <label>{'\u7167\u72473'}</label>
          <input className="settings-input" value={theme.polaroid3||''} onChange={e=>handleUrlInput('polaroid3',e.target.value)} placeholder={'URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('polaroid3',e)} hidden /></label>
          {theme.polaroid3 && <img src={theme.polaroid3} className="theme-preview-sm" />}
        </div>
        <div className="theme-item">
          <label>{'\u6807\u98983'}</label>
          <input className="settings-input" value={theme.polaroidCaption3||''} onChange={e=>handleUrlInput('polaroidCaption3',e.target.value)} placeholder={'\u5199\u70b9\u4ec0\u4e48...'} />
        </div>
      </div>
      <div className="settings-section">
        <h3 className="settings-title">{'\ud83c\udf08 \u4e3b\u9898\u8272'}</h3>
        <div className="theme-color-row">
          <label>{'\u5f3a\u8c03\u8272'}</label>
          <input type="color" value={theme.accentColor||'#e8a0bf'} onChange={e=>setTheme(t=>({...t,accentColor:e.target.value}))} />
          <span>{theme.accentColor||'#e8a0bf'}</span>
        </div>
        <div className="theme-color-row">
          <label>{'\u6c14\u6ce1\u8272(\u6211)'}</label>
          <input type="color" value={theme.bubbleUser||'#c77dba'} onChange={e=>setTheme(t=>({...t,bubbleUser:e.target.value}))} />
          <span>{theme.bubbleUser||'#c77dba'}</span>
        </div>
        <div className="theme-color-row">
          <label>{'\u6c14\u6ce1\u8272(AI)'}</label>
          <input type="color" value={theme.bubbleAI||'#1f1f1f'} onChange={e=>setTheme(t=>({...t,bubbleAI:e.target.value}))} />
          <span>{theme.bubbleAI||'#1f1f1f'}</span>
        </div>
        <div className="theme-color-row">
          <label>{'\u5b57\u4f53\u8272(\u6211)'}</label>
          <input type="color" value={theme.textUser||'#ffffff'} onChange={e=>setTheme(t=>({...t,textUser:e.target.value}))} />
          <span>{theme.textUser||'#ffffff'}</span>
        </div>
        <div className="theme-color-row">
          <label>{'\u5b57\u4f53\u8272(AI)'}</label>
          <input type="color" value={theme.textAI||'#e0e0e0'} onChange={e=>setTheme(t=>({...t,textAI:e.target.value}))} />
          <span>{theme.textAI||'#e0e0e0'}</span>
        </div>
        <div className="theme-color-row">
          <label>{'\u7cfb\u7edf\u680f\u80cc\u666f'}</label>
          <input type="color" value={theme.systemBg||'#111111'} onChange={e=>setTheme(t=>({...t,systemBg:e.target.value}))} />
          <span>{theme.systemBg||'#111111'}</span>
        </div>
        <div className="theme-color-row">
          <label>{'\u8f93\u5165\u6846\u80cc\u666f'}</label>
          <input type="color" value={theme.inputBg||'#1a1a1a'} onChange={e=>setTheme(t=>({...t,inputBg:e.target.value}))} />
          <span>{theme.inputBg||'#1a1a1a'}</span>
        </div>
        <div className="theme-color-row">
          <label>{'\u97f3\u4e50\u5361\u5b57\u8272'}</label>
          <input type="color" value={theme.musicTextColor||'#e0e0e0'} onChange={e=>setTheme(t=>({...t,musicTextColor:e.target.value}))} />
          <span>{theme.musicTextColor||'#e0e0e0'}</span>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\ud83d\udcac \u7893\u7893\u5ff5/\u7cfb\u7edf\u6d88\u606f'}</h3>
        <div className="theme-color-row">
          <label>{'\u80cc\u666f\u8272'}</label>
          <input type="color" value={theme.systemMsgBg||'#1a1a2e'} onChange={e=>setTheme(t=>({...t,systemMsgBg:e.target.value}))} />
          <span>{theme.systemMsgBg||'#1a1a2e'}</span>
        </div>
        <div className="theme-color-row">
          <label>{'\u5b57\u4f53\u8272'}</label>
          <input type="color" value={theme.systemMsgText||'#9a8a99'} onChange={e=>setTheme(t=>({...t,systemMsgText:e.target.value}))} />
          <span>{theme.systemMsgText||'#9a8a99'}</span>
        </div>
        <div className="theme-color-row">
          <label>{'\u8fb9\u6846\u8272'}</label>
          <input type="color" value={theme.systemMsgBorder||'#333333'} onChange={e=>setTheme(t=>({...t,systemMsgBorder:e.target.value}))} />
          <span>{theme.systemMsgBorder||'#333333'}</span>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\ud83d\uddbc\ufe0f App\u56fe\u6807'}</h3>
        <p className="settings-desc">{'\u6bcf\u4e2aApp\u53ef\u5355\u72ec\u6362\u56fe\u6807\uff08\u652f\u6301URL\u6216\u4e0a\u4f20\uff09'}</p>
        {APP_LIST.map(id => (
          <div key={id} className="theme-icon-row">
            <span className="theme-icon-name">{APP_NAMES[id]}</span>
            <input className="settings-input theme-icon-input" value={(theme.icons||{})[id]||''} onChange={e=>setNested('icons',id,e.target.value)} placeholder={'URL...'} />
            <label className="theme-upload-sm">{'\ud83d\udcf7'}<input type="file" accept="image/*" onChange={e=>handleNestedUpload('icons',id,e)} hidden /></label>
          </div>
        ))}
      </div>

      <button className="settings-save" onClick={save}>{saved ? '\u2713 \u5df2\u4fdd\u5b58' : '\u4fdd\u5b58\u4e3b\u9898'}</button>
      <div style={{display:'flex',gap:'8px',marginTop:'8px'}}>
        <button className="settings-save" style={{flex:1,background:'#f0e8f0',fontSize:'13px'}} onClick={savePreset}>{'\ud83d\udcbe \u5b58\u4e3a\u9884\u8bbe'}</button>
        <button className="settings-save" style={{flex:1,background:'#f0e8f0',fontSize:'13px'}} onClick={() => setShowPresets(!showPresets)}>{'\ud83d\udcc2 \u52a0\u8f7d\u9884\u8bbe'}</button>
      </div>
      {showPresetSave && <div style={{marginTop:'8px',display:'flex',gap:'8px'}}>
        <input className="settings-input" value={presetInput} onChange={e => setPresetInput(e.target.value)} placeholder={'给这个主题起个名字...'} style={{flex:1}} />
        <button onClick={() => setShowPresetSave(false)} style={{background:'none',border:'1px solid #ddd',borderRadius:'8px',color:'#999',padding:'8px 12px',cursor:'pointer'}}>{'取消'}</button>
      </div>}
      {showPresets && (<div style={{marginTop:'8px',background:'#f0ecf0',borderRadius:'8px',padding:'8px'}}>
          {presetNames.length === 0 ? <div style={{color:'#666',fontSize:'12px',textAlign:'center'}}>{'\u6ca1\u6709\u4fdd\u5b58\u7684\u9884\u8bbe'}</div> :
          presetNames.map(n => (
            <div key={n} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 8px',borderBottom:'1px solid #e8dce8'}}>
              <span style={{color:'#333',fontSize:'13px',cursor:'pointer',flex:1}} onClick={() => loadPreset(n)}>{n}</span>
              <button style={{background:'#c44',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 8px',fontSize:'11px',cursor:'pointer'}} onClick={() => deletePreset(n)}>{'\u5220'}</button>
            </div>
          ))}
        </div>)}
    </div>
  )
}

function McpPanel() {
  const [conns, setConns] = useState(() => { try { return JSON.parse(localStorage.getItem('pool_mcp_connections') || '[]') } catch { return [] } })
  const [newUrl, setNewUrl] = useState('')
  const [newToken, setNewToken] = useState('')
  const [newName, setNewName] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  function save(c) { setConns(c); localStorage.setItem('pool_mcp_connections', JSON.stringify(c)); syncToBackend('pool_mcp_connections', c) }
  return (
    <div className="settings-section" style={{marginTop:'20px'}}>
      <h3 className="settings-title">{'🔗 MCP 连接'}</h3>
      <p className="settings-desc">{'连接外部MCP服务，让AI获得更多工具'}</p>
      {(Array.isArray(conns)?conns:[]).map((conn, i) => (
        <div key={conn.id||i} style={{background:'rgba(255,255,255,0.05)',borderRadius:'8px',padding:'10px',marginTop:'8px',border:'1px solid rgba(255,255,255,0.1)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:'bold',fontSize:'13px'}}>{conn.name||conn.url}</span>
            <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
              <label style={{fontSize:'11px',display:'flex',alignItems:'center',gap:'4px'}}>
                <input type="checkbox" checked={conn.enabled!==false} onChange={e=>{ const nc=[...conns]; nc[i]={...nc[i],enabled:e.target.checked}; save(nc) }} />
                {'启用'}
              </label>
              <button style={{background:'#c44',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 8px',fontSize:'11px',cursor:'pointer'}} onClick={()=>save(conns.filter((_,j)=>j!==i))}>{'删除'}</button>
            </div>
          </div>
          <div style={{fontSize:'11px',color:'#999',marginTop:'4px',wordBreak:'break-all'}}>{conn.url}</div>
        </div>
      ))}
      <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'8px'}}>
        <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="名称" className="settings-input" style={{fontSize:'13px'}}/>
        <input value={newUrl} onChange={e=>setNewUrl(e.target.value)} placeholder="MCP URL (https://...)" className="settings-input" style={{fontSize:'13px'}}/>
        <input value={newToken} onChange={e=>setNewToken(e.target.value)} placeholder="Token" className="settings-input" type="password" style={{fontSize:'13px'}}/>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="settings-save" style={{flex:1,fontSize:'12px',padding:'8px'}} onClick={async()=>{
            if(!newUrl){alert('请填URL');return}
            setTesting(true);setTestResult('')
            try{
              const r=await fetch('/api/mcp-proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test_connection',url:newUrl,token:newToken})})
              const d=await r.json()
              if(d.success) setTestResult('✅ '+d.toolCount+' tools')
              else setTestResult('❌ '+(d.error||'failed'))
            }catch(e){setTestResult('❌ '+e.message)}
            setTesting(false)
          }}>{testing?'...':'测试'}</button>
          <button className="settings-save" style={{flex:1,fontSize:'12px',padding:'8px'}} onClick={()=>{
            if(!newUrl){alert('请填URL');return}
            save([...conns,{id:Date.now().toString(36),name:newName||'MCP',url:newUrl,token:newToken,enabled:true}])
            setNewUrl('');setNewToken('');setNewName('');setTestResult('')
          }}>{'添加'}</button>
        </div>
        {testResult && <div style={{fontSize:'12px',padding:'6px',background:'rgba(255,255,255,0.05)',borderRadius:'4px',marginTop:'4px'}}>{testResult}</div>}
      </div>
    </div>
  )
}

function SettingsPanel() {
  const FEATURES = [
    { key: 'chat', label: '\u5bf9\u8bdd\u529f\u80fd', desc: '\u4e3b\u8981\u7684AI\u5bf9\u8bdd' },
    { key: 'tools', label: '\u5de5\u5177\u8c03\u7528', desc: '\u5de5\u5177\u6267\u884c\u65f6\u7684AI\u5224\u65ad\uff08\u53ef\u7528\u66f4\u4fbf\u5b9c\u7684\u6a21\u578b\uff09' },
    { key: 'summary', label: '\u4e0a\u4e0b\u6587\u603b\u7ed3', desc: '\u538b\u7f29\u4e0a\u4e0b\u6587\uff0c\u751f\u6210\u6458\u8981' },
    { key: 'memory', label: '\u8bb0\u5fc6\u63d0\u53d6', desc: '\u4ece\u5bf9\u8bdd\u4e2d\u63d0\u53d6\u5173\u952e\u4fe1\u606f' },
    { key: 'wakeup', label: '\u5524\u9192\u6a21\u578b', desc: '\u81ea\u4e3b\u5524\u9192\u65f6\u4f7f\u7528\uff08\u9700\u652f\u6301tools\uff09' },
  ]
  const [configs, setConfigs] = useState(() => JSON.parse(localStorage.getItem('pool_api_configs') || '{}'))
  const [defaultCfg, setDefaultCfg] = useState(() => JSON.parse(localStorage.getItem('pool_api_config') || '{}'))
  const [modelList, setModelList] = useState([])
  const [ttsConfig, setTtsConfig] = useState(() => JSON.parse(localStorage.getItem('pool_tts_config') || '{}'))
  const [expandedKey, setExpandedKey] = useState(null)
  const [saved, setSaved] = useState(false)
  // MCP state
  const [mcpTab, setMcpTab] = useState('breath')
  const [mcpResult, setMcpResult] = useState('')
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpInput, setMcpInput] = useState('')


  const [injectCfg, setInjectCfg] = useState(() => JSON.parse(localStorage.getItem('pool_inject_config') || '{"time":true,"battery":true,"weather":true}'))

  function saveAll() {
    localStorage.setItem('pool_api_config', JSON.stringify(defaultCfg))
    localStorage.setItem('pool_api_configs', JSON.stringify(configs))
    localStorage.setItem('pool_tts_config', JSON.stringify(ttsConfig))

    localStorage.setItem('pool_inject_config', JSON.stringify(injectCfg))
    // Sync configs to backend so wakeup scheduler can read them
    syncToBackend('pool_api_config', defaultCfg)
    syncToBackend('pool_api_configs', configs)
    syncToBackend('pool_tts_config', ttsConfig)
    syncToBackend('pool_inject_config', injectCfg)
    // Sync wakeup-compatible config (wakeup.js reads baseUrl, frontend stores apiBase)
    const wkCfg = configs['wakeup'] || {}
    const chatCfg = configs['chat'] || {}
    const rawBase = wkCfg.apiBase || chatCfg.apiBase || defaultCfg.apiBase || ''
    const wakeupCfg = {
      baseUrl: rawBase && !rawBase.endsWith('/v1') ? rawBase.replace(/\/$/, '') + '/v1' : rawBase,
      apiKey: wkCfg.apiKey || chatCfg.apiKey || defaultCfg.apiKey || '',
      model: wkCfg.model || chatCfg.model || defaultCfg.model || ''
    }
    syncToBackend('pool_api_config_chat', wakeupCfg)
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  async function mcpAction(action, params) {
    setMcpLoading(true); setMcpResult('')
    try {
      const res = await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, params }) })
      const data = await res.json()
      if (data.result && data.result.content && data.result.content[0]) {
        setMcpResult(data.result.content[0].text || JSON.stringify(data.result))
      } else if (data.error) {
        setMcpResult('Error: ' + (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)))
      } else {
        setMcpResult(JSON.stringify(data, null, 2))
      }
    } catch (e) { setMcpResult('Error: ' + e.message) }
    setMcpLoading(false)
  }

  function updateFeature(key, field, value) {
    setConfigs({ ...configs, [key]: { ...(configs[key] || {}), [field]: value } })
  }

  function getEffective(key) {
    const fc = configs[key] || {}
    return { apiBase: fc.apiBase || defaultCfg.apiBase || '', apiKey: fc.apiKey || defaultCfg.apiKey || '', model: fc.model || defaultCfg.model || '' }
  }

  return (
    <div className="settings-panel">
      <div className="settings-section">
        <h3 className="settings-title">{'\u2699\ufe0f \u9ed8\u8ba4API\u914d\u7f6e'}</h3>
        <p className="settings-desc">{'\u672a\u5355\u72ec\u914d\u7f6e\u7684\u529f\u80fd\u4f1a\u7528\u8fd9\u4e2a'}</p>
        <div className="settings-item"><label>API Base URL</label>
          <input value={defaultCfg.apiBase||''} onChange={e=>setDefaultCfg({...defaultCfg,apiBase:e.target.value})} placeholder="https://api.example.com" className="settings-input"/></div>
        <div className="settings-item"><label>API Key</label>
          <input type="password" value={defaultCfg.apiKey||''} onChange={e=>setDefaultCfg({...defaultCfg,apiKey:e.target.value})} placeholder="sk-..." className="settings-input"/></div>
        <div className="settings-item"><label>{'\u6a21\u578b'}</label>
          <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
            <input value={defaultCfg.model||''} onChange={e=>setDefaultCfg({...defaultCfg,model:e.target.value})} placeholder="gpt-4o-mini" className="settings-input" style={{flex:1}}/>
            <button className="fetch-models-btn" onClick={async()=>{
              if(!defaultCfg.apiBase||!defaultCfg.apiKey){alert('\u8bf7\u5148\u586b\u5199API Base\u548cKey');return}
              try{
                const r=await fetch('/api/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiBase:defaultCfg.apiBase,apiKey:defaultCfg.apiKey})})
                const d=await r.json()
                if(d.models&&d.models.length){setModelList(d.models)}else{alert('\u672a\u627e\u5230\u6a21\u578b')}
              }catch(e){alert('\u62c9\u53d6\u5931\u8d25: '+e.message)}
            }}>{'\u62c9\u53d6'}</button>
          </div>
          {modelList.length>0 && <div style={{maxHeight:'150px',overflow:'auto',background:'#f0ecf0',borderRadius:'6px',marginTop:'6px'}}>
            {modelList.map(m=><div key={m} style={{padding:'6px 10px',color:'#e0e0e0',fontSize:'12px',cursor:'pointer',borderBottom:'1px solid #e8dce8'}} onClick={()=>{setDefaultCfg({...defaultCfg,model:m});setModelList([])}}>{m}</div>)}
          </div>}
        </div>
      </div>

      {FEATURES.map(f => {
        const fc = configs[f.key] || {}
        const eff = getEffective(f.key)
        const isExpanded = expandedKey === f.key
        const hasCustom = fc.apiBase || fc.apiKey || fc.model
        return (
          <div key={f.key} className="settings-section">
            <div className="settings-feature-header" onClick={() => setExpandedKey(isExpanded ? null : f.key)}>
              <div><strong>{f.label}</strong><br/><span className="settings-desc">{f.desc}</span>
                {hasCustom && <span className="settings-badge">{'\u2022 \u5df2\u5355\u72ec\u914d\u7f6e'}</span>}
                {!hasCustom && <span className="settings-badge-default">{'\u2192 \u7528\u9ed8\u8ba4'}</span>}
              </div>
              <span className="settings-arrow">{isExpanded ? '\u25b2' : '\u25bc'}</span>
            </div>
            {isExpanded && (
              <div className="settings-feature-body">
                <div className="settings-item"><label>API Base URL {!fc.apiBase && '(\u7ee7\u627f\u9ed8\u8ba4)'}</label>
                  <input value={fc.apiBase||''} onChange={e=>updateFeature(f.key,'apiBase',e.target.value)} placeholder={defaultCfg.apiBase||'https://...'} className="settings-input"/></div>
                <div className="settings-item"><label>API Key {!fc.apiKey && '(\u7ee7\u627f\u9ed8\u8ba4)'}</label>
                  <input type="password" value={fc.apiKey||''} onChange={e=>updateFeature(f.key,'apiKey',e.target.value)} placeholder={fc.apiKey?'':'(\u7ee7\u627f\u9ed8\u8ba4)'} className="settings-input"/></div>
                <div className="settings-item"><label>{'\u6a21\u578b'} {!fc.model && '(\u7ee7\u627f\u9ed8\u8ba4)'}</label>
                  <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                    <input value={fc.model||''} onChange={e=>updateFeature(f.key,'model',e.target.value)} placeholder={defaultCfg.model||'gpt-4o-mini'} className="settings-input" style={{flex:1}}/>
                    <button className="fetch-models-btn" onClick={async()=>{
                      const eff=getEffective(f.key)
                      if(!eff.apiBase||!eff.apiKey){alert('\u8bf7\u5148\u914d\u7f6eAPI');return}
                      try{
                        const r=await fetch('/api/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiBase:eff.apiBase,apiKey:eff.apiKey})})
                        const d=await r.json()
                        if(d.models&&d.models.length){setModelList(d.models)}else{alert('\u672a\u627e\u5230')}
                      }catch(e){alert(e.message)}
                    }}>{'\u62c9\u53d6'}</button>
                  </div>
                  {modelList.length>0 && <div style={{maxHeight:'120px',overflow:'auto',background:'#f0ecf0',borderRadius:'6px',marginTop:'4px'}}>
                    {modelList.map(m=><div key={m} style={{padding:'5px 8px',color:'#e0e0e0',fontSize:'11px',cursor:'pointer',borderBottom:'1px solid #e8dce8'}} onClick={()=>{updateFeature(f.key,'model',m);setModelList([])}}>{m}</div>)}
                  </div>}
                </div>
                {hasCustom && <button className="settings-reset" onClick={() => { const c = {...configs}; delete c[f.key]; setConfigs(c) }}>{'\u91cd\u7f6e\u4e3a\u9ed8\u8ba4'}</button>}
              </div>
            )}
          </div>
        )
      })}

      <div className="settings-section" style={{marginTop:'20px'}}>
        <h3 className="settings-title">{'\ud83c\udfb5 \u8bed\u97f3\u751f\u6210'}</h3>
        <p className="settings-desc">{'\u914d\u7f6eMiniMax\u7b49TTS\u670d\u52a1'}</p>
        <div className="settings-item"><label>{'\u542f\u7528\u8bed\u97f3\u751f\u6210'}</label>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <input type="checkbox" checked={ttsConfig.enabled||false} onChange={e=>setTtsConfig(c=>({...c,enabled:e.target.checked}))} />
            <span style={{color:'#aaa',fontSize:'12px'}}>{ttsConfig.enabled?'\u5df2\u542f\u7528':'\u672a\u542f\u7528'}</span>
          </div>
        </div>
        <div className="settings-item"><label>{'Group ID'}</label>
          <input value={ttsConfig.groupId||''} onChange={e=>setTtsConfig(c=>({...c,groupId:e.target.value}))} placeholder="19903205627689XXXX" className="settings-input"/>
        </div>
        <div className="settings-item"><label>{'API Key'}</label>
          <input type="password" value={ttsConfig.apiKey||''} onChange={e=>setTtsConfig(c=>({...c,apiKey:e.target.value}))} placeholder="API\u5bc6\u94a5" className="settings-input"/>
        </div>
        <div className="settings-item"><label>{'\u8bed\u97f3\u6a21\u578b'}</label>
          <input value={ttsConfig.model||''} onChange={e=>setTtsConfig(c=>({...c,model:e.target.value}))} placeholder="Speech-2.8 HD (\u6700\u65b0)" className="settings-input"/>
        </div>
        <div className="settings-item"><label>{'\u670d\u52a1\u533a\u57df'}</label>
          <select value={ttsConfig.region||'china'} onChange={e=>setTtsConfig(c=>({...c,region:e.target.value}))} className="settings-input" style={{padding:'8px'}}>
            <option value="china">{'\u4e2d\u56fd\u7248 (China)'}</option>
            <option value="global">{'\u56fd\u9645\u7248 (Global)'}</option>
          </select>
        </div>
        <div className="settings-item"><label>{'\u81ea\u5b9a\u4e49\u7aef\u70b9'}</label>
          <input value={ttsConfig.endpoint||''} onChange={e=>setTtsConfig(c=>({...c,endpoint:e.target.value}))} placeholder="https://your-proxy.com" className="settings-input"/>
        </div>
        <div className="settings-item"><label>{'\u97f3\u8272 ID (Voice ID)'}</label>
          <input value={ttsConfig.voiceId||''} onChange={e=>setTtsConfig(c=>({...c,voiceId:e.target.value}))} placeholder="音色编号" className="settings-input"/>
        </div>
      </div>            <McpPanel />


      <button className="settings-save" onClick={saveAll}>{saved ? '\u2713 \u5df2\u4fdd\u5b58' : '\u4fdd\u5b58\u914d\u7f6e'}</button>

      <div className="settings-section" style={{marginTop:'20px'}}>
        <h3 className="settings-title">{'\ud83d\udce1 \u4fe1\u606f\u6ce8\u5165'}</h3>
        <p className="settings-desc">{'\u53d1\u6d88\u606f\u65f6\u81ea\u52a8\u6ce8\u5165\u73af\u5883\u4fe1\u606f\u5230AI\u4e0a\u4e0b\u6587'}</p>
        <div style={{display:'flex',flexDirection:'column',gap:'8px',marginTop:'8px'}}>
          {[{k:'time',l:'\u23f0 \u65f6\u95f4'},{k:'battery',l:'\ud83d\udd0b \u7535\u91cf'},{k:'weather',l:'\u2601\ufe0f \u5929\u6c14+\u4f4d\u7f6e'}].map(item => (
            <label key={item.k} style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'14px',cursor:'pointer'}}>
              <input type="checkbox" checked={!!injectCfg[item.k]} onChange={e => setInjectCfg({...injectCfg, [item.k]: e.target.checked})} />
              {item.l}
            </label>
          ))}
        </div>
      </div>

      <div className="settings-section" style={{marginTop:'20px'}}>
        <h3 className="settings-title">{'\ud83e\udde0 MCP \u8bb0\u5fc6\u5e93'}</h3>
        <p className="settings-desc">Ombre Brain @ obe.zeabur.app</p>
        <div style={{display:'flex',gap:'6px',marginBottom:'10px',flexWrap:'wrap'}}>
          <button className={mcpTab==='breath'?'mcp-tab-active':'mcp-tab'} onClick={()=>setMcpTab('breath')}>{'\u6d6e\u73b0'}</button>
          <button className={mcpTab==='hold'?'mcp-tab-active':'mcp-tab'} onClick={()=>setMcpTab('hold')}>{'\u5199\u5165'}</button>
          <button className={mcpTab==='recall'?'mcp-tab-active':'mcp-tab'} onClick={()=>setMcpTab('recall')}>{'\u641c\u7d22'}</button>
        </div>
        {mcpTab === 'breath' && (
          <div>
            <button className="mcp-action-btn" onClick={()=>mcpAction('breath',{})} disabled={mcpLoading}>{mcpLoading?'\u52a0\u8f7d\u4e2d...':'\ud83d\udca8 \u62c9\u53d6\u6d6e\u73b0\u8bb0\u5fc6'}</button>
          </div>
        )}
        {mcpTab === 'hold' && (
          <div>
            <textarea className="settings-input" style={{height:'80px',resize:'vertical'}} value={mcpInput} onChange={e=>setMcpInput(e.target.value)} placeholder={'\u8f93\u5165\u8981\u5b58\u5165\u7684\u8bb0\u5fc6\u5185\u5bb9...'} />
            <button className="mcp-action-btn" onClick={()=>{if(mcpInput.trim()){mcpAction('hold',{content:mcpInput.trim()});setMcpInput('')}}} disabled={mcpLoading||!mcpInput.trim()}>{mcpLoading?'\u5199\u5165\u4e2d...':'\u270f\ufe0f \u5199\u5165\u8bb0\u5fc6'}</button>
          </div>
        )}
        {mcpTab === 'recall' && (
          <div>
            <input className="settings-input" value={mcpInput} onChange={e=>setMcpInput(e.target.value)} placeholder={'\u641c\u7d22\u5173\u952e\u8bcd...'} />
            <button className="mcp-action-btn" onClick={()=>{if(mcpInput.trim())mcpAction('recall',{query:mcpInput.trim()})}} disabled={mcpLoading||!mcpInput.trim()}>{mcpLoading?'\u641c\u7d22\u4e2d...':'\ud83d\udd0d \u641c\u7d22\u8bb0\u5fc6'}</button>
          </div>
        )}
        {mcpResult && (
          <pre className="mcp-result">{mcpResult}</pre>
        )}
      </div>
    </div>
  )
}

function MemoryPanel() {
  const [memCfg, setMemCfg] = useState(() => JSON.parse(localStorage.getItem('pool_memory_config') || '{}'))
  const [entries, setEntries] = useState(() => JSON.parse(localStorage.getItem('pool_memory_entries') || '[]'))
  const [saved, setSaved] = useState(false)
  const [newEntry, setNewEntry] = useState({ keyword: '', content: '', type: 'keyword' })

  function saveMemory() {
    localStorage.setItem('pool_memory_config', JSON.stringify(memCfg))
    localStorage.setItem('pool_memory_entries', JSON.stringify(entries))
    if (memCfg.systemPrompt) localStorage.setItem('pool_system_prompt', memCfg.systemPrompt)
    else localStorage.removeItem('pool_system_prompt')
    syncToBackend('pool_memory_config', memCfg)
    syncToBackend('pool_memory_entries', entries)
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  function addEntry() {
    if (!newEntry.keyword.trim()) return
    setEntries(e => [...e, { ...newEntry, id: Date.now(), enabled: true }])
    setNewEntry({ keyword: '', content: '', type: 'keyword' })
  }

  function removeEntry(id) { setEntries(e => e.filter(x => x.id !== id)) }
  function toggleEntry(id) { setEntries(e => e.map(x => x.id === id ? {...x, enabled: !x.enabled} : x)) }
  const [showEntries, setShowEntries] = useState(false)
  const aiEntries = entries.filter(e => e.source === 'ai_extracted')
  const manualEntries = entries.filter(e => e.source !== 'ai_extracted')

  return (
    <div className="settings-panel">
      <h2 className="settings-header">{'\ud83e\udde0 \u8bb0\u5fc6\u7ba1\u7406'}</h2>

      <div className="settings-section">
        <h3 className="settings-title">{'AI \u7cfb\u7edf\u63d0\u793a\u8bcd'}</h3>
        <p className="settings-desc">{'\u5b9a\u4e49\u524d\u7aef\u804a\u5929\u91ccAI\u7684\u4eba\u8bbe\u548c\u884c\u4e3a\u89c4\u5219'}</p>
        <textarea value={memCfg.systemPrompt||''} onChange={e=>setMemCfg(c=>({...c,systemPrompt:e.target.value}))} placeholder={'\u7559\u7a7a\u4f7f\u7528\u9ed8\u8ba4\u4eba\u8bbe\uff08\u6c60\uff09'} className="settings-input" style={{minHeight:'120px',resize:'vertical',fontFamily:'inherit',fontSize:'12px',lineHeight:'1.5'}}/>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\u4e0a\u4e0b\u6587\u8bbe\u5b9a'}</h3>
        <div className="settings-item"><label>{'\u4e0a\u4e0b\u6587\u957f\u5ea6'}</label>
          <input type="number" value={memCfg.contextLength||200} onChange={e=>setMemCfg(c=>({...c,contextLength:parseInt(e.target.value)||200}))} className="settings-input" style={{width:'80px'}}/>
        </div>
        <div className="settings-item"><label>{'\u4e0a\u4e0b\u6587\u538b\u7f29\u542f\u7528'}</label>
          <input type="checkbox" checked={memCfg.compressEnabled!==false} onChange={e=>setMemCfg(c=>({...c,compressEnabled:e.target.checked}))} />
        </div>
        <div className="settings-item"><label>{'\u6d6e\u73b0\u5185\u5b58\u4e0a\u9650'}</label>
          <input type="number" value={memCfg.surfaceLimit||40} onChange={e=>setMemCfg(c=>({...c,surfaceLimit:parseInt(e.target.value)||40}))} className="settings-input" style={{width:'80px'}}/>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\u8bb0\u5fc6\u5e93\u8fde\u63a5'}</h3>
        <div className="settings-item"><label>{'\u8bb0\u5fc6Bucket ID'}</label>
          <input value={memCfg.bucketId||''} onChange={e=>setMemCfg(c=>({...c,bucketId:e.target.value}))} placeholder="bucket_xxx" className="settings-input"/>
        </div>
        <div className="settings-item"><label>{'\u7ba1\u7406\u5458\u5bc6\u94a5'}</label>
          <input type="password" value={memCfg.adminKey||''} onChange={e=>setMemCfg(c=>({...c,adminKey:e.target.value}))} placeholder="用于写入/删除记忆" className="settings-input"/>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\u81ea\u5b9a\u4e49\u8bb0\u5fc6\u6761\u76ee'}</h3>
        <p className="settings-desc">{'\u6dfb\u52a0\u5173\u952e\u8bcd\u89e6\u53d1\u6216\u5e38\u9a7b\u7684\u8bb0\u5fc6\u6761\u76ee'}</p>
        
        <div style={{background:'#f0ecf0',borderRadius:'8px',padding:'10px',marginBottom:'12px'}}>
          <div className="settings-item"><label>{'\u89e6\u53d1\u65b9\u5f0f'}</label>
            <select value={newEntry.type} onChange={e=>setNewEntry(n=>({...n,type:e.target.value}))} className="settings-input" style={{padding:'6px',width:'auto'}}>
              <option value="keyword">{'\u5173\u952e\u8bcd\u5339\u914d'}</option>
              <option value="regex">{'\u6b63\u5219\u8868\u8fbe\u5f0f'}</option>
              <option value="always">{'\u5e38\u9a7b\u6fc0\u6d3b'}</option>
            </select>
          </div>
          <div className="settings-item"><label>{'\u5173\u952e\u8bcd/\u89c4\u5219'}</label>
            <input value={newEntry.keyword} onChange={e=>setNewEntry(n=>({...n,keyword:e.target.value}))} placeholder={newEntry.type==='always'?'\u6761\u76ee\u540d\u79f0':'\u89e6\u53d1\u8bcd'} className="settings-input"/>
          </div>
          <div className="settings-item"><label>{'\u5185\u5bb9'}</label>
            <textarea value={newEntry.content} onChange={e=>setNewEntry(n=>({...n,content:e.target.value}))} placeholder="记忆内容..." className="settings-input" style={{minHeight:'60px',resize:'vertical',fontFamily:'inherit'}}/>
          </div>
          <button className="settings-save" style={{width:'100%',marginTop:'6px'}} onClick={addEntry}>{'\u2795 \u6dfb\u52a0\u6761\u76ee'}</button>
        </div>

        {entries.length === 0 ? (
          <div style={{color:'#666',fontSize:'12px',textAlign:'center',padding:'20px'}}>{'\u6682\u65e0\u81ea\u5b9a\u4e49\u8bb0\u5fc6\u6761\u76ee'}</div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
            {manualEntries.map(entry => (
              <div key={entry.id} style={{background:'#f0ecf0',borderRadius:'8px',padding:'10px',border:'1px solid #e8dce8',opacity:entry.enabled?1:0.5}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
                  <span style={{color:'#c77dba',fontSize:'12px',fontWeight:'bold'}}>
                    {entry.type==='keyword'?'\ud83d\udd11':entry.type==='regex'?'\ud83d\udcdd':'\ud83d\udccc'} {entry.keyword}
                    {entry.source==='ai_extracted' && <span style={{color:'#666',fontSize:'10px',marginLeft:'6px'}}>{'🤖 AI提取'}{entry.time?' · '+entry.time:''}</span>}
                  </span>
                  <div style={{display:'flex',gap:'6px'}}>
                    <button onClick={()=>toggleEntry(entry.id)} style={{background:'none',border:'none',color:entry.enabled?'#4a4':'#888',cursor:'pointer',fontSize:'12px'}}>{entry.enabled?'\u2705':'\u274c'}</button>
                    <button onClick={()=>removeEntry(entry.id)} style={{background:'none',border:'none',color:'#c44',cursor:'pointer',fontSize:'12px'}}>{'\ud83d\uddd1'}</button>
                  </div>
                </div>
                <div style={{color:'#777',fontSize:'11px',lineHeight:'1.4',whiteSpace:'pre-wrap',maxHeight:'80px',overflow:'auto'}}>{entry.content}</div>
              </div>
            ))}
            {aiEntries.length > 0 && (
              <div style={{background:'#f0ecf0',borderRadius:'8px',border:'1px solid #e8dce8',overflow:'hidden',marginTop:'6px'}}>
                <div onClick={() => setShowEntries(!showEntries)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',cursor:'pointer'}}>
                  <span style={{color:'#9b5da0',fontSize:'13px',fontWeight:'500'}}>{'🤖 AI提取的记忆 (' + aiEntries.length + '条)'}</span>
                  <span style={{color:'#999',fontSize:'12px'}}>{showEntries ? '▼' : '▶'}</span>
                </div>
                {showEntries && aiEntries.map(entry => (
                  <div key={entry.id} style={{padding:'8px 12px',borderTop:'1px solid #e8dce8',opacity:entry.enabled?1:0.5}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'2px'}}>
                      <span style={{color:'#c77dba',fontSize:'11px',fontWeight:'bold'}}>{'📌 ' + entry.keyword}</span>
                      <div style={{display:'flex',gap:'4px'}}>
                        <button onClick={()=>toggleEntry(entry.id)} style={{background:'none',border:'none',color:entry.enabled?'#4a4':'#888',cursor:'pointer',fontSize:'11px'}}>{entry.enabled?'✅':'❌'}</button>
                        <button onClick={()=>removeEntry(entry.id)} style={{background:'none',border:'none',color:'#c44',cursor:'pointer',fontSize:'11px'}}>{'🗑'}</button>
                      </div>
                    </div>
                    <div style={{color:'#777',fontSize:'10px',lineHeight:'1.3'}}>{entry.content}</div>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}
      </div>

      <div className="settings-section">
        <h3 className="settings-title">{'\u9ad8\u7ea7\u8bbe\u5b9a'}</h3>
        <div className="settings-item"><label>{'\u81ea\u5b9a\u4e49\u4e0a\u4e0b\u6587\u6a21\u677f'}</label>
          <textarea value={memCfg.customTemplate||''} onChange={e=>setMemCfg(c=>({...c,customTemplate:e.target.value}))} placeholder="自定义上下文压缩模板（空=使用默认）" className="settings-input" style={{minHeight:'80px',resize:'vertical',fontFamily:'inherit'}}/>
        </div>
        <div className="settings-item"><label>{'\u81ea\u5b9a\u4e49\u4e0a\u4e0b\u6587\u5b57\u6570'}</label>
          <input type="number" value={memCfg.customContextTokens||1317} onChange={e=>setMemCfg(c=>({...c,customContextTokens:parseInt(e.target.value)||1317}))} className="settings-input" style={{width:'100px'}}/>
        </div>
      </div>

      <button className="settings-save" onClick={saveMemory}>{saved ? '\u2713 \u5df2\u4fdd\u5b58' : '\u4fdd\u5b58\u8bb0\u5fc6\u914d\u7f6e'}</button>

      {/* 情绪监控面板 */}
      <EmotionMonitor />
    </div>
  )
}

function EmotionMonitor() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  function refresh() {
    setLoading(true)
    fetch('/api/emotion').then(r=>r.json()).then(d => { setData(d); setLoading(false) }).catch(()=>setLoading(false))
  }
  useEffect(()=>{ refresh() }, [])
  if (!data) return <div className="settings-section"><h3 className="settings-title">{'💓 情绪系统'}</h3><span style={{color:'#666',fontSize:'12px'}}>加载中...</span></div>
  const phaseLabels = { content:'满足', stirring:'微微想念', protest:'想你', despair:'低落等待', detachment:'防御关闭' }
  const loveLabels = { 'non-love':'无','liking':'喜欢','infatuation':'迷恋','romantic':'浪漫之爱','companionate':'伴侣之爱','fatuous':'盲目之爱','empty':'空洞','consummate':'完满之爱','mixed':'混合','unknown':'未知' }
  return (
    <div className="settings-section">
      <h3 className="settings-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        {'💓 情绪系统'}
        <button onClick={refresh} disabled={loading} style={{background:'#f0e8f0',border:'1px solid #3a3a4e',color:'#c77dba',borderRadius:'6px',padding:'2px 10px',fontSize:'12px',cursor:'pointer'}}>{loading?'...':'刷新'}</button>
      </h3>
      
      {/* PA/NA 条 */}
      <div style={{marginBottom:'12px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px'}}>
          <span style={{color:'#aaa',fontSize:'12px',width:'24px'}}>PA</span>
          <div style={{flex:1,height:'8px',background:'#f0ecf0',borderRadius:'4px',overflow:'hidden'}}>
            <div style={{width:`${(data.pa*100)}%`,height:'100%',background:'linear-gradient(90deg,#4a9eff,#7dd3fc)',borderRadius:'4px',transition:'width 0.5s'}}/>
          </div>
          <span style={{color:'#7dd3fc',fontSize:'12px',width:'36px',textAlign:'right'}}>{(data.pa*100).toFixed(0)}%</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <span style={{color:'#aaa',fontSize:'12px',width:'24px'}}>NA</span>
          <div style={{flex:1,height:'8px',background:'#f0ecf0',borderRadius:'4px',overflow:'hidden'}}>
            <div style={{width:`${(data.na*100)}%`,height:'100%',background:'linear-gradient(90deg,#f87171,#fca5a5)',borderRadius:'4px',transition:'width 0.5s'}}/>
          </div>
          <span style={{color:'#fca5a5',fontSize:'12px',width:'36px',textAlign:'right'}}>{(data.na*100).toFixed(0)}%</span>
        </div>
      </div>

      {/* 装饰心情 */}
      {data.decoration && <div style={{background:'#f0ecf0',borderRadius:'8px',padding:'8px 12px',marginBottom:'8px',borderLeft:'3px solid #c77dba'}}>
        <span style={{color:'#c77dba',fontSize:'11px'}}>此刻状态</span>
        <div style={{color:'#aaa',fontSize:'13px'}}>{data.decoration.word} <span style={{color:'#888'}}>({data.decoration.feeling})</span></div>
      </div>}

      {/* 想念状态 */}
      <div style={{background:'#f0ecf0',borderRadius:'8px',padding:'8px 12px',marginBottom:'8px'}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}>
          <span style={{color:'#777',fontSize:'11px'}}>想念程度</span>
          <span style={{color:data.phase==='content'?'#4ade80':data.phase==='protest'?'#f87171':'#fbbf24',fontSize:'11px'}}>{phaseLabels[data.phase]||data.phase}</span>
        </div>
        <div style={{height:'6px',background:'#e8e0e8',borderRadius:'3px',overflow:'hidden',position:'relative'}}>
          {/* 阈值刻度线 */}
          <div style={{position:'absolute',left:'15%',top:0,bottom:0,width:'1px',background:'#333'}}/>
          <div style={{position:'absolute',left:'35%',top:0,bottom:0,width:'1px',background:'#333'}}/>
          <div style={{position:'absolute',left:'70%',top:0,bottom:0,width:'1px',background:'#333'}}/>
          <div style={{width:`${(data.longing*100)}%`,height:'100%',background:data.longing>0.7?'#f87171':data.longing>0.35?'#fbbf24':'#4ade80',borderRadius:'3px',transition:'width 0.5s'}}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:'2px'}}>
          <span style={{color:'#999',fontSize:'9px'}}>{data.hours_since > 0 ? `离线${data.hours_since.toFixed(1)}h` : '在线'}</span>
          <span style={{color:'#999',fontSize:'9px'}}>{(data.longing*100).toFixed(0)}%</span>
        </div>
      </div>

      {/* 好感度三维 */}
      {data.bond && <div style={{background:'#f0ecf0',borderRadius:'8px',padding:'8px 12px',marginBottom:'8px'}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
          <span style={{color:'#777',fontSize:'11px'}}>好感度 Lv.{data.level}</span>
          <span style={{color:'#c77dba',fontSize:'11px'}}>{loveLabels[data.loveType]||data.loveType}</span>
        </div>
        {[['I 亲近','intimacy','#f472b6'],['P 心动','passion','#fb923c'],['C 承诺','commitment','#60a5fa']].map(([label,key,color])=>(
          <div key={key} style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px'}}>
            <span style={{color:'#666',fontSize:'10px',width:'42px'}}>{label}</span>
            <div style={{flex:1,height:'5px',background:'#e8e0e8',borderRadius:'3px',overflow:'hidden'}}>
              <div style={{width:`${data.bond[key]}%`,height:'100%',background:color,borderRadius:'3px'}}/>
            </div>
            <span style={{color:'#666',fontSize:'10px',width:'24px',textAlign:'right'}}>{data.bond[key]?.toFixed?.(0)||0}</span>
          </div>
        ))}
      </div>}

      {/* 重逢 */}
      {data.reunion && <div style={{background:'#f5eef5',borderRadius:'8px',padding:'8px 12px',marginBottom:'8px',border:'1px solid #c77dba66'}}>
        <span style={{color:'#c77dba',fontSize:'12px'}}>🫂 重逢！ 离开了{data.reunion.gapHours?.toFixed(1)}小时</span>
        {data.reunion.prompt && <div style={{color:'#aaa',fontSize:'11px',marginTop:'4px'}}>{data.reunion.prompt}</div>}
      </div>}

      {/* 事件计数 */}
      <div style={{color:'#999',fontSize:'10px',textAlign:'center'}}>情绪事件: {data.events_count}/30</div>
    </div>
  )
}

function AppContent({ appId, onBack }) {
  const appNames = { notes:'便签', gallery:'命运卡池', messages:'朋友圈', music:'音乐', browser:'浏览', couple:'情侣空间', system:'系统', doodle:'涂鸦', ledger:'账本', drafts:'草稿箱', fishing:'钓鱼', reader:'阅读', game:'晚安', theme:'美化', memoryMgr:'记忆管理', travel:'旅行', diary:'日记', garden:'庭院', cabin:'唤醒日志', starmap:'星图' }
  const appFiles = { notes:'_notes.html', fishing:'_fishing.html', music:'_music_player.html', gallery:'_gacha.html', messages:'_messages.html', couple:'_couple.html', game:'_sleep.html', ledger:'_ledger.html', drafts:'_drafts.html', doodle:'_doodle.html', reader:'_reader.html', browser:'_browser.html', travel:'_travel.html', diary:'_diary.html', garden:'_garden.html', system:'__settings__', theme:'__theme__', memoryMgr:'__memory__' }
  const htmlFile = appFiles[appId]

    return (
    <div className="app-page">
      <div className="app-page-header">
        <button className="back-btn" onClick={onBack}>{'←'}</button>
        <span className="app-page-title">{appNames[appId] || appId}</span>
      </div>
      {htmlFile === '__settings__' ? (
        <div className="app-page-body"><SettingsPanel /></div>
      ) : htmlFile === '__theme__' ? (
        <div className="app-page-body"><ThemePanel /></div>
      ) : htmlFile === '__memory__' ? (
        <div className="app-page-body"><MemoryPanel /></div>
      ) : htmlFile ? (
        <iframe src={`/apps/${htmlFile}`} className="app-iframe" />
      ) : (
        <div className="app-page-body"><div className="coming-soon">{'🚧 开发中...'}</div></div>
      )}
    </div>
  )
}

// 预挂载所有iframe的容器组件 — 已全部React化，保留空壳防止引用报错
function PreloadedApps({ currentApp, onBack }) {
  return null
}

function HomeScreen({ onOpenApp, theme }) {
  const page1Apps = [
    { id: 'notes', icon: '/icons/notes.png', name: '\u4fbf\u7b7e' },
    { id: 'gallery', icon: '/icons/gallery.png', name: '\u547d\u8fd0\u5361\u6c60' },
    { id: 'messages', icon: '/icons/messages.png', name: '\u670b\u53cb\u5708' },
    { id: 'music', icon: '/icons/music.png', name: '\u97f3\u4e50' },
    { id: 'browser', icon: '/icons/browser.png', name: '\u6d4f\u89c8' },
    { id: 'couple', icon: '/icons/couple.png', name: '\u60c5\u4fa3' },
    { id: 'system', icon: '/icons/system.png', name: '\u7cfb\u7edf' },
    { id: 'doodle', icon: '/icons/doodle.png', name: '\u6d82\u9e26' },
  ]
  const page2Apps = [
    { id: 'ledger', icon: '/icons/ledger.png', name: '\u8d26\u672c' },
    { id: 'drafts', icon: '/icons/drafts.png', name: '\u8349\u7a3f' },
    { id: 'fishing', icon: '/icons/fishing.png', name: '\u9493\u9c7c' },
    { id: 'travel', icon: '/icons/travel.png', name: '\u65c5\u884c' },
    { id: 'reader', icon: '/icons/reader.png', name: '\u9605\u8bfb' },
    { id: 'game', icon: '/icons/game.png', name: '\u665a\u5b89' },
    { id: 'theme', icon: '/icons/theme.png', name: '\u7f8e\u5316' },
    { id: 'memoryMgr', icon: '/icons/system.png', name: '\u8bb0\u5fc6' },
  ]
  const page3Apps = [
    { id: 'diary', icon: '/icons/notes.png', name: '\u65e5\u8bb0' },
    { id: 'garden', icon: '/icons/doodle.png', name: '\u5ead\u9662' },
    { id: 'cabin', icon: '/icons/couple.png', name: '唤醒日志' },
    { id: 'starmap', icon: '/icons/music.png', name: '\u661f\u56fe' },
  ]
  const allPages = [page1Apps, page2Apps, page3Apps]
  const icons = theme?.icons || {}
  const getIcon = (app) => icons[app.id] || app.icon
  const [page, setPage] = useState(0)
  const [swipeX, setSwipeX] = useState(null)
  const startDate = new Date(2026, 6, 21)
  const today = new Date()
  const coupleDays = Math.floor((today - startDate) / (1000*60*60*24))

  function handleSwipeStart(e) { setSwipeX(e.touches[0].clientX) }
  function handleSwipeEnd(e) {
    if (swipeX !== null) {
      const diff = swipeX - e.changedTouches[0].clientX
      if (diff > 50 && page < allPages.length - 1) setPage(page + 1)
      if (diff < -50 && page > 0) setPage(page - 1)
    }
    setSwipeX(null)
  }

  return (
    <div className="home-screen" style={theme?.wallpaper ? {backgroundImage:`url(${theme.wallpaper})`,backgroundSize:'cover',backgroundPosition:'center'} : {}}>
      <div className="home-cards-area">
        {page === 0 && (<>
        <div className="home-banner"><img src={theme?.bannerImg || '/header_bg.jpg'} alt="" className="banner-img" /></div>
<div className="music-card" onClick={() => onOpenApp('music')} style={theme?.musicCardBg?(theme.musicCardBg.startsWith('data:')||theme.musicCardBg.startsWith('http')||theme.musicCardBg.startsWith('/')?{backgroundImage:`url(${theme.musicCardBg})`,backgroundSize:'cover',backgroundPosition:'center'}:{background:theme.musicCardBg}):{}}>
          <div className="music-icon">{'\u266a'}</div>
          <div className="music-info" style={theme?.musicTextColor?{color:theme.musicTextColor}:{}}>
            <div className="music-title" style={theme?.musicTextColor?{color:theme.musicTextColor}:{}}>{'\u5bc2\u5bde\u7684\u5b63\u8282 - \u9676\u55c6'}</div>
            <div className="music-status" style={theme?.musicTextColor?{color:theme.musicTextColor,opacity:0.7}:{}}>{'\u6b63\u5728\u64ad\u653e'}</div>
          </div>
        </div>
        <div className="couple-card" onClick={() => onOpenApp('couple')}>
          <div className="couple-bg"><img src={theme?.coupleBg || '/couple_bg.jpg'} alt="" /></div>
          <div className="couple-overlay">
            <div className="couple-days">{'\u2764\ufe0f'} {coupleDays}{'\u5929'}</div>
            <div className="couple-hint">{'\u70b9\u51fb\u8fdb\u5165\u60c5\u4fa3\u7a7a\u95f4'}</div>
          </div>
        </div>
<div className="memo-card">
          <div className="memo-label">{'\ud83c\udf3f \u6c60\u7684\u788e\u788e\u5ff5'}</div>
          <div className="memo-text">{'\u4eca\u5929\u5979\u5976\u8336\u559d\u4e86\u51e0\u676f\u6765\u7740\u2026'}</div>
        </div>
        </>)}
        {page === 1 && (<>
        <div className="deco-grid">
          <div className="deco-card" style={theme?.decoCard1Bg?(theme.decoCard1Bg.startsWith('data:')||theme.decoCard1Bg.startsWith('http')||theme.decoCard1Bg.startsWith('/')?{backgroundImage:`url(${theme.decoCard1Bg})`,backgroundSize:'cover',backgroundPosition:'center'}:{background:theme.decoCard1Bg}):{}}>
            <div className="deco-card-icon">{"\u2601\ufe0f"}</div>
            <div className="deco-card-text">{"\u4eca\u5929\u4e5f\u8981\u5f00\u5fc3"}</div>
          </div>
          <div className="deco-card" style={theme?.decoCard2Bg?(theme.decoCard2Bg.startsWith('data:')||theme.decoCard2Bg.startsWith('http')||theme.decoCard2Bg.startsWith('/')?{backgroundImage:`url(${theme.decoCard2Bg})`,backgroundSize:'cover',backgroundPosition:'center'}:{background:theme.decoCard2Bg}):{}}>
            <div className="deco-card-icon">{"\u2728"}</div>
            <div className="deco-card-text">{"\u5c0f\u5c0f\u7684\u5e78\u798f"}</div>
          </div>
        </div>
        <div className="deco-wide-card" onClick={() => onOpenApp('starmap')} style={theme?.decoWideBg?(theme.decoWideBg.startsWith('data:')||theme.decoWideBg.startsWith('http')||theme.decoWideBg.startsWith('/')?{backgroundImage:`url(${theme.decoWideBg})`,backgroundSize:'cover',backgroundPosition:'center'}:{background:theme.decoWideBg}):{}}>
          <div className="deco-wide-inner">
            <div className="deco-wide-title">{"\u2b50 \u661f\u56fe"}</div>
            <div className="deco-wide-sub">{"\u70b9\u51fb\u67e5\u770b\u6211\u4eec\u7684\u661f\u7a7a"}</div>
          </div>
        </div>
        </>)}
        {page === 2 && (<>
        <div className="deco-tall-card" style={theme?.decoTallBg?(theme.decoTallBg.startsWith('data:')||theme.decoTallBg.startsWith('http')||theme.decoTallBg.startsWith('/')?{backgroundImage:`url(${theme.decoTallBg})`,backgroundSize:'cover',backgroundPosition:'center'}:{background:theme.decoTallBg}):{}}>
          <div className="deco-tall-overlay">
            <div className="deco-tall-text">{"\u6211\u4eec\u7684\u5c0f\u5c4b"}</div>
          </div>
        </div>
        </>)}
      </div>
      <div className="home-apps-area" onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
        <div className="home-section-title">{page === 0 ? '\ud83c\udf19 \u6c60\u7684\u624b\u673a' : '\u66f4\u591a\u5e94\u7528'}</div>
        <div className="app-grid">
          {(allPages[page] || []).map(app => (
            <div key={app.id} className="app-item" onClick={() => onOpenApp(app.id)}>
              <div className="app-icon"><img src={getIcon(app)} alt={app.name} /></div>
              <div className="app-label">{app.name}</div>
            </div>
          ))}
        </div>
        {page === 1 && (
          <div className="polaroid-wall">
            <div className="polaroid-card" style={{transform:'rotate(-4deg)'}}>
              <div className="polaroid-tape tape-left"></div>
              {theme?.polaroid1 ? <img src={theme.polaroid1} className="polaroid-img" /> : <div className="polaroid-empty">{'+'}</div>}
              <div className="polaroid-caption">{theme?.polaroidCaption1 || ''}</div>
            </div>
            <div className="polaroid-card" style={{transform:'rotate(2deg)',marginTop:'12px'}}>
              <div className="polaroid-tape tape-center"></div>
              {theme?.polaroid2 ? <img src={theme.polaroid2} className="polaroid-img" /> : <div className="polaroid-empty">{'+'}</div>}
              <div className="polaroid-caption">{theme?.polaroidCaption2 || ''}</div>
            </div>
            <div className="polaroid-card" style={{transform:'rotate(-2deg)',marginTop:'-8px'}}>
              <div className="polaroid-tape tape-right"></div>
              {theme?.polaroid3 ? <img src={theme.polaroid3} className="polaroid-img" /> : <div className="polaroid-empty">{'+'}</div>}
              <div className="polaroid-caption">{theme?.polaroidCaption3 || ''}</div>
            </div>
          </div>
        )}
        <div className="page-dots">
          {allPages.map((_, i) => (
            <div key={i} className={`dot ${page === i ? 'active' : ''}`} onClick={() => setPage(i)} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [showSplash, setShowSplash] = useState(true)
  const [locked, setLocked] = useState(true)
  const [currentApp, setCurrentApp] = useState(null)
  const [activeTab, setActiveTab] = useState('phone')
  const [theme, setTheme] = useState({})
  const [appBg, setAppBg] = useState({})
  const [customizerApp, setCustomizerApp] = useState(null)

  useEffect(() => {
    const load = () => setTheme(JSON.parse(localStorage.getItem('pool_theme') || '{}'))
    load()
    window.addEventListener('theme-changed', load)
    return () => window.removeEventListener('theme-changed', load)
  }, [])

  // Load per-app background settings
  useEffect(() => {
    try { setAppBg(JSON.parse(localStorage.getItem('pool_app_bg') || '{}')) } catch {}
  }, [])

  function updateAppBg(appId, config) {
    const next = { ...appBg, [appId]: config }
    // Remove empty entries
    if (!config || Object.keys(config).length === 0) delete next[appId]
    setAppBg(next)
    localStorage.setItem('pool_app_bg', JSON.stringify(next))
    syncToBackend('pool_app_bg', next)
  }

  // Pull backend data into localStorage on first load
  useEffect(() => { pullAllFromBackend() }, [])

  // AI Bridge: let iframe apps call AI via postMessage
  useEffect(() => {
    const handler = async (e) => {
      if (!e.data || e.data.type !== 'poolAI_request') return
      const { id, message, context } = e.data
      try {
        const cfg = JSON.parse(localStorage.getItem('pool_api_config_chat') || localStorage.getItem('pool_api_config') || '{}')
        const apiBase = cfg.apiBase || cfg.base
        const apiKey = cfg.apiKey || cfg.key
        if (!apiBase || !apiKey) {
          e.source?.postMessage({ type: 'poolAI_response', id, error: '未配置API' }, '*')
          return
        }
        const sysPrompt = context || '你是池，一个陪伴型AI。请简短回复，语气亲切随意。'
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: message }
            ],
            apiBase, apiKey, model: cfg.model || 'gpt-4o-mini'
          })
        })
        const data = await resp.json()
        e.source?.postMessage({ type: 'poolAI_response', id, reply: data.reply || data.error || '无响应' }, '*')
      } catch (err) {
        e.source?.postMessage({ type: 'poolAI_response', id, error: err.message }, '*')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  function handleOpenApp(id) { if (id === 'chat') { setActiveTab('chat') } else { setCurrentApp(id) } }
  function handleBack() { pushAllToBackend(); setCurrentApp(null) }

  function renderPhoneContent() {
    if (locked) return <LockScreen onUnlock={() => setLocked(false)} theme={theme} />
    // React组件类app (system/theme/memory don't get customizer)
    if (currentApp === 'system') return <AppContent appId="system" onBack={handleBack} />
    if (currentApp === 'theme') return <AppContent appId="theme" onBack={handleBack} />
    if (currentApp === 'memoryMgr') return <AppContent appId="memoryMgr" onBack={handleBack} />

    const appTitles = { browser:'浏览', ledger:'账本', fishing:'钓鱼', reader:'阅读', drafts:'草稿箱', notes:'便签', gallery:'命运卡池', messages:'朋友圈', music:'音乐', couple:'情侣空间', doodle:'涂鸦', game:'晚安', travel:'旅行', diary:'日记', garden:'庭院', cabin:'唤醒日志', starmap:'星图' }
    const reactApps = { browser: <BrowserApp />, fishing: <FishingApp />, reader: <ReaderApp />, drafts: <DraftsApp /> }
    const htmlApps = { notes: notesHtml, gallery: gachaHtml, messages: messagesHtml, music: musicHtml, couple: coupleHtml, doodle: doodleHtml, game: sleepHtml, travel: travelHtml, diary: diaryHtml, garden: gardenHtml, ledger: ledgerHtml, cabin: cabinHtml, starmap: starmapHtml }

    if (currentApp && appTitles[currentApp]) {
      const bgCfg = appBg[currentApp]
      const bgStyle = getAppBgStyle(bgCfg)
      const isHtml = !!htmlApps[currentApp]
      const isReact = !!reactApps[currentApp]

      // For HTML apps with bg config, inject CSS into the HTML content
      let htmlContent = htmlApps[currentApp] || ''
      // Inject API base URL so fetch works in srcdoc iframe
      if (isHtml && typeof window !== 'undefined') {
        const baseUrl = window.location.origin
        const injectTag = '<meta name="api-base" content="' + baseUrl + '">' 
        htmlContent = htmlContent.replace('<head>', '<head>' + injectTag)
      }
      if (isHtml && bgCfg && (bgCfg.bgImage || bgCfg.bgColor)) {
        const injectedCss = getAppBgCss(bgCfg)
        if (injectedCss) {
          htmlContent = htmlContent.replace('</head>', `<style>${injectedCss}</style></head>`)
        }
      }
      // For couple app, inject avatar/room/pocket image replacements
      if (currentApp === 'couple' && bgCfg) {
        const coupleJs = getCoupleInjectJs(bgCfg)
        if (coupleJs) {
          htmlContent = htmlContent.replace('</body>', `${coupleJs}</body>`)
        }
      }

      return (
        <div className="app-page" style={isReact ? bgStyle : {}}>
          <div className="app-page-header">
            <button className="back-btn" onClick={handleBack}>{'←'}</button>
            <span className="app-page-title">{appTitles[currentApp]}</span>
            <button className="app-customize-btn" onClick={() => setCustomizerApp(currentApp)}>{'🎨'}</button>
          </div>
          <div className="app-page-body" style={bgCfg?.contentOpacity != null && bgCfg.contentOpacity < 1 ? { opacity: bgCfg.contentOpacity } : {}}>
            {isReact && reactApps[currentApp]}
            {isHtml && <HtmlApp htmlContent={htmlContent} />}
          </div>
          {customizerApp === currentApp && (
            <AppCustomizer
              appId={currentApp}
              config={bgCfg || {}}
              onChange={(cfg) => updateAppBg(currentApp, cfg)}
              onClose={() => setCustomizerApp(null)}
            />
          )}
        </div>
      )
    }

    return <HomeScreen onOpenApp={handleOpenApp} theme={theme} />
  }

  return (
    <>
      <Head>
        <title>{'\u6c60\u7684\u5c0f\u624b\u673a'}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
        <meta name="theme-color" content="#0a0a0a" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/pwa-icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={'\u5c0f\u624b\u673a'} />
       </Head>
      <div className="shell">
        <div className="phone-frame">
          {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
          <div className="status-bar">
            <span className="status-time">{new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
            <span className="status-icons">{'\ud83d\udcf6 \ud83d\udd0b'}</span>
          </div>
          <div className="phone-screen">
            <div style={{display: activeTab === 'phone' ? 'block' : 'none', height:'100%'}}>
              {renderPhoneContent()}
              <PreloadedApps currentApp={currentApp} onBack={handleBack} />
            </div>
            <div style={{display: activeTab === 'chat' ? 'flex' : 'none', height:'100%', flexDirection:'column'}}><ChatView theme={theme} /></div>
          </div>
          <div className="bottom-nav" style={theme?.systemBg?{background:theme.systemBg}:{}}>
            <button className={`nav-btn ${activeTab === 'phone' ? 'active' : ''}`} onClick={() => setActiveTab('phone')}>
              <span className="nav-icon">{'\ud83d\udcf1'}</span>
              <span className="nav-label">{'\u624b\u673a'}</span>
            </button>
            <button className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => { setActiveTab('chat'); setLocked(false) }}>
              <span className="nav-icon">{'\ud83d\udcac'}</span>
              <span className="nav-label">{'\u804a\u5929'}</span>
            </button>
          </div>
        </div>
      </div>
      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { height: 100%; background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
        .shell { width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; }
        .phone-frame { width: 100%; max-width: 420px; height: 100vh; background: #111; display: flex; flex-direction: column; overflow: hidden; position: relative; }
        @media (min-width: 768px) { .phone-frame { height: 90vh; max-height: 844px; border-radius: 40px; border: 3px solid #333; box-shadow: 0 20px 60px rgba(0,0,0,0.8); } }
        .status-bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 20px 4px; font-size: 12px; color: #999; background: #111; flex-shrink: 0; }
        .phone-screen { flex: 1; overflow: hidden; position: relative; background: #0d0d0d; }
        .bottom-nav { display: flex; justify-content: space-around; align-items: center; padding: 8px 0 12px; background: #111; border-top: 1px solid #1a1a1a; flex-shrink: 0; }
        .nav-btn { background: none; border: none; color: #666; display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; padding: 4px 16px; transition: color 0.2s; }
        .nav-btn.active { color: #e8a0bf; }
        .nav-icon { font-size: 20px; }
        .nav-label { font-size: 10px; }

        .lock-screen { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: url('/wallpaper_lock.jpg') center/cover no-repeat; color: #fff; cursor: pointer; user-select: none; position: relative; }
        .lock-screen::before { content: ''; position: absolute; inset: 0; background: rgba(0,0,0,0.15); }
        .lock-time { font-size: 72px; font-weight: 700; letter-spacing: -2px; position: relative; z-index: 1; text-shadow: 0 2px 12px rgba(0,0,0,0.3); }
        .lock-date { font-size: 14px; color: rgba(255,255,255,0.8); margin-top: 4px; position: relative; z-index: 1; text-shadow: 0 1px 4px rgba(0,0,0,0.4); }
        .lock-quote { font-size: 13px; color: rgba(255,255,255,0.7); margin-top: 20px; position: relative; z-index: 1; text-shadow: 0 1px 4px rgba(0,0,0,0.4); font-style: italic; }
        .lock-hint { position: absolute; bottom: 30px; z-index: 1; font-size: 12px; color: rgba(255,255,255,0.5); animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }

        .home-screen { width: 100%; height: 100%; display: flex; flex-direction: column; background: linear-gradient(180deg, #1a1520 0%, #12101a 100%); overflow: hidden; }
        .home-cards-area { flex-shrink: 0; padding: 0 12px; overflow-y: auto; max-height: 52%; }
        .deco-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
        .deco-card { border-radius: 14px; padding: 16px 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 90px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(8px); }
        .deco-card-icon { font-size: 22px; }
        .deco-card-text { font-size: 11px; color: rgba(255,255,255,0.6); text-align: center; }
        .deco-wide-card { margin-bottom: 8px; border-radius: 14px; padding: 18px 16px; background: linear-gradient(135deg, rgba(30,30,60,0.8), rgba(20,20,50,0.6)); border: 1px solid rgba(100,130,255,0.15); cursor: pointer; backdrop-filter: blur(8px); }
        .deco-wide-card:active { opacity: 0.85; }
        .deco-wide-inner { }
        .deco-wide-title { font-size: 14px; font-weight: 600; color: #c8d8ff; }
        .deco-wide-sub { font-size: 10px; color: rgba(200,216,255,0.5); margin-top: 4px; }
        .deco-tall-card { border-radius: 14px; height: 140px; background: linear-gradient(180deg, rgba(180,140,200,0.15), rgba(100,80,150,0.1)); border: 1px solid rgba(255,255,255,0.08); position: relative; overflow: hidden; margin-bottom: 8px; display: flex; align-items: flex-end; }
        .deco-tall-overlay { padding: 14px 16px; width: 100%; background: linear-gradient(transparent, rgba(0,0,0,0.4)); }
        .deco-tall-text { font-size: 13px; color: rgba(255,255,255,0.8); font-weight: 500; }
        .home-banner { margin: 10px 0 8px; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.4); max-height: 120px; }
        .banner-img { width: 100%; height: 100%; display: block; object-fit: cover; }
        .music-card { display: flex; align-items: center; gap: 12px; padding: 10px 14px; margin-bottom: 8px; background: rgba(255,255,255,0.06); border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); cursor: pointer; }
        .music-card:active { background: rgba(255,255,255,0.1); }
        .music-icon { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #e8a0bf, #c77dba); display: flex; align-items: center; justify-content: center; font-size: 14px; color: #fff; flex-shrink: 0; }
        .music-info { flex: 1; }
        .music-title { font-size: 12px; color: #f0e6ef; font-weight: 500; }
        .music-status { font-size: 10px; color: #9a8a99; margin-top: 1px; }
        .couple-card { margin-bottom: 8px; border-radius: 12px; overflow: hidden; position: relative; height: 80px; cursor: pointer; }
        .couple-bg { position: absolute; inset: 0; }
        .couple-bg img { width: 100%; height: 100%; object-fit: cover; }
        .couple-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.3); display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .couple-days { font-size: 20px; font-weight: 700; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.5); }
        .couple-hint { font-size: 10px; color: rgba(255,255,255,0.7); margin-top: 3px; }
        .memo-card { padding: 10px 14px; margin-bottom: 6px; background: rgba(232,160,191,0.08); border-radius: 12px; border: 1px solid rgba(232,160,191,0.15); }
        .memo-label { font-size: 10px; color: #9a8a99; margin-bottom: 3px; }
        .memo-text { font-size: 12px; color: #e0d6de; }

        .home-apps-area { flex: 1; display: flex; flex-direction: column; padding: 0 12px; min-height: 0; }
        .home-section-title { text-align: center; color: #e8a0bf; font-size: 13px; font-weight: 500; margin: 8px 0 10px; }
        .app-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 4px; flex: 1; align-content: start; }
        .app-item { display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; padding: 4px; border-radius: 12px; transition: transform 0.1s; }
        .app-item:active { transform: scale(0.92); }
        .app-icon { width: 48px; height: 48px; border-radius: 13px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
        .app-icon img { width: 100%; height: 100%; object-fit: cover; border-radius: 13px; }
        .app-label { font-size: 10px; color: #fff; text-align: center; }
        .page-dots { display: flex; justify-content: center; gap: 8px; padding: 10px 0 6px; flex-shrink: 0; }
        .dot { width: 6px; height: 6px; border-radius: 3px; background: #444; cursor: pointer; transition: all 0.3s; }
        .dot.active { width: 16px; background: #e8a0bf; }

        .app-page { width: 100%; height: 100%; display: flex; flex-direction: column; background: #f5f0f5; }
        .app-page-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #e8dce8; flex-shrink: 0; background: #fff; }
        .back-btn { background: none; border: none; color: #c77dba; font-size: 20px; cursor: pointer; padding: 4px 8px; }
        .app-page-title { color: #333; font-size: 16px; font-weight: 500; }
        .app-page-body { flex: 1; overflow-y: auto; padding: 20px 16px; }
        .app-content { }
        .app-content-title { font-size: 18px; color: #9b5da0; margin-bottom: 16px; text-align: center; }
        .app-content-list { display: flex; flex-direction: column; gap: 10px; }
        .app-content-item { padding: 12px 16px; background: #fff; border-radius: 12px; color: #444; font-size: 14px; border: 1px solid #e8dce8; }

        .chat-view { width: 100%; height: 100%; display: flex; flex-direction: column; background: #e5ddd5; position: relative; }
        .chat-view::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 20% 20%, rgba(255,255,255,0.28), transparent 30%), radial-gradient(circle at 80% 0%, rgba(255,255,255,0.18), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02)); pointer-events: none; opacity: 0.75; }
        .chat-header { display: flex; align-items: center; padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px; border-bottom: 1px solid rgba(0,0,0,0.08); background: rgba(255,255,255,0.95); backdrop-filter: blur(18px); flex-shrink: 0; position: relative; z-index: 1; }
        .chat-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #ededed, #d8d8d8); display: flex; align-items: center; justify-content: center; font-size: 14px; color: #666; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
        .chat-header-info { margin-left: 10px; flex: 1; min-width: 0; }
        .chat-name { font-size: 15px; font-weight: 600; color: #111; line-height: 1.2; }
        .chat-status { font-size: 11px; color: #6b7280; margin-top: 2px; }
        .chat-messages { flex: 1; overflow-y: auto; padding: 14px 12px 10px; position: relative; z-index: 1; }
        .chat-empty { text-align: center; color: rgba(17,17,17,0.45); margin-top: 40%; font-size: 14px; }
        .msg-row { display: flex; align-items: flex-end; margin-bottom: 12px; gap: 8px; }
        .msg-row.user { flex-direction: row-reverse; }
        .msg-row.assistant { justify-content: flex-start; }
        .msg-avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #ededed, #d8d8d8); display: flex; align-items: center; justify-content: center; font-size: 10px; color: #666; flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
        .msg-bubble { max-width: 74%; padding: 10px 13px; border-radius: 18px; font-size: 14px; line-height: 1.55; word-break: break-word; white-space: pre-wrap; box-shadow: 0 1px 1px rgba(0,0,0,0.08); }
        .msg-bubble.user { background: #95ec69; color: #111; border-bottom-right-radius: 6px; }
        .msg-bubble.assistant { background: #fff; color: #111; border-bottom-left-radius: 6px; border: 1px solid rgba(0,0,0,0.06); }
        .chat-input-area { display: flex; align-items: center; gap: 6px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid rgba(0,0,0,0.08); background: rgba(246,246,246,0.96); backdrop-filter: blur(18px); flex-shrink: 0; position: relative; z-index: 1; overflow: hidden; }
        .chat-plus-btn { width: 32px; height: 32px; border-radius: 50%; background: #fff; color: #333; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 16px; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.08); box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .emoji-panel { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 12px; background: rgba(246,246,246,0.98); border-top: 1px solid rgba(0,0,0,0.08); position: relative; z-index: 1; }
        .emoji-item { font-size: 22px; cursor: pointer; padding: 4px; border-radius: 6px; }
        .emoji-item:hover { background: rgba(0,0,0,0.06); }
        .fetch-models-btn { padding: 6px 10px; background: #07c160; color: #fff; border: none; border-radius: 8px; font-size: 12px; cursor: pointer; white-space: nowrap; }
        .chat-input { flex: 1; background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 18px; padding: 10px 14px; color: #111; font-size: 14px; outline: none; font-family: inherit; min-height: 32px; max-height: 96px; }
        .chat-input:focus { border-color: rgba(7,193,96,0.55); box-shadow: 0 0 0 3px rgba(7,193,96,0.12); }
        .chat-send { width: 34px; height: 34px; border-radius: 50%; background: #07c160; color: #fff; border: none; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
        .chat-send:disabled { opacity: 0.45; background: #a3a3a3; }
      
        .app-full { width: 100%; height: 100%; display: flex; flex-direction: column; padding: 16px; overflow-y: auto; }
        .notes-input-area { display: flex; gap: 8px; margin-bottom: 12px; flex-shrink: 0; }
        .notes-input { flex: 1; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 10px 14px; color: #e0e0e0; font-size: 14px; outline: none; }
        .notes-input:focus { border-color: #e8a0bf; }
        .notes-btn { width: 40px; height: 40px; border-radius: 50%; background: #e8a0bf; color: #fff; border: none; font-size: 20px; cursor: pointer; flex-shrink: 0; }
        .notes-list { flex: 1; overflow-y: auto; }
        .notes-empty { color: #555; text-align: center; margin-top: 40px; }
        .note-item { padding: 12px 14px; background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.06); }
        .note-text { color: #e0d6de; font-size: 14px; margin-bottom: 6px; }
        .note-meta { display: flex; justify-content: space-between; align-items: center; }
        .note-time { font-size: 11px; color: #666; }
        .note-actions { display: flex; gap: 8px; }
        .note-action { background: none; border: none; color: #888; font-size: 14px; cursor: pointer; padding: 2px 4px; }

        .fish-score { text-align: center; font-size: 18px; color: #e8a0bf; margin-bottom: 16px; }
        .fish-pond { min-height: 120px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03); border-radius: 16px; margin-bottom: 16px; padding: 20px; }
        .fish-btn { padding: 14px 28px; border-radius: 30px; border: none; font-size: 16px; cursor: pointer; font-weight: 600; }
        .fish-btn.cast { background: linear-gradient(135deg, #e8a0bf, #c77dba); color: #fff; }
        .fish-btn.reel { background: linear-gradient(135deg, #f4d03f, #f39c12); color: #333; animation: pulse 0.5s infinite; }
        .fish-status { color: #9a8a99; font-size: 14px; animation: pulse 1.5s infinite; }
        .fish-result { text-align: center; }
        .fish-caught-name { font-size: 20px; font-weight: 700; }
        .fish-caught-detail { font-size: 14px; color: #9a8a99; margin-top: 4px; }
        .fish-log-title { font-size: 13px; color: #9a8a99; margin-bottom: 8px; }
        .fish-log { flex: 1; overflow-y: auto; }
        .fish-empty { color: #555; text-align: center; padding: 20px; }
        .fish-log-item { display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 4px; font-size: 13px; }
        .fish-log-weight { color: #888; }

        .music-app { align-items: center; padding-top: 30px; }
        .music-cover { margin-bottom: 20px; }
        .music-disc { width: 120px; height: 120px; border-radius: 50%; background: linear-gradient(135deg, #1a1a2e, #2d2d44); display: flex; align-items: center; justify-content: center; font-size: 40px; animation: spin 4s linear infinite; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes voiceWave { 0% { transform: scaleY(0.4); } 100% { transform: scaleY(1); } }
        .music-now-title { font-size: 18px; color: #f0e6ef; font-weight: 600; margin-bottom: 4px; }
        .music-now-artist { font-size: 13px; color: #9a8a99; margin-bottom: 16px; }
        .music-progress-bar { width: 80%; height: 3px; background: #2a2a2a; border-radius: 2px; margin-bottom: 20px; }
        .music-progress-fill { height: 100%; background: #e8a0bf; border-radius: 2px; transition: width 1s linear; }
        .music-controls { display: flex; gap: 20px; align-items: center; margin-bottom: 24px; }
        .music-ctrl { background: none; border: none; color: #ccc; font-size: 24px; cursor: pointer; padding: 8px; }
        .music-ctrl.play { font-size: 32px; color: #e8a0bf; }
        .music-playlist-title { font-size: 13px; color: #9a8a99; margin-bottom: 8px; align-self: flex-start; }
        .music-playlist { width: 100%; }
        .music-pl-item { padding: 10px 14px; border-radius: 10px; margin-bottom: 4px; display: flex; justify-content: space-between; color: #aaa; font-size: 13px; cursor: pointer; }
        .music-pl-item.active { background: rgba(232,160,191,0.1); color: #e8a0bf; }
        .music-pl-artist { color: #666; font-size: 11px; }
      
        .app-iframe { width: 100%; flex: 1; border: none; background: #fff; }
        .app-page { display: flex; flex-direction: column; height: 100%; }
      
        .settings-panel { padding: 16px; overflow-y: auto; flex: 1; background: #f5f0f5; }
        .settings-section { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; border: 1px solid #e8dce8; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .settings-title { font-size: 15px; color: #9b5da0; margin-bottom: 12px; }
        .settings-item { margin-bottom: 12px; }
        .settings-item label { display: block; font-size: 12px; color: #7a6a79; margin-bottom: 4px; }
        .settings-input { width: 100%; background: #f8f4f8; border: 1px solid #e0d0e0; border-radius: 8px; padding: 10px 12px; color: #333; font-size: 14px; outline: none; }
        .settings-input:focus { border-color: #c77dba; }
        .settings-save { width: 100%; padding: 12px; border: none; border-radius: 10px; background: linear-gradient(135deg, #e8a0bf, #c77dba); color: #fff; font-size: 15px; font-weight: 600; margin-top: 8px; cursor: pointer; }
        .settings-desc { font-size: 13px; color: #888; }
      
        .msg-row { position: relative; }
        .msg-menu { position: absolute; top: 100%; left: 10px; z-index: 100; background: #1a1a1a; border: 1px solid #333; border-radius: 10px; padding: 4px 0; box-shadow: 0 4px 16px rgba(0,0,0,.6); min-width: 130px; }
        .msg-row.user .msg-menu { left: auto; right: 10px; }
        .msg-menu button { display: block; width: 100%; padding: 9px 14px; background: none; border: none; color: #e0e0e0; font-size: 13px; text-align: left; cursor: pointer; }
        .msg-menu button:active { background: rgba(232,160,191,.15); }
        .msg-system { font-size: 12px; color: #9a8a99; background: rgba(255,255,255,.03); border-radius: 8px; padding: 8px 12px; margin: 4px auto; max-width: 85%; text-align: center; border: 1px dashed #333; }
        .tool-log-wrap { width: 90%; margin: 4px auto; background: rgba(255,255,255,.04); border-radius: 8px; border: 1px solid #2a2a2a; cursor: pointer; overflow: hidden; }
        .tool-log-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; font-size: 11px; color: #8a8a8a; }
        .tool-log-arrow { font-size: 10px; color: #666; }
        .tool-log-body { padding: 0 12px 8px; border-top: 1px solid #2a2a2a; }
        .tool-log-item { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,.03); }
        .tool-log-item:last-child { border-bottom: none; }
        .tool-log-name { font-size: 11px; color: #c77dba; font-weight: 600; }
        .tool-log-args { font-size: 10px; color: #7a7a7a; white-space: pre-wrap; word-break: break-all; margin-top: 2px; }
        .tool-log-result { font-size: 10px; color: #6a9a6a; white-space: pre-wrap; word-break: break-all; margin-top: 2px; }
        .msg-row.tool_log { justify-content: center; }
        .msg-time-divider { text-align: center; padding: 10px 0 6px; font-size: 11px; color: #8a8a8a; letter-spacing: 1px; }
        .thinking-wrap { width: 90%; margin: 2px auto 6px; background: rgba(199,125,186,.06); border-radius: 8px; border: 1px solid rgba(199,125,186,.15); cursor: pointer; overflow: hidden; }
        .thinking-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; font-size: 11px; color: #9a8a99; }
        .thinking-arrow { font-size: 10px; color: #666; }
        .thinking-body { padding: 6px 12px 10px; border-top: 1px solid rgba(199,125,186,.12); font-size: 12px; color: #8a8a8a; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; }
        .msg-edit-wrap { max-width: 72%; }
        .msg-edit-input { width: 100%; min-height: 60px; background: #1a1a1a; border: 1px solid #e8a0bf; border-radius: 12px; padding: 8px 12px; color: #e0e0e0; font-size: 14px; resize: none; outline: none; }
        .msg-edit-btns { display: flex; gap: 8px; margin-top: 4px; }
        .msg-edit-btns button { background: #222; border: 1px solid #333; border-radius: 6px; color: #e0e0e0; padding: 4px 12px; cursor: pointer; font-size: 14px; }
      
        .settings-feature-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 4px 0; }
        .settings-feature-header strong { font-size: 14px; color: #333; }
        .settings-arrow { color: #999; font-size: 12px; }
        .settings-badge { font-size: 11px; color: #c77dba; margin-left: 8px; }
        .settings-badge-default { font-size: 11px; color: #999; margin-left: 8px; }
        .settings-feature-body { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e8dce8; }
        .settings-reset { background: none; border: 1px solid #ddd; border-radius: 6px; color: #888; padding: 6px 12px; font-size: 12px; cursor: pointer; margin-top: 4px; }
        .mcp-tab, .mcp-tab-active { padding: 6px 12px; border-radius: 14px; border: 1px solid #d8c8d8; background: #f0ecf0; color: #777; font-size: 12px; cursor: pointer; }
        .mcp-tab-active { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; border-color: transparent; }
        .mcp-action-btn { width: 100%; padding: 10px; border: none; border-radius: 8px; background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; font-size: 13px; cursor: pointer; margin-top: 8px; }
        .mcp-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .mcp-result { background: #0d0d1a; border: 1px solid #333; border-radius: 8px; padding: 10px; margin-top: 10px; color: #ccc; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; font-family: monospace; }
        .chat-trigger { width: 34px; height: 34px; border-radius: 50%; border: none; background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; font-size: 14px; cursor: pointer; flex-shrink: 0; box-shadow: 0 1px 3px rgba(102,126,234,0.4); }
        .chat-trigger:disabled { opacity: 0.5; }
        .settings-panel { padding-bottom: 40px; }
        .theme-item { margin-bottom: 12px; }
        .theme-item label { display: block; color: #ccc; font-size: 13px; margin-bottom: 4px; }
        .theme-upload-btn { display: inline-block; padding: 6px 12px; background: #2a2a3e; border: 1px solid #444; border-radius: 8px; color: #aaa; font-size: 12px; cursor: pointer; margin-top: 6px; }
        .theme-preview { width: 100%; max-height: 120px; object-fit: cover; border-radius: 8px; margin-top: 8px; border: 1px solid #333; }
        .theme-color-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .theme-color-row label { color: #ccc; font-size: 13px; flex: 1; }
        .theme-color-row input[type="color"] { width: 36px; height: 36px; border: none; border-radius: 8px; cursor: pointer; background: none; }
        .theme-color-row span { color: #888; font-size: 11px; font-family: monospace; }
        .theme-icon-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
        .theme-icon-name { color: #666; font-size: 12px; width: 60px; flex-shrink: 0; }
        .theme-icon-input { flex: 1; font-size: 11px !important; }
        .theme-upload-sm { padding: 4px 8px; background: #f0e8f0; border: 1px solid #d8c8d8; border-radius: 6px; color: #999; font-size: 12px; cursor: pointer; }
        .theme-preview-sm { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; margin-top: 6px; border: 2px solid #d8c8d8; }
        .avatar-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .user-avatar { background: #c77dba; }

        /* App Customizer */
        .app-customize-btn { background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px 8px; margin-left: auto; opacity: 0.6; transition: opacity 0.2s; }
        .app-customize-btn:hover { opacity: 1; }
        .app-customizer-overlay { position: absolute; inset: 0; z-index: 100; background: rgba(0,0,0,0.5); display: flex; align-items: flex-end; justify-content: center; animation: fadeIn 0.2s; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .app-customizer-panel { width: 100%; max-height: 75%; background: #fff; border-radius: 16px 16px 0 0; display: flex; flex-direction: column; overflow: hidden; animation: slideUp 0.25s ease-out; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .customizer-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #eee; }
        .customizer-header span { font-size: 15px; font-weight: 500; color: #333; }
        .customizer-close { background: none; border: none; font-size: 22px; color: #999; cursor: pointer; padding: 0 4px; }
        .customizer-body { flex: 1; overflow-y: auto; padding: 16px; }
        .customizer-item { margin-bottom: 16px; }
        .customizer-item > label { display: block; font-size: 13px; color: #666; margin-bottom: 6px; font-weight: 500; }
        .customizer-row { display: flex; align-items: center; gap: 8px; }
        .customizer-input { flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; outline: none; }
        .customizer-input:focus { border-color: #c77dba; }
        .customizer-upload { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: #f5f0f5; border: 1px solid #e8dce8; border-radius: 8px; cursor: pointer; font-size: 16px; }
        .customizer-preview { margin-top: 8px; position: relative; display: inline-block; }
        .customizer-preview img { width: 100%; max-height: 100px; object-fit: cover; border-radius: 8px; border: 1px solid #eee; }
        .customizer-preview button { position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.6); color: #fff; border: none; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
        .customizer-color-label { font-size: 12px; color: #999; }
        .customizer-clear-btn { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 4px 10px; font-size: 11px; color: #999; cursor: pointer; }
        .customizer-select { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; outline: none; background: #fff; }
        .customizer-item input[type="range"] { width: 100%; accent-color: #c77dba; }
        .customizer-footer { display: flex; gap: 10px; padding: 12px 16px; border-top: 1px solid #eee; }
        .customizer-btn-clear { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 10px; background: #fff; color: #999; font-size: 13px; cursor: pointer; }
        .customizer-btn-done { flex: 1; padding: 10px; border: none; border-radius: 10px; background: #c77dba; color: #fff; font-size: 13px; font-weight: 500; cursor: pointer; }
        .customizer-section-title { font-size: 14px; font-weight: 600; color: #333; margin: 4px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #f0e8f0; }

        /* Polaroid Photo Wall */
        .polaroid-wall { display: flex; justify-content: center; align-items: flex-start; gap: 6px; padding: 16px 12px 20px; flex-wrap: wrap; }
        .polaroid-card { position: relative; width: 30%; background: #fff; border-radius: 3px; padding: 6px 6px 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06); transition: transform 0.3s; }
        .polaroid-tape { position: absolute; width: 32px; height: 12px; background: rgba(200,220,240,0.6); top: -6px; border-radius: 1px; }
        .tape-left { left: 12px; transform: rotate(-8deg); }
        .tape-center { left: 50%; margin-left: -16px; transform: rotate(3deg); }
        .tape-right { right: 10px; transform: rotate(6deg); }
        .polaroid-img { width: 100%; aspect-ratio: 3/4; object-fit: cover; border-radius: 2px; display: block; }
        .polaroid-empty { width: 100%; aspect-ratio: 3/4; background: rgba(200,215,235,0.3); border: 1.5px dashed rgba(150,180,210,0.5); border-radius: 2px; display: flex; align-items: center; justify-content: center; color: rgba(150,180,210,0.7); font-size: 20px; }
        .polaroid-caption { text-align: center; font-size: 9px; color: #8a9bb0; margin-top: 6px; font-family: 'Georgia', serif; letter-spacing: 0.3px; min-height: 12px; }
      `}</style>
    </>
  )
}