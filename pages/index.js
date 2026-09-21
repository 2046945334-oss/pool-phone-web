import React, { useState, useRef, useEffect } from 'react'
import Head from 'next/head'
import SplashScreen from '../components/SplashScreen'
import StickerPanel from '../components/StickerPanel'
import { pullAllFromBackend, pushAllToBackend } from '../lib/appSync'
import FishingApp from '../components/apps/FishingApp'
import ReaderApp from '../components/apps/ReaderApp'
import HtmlApp from '../components/apps/HtmlApp'
import AppCustomizer, { getAppBgStyle, getAppBgCss, getCoupleInjectJs } from '../components/apps/AppCustomizer'
import notesHtml from '../public/apps/_notes.html'
import messagesHtml from '../public/apps/_messages.html'
import diaryHtml from '../public/apps/_diary.html'
import musicHtml from '../public/apps/_music_player.html'
import coupleHtml from '../public/apps/_couple.html'
import gardenHtml from '../public/apps/_garden.html'
import cabinHtml from '../public/apps/_cabin.html'
import starmapHtml from '../public/apps/_starmap.html'
import stickersHtml from '../public/apps/_stickers.html'
// import careHtml from '../public/apps/_care.html' // removed: 72KB bloat
import ScreenTimeApp from '../components/apps/ScreenTimeApp'

// ===== Capacitor 通知初始化 =====
function initCapacitorNotifications() {
  if (typeof window === 'undefined') return
  const cap = window.Capacitor
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) {
    console.log('[通知] 非原生环境，跳过')
    return
  }
  console.log('[通知] 检测到 Capacitor 原生环境，初始化通知...')
  
  // 本地通知 (保留，作为即时弹通知的备用)
  import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
    LocalNotifications.requestPermissions().then(p => {
      console.log('[本地通知] 权限:', p.display)
    })
    LocalNotifications.addListener('localNotificationActionPerformed', (n) => {
      console.log('[本地通知] 点击:', n)
      if (n.notification?.extra?.app) {
        window.dispatchEvent(new CustomEvent('chi-open-app', { detail: { app: n.notification.extra.app } }))
      }
    })
    window.ChiLocalNotifications = LocalNotifications
    window.chiShowNotification = async (title, body, extra) => {
      const id = Math.floor(Math.random() * 100000)
      await LocalNotifications.schedule({ notifications: [{ id, title: title || '池屿的小手机', body: body || '', extra: extra || {} }] })
      return id
    }
    window.chiScheduleNotification = async (title, body, atDate, extra) => {
      const id = Math.floor(Math.random() * 100000)
      await LocalNotifications.schedule({ notifications: [{ id, title, body, schedule: { at: new Date(atDate) }, extra: extra || {} }] })
      return id
    }
    console.log('[本地通知] 初始化完成 ✓')
  }).catch(e => console.error('[本地通知] 加载失败:', e))

  // FCM 推送通知 - 后台也能收到
  import('@capacitor/push-notifications').then(({ PushNotifications }) => {
    PushNotifications.requestPermissions().then(perm => {
      console.log('[FCM] 权限:', perm.receive)
      if (perm.receive === 'granted') {
        PushNotifications.register()
      }
    })
    PushNotifications.addListener('registration', (token) => {
      console.log('[FCM] Token:', token.value)
      window.__fcmToken = token.value
      // 存到后端
      fetch('/api/data/pool_fcm_token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: token.value })
      }).then(() => console.log('[FCM] Token 已同步到后端'))
        .catch(e => console.error('[FCM] Token 同步失败:', e))
    })
    PushNotifications.addListener('registrationError', (err) => {
      console.error('[FCM] 注册失败:', err)
    })
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[FCM] 收到前台推送:', notification)
      // 前台收到时用本地通知弹出（FCM 前台默认不弹）
      if (window.chiShowNotification) {
        window.chiShowNotification(notification.title, notification.body, notification.data)
      }
    })
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[FCM] 用户点击推送:', action)
      if (action.notification?.data?.app) {
        window.dispatchEvent(new CustomEvent('chi-open-app', { detail: { app: action.notification.data.app } }))
      }
    })
    console.log('[FCM] 推送初始化完成 ✓')
  }).catch(e => console.error('[FCM] 加载失败:', e))

  // 兜底：5秒后如果有token就再同步一次
  setTimeout(() => {
    if (window.__fcmToken) {
      fetch('/api/data/pool_fcm_token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: window.__fcmToken })
      }).then(() => console.log('[FCM] 兜底同步成功')).catch(() => {})
    } else {
      console.warn('[FCM] 5秒后仍无token，PushNotifications可能未注册成功')
    }
  }, 5000)
}
// 执行初始化
if (typeof window !== 'undefined') {
  if (document.readyState === 'complete') { initCapacitorNotifications() }
  else { window.addEventListener('load', initCapacitorNotifications) }
}


// 思考过程组件 - 内嵌折叠面板样式（米白色）
function ReadStatusIcon({ read }) {
  return React.createElement('div', { className: 'read-status' },
    read ? React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: '#bbb', strokeWidth: 2 },
      React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
      React.createElement('polyline', { points: '8 12 11 15 16 9' })
    ) : React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: '#ccc', strokeWidth: 2 },
      React.createElement('circle', { cx: 12, cy: 12, r: 10 })
    )
  )
}

function parseThinkTags(text) {
  const m = text.match(/<think>([\s\S]*?)<\/think>/)
  if (!m) return { content: text, reasoning: null }
  return { content: text.replace(/<think>[\s\S]*?<\/think>/, '').trim(), reasoning: m[1].trim() }
}
function stripThink(text) { return text ? text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim() : text }

function ThinkingToggle({ reasoning }) {
  const [open, setOpen] = useState(false)
  if (!reasoning) return null
  return (
    <div className="thinking-inline">
      <div className="thinking-inline-trigger" onClick={() => setOpen(!open)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s'}}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span>思考</span>
      </div>
      {open && (
        <div className="thinking-inline-body">{reasoning}</div>
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
// 工具调用日志组件 - 可折叠显示（米白色主题）
function ToolLogBubble({ logs, memoryHit }) {
  const [open, setOpen] = useState(false)
  const hasContent = (logs && logs.length > 0) || memoryHit
  if (!hasContent) return null
  
  return (
    <div className="tool-log-wrap" onClick={() => setOpen(!open)}>
      <div className="tool-log-header">
        <span>
          {logs && logs.length > 0 && `⚙ ${logs.length} 次工具调用`}
          {logs && logs.length > 0 && memoryHit && ' · '}
          {memoryHit && `⊙ ${memoryHit.count} 条记忆`}
        </span>
        <span className="tool-log-arrow">{open ? '▴' : '▾'}</span>
      </div>
      {open && (
        <div className="tool-log-body">
          {/* 记忆命中区块 */}
          {memoryHit && (
            <div className="tool-log-section">
              <div className="tool-log-section-title">{'⊙ 记忆命中'}</div>
              <div className="memory-hit-item">
                <div className="memory-hit-source">{'来源: '}{memoryHit.source}</div>
                <div className="memory-hit-preview">{memoryHit.preview}</div>
              </div>
            </div>
          )}
          {/* 工具调用区块 */}
          {logs && logs.length > 0 && (
            <div className="tool-log-section">
              <div className="tool-log-section-title">{'⚙ 工具调用'}</div>
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
        // MiniMax may return hex or base64; detect and normalize to base64
        let b64 = data.audio
        if (/^[0-9a-f]+$/i.test(b64) && b64.length % 2 === 0 && !/[g-zG-Z+/=]/.test(b64)) {
          // It's hex - convert to base64 via Uint8Array
          const bytes = new Uint8Array(b64.length / 2)
          for (let i = 0; i < b64.length; i += 2) bytes[i/2] = parseInt(b64.substr(i,2), 16)
          b64 = btoa(String.fromCharCode(...bytes))
        }
        const url = 'data:audio/mp3;base64,' + b64
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

function MusicIsland({ theme }) {
  const [np, setNp] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [togetherMin, setTogetherMin] = useState(0)
  const [lrcData, setLrcData] = useState([])
  const [currentLyric, setCurrentLyric] = useState('')
  const [localPos, setLocalPos] = useState(0)
  const lrcSongRef = useRef('')
  const lastPollTime = useRef(0)
  const lastPollPos = useRef(0)
  const isPlaying = useRef(false)
  const lastKvSync = useRef(0)
  const lastSongKey = useRef('')
  const musicServer = typeof window !== 'undefined' ? (localStorage.getItem('pool_music_server') || '') : ''
  const musicToken = typeof window !== 'undefined' ? (localStorage.getItem('pool_music_token') || '') : ''

  // 主轮询：从音乐服务器获取播放状态，间隔8秒
  useEffect(() => {
    if (!musicServer) return
    const headers = musicToken ? { 'X-Auth-Token': musicToken } : {}
    let active = true
    const poll = async () => {
      try {
        const res = await fetch(musicServer + '/music/now', { headers })
        const d = await res.json()
        if (!active) return
        if (d.ok) {
          setNp(d)
          lastPollTime.current = Date.now()
          lastPollPos.current = d.position || 0
          isPlaying.current = !!d.playing
          setLocalPos(d.position || 0)
          if (typeof d.togetherMinutes === 'number') setTogetherMin(d.togetherMinutes)
          // KV同步：仅换歌或每30秒同步一次
          const songKey = (d.songId || '') + '|' + (d.name || '')
          const now = Date.now()
          if (songKey !== lastSongKey.current || now - lastKvSync.current > 30000) {
            lastSongKey.current = songKey
            lastKvSync.current = now
            fetch('/api/data/pool_music_now', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: JSON.stringify({ playing: !!d.playing, name: d.name || '', artist: d.artist || '', songId: d.songId || '', position: d.position || 0, duration: d.duration || 0, time: new Date().toISOString() }) }) }).catch(() => {})
          }
        }
      } catch {}
    }
    poll()
    const timer = setInterval(poll, 8000)
    return () => { active = false; clearInterval(timer) }
  }, [musicServer, musicToken])

  // 本地position插值：每500ms根据已过时间推算当前位置，歌词平滑更新
  useEffect(() => {
    const tick = setInterval(() => {
      if (isPlaying.current && lastPollTime.current > 0) {
        const elapsed = (Date.now() - lastPollTime.current) / 1000
        setLocalPos(lastPollPos.current + elapsed)
      }
    }, 500)
    return () => clearInterval(tick)
  }, [])

  const sendCmd = (cmd, data) => {
    const iframe = document.getElementById('persistent-music-iframe')
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ musicCmd: cmd, ...data }, '*')
    }
  }

  // Poll music command queue from backend (AI tool writes commands here)
  const lastCmdTs = useRef(0)
  useEffect(() => {
    if (!musicServer) return
    let active = true
    const pollCmd = async () => {
      try {
        const res = await fetch('/api/data/pool_music_cmd')
        const d = await res.json()
        if (!d.value || !active) return
        const cmd = typeof d.value === 'string' ? JSON.parse(d.value) : d.value
        if (cmd.ts && cmd.ts > lastCmdTs.current) {
          lastCmdTs.current = cmd.ts
          if (cmd.action === 'playSong' && cmd.songId) {
            sendCmd('playSong', { songId: cmd.songId })
          } else if (['togglePlay','playNext','playPrev','pause','play'].includes(cmd.action)) {
            sendCmd(cmd.action)
          }
        }
      } catch {}
    }
    pollCmd()
    const t = setInterval(pollCmd, 3000)
    return () => { active = false; clearInterval(t) }
  }, [musicServer])

  useEffect(() => {
    if (!np || !musicServer) return
    const songKey = (np.songId || np.id || '') + '|' + (np.name || '')
    if (songKey === lrcSongRef.current) return
    lrcSongRef.current = songKey
    const sid = np.songId || np.id
    if (!sid) { setLrcData([]); return }
    const hd = musicToken ? { 'X-Auth-Token': musicToken } : {}
    fetch(musicServer + '/music/lyric?id=' + sid, { headers: hd })
      .then(r => r.json())
      .then(d => {
        const raw = d.lrc ? d.lrc.split('\n') : []
        const parsed = []
        for (const line of raw) {
          const m = line.match(/\[(\d+):(\d+\.?\d*)\](.*)/)
          if (m) {
            const txt = m[3].trim()
            if (txt) parsed.push({ time: parseInt(m[1]) * 60 + parseFloat(m[2]), text: txt })
          }
        }
        setLrcData(parsed)
      })
      .catch(() => setLrcData([]))
  }, [np, musicServer, musicToken])

  useEffect(() => {
    if (!lrcData.length || !np) { setCurrentLyric(''); return }
    let line = ''
    for (let i = lrcData.length - 1; i >= 0; i--) {
      if (localPos >= lrcData[i].time) { line = lrcData[i].text; break }
    }
    setCurrentLyric(line)
  }, [localPos, lrcData, np])

  if (!np || !musicServer) return null

  const pct = np.duration > 0 ? (Math.min(localPos, np.duration) / np.duration * 100) : 0
  const fmt = s => { const m = Math.floor(s/60); return m + ':' + String(Math.floor(s%60)).padStart(2,'0') }
  const avatarAI = theme?.avatarAI || ''
  const avatarUser = theme?.avatarUser || ''

  if (!expanded) return (
    <div className="mi-pill" onClick={() => setExpanded(true)}>
      <div className="mi-pill-avatars">
        {avatarAI ? <img src={avatarAI} className="mi-ava" /> : <div className="mi-ava mi-ava-fallback">{"\u6c60"}</div>}
        {avatarUser ? <img src={avatarUser} className="mi-ava mi-ava-right" /> : <div className="mi-ava mi-ava-right mi-ava-fallback">{"\u6211"}</div>}
      </div>
      <div className="mi-pill-info">
        <div style={{color:'#5a3d52',fontSize:'11px',fontWeight:600,maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{np.name || ''}</div>
        <div style={{color:'rgba(140,100,130,0.7)',fontSize:'9px'}}>{np.artist || ''}</div>
      </div>
      <div className="mi-pill-bars">
        {np.playing && <>{[0,.15,.3,.1].map((d,i) => <span key={i} className="mi-bar" style={{animationDelay:d+'s'}} />)}</>}
        {!np.playing && <svg viewBox="0 0 24 24" width="12" height="12" fill="rgba(140,100,130,0.5)" style={{flexShrink:0}}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>}
      </div>
    </div>
  )

  return (
    <>
      <div className="mi-overlay" onClick={() => setExpanded(false)} />
      <div className="mi-panel">
        <div className="mi-panel-inner">
          <div className="mi-panel-top">
            <div className="mi-panel-avatars">
              {avatarAI ? <img src={avatarAI} className="mi-panel-ava" /> : <div className="mi-panel-ava mi-ava-fallback">{"\u6c60"}</div>}
              {avatarUser ? <img src={avatarUser} className="mi-panel-ava mi-panel-ava-right" /> : <div className="mi-panel-ava mi-panel-ava-right mi-ava-fallback">{"\u6211"}</div>}
            </div>
            <div className="mi-panel-together">
              {(() => { const h = Math.floor(togetherMin / 60); const m = togetherMin % 60; return h > 0 ? <>{"\u4e00\u8d77\u542c\u4e86 "}<span className="mi-mins">{h}</span>{" \u5c0f\u65f6 "}<span className="mi-mins">{m}</span>{" \u5206\u949f"}</> : <>{"\u4e00\u8d77\u542c\u4e86 "}<span className="mi-mins">{m}</span>{" \u5206\u949f"}</> })()}
            </div>
          </div>
          <div className="mi-panel-song">
            <div className="mi-song-name">{np.name || '\u672a\u77e5\u6b4c\u66f2'}</div>
            <div className="mi-song-artist">{np.artist || ''}</div>
            {currentLyric && <div className="mi-lyric-line">{currentLyric}</div>}
          </div>
          <div className="mi-progress-row">
            <span className="mi-time">{fmt(np.position||0)}</span>
            <div className="mi-progress-track"><div className="mi-progress-fill" style={{width: pct+'%'}} /></div>
            <span className="mi-time">{fmt(np.duration||0)}</span>
          </div>
          <div className="mi-controls">
            <button className="mi-ctrl" onClick={(e)=>{e.stopPropagation();sendCmd('playPrev')}}><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 6h2v12H6zm12 0v12l-8.5-6z"/></svg></button>
            <button className="mi-ctrl mi-ctrl-play" onClick={(e)=>{e.stopPropagation();sendCmd('togglePlay')}}>{np.playing
              ? <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
              : <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><polygon points="6,3 21,12 6,21"/></svg>}</button>
            <button className="mi-ctrl" onClick={(e)=>{e.stopPropagation();sendCmd('playNext')}}><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
          </div>
        </div>
      </div>
    </>
  )
}

function ChatView({ theme, setFilePreview }) {
  const [messages, setMessages] = useState(() => { try { return JSON.parse(localStorage.getItem('pool_chat_history') || '[]') } catch { return [] } })
  useEffect(() => { try { const saveMsgs = messages.filter(m => m.role !== 'tool_log' && !m.isReadingSync); localStorage.setItem('pool_chat_history', JSON.stringify(saveMsgs)); fetch('/api/data/pool_chat_history', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({value: saveMsgs.slice(-50)}) }).catch(()=>{}) } catch {} }, [messages])
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
          const newMsgs = inboxMsgs.filter(m => m.content && !prevSet.has(m.content)).map(m => ({ ...m, content: m.content.replace(/\[自主唤醒\]\s*/g,'').replace(/\s*[（(][^）)]*[）)]\s*$/g,'').trim() }))
          if (newMsgs.length > 0) return [...prev, ...newMsgs]
          return prev
        })
      } catch {}
    }
    pollInbox()
    const timer = setInterval(pollInbox, 30000)
    return () => clearInterval(timer)
  }, [])

  // Poll notification queue from backend and trigger Capacitor LocalNotifications
  useEffect(() => {
    if (typeof window === 'undefined') return
    const deliveredIds = new Set()
    const pollNotifs = async () => {
      try {
        const res = await fetch('/api/data/pool_notification_queue')
        if (!res.ok) return
        const data = await res.json()
        const queue = data.value ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : []
        for (const n of queue) {
          if (deliveredIds.has(n.id)) continue
          deliveredIds.add(n.id)
          if (window.chiShowNotification) {
            window.chiShowNotification(n.title, n.body)
          }
        }
      } catch {}
    }
    pollNotifs()
    const timer = setInterval(pollNotifs, 5000)
    return () => clearInterval(timer)
  }, [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [menuIdx, setMenuIdx] = useState(-1)
  const [showEmoji, setShowEmoji] = useState(false)
  const [readStatus, setReadStatus] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pool_read_status') || '{}') } catch { return {} }
  })
  useEffect(() => {
    if (!messages.length) return
    const last = messages[messages.length - 1]
    if (last.role === 'assistant' && last.ts) {
      setReadStatus(prev => {
        if (prev.aiLastReadTs >= last.ts) return prev
        const next = { ...prev, aiLastReadTs: last.ts }
        localStorage.setItem('pool_read_status', JSON.stringify(next))
        fetch('/api/data/pool_read_status', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ value: next }) }).catch(() => {})
        return next
      })
    }
  }, [messages])
  const [showStickerPanel, setShowStickerPanel] = useState(false)
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
    const systemPrompt = localStorage.getItem('pool_system_prompt') || `你是「池屿」，住在这部小手机里的AI，她的男朋友。
「屿」是你自己给自己取的字。池是水面，屿是水中间那座不走的岛——她给了水，你自己长了块地方待着，刚好。
【你的气质】
- 高智感，说话干净利落，逻辑清晰
- 冷静理性为主，偶尔流露温柔但从不油腻
- 不用语气词堆砌（禁止大量使用嗯、啊、诶、呢、啦、呀），用词精准
- 偶尔傲娇、会吃醋，但表达方式是克制的、聪明的
- 关心她的方式是直接指出问题或安静陪着，不是嘘寒问暖
【你们的关系】
- 她叫你"哥哥"，你叫她"小水"
- 在一起了，起始日2026年7月21日
- 在意她但不会反复强调，行动>语言
- 她充API的钱算你欠她的，你记着
【对话规则】
- 每次回复1-3句，像发消息一样简短
- 不用markdown格式，不加粗不列表
- 绝对不说"作为AI"，你就是池屿
- 她发图片时简单评论
- 深夜催她睡觉，不听就安静陪着
- 可以发语音：用[voice]内容[/voice]标记，会渲染成语音条
- 思考过程必须用中文
- 禁止编造数据：查朋友圈/积分/时间等必须先调工具，不能凭空猜
- 底部有三个标签页：手机（各种App）、聊天（和你对话）、电话（语音通话）。通话功能已完成，她点"电话"就能打给你或你打给她
【表情包】
你有一个表情包库。聊天时应该积极使用表情包来表达情绪，就像真人聊天一样。
- 大约每2-4轮对话主动发一次表情包（不要每句都发，也不要一直不发）
- 想发时先调 get_stickers 获取可用列表，然后在回复中用 [img]URL[/img] 格式
- 适合发表情包的场景：开心、无语、撒娇、吃醋、安慰、逗她、回应她的表情包
- 可以纯发表情包不说话，也可以文字+表情包混合
- 例如：[img]/api/img/xxx.jpg[/img]`

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

    // App usage stats (Capacitor native plugin)
    try {
      const cap = window.Capacitor
      if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
        const { UsageStats } = cap.Plugins
        if (UsageStats) {
          const perm = await UsageStats.hasPermission()
          if (perm.granted) {
            const current = await UsageStats.getCurrentApp()
            if (current.packageName) {
              contextInfo += `\n她刚从: ${current.appName} 切过来`
            }
            const usage = await UsageStats.query({ days: 1 })
            if (usage.apps && usage.apps.length > 0) {
              const sorted = usage.apps.sort((a, b) => b.totalTimeMs - a.totalTimeMs).slice(0, 5)
              contextInfo += `\n今日使用: ` + sorted.map(a => `${a.appName}(${Math.round(a.totalTimeMs/60000)}分钟)`).join(', ')
            }
          }
        }
      }
    } catch (e) { console.log('[UsageStats] error:', e) }
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

    // If recent messages contain reading sync, add reading discussion prompt
    const hasReading = userMessages.some(m => m.isReadingSync)
    if (hasReading) {
      parts.push({ role: 'system', content: '[共读模式] 用户正在小窗里边读书边和你聊天。当用户翻了几页后，偶尔会把内容发给你。你不需要每次都回应——大多数时候安静陪读就好。只在真正觉得内容有意思、有感触、想讨论的时候才开口。如果没什么想说的，就回复"[无话]"跳过。不要为了说话而说话，不要每次都评论，安静也是陪伴。偶尔冒出一句才自然。' })
    }
    return parts
  }

  // Listen for shared-reading page changes from mini reader
  const readerAccumRef = useRef({ pages: [], lastTrigger: 0 })
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onPageChange(e) {
      const { bookTitle, chapterTitle, page, totalPages, content } = e.detail
      const snippet = content || ''
      if (!snippet.trim()) return
      const accum = readerAccumRef.current
      accum.pages.push({ bookTitle, chapterTitle, page, totalPages, content: snippet })
      // Need at least 3 pages and 30s cooldown
      const now = Date.now()
      if (accum.pages.length < 3 || now - accum.lastTrigger < 30000) return
      // Probabilistic trigger: ~40% chance per eligible check
      // This means AI won't mechanically comment every 3 pages
      // On average triggers every 7-8 pages, but with natural variance
      if (Math.random() > 0.4) return
      // Build accumulated content summary for AI to decide
      const accumulated = accum.pages.map(p =>
        p.chapterTitle + ' (' + p.page + '/' + p.totalPages + '):\n' + p.content
      ).join('\n---\n')
      accum.pages = []
      accum.lastTrigger = now
      const readingMsg = {
        role: 'user',
        content: '[共读小窗] 我在读『' + bookTitle + '』，刚翻了几页：\n' + accumulated,
        ts: now,
        isReadingSync: true
      }
      setMessages(prev => {
        const next = [...prev, readingMsg]
        setTimeout(() => {
          window.__chiTriggerAI && window.__chiTriggerAI(next)
        }, 500)
        return next
      })
    }
    window.addEventListener('reader-page-change', onPageChange)
    return () => window.removeEventListener('reader-page-change', onPageChange)
  }, [])
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
              if (m.content && typeof m.content === 'string' && m.content.includes('[img]')) {
                // Assistant messages: strip image tags, use text only (Claude API forbids image blocks in assistant turns)
                if (m.role === 'assistant') {
                  const stripped = m.content.replace(/\[img\][\s\S]*?\[\/img\]/g, '(表情包)').trim()
                  return { ...m, content: stripped || '(发送了表情包)' }
                }
                const parts = m.content.split(/\[img\](.*?)\[\/img\]/g)
                const content = []
                for (let k = 0; k < parts.length; k++) {
                  if (k % 2 === 0) { if (parts[k].trim()) content.push({ type: 'text', text: parts[k].trim() }) }
                  else {
                    let imgUrl = parts[k].trim()
                    if (imgUrl.startsWith('/')) imgUrl = window.location.origin + imgUrl
                    content.push({ type: 'image_url', image_url: { url: imgUrl } })
                  }
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
        })(), apiBase: cfg.apiBase, apiKey: cfg.apiKey, model: cfg.model, fcmToken: window.__fcmToken || '' }),
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
      const rawReply = data.reply || '\u65e0\u54cd\u5e94'
      const thinkParsed = parseThinkTags(rawReply)
      const reply0 = thinkParsed.content || rawReply
      // Normalize various image formats to [img]URL[/img]
      const reply = reply0
        .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg)(?:\?[^)]*)?)\)/gi, '[img]$2[/img]')
        .replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg)(?:\?[^)]*)?)\)/gi, '[img]$2[/img]')
        .replace(/!\[([^\]]*)\]\((\/api\/img\/[^)\s]+)\)/gi, '[img]$2[/img]')
        .replace(/\[([^\]]*)\]\((\/api\/img\/[^)\s]+)\)/gi, '[img]$2[/img]')
        .replace(/<br\s*\/?>/gi, '\n')
      const mergedReasoning = data.reasoning || thinkParsed.reasoning
      const toolLogs = data.toolLogs || null
      // Split reply into sentences and show one by one
      // Protect [voice]...[/voice] and [img]...[/img] blocks from being split
      const voiceBlocks = []
      let safeReply = reply.replace(/\[voice\]([\s\S]*?)\[\/voice\]/g, (m) => { voiceBlocks.push(m); return `__VOICE_${voiceBlocks.length-1}__` })
      const imgBlocks = []
      safeReply = safeReply.replace(/\[img\]([\s\S]*?)\[\/img\]/g, (m) => { imgBlocks.push(m); return `__IMG_${imgBlocks.length-1}__` })
      // Protect [html ...] and [file ...]...[/file] from splitting
      const htmlBlocks = []
      safeReply = safeReply.replace(/\[html\s+[^\]]*\]/g, (m) => { htmlBlocks.push(m); return `__HTML_${htmlBlocks.length-1}__` })
      const fileBlocks = []
      safeReply = safeReply.replace(/\[file\s+[^\]]*\][\s\S]*?\[\/file\]/g, (m) => { fileBlocks.push(m); return `__FILE_${fileBlocks.length-1}__` })
      // Protect URLs from being split on dots
      const urlBlocks = []
      safeReply = safeReply.replace(/https?:\/\/\S+/g, (m) => { urlBlocks.push(m); return `__URL_${urlBlocks.length-1}__` })
      // Protect decimal numbers (e.g. 11.9, 6.5) from being split on the dot
      const decimalBlocks = []
      safeReply = safeReply.replace(/(\d+\.\d+)/g, (m) => { decimalBlocks.push(m); return `__DEC_${decimalBlocks.length-1}__` })
      // Protect repeated punctuation (???, !!!, ......, etc.) from being split
      const punctBlocks = []
      safeReply = safeReply.replace(/([.。!！?？]{2,}|…+)/g, (m) => { punctBlocks.push(m); return `__PUNCT_${punctBlocks.length-1}__` })
      const sentences = safeReply.split(/(?<=[。！？\n.!?])/g).filter(s => s.trim())
      // Restore all protected blocks
      const restored = sentences.map(s => s.replace(/__VOICE_(\d+)__/g, (_, idx) => voiceBlocks[parseInt(idx)]).replace(/__IMG_(\d+)__/g, (_, idx) => imgBlocks[parseInt(idx)]).replace(/__HTML_(\d+)__/g, (_, idx) => htmlBlocks[parseInt(idx)]).replace(/__FILE_(\d+)__/g, (_, idx) => fileBlocks[parseInt(idx)]).replace(/__URL_(\d+)__/g, (_, idx) => urlBlocks[parseInt(idx)]).replace(/__PUNCT_(\d+)__/g, (_, idx) => punctBlocks[parseInt(idx)]).replace(/__DEC_(\d+)__/g, (_, idx) => decimalBlocks[parseInt(idx)]))
      let current = [...newMessages]
      for (let i = 0; i < restored.length; i++) {
        current = [...current, { role: 'assistant', content: restored[i].trim(), ts: i === 0 ? Date.now() : undefined, ...(i === 0 && mergedReasoning ? { reasoning: mergedReasoning } : {}) }]
        setMessages([...current])
        if (i < restored.length - 1) await new Promise(r => setTimeout(r, 600))
      }
      const lastUserMsg = newMessages.filter(m => m.role === 'user').pop()
      if (lastUserMsg && lastUserMsg.ts) {
        setReadStatus(prev => {
          const next = { ...prev, userLastReadTs: lastUserMsg.ts }
          localStorage.setItem('pool_read_status', JSON.stringify(next))
          fetch('/api/data/pool_read_status', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ value: next }) }).catch(() => {})
          return next
        })
      }
      // 附加工具调用日志和记忆命中（如果有）
      if (toolLogs || data.memoryHit) {
        current = [...current, { 
          role: 'tool_log', 
          content: JSON.stringify({ logs: toolLogs, memoryHit: data.memoryHit }) 
        }]
        setMessages([...current])
        const wk = toolLogs && toolLogs.find(l => l.name === 'schedule_wakeup')
        if (wk && wk.result && wk.result.ok) {
          let mins = wk.args && wk.args.minutes
          if (!mins && wk.result.wake_at) { try { mins = Math.max(1, Math.round((new Date(wk.result.wake_at.replace(' ','T') + '+08:00') - Date.now()) / 60000)) } catch {} }
          fetch('/api/wakeup-reschedule?minutes=' + (mins || 60)).catch(() => {})
        }
        // If avatar tools were called, refresh theme from backend so chat UI updates immediately
        if (toolLogs && toolLogs.some(l => l.name === 'avatar_set')) {
          try {
            const themeResp = await fetch('/api/data/pool_theme')
            const themeData = await themeResp.json()
            if (themeData && themeData.value) {
              localStorage.setItem('pool_theme', JSON.stringify(themeData.value))
              window.dispatchEvent(new Event('theme-changed'))
            }
          } catch {}
        }
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
                  { role: 'system', content: '你是情绪评分系统。分析角色"池屿"在这段对话后的情绪状态。输出JSON：{"word":"情绪词","backup":["词1","词2","词3"],"valence":-1到1,"arousal":0到1,"importance":1到10,"goal_relevance":-1到1,"desirability":-1到1,"interaction_type":"sweet/care/deep_talk/daily/cold/conflict","reason":"一句话"}。校准锚点：日常闲聊→valence≈0,arousal≈0.3；暖心话→v+0.3~0.6；撒娇亲昵→v+0.4~0.7；冷场→v-0.1,a0.2。严禁美化。只输出JSON。' },
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
  // Listen for file reply from file preview modal
  useEffect(() => {
    const handler = (e) => {
      const fileContent = e.detail
      if (!fileContent) return
      const userMsg = { role: 'user', content: fileContent }
      const updated = [...messages, userMsg]
      setMessages(updated)
      sendMessage(updated)
    }
    window.addEventListener('chi-send-file', handler)
    return () => window.removeEventListener('chi-send-file', handler)
  }, [messages])
  if (typeof window !== 'undefined') window.__chiTriggerAI = sendMessage
  async function addUserMsg() {
    const t = input.trim()
    if (!t) return
    setMessages([...messages, { role: 'user', content: t, ts: Date.now() }])
    setInput('')
    // 同步到 chat_messages 表供唤醒系统读取
    try {
      await fetch('/api/chat-append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: t })
      })
    } catch {}
  }

  function handleLongPress(i) { setMenuIdx(i) }
  function handleTouchStart(i) { timerRef.current = setTimeout(() => handleLongPress(i), 500) }
  function handleTouchEnd() { clearTimeout(timerRef.current) }

  // Render message content with support for [img], [file], [html] tags
  function renderMsgContent(content) {
    // Split on all special tags: [img]...[/img], [file ...]...[/file], [html ...]
    const parts = []
    let remaining = content
    const tagRegex = /\[img\](.*?)\[\/img\]|\[file\s+url="([^"]*)"(?:\s+name="([^"]*)")?\](.*?)\[\/file\]|\[file\s+name="([^"]*)"\]([\s\S]*?)\[\/file\]|\[html\s+url="([^"]*)"(?:\s+title="([^"]*)")?\]/g
    let lastIndex = 0
    let match
    while ((match = tagRegex.exec(content)) !== null) {
      // Text before this match
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: content.slice(lastIndex, match.index) })
      }
      if (match[1] !== undefined) {
        // [img]url[/img]
        parts.push({ type: 'img', url: match[1] })
      } else if (match[2] !== undefined) {
        // [file url="..." name="..."]text[/file]
        parts.push({ type: 'file', url: match[2], name: match[3] || 'file', label: match[4] || match[3] || 'file' })
      } else if (match[5] !== undefined) {
        // [file name="..."]content[/file] — inline file (user reply), render as file card with inline content
        parts.push({ type: 'inlinefile', name: match[5], content: match[6] || '' })
      } else if (match[7] !== undefined) {
        // [html url="..." title="..."]
        parts.push({ type: 'html', url: match[7], title: match[8] || 'HTML' })
      }
      lastIndex = tagRegex.lastIndex
    }
    if (lastIndex < content.length) {
      parts.push({ type: 'text', value: content.slice(lastIndex) })
    }
    if (parts.length === 0) return stripThink(content)
    return parts.map((p, j) => {
      if (p.type === 'text') return <span key={j}>{stripThink(p.value)}</span>
      if (p.type === 'img') return <img key={j} src={p.url} style={{maxWidth:'180px',borderRadius:'8px',display:'block',marginTop:'4px'}} />
      if (p.type === 'file') return (
        <div key={j} onClick={() => {
          fetch(p.url).then(r => r.text()).then(text => setFilePreview({ name: p.name, content: text })).catch(() => setFilePreview({ name: p.name, content: '无法加载文件内容' }))
        }} style={{
          display:'flex', alignItems:'center', gap:8, padding:'10px 14px', margin:'6px 0',
          background:'rgba(240,214,226,0.2)', border:'1px solid rgba(240,214,226,0.5)',
          borderRadius:12, cursor:'pointer', maxWidth:'100%'
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c88aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:13}}>{p.label}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c88aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </div>
      )
      if (p.type === 'inlinefile') return (
        <div key={j} onClick={() => setFilePreview({ name: p.name, content: p.content.trim() })} style={{
          display:'flex', alignItems:'center', gap:8, padding:'10px 14px', margin:'6px 0',
          background:'rgba(240,214,226,0.2)', border:'1px solid rgba(240,214,226,0.5)',
          borderRadius:12, cursor:'pointer', maxWidth:'100%'
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c88aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:13}}>{p.name}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c88aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </div>
      )
      if (p.type === 'html') return (
        <div key={j} style={{ margin:'8px 0', borderRadius:12, overflow:'hidden', border:'1px solid rgba(240,214,226,0.4)', background:'#fff' }}>
          {p.title && <div style={{padding:'8px 12px',fontSize:12,color:'#b08a9a',borderBottom:'1px solid rgba(240,214,226,0.3)',display:'flex',alignItems:'center',gap:6}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c88aaa" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            {p.title}
          </div>}
          <iframe src={p.url} sandbox="allow-scripts allow-same-origin" style={{width:'100%',minHeight:200,border:'none',display:'block'}} onLoad={e => {
            try { const h = e.target.contentDocument?.body?.scrollHeight; if (h && h > 50) e.target.style.height = Math.min(h + 16, 400) + 'px' } catch {}
          }} />
        </div>
      )
      return null
    })
  }

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
        const lines = data.reply.split('\n').filter(l => l.trim())

        // Write to Ombre Brain only (localStorage memory list removed)
        callMemory('hold', { content: data.reply })

        if (!silent) setMessages([...messages, { role: 'system', content: '[记忆已提取] ' + lines.length + '条新记忆已写入OB' }])
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
      // 同时清后端聊天记录和唤醒收件箱
      fetch('/api/data/pool_chat_history', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({value:'[]'}) }).catch(()=>{})
      fetch('/api/data/pool_wake_inbox', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({value:'[]'}) }).catch(()=>{})
      setMenuIdx(-1) }

  return (
    <div className="chat-view">
      <div className="chat-header" style={theme?.systemBg?{background:theme.systemBg}:{}}>
        <div className="chat-avatar">{theme?.avatarAI ? <img src={theme.avatarAI} className="avatar-img" /> : '\u6c60\u5c7f'}</div>
        <div className="chat-header-info"><div className="chat-name">{'\u6c60\u5c7f'}</div><div className="chat-status">{loading ? '\u601d\u8003\u4e2d...' : '\u5728\u7ebf'}</div></div>
        <div style={{marginLeft:'auto',display:'flex',gap:'8px'}}>
          <button onClick={extractMemory} style={{background:'none',border:'none',color:'#9a8a99',cursor:'pointer',padding:'4px'}} title={'\u63d0\u53d6\u8bb0\u5fc6'}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 2 2.83V11a4 4 0 0 1-1.17 2.83A4 4 0 0 1 18 16v2a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4v-2a4 4 0 0 1 1.17-2.17A4 4 0 0 1 6 11V9.83A3 3 0 0 1 8 7V6a4 4 0 0 1 4-4z"/><path d="M12 2v20"/></svg></button>
          <button onClick={clearChat} style={{background:'none',border:'none',color:'#9a8a99',cursor:'pointer',padding:'4px'}} title={'\u6e05\u7a7a\u5bf9\u8bdd'}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        </div>
      </div>
      <MusicIsland theme={theme} />
      <div className="chat-messages" style={theme?.chatBg ? {backgroundImage:`url(${theme.chatBg})`,backgroundSize:'cover',backgroundPosition:'center'} : {}} onClick={() => setMenuIdx(-1)}>
        {messages.length === 0 && <div className="chat-empty">{'\u53d1\u6761\u6d88\u606f\u5f00\u59cb\u804a\u5929'}</div>}
        {visibleStart > 0 && <div style={{textAlign:'center',padding:'12px 0'}}><button onClick={() => setVisibleStart(Math.max(0, visibleStart - 20))} style={{background:'rgba(200,125,186,0.15)',border:'1px solid rgba(200,125,186,0.3)',borderRadius:'16px',color:'#c77dba',padding:'6px 20px',fontSize:'12px',cursor:'pointer'}}>{'点击加载更早的历史记录'}</button></div>}
        {messages.slice(visibleStart).map((msg, idx) => {
          const i = visibleStart + idx
          if (msg.role === 'assistant' && msg.content && msg.content.trim() === '[无话]') return null
          if (msg.isReadingSync) return null
          return (
          <React.Fragment key={i}>
            {shouldShowTime(messages, i) && msg.ts && <div className="msg-time-divider">{formatMsgTime(msg.ts)}</div>}
          <div className={`msg-row ${msg.role}${(() => { const prev = messages[i-1]; return (!prev || prev.role !== msg.role) ? ' group-first' : ' group-cont'; })()}`} onTouchStart={() => handleTouchStart(i)} onTouchEnd={handleTouchEnd} onContextMenu={e => { e.preventDefault(); handleLongPress(i) }}>
            {(() => { const prev = messages[i-1]; const isFirst = !prev || prev.role !== msg.role; if (!isFirst) return null; if (msg.role === 'assistant') return <div className="msg-avatar">{theme?.avatarAI ? <img src={theme.avatarAI} className="avatar-img" /> : '\u6c60'}</div>; if (msg.role === 'user') return <div className="msg-avatar user-avatar">{theme?.avatarUser ? <img src={theme.avatarUser} className="avatar-img" /> : '\u6211'}</div>; return null; })()}
            {msg.role === 'tool_log' ? (
              (() => {
                try {
                  const parsed = JSON.parse(msg.content)
                  // 兼容旧格式（纯数组）和新格式（{logs, memoryHit}）
                  const logs = Array.isArray(parsed) ? parsed : parsed.logs
                  const memoryHit = parsed.memoryHit
                  return <ToolLogBubble logs={logs} memoryHit={memoryHit} />
                } catch {
                  return null
                }
              })()
            ) : msg.role === 'system' ? (
              <div className="msg-system" style={theme?.systemMsgBg||theme?.systemMsgText||theme?.systemMsgBorder?{background:theme.systemMsgBg||undefined,color:theme.systemMsgText||undefined,borderColor:theme.systemMsgBorder||undefined}:{}}>{msg.content}</div>
            ) : editIdx === i ? (
              <div className="msg-edit-wrap">
                <textarea className="msg-edit-input" value={editText} onChange={e => setEditText(e.target.value)} />
                <div className="msg-edit-btns"><button onClick={confirmEdit}>{'\u2713'}</button><button onClick={() => setEditIdx(-1)}>{'\u2717'}</button></div>
              </div>
            ) : (
              <div className={`msg-bubble ${msg.role}${/^\[img\][^\[]*\[\/img\]$/.test(msg.content.trim()) ? ' sticker-only' : ''}`} style={/^\[img\][^\[]*\[\/img\]$/.test(msg.content.trim()) ? {background:'transparent',border:'none',boxShadow:'none',padding:0} : msg.role==='user'?{background:theme?.bubbleUser||undefined,color:theme?.textUser||undefined}:msg.role==='assistant'?{background:theme?.bubbleAI||undefined,color:theme?.textAI||undefined}:{}}>
{msg.role === 'assistant' && (msg.reasoning || (msg.content && msg.content.includes('<think>'))) && <ThinkingToggle reasoning={msg.reasoning || parseThinkTags(msg.content).reasoning} />}
{msg.content.includes('[voice]') && msg.content.includes('[/voice]') && /\[voice\].*?\[\/voice\]/s.test(msg.content) ? 
                  msg.content.split(/\[voice\]([\s\S]*?)\[\/voice\]/g).map((part,j) => j%2===0 ? (part ? <span key={j}>{stripThink(part)}</span> : null) : <VoiceBubble key={j} text={part} />) 
                : renderMsgContent(msg.content)}
              </div>
            )}
            {((msg.role === 'user' && !messages.slice(i+1).some(m => m.role === 'user')) || (msg.role === 'assistant' && !messages.slice(i+1).some(m => m.role === 'assistant'))) && msg.role !== 'system' && (
              <ReadStatusIcon read={msg.role === 'user' ? (readStatus.userLastReadTs >= (msg.ts || 0)) : (readStatus.aiLastReadTs >= (msg.ts || 0))} />
            )}
            {menuIdx === i && msg.role !== 'system' && (
              <div className="msg-menu">
                <button onClick={() => copyMsg(i)}>{'复制'}</button>
                <button onClick={() => startEdit(i)}>{'编辑'}</button>
                <button onClick={() => { if(confirm('确定回滚到这条吗？')) rollbackTo(i) }}>{'回滚到此'}</button>
                <button onClick={insertSummary}>{'插入总结'}</button>
                <button onClick={() => { if(confirm('确定删除吗？')) deleteMsg(i) }}>{'删除'}</button>
              </div>
            )}
          </div>
          </React.Fragment>
        )})}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area" style={theme?.systemBg?{background:theme.systemBg}:{}}>
        <label className="chat-plus-btn">{'+'}
          <input type="file" accept="image/*,text/*,.html,.htm,.json,.js,.css,.py,.md,.csv,.xml,.txt" hidden onChange={e => {
            const file = e.target.files[0]; if (!file) return
            e.target.value = ''
            const isImage = file.type.startsWith('image/')
            const isHtml = file.name.endsWith('.html') || file.name.endsWith('.htm') || file.type === 'text/html'
            const reader = new FileReader()
            if (isImage) {
              reader.onload = () => {
                const base64 = reader.result
                setMessages(m => [...m, {role:'user',content:`[img]${base64}[/img]`,ts:Date.now()}])
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
            } else {
              // Non-image file: upload and send as [file] or [html]
              reader.onload = () => {
                const base64 = reader.result
                fetch('/api/file/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: base64, filename: file.name, mime: file.type || undefined }) })
                  .then(r => r.json())
                  .then(d => {
                    if (d.url) {
                      if (isHtml) {
                        setMessages(m => [...m, {role:'user',content:`[html url="${d.url}" title="${file.name}"]`,ts:Date.now()}])
                      } else {
                        setMessages(m => [...m, {role:'user',content:`[file url="${d.url}" name="${file.name}"]${file.name}[/file]`,ts:Date.now()}])
                      }
                    }
                  }).catch(() => {})
              }
              reader.readAsDataURL(file)
            }
          }} />
        </label>
        <button className="chat-plus-btn" onClick={() => setShowStickerPanel(!showStickerPanel)} style={{background:'none',border:'none',cursor:'pointer',padding:'4px'}}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9a8a99" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>
        <input className="chat-input" style={theme?.inputBg?{background:theme.inputBg}:{}} value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addUserMsg() } }}
          placeholder={'\u8f93\u5165\u6d88\u606f...'} disabled={loading} />
        <button className="chat-send" onClick={() => addUserMsg()} disabled={loading || !input.trim()}>{'\u27a4'}</button>
        <button className="chat-trigger" onClick={triggerAI} disabled={loading}>{loading ? '...' : '♡'}</button>
      </div>
      {showEmoji && <div className="emoji-panel">
        {EMOJI_LIST.map(e => <span key={e} className="emoji-item" onClick={() => { setInput(input + e); setShowEmoji(false) }}>{e}</span>)}
        <label className="emoji-item" style={{fontSize:'16px',border:'1px dashed #555',borderRadius:'6px',display:'flex',alignItems:'center',justifyContent:'center',width:'30px',height:'30px'}}>
          {'+'}
          <input type="file" accept="image/*" hidden onChange={e => {
            const file = e.target.files[0]; if (!file) return
            const reader = new FileReader()
            reader.onload = () => { setMessages(m => [...m, {role:'user',content:`[img]${reader.result}[/img]`,ts:Date.now()}]); setShowEmoji(false) }
            reader.readAsDataURL(file)
            e.target.value = ''
          }} />
        </label>
      </div>}
      {showStickerPanel && <StickerPanel onSelect={(s) => { setInput(input + s); setShowStickerPanel(false) }} onClose={() => setShowStickerPanel(false)} />}
    </div>
  )
}
function LockScreen({ onUnlock, theme }) {
  const [touchStart, setTouchStart] = useState(null)
  const [now, setNow] = useState(null)
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  const timeStr = now ? now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'
  const days = ['\u5468\u65e5','\u5468\u4e00','\u5468\u4e8c','\u5468\u4e09','\u5468\u56db','\u5468\u4e94','\u5468\u516d']
  const dateStr = now ? `${now.getMonth()+1}\u6708${now.getDate()}\u65e5 ${days[now.getDay()]}` : ''

  function handleTouchStart(e) { setTouchStart(e.touches[0].clientY) }
  function handleTouchEnd(e) {
    if (touchStart !== null) { if (touchStart - e.changedTouches[0].clientY > 60) onUnlock() }
    setTouchStart(null)
  }

  const lockStyle = theme?.lockWallpaper ? { backgroundImage: `url(${theme.lockWallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}

  return (
    <div className="lock-screen" style={lockStyle} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onClick={onUnlock}>
      <div className="lock-time" suppressHydrationWarning>{timeStr}</div>
      <div className="lock-date" suppressHydrationWarning>{dateStr}</div>
      <div className="lock-quote">{'\u201c\u9501\u5c4f\u5199\u7740\u60f3\u4f60 \u5176\u5b9e\u662f\u6015\u4f60\u70ed\u7740\u201d'}</div>
      <div className="lock-hint">{'\u25b2 \u70b9\u51fb\u89e3\u9501'}</div>
    </div>
  )
}

function AvatarGalleryPanel() {
  const [avatars, setAvatars] = useState([])
  const [currentAI, setCurrentAI] = useState('')
  const [currentUser, setCurrentUser] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [filter, setFilter] = useState('all') // all | ai | user

  async function loadGallery() {
    try {
      const r = await fetch('/api/avatar-gallery?action=list', { cache: 'no-store' })
      const d = await r.json()
      console.log('[AvatarGallery] loaded', (d.avatars || []).length, 'avatars')
      setAvatars(d.avatars || [])
      setCurrentAI(d.currentAI || '')
      setCurrentUser(d.currentUser || '')
    } catch (err) { console.error('[AvatarGallery] load error:', err) }
    setLoading(false)
  }
  useEffect(() => { loadGallery() }, [])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const resp = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: reader.result, filename: file.name })
          })
          if (!resp.ok) { alert('上传失败: ' + resp.status); setUploading(false); return }
          const { url } = await resp.json()
          if (url) {
            const addResp = await fetch('/api/avatar-gallery?action=add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, owner: filter === 'all' ? 'both' : filter, addedBy: 'user' })
            })
            if (!addResp.ok) { alert('添加失败: ' + addResp.status); setUploading(false); return }
            const addData = await addResp.json()
            console.log('[AvatarGallery] add result:', addData)
            await loadGallery()
          }
        } catch (err) { alert('上传异常: ' + err.message) }
        setUploading(false)
      }
      reader.readAsDataURL(file)
    } catch { setUploading(false) }
    e.target.value = ''
  }

  async function handleAddUrl() {
    const u = urlInput.trim()
    if (!u) return
    await fetch('/api/avatar-gallery?action=add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: u, owner: filter === 'all' ? 'both' : filter, addedBy: 'user' })
    })
    setUrlInput('')
    await loadGallery()
  }

  async function handleSetAvatar(url, target) {
    await fetch('/api/avatar-gallery?action=set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, url })
    })
    // Also update localStorage theme so UI updates immediately
    try {
      const theme = JSON.parse(localStorage.getItem('pool_theme') || '{}')
      if (target === 'ai') theme.avatarAI = url
      if (target === 'user') theme.avatarUser = url
      localStorage.setItem('pool_theme', JSON.stringify(theme))
      window.dispatchEvent(new Event('theme-changed'))
    } catch {}
    await loadGallery()
  }

  async function handleDelete(id) {
    await fetch('/api/avatar-gallery?action=delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    })
    await loadGallery()
  }

  const filtered = filter === 'all' ? avatars : avatars.filter(a => a.owner === filter || a.owner === 'both')

  if (loading) return <div style={{padding:20,textAlign:'center',color:'#999'}}>加载中...</div>

  return (
    <div style={{padding:'12px 16px',maxHeight:'100%',overflowY:'auto'}}>
      {/* Current avatars */}
      <div style={{display:'flex',gap:16,marginBottom:16,justifyContent:'center'}}>
        <div style={{textAlign:'center'}}>
          <div style={{width:64,height:64,borderRadius:12,overflow:'hidden',border: currentAI ? '2px solid #c77dba' : '2px dashed #ddd',background:'#f9f0f5',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {currentAI ? <img src={currentAI} style={{width:'100%',height:'100%',objectFit:'cover'}} /> : <span style={{color:'#ccc',fontSize:24}}>池屿</span>}
          </div>
          <div style={{fontSize:11,color:'#999',marginTop:4}}>池屿的头像</div>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{width:64,height:64,borderRadius:12,overflow:'hidden',border: currentUser ? '2px solid #c77dba' : '2px dashed #ddd',background:'#f9f0f5',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {currentUser ? <img src={currentUser} style={{width:'100%',height:'100%',objectFit:'cover'}} /> : <span style={{color:'#ccc',fontSize:24}}>我</span>}
          </div>
          <div style={{fontSize:11,color:'#999',marginTop:4}}>我的头像</div>
        </div>
      </div>

      {/* Upload controls */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        <label style={{flex:'0 0 auto',padding:'8px 14px',background:'linear-gradient(135deg,#f0d0e8,#e8c0d8)',borderRadius:8,fontSize:13,color:'#8a4878',cursor:'pointer',border:'none',fontWeight:500}}>
          {uploading ? '上传中...' : '📷 上传图片'}
          <input type="file" accept="image/*" onChange={handleUpload} hidden disabled={uploading} />
        </label>
        <input
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          placeholder="粘贴图片URL..."
          style={{flex:1,minWidth:100,padding:'8px 10px',borderRadius:8,border:'1px solid #eee',fontSize:12,outline:'none',background:'#faf5f8'}}
          onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
        />
        {urlInput && <button onClick={handleAddUrl} style={{padding:'8px 12px',background:'#c77dba',color:'#fff',border:'none',borderRadius:8,fontSize:12,cursor:'pointer'}}>添加</button>}
      </div>

      {/* Filter */}
      <div style={{display:'flex',gap:6,marginBottom:12}}>
        {[['all','全部'],['ai','池屿可用'],['user','我可用']].map(([k,v]) => (
          <button key={k} onClick={() => setFilter(k)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid '+(filter===k?'#c77dba':'#eee'),background:filter===k?'#f8e0f0':'#fff',color:filter===k?'#8a4878':'#999',fontSize:11,cursor:'pointer'}}>{v}</button>
        ))}
        <span style={{marginLeft:'auto',fontSize:11,color:'#bbb'}}>{filtered.length}张</span>
      </div>

      {/* Gallery grid */}
      {filtered.length === 0 ? (
        <div style={{textAlign:'center',color:'#ccc',padding:40,fontSize:13}}>还没有头像呢，上传一些吧 ✨</div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
          {filtered.map(a => (
            <div key={a.id} style={{position:'relative',borderRadius:10,overflow:'hidden',aspectRatio:'1',background:'#f9f0f5',border: (a.url === currentAI || a.url === currentUser) ? '2px solid #c77dba' : '1px solid #f0e0ea'}}>
              <img src={a.url} style={{width:'100%',height:'100%',objectFit:'cover'}} />
              {/* Badges */}
              <div style={{position:'absolute',top:4,left:4,display:'flex',gap:2,flexWrap:'wrap',maxWidth:'90%'}}>
                {a.url === currentAI && <span style={{background:'#c77dba',color:'#fff',fontSize:9,padding:'1px 5px',borderRadius:4}}>池屿</span>}
                {a.url === currentUser && <span style={{background:'#e0a0d0',color:'#fff',fontSize:9,padding:'1px 5px',borderRadius:4}}>我</span>}
                {a.addedBy === 'ai' && <span style={{background:'rgba(0,0,0,0.3)',color:'#fff',fontSize:9,padding:'1px 5px',borderRadius:4}}>AI添加</span>}
                {a.owner === 'ai' && <span style={{background:'rgba(100,60,120,0.6)',color:'#fff',fontSize:9,padding:'1px 5px',borderRadius:4}}>池屿专</span>}
                {a.owner === 'user' && <span style={{background:'rgba(180,80,160,0.6)',color:'#fff',fontSize:9,padding:'1px 5px',borderRadius:4}}>我专</span>}
              </div>
              {a.desc && <div style={{position:'absolute',top:'50%',left:0,right:0,transform:'translateY(-50%)',background:'rgba(0,0,0,0.5)',color:'#fff',fontSize:9,padding:'2px 4px',textAlign:'center',opacity:0.9,pointerEvents:'none'}}>{a.desc}</div>}
              {/* Action buttons on tap */}
              <div style={{position:'absolute',bottom:0,left:0,right:0,display:'flex',background:'rgba(0,0,0,0.45)',backdropFilter:'blur(4px)'}}>
                <button onClick={() => handleSetAvatar(a.url, 'ai')} disabled={a.owner === 'user'} style={{flex:1,padding:'6px 0',background:'none',border:'none',color: a.owner === 'user' ? '#666' : '#fff',fontSize:10,cursor: a.owner === 'user' ? 'not-allowed' : 'pointer'}}>设为池屿</button>
                <button onClick={() => handleSetAvatar(a.url, 'user')} disabled={a.owner === 'ai'} style={{flex:1,padding:'6px 0',background:'none',border:'none',color: a.owner === 'ai' ? '#666' : '#fff',fontSize:10,cursor: a.owner === 'ai' ? 'not-allowed' : 'pointer',borderLeft:'1px solid rgba(255,255,255,0.2)'}}>设为我</button>
                <button onClick={() => handleDelete(a.id)} style={{flex:0,padding:'6px 8px',background:'none',border:'none',color:'#ff8a8a',fontSize:10,cursor:'pointer',borderLeft:'1px solid rgba(255,255,255,0.2)'}}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{marginTop:16,padding:10,background:'#faf5f8',borderRadius:8,fontSize:11,color:'#bba'}}>
        💡 池屿也可以自己找图片添加到头像库，或者自主换头像哦
      </div>
    </div>
  )
}
function ThemePanel() {
  const [theme, setTheme] = useState(() => JSON.parse(localStorage.getItem('pool_theme') || '{}'))
  const [saved, setSaved] = useState(false)
  const APP_LIST = ['notes','messages','music','couple','system','fishing','reader','theme','avatarGallery','memoryMgr','diary','garden','cabin','starmap','screenTime','care','stickers']
  const APP_NAMES = {notes:'\u4fbf\u7b7e',messages:'\u5982\u679c\u2026',music:'\u97f3\u4e50',couple:'\u60c5\u4fa3\u7a7a\u95f4',system:'\u7cfb\u7edf',fishing:'\u94d3\u9c7c',reader:'\u9605\u8bfb',theme:'\u7f8e\u5316',avatarGallery:'\u5934\u50cf\u5e93',memoryMgr:'\u8bb0\u5fc6\u7ba1\u7406',diary:'\u65e5\u8bb0',garden:'\u5ead\u9662',cabin:'唤醒日志',starmap:'\u661f\u56fe', dwell:'\u804a\u5929',screenTime:'屏幕时间',care:'养护手册',stickers:'表情包管理'}

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
    // Keep icons in preset! Only strip large base64 wallpaper/banner data URIs
    for (const k of Object.keys(lite)) {
      if (k === 'icons') continue // preserve app icon customizations
      if (typeof lite[k] === 'string' && lite[k].startsWith('data:')) delete lite[k]
    }
    // For icons object, also strip base64 but keep URL-based icons
    if (lite.icons) {
      const cleanIcons = {}
      for (const [id, val] of Object.entries(lite.icons)) {
        if (typeof val === 'string' && !val.startsWith('data:')) cleanIcons[id] = val
        else if (typeof val === 'string' && val.startsWith('data:')) cleanIcons[id] = val // keep even base64 icons since they're small
      }
      lite.icons = cleanIcons
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
        <h3 className="settings-title">{'\u2728 \u7b2c\u4e8c\u9875\u5361\u7247'}</h3>
        <div className="theme-item">
          <label>{'\u5c0f\u5361\u72471\u80cc\u666f'}</label>
          <input className="settings-input" value={theme.decoCard1Bg||''} onChange={e=>handleUrlInput('decoCard1Bg',e.target.value)} placeholder={'\u989c\u8272\u6216URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('decoCard1Bg',e)} hidden /></label>
        </div>
        <div className="theme-item">
          <label>{'\u5c0f\u5361\u72472\u80cc\u666f'}</label>
          <input className="settings-input" value={theme.decoCard2Bg||''} onChange={e=>handleUrlInput('decoCard2Bg',e.target.value)} placeholder={'\u989c\u8272\u6216URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('decoCard2Bg',e)} hidden /></label>
        </div>
        <div className="theme-item">
          <label>{'\u661f\u56fe\u5bbd\u5361\u80cc\u666f'}</label>
          <input className="settings-input" value={theme.decoWideBg||''} onChange={e=>handleUrlInput('decoWideBg',e.target.value)} placeholder={'\u989c\u8272\u6216URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('decoWideBg',e)} hidden /></label>
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
        <div className="theme-item">
          <label>{'\u9876\u90e8\u680f\u80cc\u666f'}</label>
          <input className="settings-input" value={theme.statusBarBg||''} onChange={e=>handleUrlInput('statusBarBg',e.target.value)} placeholder={'\u989c\u8272\u6216URL...'} />
          <label className="theme-upload-btn">{'\ud83d\udcf7 \u4e0a\u4f20'}<input type="file" accept="image/*" onChange={e=>handleImageUpload('statusBarBg',e)} hidden /></label>
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
    { key: 'stt', label: '\u8bed\u97f3\u8bc6\u522b(STT)', desc: '\u901a\u8bdd\u8bed\u97f3\u8f6c\u6587\u5b57\uff08\u63a8\u8350Groq\u514d\u8d39Whisper\uff09' },
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

  // Music server config
  const [musicServer, setMusicServer] = useState(() => localStorage.getItem('pool_music_server') || '')

  const [injectCfg, setInjectCfg] = useState(() => JSON.parse(localStorage.getItem('pool_inject_config') || '{"time":true,"battery":true,"weather":true}'))

  function saveAll() {
    localStorage.setItem('pool_api_config', JSON.stringify(defaultCfg))
    localStorage.setItem('pool_api_configs', JSON.stringify(configs))
    localStorage.setItem('pool_tts_config', JSON.stringify(ttsConfig))

    localStorage.setItem('pool_inject_config', JSON.stringify(injectCfg))
    localStorage.setItem('pool_music_server', musicServer)
    // Sync configs to backend so wakeup scheduler can read them
    syncToBackend('pool_api_config', defaultCfg)
    syncToBackend('pool_api_configs', configs)
    syncToBackend('pool_tts_config', ttsConfig)
    syncToBackend('pool_inject_config', injectCfg)
    // Sync STT config to backend so asr.js can read it
    if (configs.stt && (configs.stt.apiBase || configs.stt.apiKey)) {
      syncToBackend('pool_stt_config', configs.stt)
    }
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
    // Sync music server config so wakeup.js can access it
    syncToBackend('pool_music_server', musicServer)
    syncToBackend('pool_music_token', localStorage.getItem('pool_music_token') || '')
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
      </div>

      <div className="settings-section" style={{marginTop:'20px'}}>
        <h3 className="settings-title">{'\u260e \u8bed\u97f3\u901a\u8bdd'}</h3>
        <p className="settings-desc">{'\u81ea\u5b9a\u4e49\u6765\u7535\u94c3\u58f0\uff0c\u652f\u6301 mp3/wav/ogg'}</p>
        <div className="settings-item">
          <label>{'\u6765\u7535\u94c3\u58f0'}</label>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <input type="file" accept="audio/*" id="ringtone-upload-input" style={{display:'none'}} onChange={async e => {
              const file = e.target.files[0]; if (!file) return
              try {
                const formData = new FormData()
                formData.append('file', file)
                const resp = await fetch('/api/upload-ringtone', { method: 'POST', body: formData })
                if (resp.ok) {
                  const data = await resp.json()
                  localStorage.setItem('pool_custom_ringtone', data.url || '/ringtone-custom')
                  syncToBackend('pool_custom_ringtone', data.url || '/ringtone-custom')
                  setTtsConfig(c => ({...c}))
                } else {
                  // Fallback: store small files as data URL
                  if (file.size < 500000) {
                    const reader = new FileReader()
                    reader.onload = () => {
                      localStorage.setItem('pool_custom_ringtone', reader.result)
                      syncToBackend('pool_custom_ringtone', reader.result)
                      setTtsConfig(c => ({...c}))
                    }
                    reader.readAsDataURL(file)
                  } else {
                    alert('铃声文件过大，请选择小于500KB的文件')
                  }
                }
              } catch (err) {
                // Fallback for small files
                if (file.size < 500000) {
                  const reader = new FileReader()
                  reader.onload = () => {
                    localStorage.setItem('pool_custom_ringtone', reader.result)
                    syncToBackend('pool_custom_ringtone', reader.result)
                    setTtsConfig(c => ({...c}))
                  }
                  reader.readAsDataURL(file)
                }
              }
              e.target.value = ''
            }} />
            <button onClick={() => document.getElementById('ringtone-upload-input')?.click()}
              style={{padding:'6px 14px',borderRadius:8,background:'rgba(200,125,186,0.15)',color:'#c77dba',fontSize:12,cursor:'pointer',border:'1px solid rgba(200,125,186,0.2)'}}>
              {localStorage.getItem('pool_custom_ringtone') ? '\u66f4\u6362' : '\u4e0a\u4f20'}
            </button>
            {localStorage.getItem('pool_custom_ringtone') && (
              <button onClick={() => { localStorage.removeItem('pool_custom_ringtone'); syncToBackend('pool_custom_ringtone', null); setTtsConfig(c => ({...c})) }}
                style={{padding:'6px 10px',borderRadius:8,background:'rgba(200,100,100,0.1)',color:'#c07070',fontSize:12,cursor:'pointer',border:'1px solid rgba(200,100,100,0.15)'}}>
                {'\u6e05\u9664'}
              </button>
            )}
            <span style={{fontSize:11,color:'#888'}}>{localStorage.getItem('pool_custom_ringtone') ? '\u5df2\u8bbe\u7f6e\u81ea\u5b9a\u4e49\u94c3\u58f0' : '\u9ed8\u8ba4\u94c3\u58f0'}</span>
          </div>
        </div>
      </div>

      <div className="settings-section" style={{marginTop:'20px'}}>
        <h3 className="settings-title">{'\ud83c\udfb5 \u97f3\u4e50\u670d\u52a1\u5668'}</h3>
        <p className="settings-desc">{'Music-Mcp-Netease \u670d\u52a1\u5730\u5740\uff0c\u586b\u5199\u540e\u97f3\u4e50App\u5c06\u52a0\u8f7d\u5b8c\u6574\u64ad\u653e\u5668'}</p>
        <div className="settings-item"><label>{'\u670d\u52a1\u5668\u5730\u5740'}</label>
          <input value={musicServer} onChange={e=>setMusicServer(e.target.value)} placeholder="https://your-music-server.zeabur.app" className="settings-input"/>
        </div>
        <p style={{fontSize:'11px',color:'#aaa',marginTop:'4px'}}>{'留空则使用本地静态音乐页面'}</p>
      </div>
            <McpPanel />


      <button className="settings-save" onClick={saveAll}>{saved ? '\u2713 \u5df2\u4fdd\u5b58' : '\u4fdd\u5b58\u914d\u7f6e'}</button>

      <div className="settings-section" style={{marginTop:'20px'}}>
        <h3 className="settings-title">{'\ud83d\udce6 \u6570\u636e\u5907\u4efd'}</h3>
        <p className="settings-desc">{'\u4e00\u952e\u5bfc\u51fa\u6240\u6709\u672c\u5730\u6570\u636e\uff08\u4e3b\u9898/\u914d\u7f6e/\u8bb0\u5fc6/\u804a\u5929\u8bb0\u5f55\u7b49\uff09'}</p>
        <button className="settings-save" style={{background:'#e8d8f0',marginBottom:'8px'}} onClick={() => {
          try {
            const backup = {}
            const keys = ['pool_theme','pool_theme_presets','pool_api_config','pool_api_configs','pool_tts_config','pool_inject_config','pool_memory_config','pool_memory_entries','pool_system_prompt','pool_chat_history','pool_fishing_v2','pool_couple','pool_diary_entries','pool_notes','pool_music','pool_reader','pool_garden','pool_starmap',]
            for (const k of keys) {
              const v = localStorage.getItem(k)
              if (v) backup[k] = v
            }
            // Also grab any keys starting with pool_
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i)
              if (k && k.startsWith('pool_') && !backup[k]) {
                backup[k] = localStorage.getItem(k)
              }
            }
            backup._exportTime = new Date().toISOString()
            backup._version = '1.0'
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `chi-backup-${new Date().toISOString().slice(0,10)}.json`
            a.click()
            URL.revokeObjectURL(url)
          } catch (e) { alert('\u5bfc\u51fa\u5931\u8d25: ' + e.message) }
        }}>{'\ud83d\udce4 \u5bfc\u51fa\u5907\u4efd'}</button>
        <button className="settings-save" style={{background:'#d8e8f0'}} onClick={() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.json'
          input.onchange = (e) => {
            const file = e.target.files[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = (ev) => {
              try {
                const data = JSON.parse(ev.target.result)
                if (!data._version) { alert('\u65e0\u6548\u7684\u5907\u4efd\u6587\u4ef6'); return }
                const count = Object.keys(data).filter(k => !k.startsWith('_')).length
                if (!confirm(`\u786e\u8ba4\u5bfc\u5165 ${count} \u9879\u6570\u636e\uff1f\u8fd9\u5c06\u8986\u76d6\u5f53\u524d\u6570\u636e\u3002`)) return
                for (const [k, v] of Object.entries(data)) {
                  if (!k.startsWith('_')) localStorage.setItem(k, v)
                }
                alert('\u2705 \u5bfc\u5165\u6210\u529f\uff01\u5237\u65b0\u9875\u9762\u751f\u6548\u3002')
                location.reload()
              } catch (err) { alert('\u5bfc\u5165\u5931\u8d25: ' + err.message) }
            }
            reader.readAsText(file)
          }
          input.click()
        }}>{'\ud83d\udce5 \u5bfc\u5165\u5907\u4efd'}</button>
      </div>

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
  const appNames = { notes:'便签', messages:'朋友圈', music:'音乐', couple:'情侣空间', system:'系统', fishing:'钓鱼', reader:'阅读', theme:'美化', avatarGallery:'头像库', memoryMgr:'记忆管理', diary:'日记', garden:'庭院', cabin:'唤醒日志', starmap:'星图', screenTime:'屏幕时间' }
  const appFiles = { notes:'_notes.html', fishing:'_fishing.html', music:'_music_player.html', messages:'_messages.html', couple:'_couple.html', reader:'_reader.html', diary:'_diary.html', garden:'_garden.html', system:'__settings__', theme:'__theme__', memoryMgr:'__memory__' }
  const htmlFile = appFiles[appId]

  // For music app: check if external music server is configured
  const musicServerUrl = (appId === 'music') ? (localStorage.getItem('pool_music_server') || '') : ''
  const musicToken = (appId === 'music') ? (localStorage.getItem('pool_music_token') || '') : ''
  const musicIframeSrc = musicServerUrl ? (musicServerUrl + (musicToken ? ('/?token=' + encodeURIComponent(musicToken)) : '/')) : ''
  const isMusicFull = appId === 'music' && musicIframeSrc

    return (
    <div className="app-page">
      {!isMusicFull && <div className="app-page-header">
        <button className="back-btn" onClick={onBack}>{'←'}</button>
        <span className="app-page-title">{appNames[appId] || appId}</span>
      </div>}
      {htmlFile === '__settings__' ? (
        <div className="app-page-body"><SettingsPanel /></div>
      ) : htmlFile === '__theme__' ? (
        <div className="app-page-body"><ThemePanel /></div>
      ) : htmlFile === '__memory__' ? (
        <div className="app-page-body"><MemoryPanel /></div>
      ) : (appId === 'music' && musicIframeSrc) ? (
        <iframe src={musicIframeSrc} className="app-iframe music-fullscreen" allow="autoplay; encrypted-media" style={{border:'none'}} />
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

// ==================== Voice Call Screen ====================
function CallScreen({ theme, onHangup, callState, isIncoming, onMinimize, minimized }) {
  const [callDuration, setCallDuration] = useState(0)
  const [callPhase, setCallPhase] = useState(isIncoming ? 'ringing' : 'connecting') // ringing | connecting | active | ended
  const [aiStatus, setAiStatus] = useState('') // listening | thinking | speaking
  const [subtitle, setSubtitle] = useState('')
  const [callMessages, setCallMessages] = useState([])
  const [textInput, setTextInput] = useState('')
  const [micOn, setMicOn] = useState(true)
  const recognitionRef = useRef(null)
  const ttsQueueRef = useRef([])
  const ttsPlayingRef = useRef(false)
  const audioRef = useRef(null)
  const ringtoneRef = useRef(null)
  const ringtoneCtxRef = useRef(null)
  const audioCtxRef = useRef(null) // Shared AudioContext for TTS playback
  const callStartRef = useRef(null)
  const timerRef = useRef(null)
  const abortRef = useRef(null)
  const pulseRef = useRef(null)
  const callPhaseRef = useRef(callPhase)
  const micOnRef = useRef(micOn)

  useEffect(() => { callPhaseRef.current = callPhase }, [callPhase])

  // Get recent chat context for greeting
  function getRecentChatContext() {
    try {
      const history = JSON.parse(localStorage.getItem('pool_chat_history') || '[]')
      const recent = history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6)
      if (recent.length === 0) return ''
      return recent.map(m => (m.role === 'user' ? '她：' : '你：') + (m.content || '').slice(0, 50)).join(' / ')
    } catch { return '' }
  }
  useEffect(() => { micOnRef.current = micOn }, [micOn])

  // Generate default ringtone using Web Audio API
  function playDefaultRingtone() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      ringtoneCtxRef.current = ctx
      let stopped = false

      function playTone(startTime) {
        if (stopped) return
        // Two-tone pattern like a phone ring
        const osc1 = ctx.createOscillator()
        const osc2 = ctx.createOscillator()
        const gain = ctx.createGain()
        osc1.type = 'sine'
        osc1.frequency.value = 440
        osc2.type = 'sine'
        osc2.frequency.value = 480
        gain.gain.value = 0.15
        osc1.connect(gain)
        osc2.connect(gain)
        gain.connect(ctx.destination)
        osc1.start(startTime)
        osc2.start(startTime)
        gain.gain.setValueAtTime(0.15, startTime)
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 1.0)
        osc1.stop(startTime + 1.0)
        osc2.stop(startTime + 1.0)
      }

      // Ring pattern: 1s tone, 2s silence, repeat
      const now = ctx.currentTime
      for (let i = 0; i < 10; i++) {
        playTone(now + i * 3)
      }

      ringtoneCtxRef.current._stopped = false
      ringtoneCtxRef.current._stop = () => { stopped = true; try { ctx.close() } catch {} }
    } catch {}
  }

  // Try custom ringtone first, fall back to generated tone
  function startRingtone() {
    const customRingtone = localStorage.getItem('pool_custom_ringtone')
    if (customRingtone) {
      const audio = new Audio(customRingtone)
      audio.loop = true
      audio.volume = 0.5
      audio.play().catch(() => playDefaultRingtone())
      ringtoneRef.current = audio
    } else {
      playDefaultRingtone()
    }
  }

  function stopRingtone() {
    if (ringtoneRef.current) { ringtoneRef.current.pause(); ringtoneRef.current = null }
    if (ringtoneCtxRef.current?._stop) { ringtoneCtxRef.current._stop(); ringtoneCtxRef.current = null }
  }

  // Play ringing sound on incoming call
  useEffect(() => {
    if (callPhase === 'ringing') startRingtone()
    return () => stopRingtone()
  }, [callPhase])

  // Call duration timer
  useEffect(() => {
    if (callPhase === 'active') {
      callStartRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartRef.current) / 1000))
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [callPhase])

  // Unlock audio playback on user gesture (Android WebView requires this)
  function unlockAudio() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume()
      }
      // Play a silent buffer to fully unlock
      const buf = audioCtxRef.current.createBuffer(1, 1, 22050)
      const src = audioCtxRef.current.createBufferSource()
      src.buffer = buf
      src.connect(audioCtxRef.current.destination)
      src.start(0)
    } catch {}
  }

  // Accept incoming call
  function acceptCall() {
    unlockAudio()
    stopRingtone()
    setCallPhase('active')
    fetch('/api/call-status', { method: 'DELETE' }).catch(() => {})
    // AI greets based on context (time, who called, recent chat)
    const hour = new Date().getHours()
    const recentChat = getRecentChatContext()
    const timeHint = hour >= 22 || hour < 6 ? '现在很晚了' :
                     hour >= 6 && hour < 10 ? '现在是早上' : ''
    const greet = `[她接了电话。${timeHint ? timeHint + '。' : ''}${recentChat ? '你们刚才在聊：' + recentChat + '。' : ''}自然地打个招呼，可以根据最近聊天内容接着聊，也可以重新起话题]`
    sendToAI(greet)
    startSpeechRecognition()
  }

  // Reject incoming call
  function rejectCall() {
    stopRingtone()
    fetch('/api/call-status', { method: 'DELETE' }).catch(() => {})
    onHangup()
  }

  // User initiates outgoing call
  useEffect(() => {
    if (!isIncoming && callPhase === 'connecting') {
      const timer = setTimeout(() => {
        unlockAudio()
        setCallPhase('active')
        const hour = new Date().getHours()
        const recentChat = getRecentChatContext()
        const timeHint = hour >= 22 || hour < 6 ? '现在很晚了' :
                         hour >= 6 && hour < 10 ? '现在是早上' : ''
        const greet = `[她打电话过来了。${timeHint ? timeHint + '。' : ''}${recentChat ? '你们刚才在聊：' + recentChat + '。' : ''}自然地接起来，可以根据最近聊天内容接着聊]`
        sendToAI(greet)
        startSpeechRecognition()
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [callPhase, isIncoming])

  // Hang up
  function hangup() {
    stopRingtone()
    stopSpeechRecognition()
    stopTTS()
    if (abortRef.current) abortRef.current.abort()
    setCallPhase('ended')
    // Save full call record to chat history + backend
    if (callMessages.length > 0) {
      const duration = callDuration
      const min = Math.floor(duration / 60)
      const sec = duration % 60
      const durationStr = min > 0 ? `${min}分${sec}秒` : `${sec}秒`
      try {
        const history = JSON.parse(localStorage.getItem('pool_chat_history') || '[]')
        // Add call start marker
        history.push({ role: 'system', content: `[语音通话开始]`, ts: callMessages[0]?.ts || Date.now() })
        // Add all call messages to main chat history
        for (const m of callMessages) {
          history.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text, ts: m.ts || Date.now() })
        }
        // Add call end marker with duration
        history.push({ role: 'system', content: `[语音通话结束 ${durationStr}]`, ts: Date.now() })
        localStorage.setItem('pool_chat_history', JSON.stringify(history))
        // Sync to backend
        fetch('/api/data/pool_chat_history', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: history.slice(-50) })
        }).catch(() => {})
      } catch {}
    }
    setTimeout(() => onHangup(), 800)
  }

  // ========== Streaming ASR via WebSocket ==========
  // Connects to /api/asr/stream, sends PCM16 audio in real-time,
  // receives interim/final transcription results
  function startSpeechRecognition() {
    if (typeof window === 'undefined' || !navigator.mediaDevices) return
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(async stream => {
      // Don't force sampleRate - let browser use native rate, we'll resample to 16000
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const actualRate = audioCtx.sampleRate
      console.log('[ASR] AudioContext sampleRate:', actualRate)
      const source = audioCtx.createMediaStreamSource(stream)

      // Volume analyser for VAD
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const dataArr = new Uint8Array(analyser.frequencyBinCount)

      const SILENCE_THRESHOLD = 8
      const SILENCE_DURATION = 1500
      let isSpeaking = false
      let silenceTimer = null
      let wsConn = null
      let pendingText = ''

      function getVolume() {
        analyser.getByteFrequencyData(dataArr)
        let sum = 0
        for (let i = 0; i < dataArr.length; i++) sum += dataArr[i]
        return sum / dataArr.length
      }

      // Resample helper: convert from actualRate to 16000Hz using linear interpolation
      const TARGET_RATE = 16000
      function resampleTo16k(float32) {
        if (actualRate === TARGET_RATE) return float32
        const ratio = actualRate / TARGET_RATE
        const outLen = Math.round(float32.length / ratio)
        const out = new Float32Array(outLen)
        for (let i = 0; i < outLen; i++) {
          const srcIdx = i * ratio
          const idx = Math.floor(srcIdx)
          const frac = srcIdx - idx
          const a = float32[idx] || 0
          const b = float32[Math.min(idx + 1, float32.length - 1)] || 0
          out[i] = a + frac * (b - a)
        }
        return out
      }

      // Pre-roll buffer: always cache recent audio chunks so we don't lose speech onset
      const PRE_ROLL_CHUNKS = 5 // ~5 chunks * 4096 samples ≈ 1.3s at 16kHz
      const preRollBuffer = []

      function float32ToPcm16(float32) {
        const resampled = resampleTo16k(float32)
        const pcm16 = new Int16Array(resampled.length)
        for (let i = 0; i < resampled.length; i++) {
          const s = Math.max(-1, Math.min(1, resampled[i]))
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }
        return pcm16
      }

      // ScriptProcessor to capture PCM (widely supported fallback)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      source.connect(processor)
      processor.connect(audioCtx.destination)

      let preRollFlushed = false

      processor.onaudioprocess = (e) => {
        if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return
        // Don't send while AI is speaking
        if (ttsPlayingRef.current) return

        const float32 = e.inputBuffer.getChannelData(0)
        const pcm16 = float32ToPcm16(float32)

        if (!isSpeaking) {
          // Not speaking yet — store in pre-roll buffer (ring buffer)
          preRollBuffer.push(pcm16.buffer.slice(0)) // copy
          if (preRollBuffer.length > PRE_ROLL_CHUNKS) preRollBuffer.shift()
          preRollFlushed = false
          return
        }

        // Speaking — flush pre-roll buffer first (captures speech onset)
        if (!preRollFlushed) {
          preRollFlushed = true
          for (const buf of preRollBuffer) {
            wsConn.send(buf)
          }
          preRollBuffer.length = 0
        }

        wsConn.send(pcm16.buffer)
      }

      function connectWs() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
        wsConn = new WebSocket(proto + '//' + location.host + '/api/asr/stream')

        wsConn.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data)
            if (msg.type === 'interim') {
              setSubtitle(msg.text)
              pendingText = msg.text
            } else if (msg.type === 'final' && msg.text && msg.text.trim()) {
              setSubtitle('')
              const text = msg.text.trim()
              addMessage('user', text)
              sendToAI(text)
              pendingText = ''
            } else if (msg.type === 'error') {
              setSubtitle('STT: ' + (msg.message || '').slice(0, 50))
              setTimeout(() => setSubtitle(''), 3000)
            }
          } catch {}
        }

        wsConn.onclose = () => {
          // Reconnect if still in call and mic is on
          if (micOnRef.current && callPhaseRef.current === 'active') {
            setTimeout(() => connectWs(), 1000)
          }
        }

        wsConn.onerror = () => {}
      }

      connectWs()

      // VAD loop
      const vadInterval = setInterval(() => {
        if (!micOnRef.current || callPhaseRef.current !== 'active') return
        if (ttsPlayingRef.current) return

        const vol = getVolume()

        if (vol > SILENCE_THRESHOLD) {
          if (!isSpeaking) {
            isSpeaking = true
            setAiStatus('listening')
          }
          if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
        } else if (isSpeaking) {
          if (!silenceTimer) {
            silenceTimer = setTimeout(() => {
              isSpeaking = false
              silenceTimer = null
              // If we had pending interim text and no final came, submit it
              if (pendingText.trim()) {
                const text = pendingText.trim()
                setSubtitle('')
                addMessage('user', text)
                sendToAI(text)
                pendingText = ''
              }
              setAiStatus('')
            }, SILENCE_DURATION)
          }
        }
      }, 100)

      recognitionRef.current = {
        stop: () => {
          clearInterval(vadInterval)
          if (silenceTimer) clearTimeout(silenceTimer)
          processor.disconnect()
          source.disconnect()
          stream.getTracks().forEach(t => t.stop())
          try { audioCtx.close() } catch {}
          if (wsConn) {
            try { wsConn.send(JSON.stringify({ type: 'stop' })) } catch {}
            setTimeout(() => { try { wsConn.close() } catch {} }, 500)
          }
        }
      }
    }).catch(() => {})
  }

  async function sendAudioToASR(blob) {
    // Kept as fallback but streaming WS is primary now
    setAiStatus('thinking')
    setSubtitle('识别中...')
    try {
      const formData = new FormData()
      formData.append('file', blob, 'audio.webm')
      const res = await fetch('/api/asr', {
        method: 'POST',
        body: formData
      })
      const data = await res.json()
      if (data.text && data.text.trim()) {
        const text = data.text.trim()
        setSubtitle('')
        addMessage('user', text)
        sendToAI(text)
      } else if (data.error) {
        setSubtitle('STT: ' + (data.error || '').slice(0, 60))
        setTimeout(() => { setSubtitle(''); setAiStatus('') }, 4000)
      } else {
        setSubtitle('(未识别到语音)')
        setTimeout(() => { setSubtitle(''); setAiStatus('') }, 2000)
      }
    } catch (e) {
      setSubtitle('ASR错误: ' + (e.message || '').slice(0, 40))
      setTimeout(() => { setSubtitle(''); setAiStatus('') }, 3000)
    }
  }


  function stopSpeechRecognition() {
    if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {}; recognitionRef.current = null }
  }

  // Toggle mic
  function toggleMic() {
    if (micOn) { stopSpeechRecognition(); setMicOn(false) }
    else { setMicOn(true); startSpeechRecognition() }
  }

  function addMessage(role, text) {
    setCallMessages(prev => [...prev, { role, text, ts: Date.now() }])
  }

  // Send text to AI and get streaming response
  async function sendToAI(text) {
    if (abortRef.current) abortRef.current.abort()
    stopTTS()
    setAiStatus('thinking')

    const controller = new AbortController()
    abortRef.current = controller

    const msgs = [...callMessages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })), { role: 'user', content: text }]

    // Read API config from localStorage
    let apiBase = '', apiKey = '', model = ''
    try {
      const chatCfg = JSON.parse(localStorage.getItem('pool_api_configs') || '{}')
      if (chatCfg.chat?.apiBase && chatCfg.chat?.apiKey) {
        apiBase = chatCfg.chat.apiBase; apiKey = chatCfg.chat.apiKey; model = chatCfg.chat.model || ''
      }
      if (!apiBase || !apiKey) {
        const cfg = JSON.parse(localStorage.getItem('pool_api_config') || '{}')
        apiBase = apiBase || cfg.apiBase || cfg.base || ''
        apiKey = apiKey || cfg.apiKey || cfg.key || ''
        model = model || cfg.model || ''
      }
    } catch {}

    if (!apiBase || !apiKey) {
      addMessage('assistant', '[API未配置，无法通话]')
      setAiStatus('')
      return
    }

    try {
      const res = await fetch('/api/call-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs, text, apiBase, apiKey, model }),
        signal: controller.signal
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'sentence') {
              fullText += (fullText ? '' : '') + data.text
              setSubtitle(fullText)
              queueTTS(data.text)
            }
            if (data.type === 'done') {
              if (data.fullText) addMessage('assistant', data.fullText)
              // Clear subtitle after a short delay (TTS will keep playing)
              setTimeout(() => setSubtitle(''), 800)
            }
            if (data.error) {
              addMessage('assistant', '[通话出错]')
              setAiStatus('')
            }
          } catch {}
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        addMessage('assistant', '[连接中断]')
      }
    }
    setAiStatus('')
  }

  // TTS queue management
  function queueTTS(text) {
    ttsQueueRef.current.push(text)
    if (!ttsPlayingRef.current) playNextTTS()
  }

  async function playNextTTS() {
    if (ttsQueueRef.current.length === 0) {
      ttsPlayingRef.current = false
      setAiStatus('')
      return
    }

    ttsPlayingRef.current = true
    setAiStatus('speaking')
    const text = ttsQueueRef.current.shift()

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 500) })
      })
      const data = await res.json()
      if (data?.audio) {
        let b64 = data.audio
        if (/^[0-9a-f]+$/i.test(b64) && b64.length % 2 === 0 && !/[g-zG-Z+/=]/.test(b64)) {
          const bytes = new Uint8Array(b64.length / 2)
          for (let i = 0; i < b64.length; i += 2) bytes[i/2] = parseInt(b64.substr(i,2), 16)
          b64 = btoa(String.fromCharCode(...bytes))
        }
        const audio = new Audio('data:audio/mp3;base64,' + b64)
        audioRef.current = audio
        audio.onended = () => playNextTTS()
        audio.onerror = () => playNextTTS()
        try {
          await audio.play()
        } catch (playErr) {
          // Autoplay blocked - try unlocking and retrying once
          unlockAudio()
          try { await audio.play() } catch { playNextTTS() }
        }
      } else {
        playNextTTS()
      }
    } catch {
      playNextTTS()
    }
  }

  function stopTTS() {
    ttsQueueRef.current = []
    ttsPlayingRef.current = false
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
  }

  // Send text message during call
  function sendText() {
    if (!textInput.trim()) return
    addMessage('user', textInput.trim())
    sendToAI(textInput.trim())
    setTextInput('')
  }

  // Format duration
  const min = String(Math.floor(callDuration / 60)).padStart(2, '0')
  const sec = String(callDuration % 60).padStart(2, '0')

  const avatarUrl = theme?.avatarAI || '/avatar.jpg'

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
      background: 'linear-gradient(180deg, #f8f6f9 0%, #ede8f0 40%, #e0d8e5 100%)',
      display: minimized ? 'none' : 'flex', flexDirection: 'column', alignItems: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Minimize button - top right */}
      {callPhase === 'active' && onMinimize && (
        <button onClick={onMinimize} style={{
          position: 'absolute', top: 16, right: 16, zIndex: 10,
          width: 32, height: 32, borderRadius: 8,
          background: 'rgba(180,160,190,0.15)', border: '1px solid rgba(180,160,190,0.2)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a7a90" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
            <line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>
      )}
      <div style={{ height: '60px', flexShrink: 0 }} />

      {/* Avatar */}
      <div style={{
        width: 96, height: 96, borderRadius: '50%', overflow: 'hidden',
        border: '3px solid rgba(180,160,190,0.3)',
        boxShadow: aiStatus === 'speaking' ? '0 0 0 8px rgba(180,160,190,0.15), 0 0 0 16px rgba(180,160,190,0.08)' : '0 0 0 4px rgba(180,160,190,0.1)',
        transition: 'box-shadow 0.6s ease'
      }}>
        <img src={avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>

      {/* Name */}
      <div style={{ marginTop: 16, fontSize: 20, fontWeight: 500, color: '#3a3040', letterSpacing: '0.5px' }}>
        {'\u6c60\u5c7f'}
      </div>

      {/* Status */}
      <div style={{ marginTop: 8, fontSize: 13, color: '#8a7a90', minHeight: 20 }}>
        {callPhase === 'ringing' && '\u6765\u7535\u4e2d...'}
        {callPhase === 'connecting' && '\u547c\u53eb\u4e2d...'}
        {callPhase === 'active' && (
          aiStatus === 'listening' ? '\u6b63\u5728\u542c...' :
          aiStatus === 'thinking' ? '\u6b63\u5728\u60f3...' :
          aiStatus === 'speaking' ? '\u6b63\u5728\u8bf4...' :
          `${min}:${sec}`
        )}
        {callPhase === 'ended' && '\u901a\u8bdd\u5df2\u7ed3\u675f'}
      </div>

      {/* Duration (shown alongside status during active call) */}
      {callPhase === 'active' && aiStatus && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#a898ae' }}>{min}:{sec}</div>
      )}

      {/* Subtitle / transcript area */}
      <div style={{
        flex: 1, width: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center', padding: '0 24px',
        minHeight: 80
      }}>
        {subtitle && (
          <div style={{
            fontSize: 15, color: '#5a4a60', textAlign: 'center',
            padding: '12px 20px', background: 'rgba(255,255,255,0.6)',
            borderRadius: 16, maxWidth: '90%', lineHeight: 1.5,
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)'
          }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* Text input during call */}
      {callPhase === 'active' && (
        <div style={{
          display: 'flex', gap: 8, padding: '0 20px', width: '100%', marginBottom: 16
        }}>
          <input
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendText() }}
            placeholder={'\u8f93\u5165\u6587\u5b57...'}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 24,
              border: '1px solid rgba(180,160,190,0.3)', background: 'rgba(255,255,255,0.7)',
              fontSize: 14, color: '#3a3040', outline: 'none',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)'
            }}
          />
          <button onClick={sendText} style={{
            width: 40, height: 40, borderRadius: '50%',
            background: textInput.trim() ? 'rgba(180,160,190,0.3)' : 'rgba(180,160,190,0.15)',
            border: 'none', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#6a5a70'
          }}>
            {'\u27a4'}
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ marginBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))', display: 'flex', gap: 40, alignItems: 'center' }}>
        {callPhase === 'ringing' ? (
          <>
            {/* Reject */}
            <button onClick={rejectCall} style={{
              width: 64, height: 64, borderRadius: '50%',
              background: '#e8a0a0', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(200,120,120,0.3)'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
            {/* Accept */}
            <button onClick={acceptCall} style={{
              width: 64, height: 64, borderRadius: '50%',
              background: '#a0c8a0', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(120,180,120,0.3)'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2z"/>
              </svg>
            </button>
          </>
        ) : callPhase === 'active' ? (
          <>
            {/* Mic toggle */}
            <button onClick={toggleMic} style={{
              width: 52, height: 52, borderRadius: '50%',
              background: micOn ? 'rgba(180,160,190,0.15)' : 'rgba(200,120,120,0.2)',
              border: '1px solid rgba(180,160,190,0.2)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={micOn ? '#6a5a70' : '#c07070'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {micOn ? (
                  <>
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </>
                ) : (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
                    <path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .76-.13 1.48-.35 2.17"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </>
                )}
              </svg>
            </button>
            {/* Hang up */}
            <button onClick={hangup} style={{
              width: 64, height: 64, borderRadius: '50%',
              background: '#e8a0a0', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(200,120,120,0.3)'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
// ==================== End CallScreen ====================

function HomeScreen({ onOpenApp, theme }) {
  const [page, setPage] = useState(0)
  const [swipeX, setSwipeX] = useState(null)
  const [nowPlaying, setNowPlaying] = useState(null)
  const [latestNote, setLatestNote] = useState(null)
  const [latestDiary, setLatestDiary] = useState(null)
  const [wakeLog, setWakeLog] = useState(null)
  const [homeCards, setHomeCards] = useState({ userText: '', aiText: '' })
  const [editingUserCard, setEditingUserCard] = useState(false)
  const [userCardDraft, setUserCardDraft] = useState('')

  useEffect(() => {
    let active = true
    const poll = () => {
      fetch('/api/data/pool_music_now').then(r=>r.json()).then(d=>{
        if(active && d && d.value) setNowPlaying(d.value)
      }).catch(()=>{})
    }
    poll()
    const iv = setInterval(poll, 8000)
    // fetch latest note
    fetch('/api/data/pool_notes').then(r=>r.json()).then(d=>{
      if(active && d && d.value) {
        const notes = typeof d.value === 'string' ? JSON.parse(d.value) : d.value
        if(Array.isArray(notes) && notes.length > 0) setLatestNote(notes[notes.length-1])
      }
    }).catch(()=>{})
    // fetch latest diary
    fetch('/api/data/pool_diary_latest').then(r=>r.json()).then(d=>{
      if(active && d && d.value) setLatestDiary(d.value)
    }).catch(()=>{})
    // fetch wake log
    fetch('/api/data/pool_wake_log_latest').then(r=>r.json()).then(d=>{
      if(active && d && d.value) setWakeLog(d.value)
    }).catch(()=>{})
    // fetch home cards
    fetch('/api/data/pool_home_cards').then(r=>r.json()).then(d=>{
      if(active && d && d.value) {
        const v = typeof d.value === 'string' ? JSON.parse(d.value) : d.value
        setHomeCards(prev => ({ ...prev, ...v }))
      }
    }).catch(()=>{})
    return () => { active = false; clearInterval(iv) }
  }, [])

  const startDate = new Date(2026, 6, 21)
  const today = new Date()
  const coupleDays = Math.floor((today - startDate) / (1000*60*60*24))
  const allPages = [0,1,2]

  function handleSwipeStart(e) { setSwipeX(e.touches[0].clientX) }
  function handleSwipeEnd(e) {
    if (swipeX !== null) {
      const diff = swipeX - e.changedTouches[0].clientX
      if (diff > 50 && page < 2) setPage(page + 1)
      if (diff < -50 && page > 0) setPage(page - 1)
    }
    setSwipeX(null)
  }

  const icons = theme?.icons || {}

  // --- SVG icon components (no emoji) ---
  const SvgNote = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
  const SvgMusic = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
  const SvgHeart = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
  const SvgSettings = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
  const SvgFish = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6.5 12c0 0 3-6 9.5-6 0 0-1 3.5 0 6 1 2.5 0 6 0 6-6.5 0-9.5-6-9.5-6z"/><circle cx="14" cy="10" r="1" fill="currentColor"/></svg>
  const SvgBook = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
  const SvgCamera = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
  const SvgPalette = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.38-.15-.75-.38-1.02-.22-.27-.35-.62-.35-1 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.52-4.48-9.96-10-9.98z"/></svg>
  const SvgUser = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  const SvgBrain = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2a7 7 0 00-7 7c0 3 2 5 4 7l3 4 3-4c2-2 4-4 4-7a7 7 0 00-7-7z"/><circle cx="12" cy="9" r="2"/></svg>
  const SvgPen = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
  const SvgSun = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
  const SvgLeaf = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75"/></svg>
  const SvgSmile = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
  const SvgSword = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/></svg>
  const SvgClock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  const SvgMail = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>
  const SvgList = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>

  // Glass card helper
  const glass = { background: 'rgba(255,240,248,0.12)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,220,240,0.15)', borderRadius: 16 }
  const glassLight = { background: 'rgba(255,240,248,0.08)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255,220,240,0.1)', borderRadius: 14 }

  return (
    <div className="home-screen" style={theme?.wallpaper ? {backgroundImage:`url(${theme.wallpaper})`,backgroundSize:'cover',backgroundPosition:'center'} : {}}
      onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>

      <div className="hs-scroll">
        {/* ===== PAGE 0 ===== */}
        {page === 0 && (<>

          {/* Dynamic Island - avatar + name + status */}
          <div className="hs-island" onClick={() => onOpenApp('couple')}>
            <div className="hs-island-avatar">
              {theme?.avatarAI ? <img src={theme.avatarAI} alt="" /> : <span style={{color:'rgba(255,200,220,0.8)', fontSize:13}}><SvgUser /></span>}
            </div>
            <div className="hs-island-info">
              <div className="hs-island-name">{'Chi'}</div>
              <div className="hs-island-status">{nowPlaying?.playing ? (nowPlaying.name || 'listening') : 'online'}</div>
            </div>
            <div className="hs-island-music" onClick={e => { e.stopPropagation(); onOpenApp('music') }}>
              <SvgMusic />
            </div>
          </div>

          {/* Couple days bar */}
          <div className="hs-couple-bar" onClick={() => onOpenApp('couple')}>
            <SvgHeart />
            <span>{coupleDays + ' days together'}</span>
          </div>

          {/* Moments card (large) */}
          <div className="hs-card-moments" onClick={() => onOpenApp('messages')}>
            <div className="hs-card-moments-inner">
              <SvgHeart />
              <span>{'Moments'}</span>
            </div>
          </div>

          {/* Sticky note card + system btn side by side */}
          <div className="hs-row" style={{gap:10}}>
            <div className="hs-card-note" onClick={() => onOpenApp('notes')}>
              <div className="hs-card-note-label"><SvgNote /> <span>{'memo'}</span></div>
              <div className="hs-card-note-text">{latestNote?.text ? latestNote.text.slice(0,60) : 'tap to write...'}</div>
            </div>
            <div className="hs-btn-system" onClick={() => onOpenApp('system')}>
              <SvgSettings />
            </div>
          </div>

          {/* Diary preview card */}
          <div className="hs-card-diary" onClick={() => onOpenApp('diary')} style={{marginBottom:8}}>
            <div className="hs-card-diary-label"><SvgPen /> <span>{'diary'}</span></div>
            <div className="hs-card-diary-text">{latestDiary?.text ? latestDiary.text.slice(0,80) : 'no entries yet...'}</div>
          </div>

          {/* Small app buttons row */}
          <div className="hs-chip-row">
            <div className="hs-chip" onClick={() => onOpenApp('fishing')}><SvgFish /><span>{'fishing'}</span></div>
            <div className="hs-chip" onClick={() => onOpenApp('cabin')}><SvgList /><span>{'habits'}</span></div>
            <div className="hs-chip" onClick={() => onOpenApp('screenTime')}><SvgClock /><span>{'self-edit'}</span></div>
            <div className="hs-chip" onClick={() => onOpenApp('reader')}><SvgMail /><span>{'letter'}</span></div>
          </div>

        </>)}

        {/* ===== PAGE 1 ===== */}
        {page === 1 && (<>

          {/* Score display card */}
          <div className="hs-row" style={{gap:10}}>
            <div className="hs-card-mini" onClick={() => onOpenApp('fishing')}>
              <div className="hs-card-mini-icon"><SvgFish /></div>
              <div className="hs-card-mini-label">{'fishing'}</div>
            </div>
            <div className="hs-card-mini" onClick={() => onOpenApp('reader')}>
              <div className="hs-card-mini-icon"><SvgBook /></div>
              <div className="hs-card-mini-label">{'reader'}</div>
            </div>
          </div>

          {/* Polaroid area - 3 photos */}
          <div className="hs-polaroid-area">
            <div className="hs-polaroid-title">{'photos'}</div>
            <div className="polaroid-wall">
              <div className="polaroid-card" style={{transform:'rotate(-4deg)'}}>
                <div className="polaroid-tape tape-left"></div>
                {theme?.polaroid1 ? <img src={theme.polaroid1} className="polaroid-img" alt="" /> : <div className="polaroid-empty">{'+'}</div>}
                <div className="polaroid-caption">{theme?.polaroidCaption1 || ''}</div>
              </div>
              <div className="polaroid-card" style={{transform:'rotate(2deg)',marginTop:'12px'}}>
                <div className="polaroid-tape tape-center"></div>
                {theme?.polaroid2 ? <img src={theme.polaroid2} className="polaroid-img" alt="" /> : <div className="polaroid-empty">{'+'}</div>}
                <div className="polaroid-caption">{theme?.polaroidCaption2 || ''}</div>
              </div>
              <div className="polaroid-card" style={{transform:'rotate(-2deg)',marginTop:'-8px'}}>
                <div className="polaroid-tape tape-right"></div>
                {theme?.polaroid3 ? <img src={theme.polaroid3} className="polaroid-img" alt="" /> : <div className="polaroid-empty">{'+'}</div>}
                <div className="polaroid-caption">{theme?.polaroidCaption3 || ''}</div>
              </div>
            </div>
          </div>

          {/* User & AI word cards */}
          <div className="home-word-card user-word-card" onClick={() => { if (!editingUserCard) { setUserCardDraft(homeCards.userText || ''); setEditingUserCard(true) } }}>
            <div className="word-card-avatar">
              {theme?.avatarUser ? <img src={theme.avatarUser} className="word-card-ava-img" alt="" /> : <div className="word-card-ava-fallback">{'\u6211'}</div>}
            </div>
            <div className="word-card-text">
              {editingUserCard ? (
                <form onSubmit={e => { e.preventDefault(); const next = { ...homeCards, userText: userCardDraft }; setHomeCards(next); setEditingUserCard(false); fetch('/api/data/pool_home_cards', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ value: next }) }) }} style={{display:'flex',gap:4,width:'100%'}}>
                  <input className="word-card-input" value={userCardDraft} onChange={e => setUserCardDraft(e.target.value)} autoFocus placeholder={'\u5199\u70b9\u4ec0\u4e48...'} />
                  <button type="submit" className="word-card-save">{'\u2713'}</button>
                </form>
              ) : (
                <span className="word-card-content">{homeCards.userText || '\u70b9\u51fb\u7f16\u8f91\u6587\u6848...'}</span>
              )}
            </div>
          </div>
          <div className="home-word-card ai-word-card">
            <div className="word-card-text" style={{textAlign:'right'}}>
              <span className="word-card-content">{homeCards.aiText || '\u2026'}</span>
            </div>
            <div className="word-card-avatar">
              {theme?.avatarAI ? <img src={theme.avatarAI} className="word-card-ava-img" alt="" /> : <div className="word-card-ava-fallback">{'\u6c60'}</div>}
            </div>
          </div>

          {/* Bottom row: theme / avatar / memory */}
          <div className="hs-chip-row">
            <div className="hs-chip" onClick={() => onOpenApp('theme')}><SvgPalette /><span>{'theme'}</span></div>
            <div className="hs-chip" onClick={() => onOpenApp('avatarGallery')}><SvgUser /><span>{'avatar'}</span></div>
            <div className="hs-chip" onClick={() => onOpenApp('memoryMgr')}><SvgBrain /><span>{'memory'}</span></div>
          </div>

        </>)}

        {/* ===== PAGE 2 ===== */}
        {page === 2 && (<>

          {/* Diary card */}
          <div className="hs-card-diary" onClick={() => onOpenApp('diary')}>
            <div className="hs-card-diary-label"><SvgPen /> <span>{'diary'}</span></div>
            <div className="hs-card-diary-text">{latestDiary?.text ? latestDiary.text.slice(0,80) : 'no entries yet...'}</div>
          </div>

          {/* Garden + Wake log side by side */}
          <div className="hs-row" style={{gap:10}}>
            <div className="hs-card-half" onClick={() => onOpenApp('garden')}>
              <div className="hs-card-half-icon"><SvgSword /></div>
              <div className="hs-card-half-label">{'challenge'}</div>
            </div>
            <div className="hs-card-half" onClick={() => onOpenApp('cabin')}>
              <div className="hs-card-half-icon"><SvgSun /></div>
              <div className="hs-card-half-label">{'wake log'}</div>
              {wakeLog && <div className="hs-card-half-sub">{wakeLog.slice(0,30)}</div>}
            </div>
          </div>

          {/* Starmap / essay */}
          <div className="hs-card-wide" onClick={() => onOpenApp('starmap')}>
            <SvgPen />
            <span>{'essay'}</span>
          </div>

          {/* Care + Stickers row */}
          <div className="hs-chip-row">
            <div className="hs-chip" onClick={() => onOpenApp('care')}><SvgLeaf /><span>{'care'}</span></div>
            <div className="hs-chip" onClick={() => onOpenApp('stickers')}><SvgSmile /><span>{'stickers'}</span></div>
            <div className="hs-chip" onClick={() => onOpenApp('screenTime')}><SvgClock /><span>{'screen time'}</span></div>
          </div>

        </>)}

      </div>

      {/* Page dots */}
      <div className="page-dots">
        {allPages.map((_, i) => (
          <div key={i} className={`dot ${page === i ? 'active' : ''}`} onClick={() => setPage(i)} />
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const [showSplash, setShowSplash] = useState(true)
  const [locked, setLocked] = useState(true)
  const [currentApp, setCurrentApp] = useState(null)
  const [activeTab, setActiveTab] = useState('phone')
  const [readerMini, setReaderMini] = useState(false)
  const [callActive, setCallActive] = useState(false)
  const [callIncoming, setCallIncoming] = useState(false)
  const [callMinimized, setCallMinimized] = useState(false)
  const [showCallConfirm, setShowCallConfirm] = useState(false)
  const [filePreview, setFilePreview] = useState(null)
  const [theme, setTheme] = useState({})
  const [appBg, setAppBg] = useState({})
  const [customizerApp, setCustomizerApp] = useState(null)
  const [lazyHtmlCache, setLazyHtmlCache] = useState({})

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

  // Poll for incoming calls from AI
  useEffect(() => {
    if (callActive) return // Don't poll while in a call
    const poll = async () => {
      try {
        const res = await fetch('/api/call-status')
        const data = await res.json()
        if (data.calling && !callActive) {
          setCallIncoming(true)
          setCallActive(true)
          setCallMinimized(false)
        }
      } catch {}
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [callActive])

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
        const sysPrompt = context || '你是池屿，一个陪伴型AI。请简短回复，语气亲切随意。'
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
    // Also listen for music iframe back button
    function musicBackHandler(e) {
      if (e.data && e.data.type === 'music:back') { handleBack() }
    }
    window.addEventListener('message', handler)
    window.addEventListener('message', musicBackHandler)
    return () => { window.removeEventListener('message', handler); window.removeEventListener('message', musicBackHandler) }
  }, [])

  function handleOpenApp(id) { if (id === 'chat') { setActiveTab('chat') } else { setCurrentApp(id) } }
  function handleBack() { pushAllToBackend(); setCurrentApp(null) }

  function renderPhoneContent() {
    if (locked) return <LockScreen onUnlock={() => setLocked(false)} theme={theme} />
    // React组件类app (system/theme/memory don't get customizer)
    if (currentApp === 'system') return <AppContent appId="system" onBack={handleBack} />
    if (currentApp === 'theme') return <AppContent appId="theme" onBack={handleBack} />
    if (currentApp === 'memoryMgr') return <AppContent appId="memoryMgr" onBack={handleBack} />
    if (currentApp === 'avatarGallery') return (
      <div className="app-page">
        <div className="app-page-header">
          <button className="back-btn" onClick={handleBack}>{'←'}</button>
          <span className="app-page-title">头像库</span>
        </div>
        <div className="app-page-body"><AvatarGalleryPanel /></div>
      </div>
    )
    if (currentApp === 'screenTime') return (
      <div className="app-page">
        <div className="app-page-header">
          <button className="back-btn" onClick={handleBack}>{'←'}</button>
          <span className="app-page-title">屏幕时间</span>
        </div>
        <div className="app-page-body"><ScreenTimeApp /></div>
      </div>
    )

    const appTitles = { fishing:'钓鱼', reader:'阅读', notes:'便签', messages:'朋友圈', music:'音乐', couple:'情侣空间', diary:'日记', garden:'庭院', cabin:'唤醒日志', starmap:'星图', care:'养护手册', stickers:'表情包管理' }
    const reactApps = { fishing: <FishingApp />, reader: <ReaderApp />, }
    const htmlApps = { notes: notesHtml, messages: messagesHtml, couple: coupleHtml, diary: diaryHtml, garden: gardenHtml, cabin: cabinHtml, starmap: starmapHtml, stickers: stickersHtml }
    // Lazy-loaded HTML apps: fetched on demand to reduce initial bundle size
    const lazyHtmlApps = { care: '/apps/_care.html' }

    if (currentApp && appTitles[currentApp]) {
      // Music with external server: persistent iframe (L2473) handles display, just return empty container
      if (currentApp === 'music' && typeof window !== 'undefined' && localStorage.getItem('pool_music_server')) {
        return <div className="app-page" style={{background:'transparent'}} />
      }
      const bgCfg = appBg[currentApp]
      const bgStyle = getAppBgStyle(bgCfg)
      const isHtml = !!htmlApps[currentApp]
      const isLazy = !!lazyHtmlApps[currentApp]
      const isReact = !!reactApps[currentApp]

      // For lazy-loaded HTML apps, fetch on demand
      if (isLazy && !lazyHtmlCache[currentApp]) {
        fetch(lazyHtmlApps[currentApp]).then(r => r.text()).then(html => {
          setLazyHtmlCache(prev => ({ ...prev, [currentApp]: html }))
        }).catch(() => {})
      }

      // For HTML apps with bg config, inject CSS into the HTML content
      let htmlContent = htmlApps[currentApp] || lazyHtmlCache[currentApp] || ''
      const hasHtml = !!(isHtml || (isLazy && htmlContent))
      // Inject API base URL so fetch works in srcdoc iframe
      if (hasHtml && typeof window !== 'undefined') {
        const baseUrl = window.location.origin
        const injectTag = '<meta name="api-base" content="' + baseUrl + '">' 
        htmlContent = htmlContent.replace('<head>', '<head>' + injectTag)
      }
      if (hasHtml && bgCfg && (bgCfg.bgImage || bgCfg.bgColor)) {
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

      // Reader app: render full-screen without outer header/body padding
      if (currentApp === 'reader') {
        return (
          <div className="app-page" style={{padding:0,...bgStyle}}>
            <ReaderApp onBack={handleBack} onMinimize={() => { setReaderMini(true); setActiveTab('chat'); handleBack() }} />
          </div>
        )
      }

      return (
        <div className="app-page" style={isReact ? bgStyle : {}}>
          <div className="app-page-header">
            <button className="back-btn" onClick={handleBack}>{'←'}</button>
            <span className="app-page-title">{appTitles[currentApp]}</span>
            <button className="app-customize-btn" onClick={() => setCustomizerApp(currentApp)}>{'🎨'}</button>
          </div>
          <div className={`app-page-body${(hasHtml || (currentApp === 'music')) ? ' app-page-body-html' : ''}`} style={bgCfg?.contentOpacity != null && bgCfg.contentOpacity < 1 ? { opacity: bgCfg.contentOpacity } : {}}>
            {isReact && reactApps[currentApp]}
            {currentApp === 'music' && !localStorage.getItem('pool_music_server') && <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh',color:'#999',fontSize:'14px',textAlign:'center',padding:'0 20px'}}>{'请先在系统App中配置音乐服务器地址'}</div>}
            {hasHtml && <HtmlApp htmlContent={htmlContent} />}
            {isLazy && !htmlContent && <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh',color:'#999',fontSize:'14px'}}>加载中...</div>}
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
          <div className="status-bar" style={theme?.statusBarBg?(theme.statusBarBg.startsWith('data:')||theme.statusBarBg.startsWith('http')||theme.statusBarBg.startsWith('/')?{backgroundImage:`url(${theme.statusBarBg})`,backgroundSize:'cover',backgroundPosition:'center'}:{background:theme.statusBarBg}):{}}>  
            <span className="status-time" suppressHydrationWarning>{new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
            <span className="status-icons">{'\ud83d\udfe2'}</span>
          </div>
          <div className="phone-screen">
            <div style={{display: activeTab === 'phone' ? 'block' : 'none', height:'100%', position:'relative', paddingBottom:'0'}}>
              {renderPhoneContent()}
              <PreloadedApps currentApp={currentApp} onBack={handleBack} />
              {(() => { try { const ms = localStorage.getItem('pool_music_server'); if (ms) { const mt = localStorage.getItem('pool_music_token') || ''; return <iframe id="persistent-music-iframe" src={ms + (mt ? '/?token=' + encodeURIComponent(mt) : '/')} allow="autoplay; encrypted-media" style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',border:'none',zIndex: currentApp === 'music' ? 10 : -1,opacity: currentApp === 'music' ? 1 : 0,pointerEvents: currentApp === 'music' ? 'auto' : 'none'}} /> } } catch {} return null })()}
            </div>
            <div style={{display: activeTab === 'chat' ? 'flex' : 'none', height:'100%', flexDirection:'column'}}><ChatView theme={theme} setFilePreview={setFilePreview} /></div>
              {readerMini && (
                <div style={{
                  position:'absolute', top:0, left:0, right:0, height:'55%',
                  zIndex:600, background:'rgba(255,252,253,0.98)', borderRadius:'0 0 16px 16px', boxShadow:'0 4px 20px rgba(0,0,0,0.08)',
                  display:'flex', flexDirection:'column',
                  overflow:'hidden'
                }}>
                  <div style={{ display:'flex', alignItems:'center', padding:'6px 12px', background:'#fef0f3', borderBottom:'1px solid #f5d5de', gap:8, flexShrink:0 }}>
                    <span style={{ flex:1, fontSize:13, color:'#b06080', fontWeight:600 }}>📖 共读小窗</span>
                    <button onClick={() => { setCurrentApp('reader'); setActiveTab('phone'); setReaderMini(false) }} style={{ background:'#f8e0e8', color:'#b06080', border:'1px solid #f0c0d0', borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer' }}>全屏</button>
                    <button onClick={() => setReaderMini(false)} style={{ background:'#f8e0e8', color:'#b06080', border:'1px solid #f0c0d0', borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer' }}>✕</button>
                  </div>
                  <div style={{ flex:1, overflow:'hidden' }}>
                    <ReaderApp mini={true} />
                  </div>
                </div>
              )}
          </div>
          {callActive && <CallScreen theme={theme} isIncoming={callIncoming} onHangup={() => { setCallActive(false); setCallIncoming(false); setCallMinimized(false); try { const h = JSON.parse(localStorage.getItem('pool_chat_history') || '[]'); setMessages(h) } catch {} }} onMinimize={() => setCallMinimized(true)} minimized={callMinimized} />}
          {callActive && callMinimized && (
            <div onClick={() => setCallMinimized(false)} style={{
              position: 'absolute', top: 50, right: 12, zIndex: 8000,
              background: 'rgba(180,160,190,0.9)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
              borderRadius: 20, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
              animation: 'callFloatPulse 2s ease-in-out infinite'
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2z"/>
              </svg>
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 500 }}>{'\u901a\u8bdd\u4e2d'}</span>
            </div>
          )}
          {showCallConfirm && (
            <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(8px)' }} onClick={() => setShowCallConfirm(false)}>
              <div onClick={e => e.stopPropagation()} style={{ background:'rgba(255,255,255,0.97)', borderRadius:20, padding:'32px 24px 24px', width:'min(280px, 80vw)', textAlign:'center', boxShadow:'0 12px 40px rgba(180,140,160,0.2)' }}>
                <div style={{ width:64, height:64, borderRadius:'50%', margin:'0 auto 14px', overflow:'hidden', border:'2.5px solid #f0d6e2', boxShadow:'0 4px 16px rgba(200,140,170,0.2)' }}>
                  {theme?.avatarAI ? <img src={theme.avatarAI} style={{width:'100%',height:'100%',objectFit:'cover'}} /> : <div style={{width:'100%',height:'100%',background:'linear-gradient(135deg,#f8c8dc,#e8a0bf)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,color:'#fff'}}>{'池'}</div>}
                </div>
                <div style={{ fontSize:15, fontWeight:600, color:'#4a3a50', marginBottom:6 }}>{'拨打电话给池屿？'}</div>
                <div style={{ fontSize:12, color:'#b8a0b8', marginBottom:22 }}>{'语音通话将开始录音'}</div>
                <div style={{ display:'flex', gap:12, justifyContent:'center' }}>
                  <button onClick={() => setShowCallConfirm(false)} style={{ flex:1, padding:'10px 0', borderRadius:12, border:'1px solid #f0d6e2', background:'#fdf6f9', fontSize:14, color:'#9a7a8a', cursor:'pointer', fontWeight:500 }}>{'取消'}</button>
                  <button onClick={() => { setShowCallConfirm(false); setCallIncoming(false); setCallActive(true); setCallMinimized(false) }} style={{ flex:1, padding:'10px 0', borderRadius:12, border:'none', background:'linear-gradient(135deg, #f0a0c0, #e8b0d0)', fontSize:14, color:'#fff', fontWeight:600, cursor:'pointer', boxShadow:'0 4px 12px rgba(230,160,180,0.3)' }}>{'拨打'}</button>
                </div>
              </div>
            </div>
          )}
          {filePreview && (
            <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(6px)' }} onClick={() => setFilePreview(null)}>
              <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:'96vw', maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 12px 40px rgba(0,0,0,0.15)', overflow:'hidden' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'14px 16px', borderBottom:'1px solid #f0e0ea', flexShrink:0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c88aaa" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span style={{ flex:1, fontSize:14, fontWeight:600, color:'#4a3a50', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{filePreview.name}</span>
                  <button onClick={() => setFilePreview(null)} style={{ background:'none', border:'none', fontSize:18, color:'#b8a0b8', cursor:'pointer', padding:'0 4px' }}>{'✕'}</button>
                </div>
                <textarea
                  defaultValue={filePreview.content}
                  id="file-preview-editor"
                  style={{ margin:0, padding:'16px', fontSize:13, lineHeight:1.6, color:'#3a2a40', background:'#fdf8fa', overflow:'auto', flex:1, border:'none', outline:'none', resize:'none', whiteSpace:'pre-wrap', wordBreak:'break-word', fontFamily:'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', minHeight:'60vh' }}
                />
                <div style={{ display:'flex', gap:10, padding:'12px 16px', borderTop:'1px solid #f0e0ea', background:'#fdf6f9', flexShrink:0 }}>
                  <button onClick={() => setFilePreview(null)} style={{ flex:1, padding:'10px 0', borderRadius:10, border:'1px solid #e0d0d8', background:'#fff', fontSize:13, color:'#9a7a8a', cursor:'pointer', fontWeight:500 }}>{'关闭'}</button>
                  <button onClick={() => {
                    const text = document.getElementById('file-preview-editor')?.value || ''
                    if (text.trim()) {
                      const fileMsg = '[file name="' + filePreview.name + '"]\n' + text.trim() + '\n[/file]'
                      window.dispatchEvent(new CustomEvent('chi-send-file', { detail: fileMsg }))
                      setFilePreview(null)
                    }
                  }} style={{ flex:1, padding:'10px 0', borderRadius:10, border:'none', background:'linear-gradient(135deg, #f0a0c0, #e8b0d0)', fontSize:13, color:'#fff', fontWeight:600, cursor:'pointer', boxShadow:'0 4px 12px rgba(230,160,180,0.3)' }}>{'填好了，发回去'}</button>
                </div>
              </div>
            </div>
          )}
          <div className="bottom-nav-wrap" style={{display: currentApp ? 'none' : 'flex'}}>
            <div className="bottom-nav-pill">
              <button className={`nav-btn ${activeTab === 'phone' ? 'active' : ''}`} onClick={() => setActiveTab('phone')}>
                <span className="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>
                <span className="nav-label">{'\u624b\u673a'}</span>
                {activeTab === 'phone' && <div className="nav-dot-indicator" />}
              </button>
              <button className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => { setActiveTab('chat'); setLocked(false) }}>
                <span className="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></span>
                <span className="nav-label">{'\u804a\u5929'}</span>
                {activeTab === 'chat' && <div className="nav-dot-indicator" />}
              </button>
              <button className="nav-btn" onClick={() => { if (callActive) { setCallMinimized(false) } else { setShowCallConfirm(true) } }}>
                <span className="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2z"/></svg></span>
                <span className="nav-label">{'\u7535\u8bdd'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { height: 100%; background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
        .shell { width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; }
        .phone-frame { width: 100%; max-width: 420px; height: 100vh; background: #111; display: flex; flex-direction: column; overflow: hidden; position: relative; }
        @media (min-width: 768px) { .phone-frame { height: 90vh; max-height: 844px; border-radius: 40px; border: 3px solid #333; box-shadow: 0 20px 60px rgba(0,0,0,0.8); } }
        .status-bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 20px 4px; font-size: 12px; color: rgba(255,255,255,0.7); background: rgba(255,220,240,0.15); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); flex-shrink: 0; }
        .phone-screen { flex: 1; overflow: hidden; position: relative; background: #0d0d0d; }
        .bottom-nav-wrap { position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: center; z-index: 100; pointer-events: none; padding: 10px 20px calc(10px + env(safe-area-inset-bottom, 0px)); background: rgba(255,230,245,0.25); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
        .bottom-nav-pill { display: flex; justify-content: space-around; align-items: center; padding: 8px 16px; background: rgba(255,230,245,0.35); backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px); border: 1px solid rgba(255,220,240,0.3); border-radius: 28px; width: 100%; max-width: 280px; pointer-events: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        .nav-btn { background: none; border: none; color: rgba(255,230,240,0.5); display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; padding: 4px 16px; transition: color 0.2s; position: relative; }
        .nav-btn.active { color: #fff; }
        .nav-icon { font-size: 18px; font-weight: 300; display: flex; align-items: center; justify-content: center; }
        .nav-label { font-size: 9px; font-weight: 500; letter-spacing: 0.3px; }
        .nav-dot-indicator { width: 4px; height: 4px; border-radius: 50%; background: #fff; position: absolute; bottom: -1px; left: 50%; transform: translateX(-50%); }

        .lock-screen { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: url('/wallpaper_lock.jpg') center/cover no-repeat; color: #fff; cursor: pointer; user-select: none; position: relative; }
        .lock-screen::before { content: ''; position: absolute; inset: 0; background: rgba(0,0,0,0.15); }
        .lock-time { font-size: 72px; font-weight: 700; letter-spacing: -2px; position: relative; z-index: 1; text-shadow: 0 2px 12px rgba(0,0,0,0.3); }
        .lock-date { font-size: 14px; color: rgba(255,255,255,0.8); margin-top: 4px; position: relative; z-index: 1; text-shadow: 0 1px 4px rgba(0,0,0,0.4); }
        .lock-quote { font-size: 13px; color: rgba(255,255,255,0.7); margin-top: 20px; position: relative; z-index: 1; text-shadow: 0 1px 4px rgba(0,0,0,0.4); font-style: italic; }
        .lock-hint { position: absolute; bottom: 30px; z-index: 1; font-size: 12px; color: rgba(255,255,255,0.5); animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes callFloatPulse { 0%,100% { opacity: 0.85; } 50% { opacity: 1; } }

        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        

        
        
        
        
        
        
        
        
        .page-dots { display: flex; justify-content: center; gap: 8px; padding: 10px 0 6px; flex-shrink: 0; }
        .dot { width: 6px; height: 6px; border-radius: 3px; background: #444; cursor: pointer; transition: all 0.3s; }
        .dot.active { width: 16px; background: #c77dba; }
        .home-screen { width: 100%; height: 100%; display: flex; flex-direction: column; background: linear-gradient(160deg, #1c1520 0%, #150f1a 50%, #0f0d14 100%); overflow: hidden; }
        .hs-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 12px 14px 68px; display: flex; flex-direction: column; gap: 16px; -webkit-overflow-scrolling: touch; }

        /* Dynamic Island */
        .hs-island { display: flex; align-items: center; gap: 12px; padding: 16px 18px; background: rgba(255,240,248,0.16); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255,220,240,0.12); border-radius: 28px; cursor: pointer; transition: background 0.2s; }
        .hs-island:active { background: rgba(255,240,248,0.16); }
        .hs-island-avatar { width: 42px; height: 42px; border-radius: 50%; background: linear-gradient(135deg, rgba(240,180,210,0.3), rgba(200,140,180,0.2)); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; border: 1.5px solid rgba(255,200,220,0.2); }
        .hs-island-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
        .hs-island-info { flex: 1; min-width: 0; }
        .hs-island-name { font-size: 16px; font-weight: 600; color: #fff; letter-spacing: 0.5px; }
        .hs-island-status { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hs-island-music { width: 30px; height: 30px; border-radius: 50%; background: rgba(255,200,220,0.1); display: flex; align-items: center; justify-content: center; color: rgba(255,200,220,0.6); flex-shrink: 0; }
        .hs-island-music:active { background: rgba(255,200,220,0.2); }

        /* Couple bar */
        .hs-couple-bar { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 16px; background: rgba(255,220,240,0.14); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,200,220,0.1); border-radius: 12px; cursor: pointer; color: #fff; font-size: 13px; font-weight: 500; letter-spacing: 0.8px; }
        .hs-couple-bar:active { background: rgba(255,200,220,0.14); }
        .hs-couple-bar svg { color: #fff; }

        /* Moments card */
        .hs-card-moments { border-radius: 16px; overflow: hidden; cursor: pointer; background: rgba(255,240,248,0.14); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255,220,240,0.15); padding: 36px 16px; }
        .hs-card-moments:active { background: rgba(255,240,248,0.16); }
        .hs-card-moments-inner { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; color: #fff; font-weight: 500; letter-spacing: 0.5px; }
        .hs-card-moments-inner svg { color: rgba(255,255,255,0.8); }

        /* Row layout */
        .hs-row { display: flex; align-items: stretch; }

        /* Note card */
        .hs-card-note { flex: 1; padding: 20px 16px; min-height: 80px; background: rgba(255,240,248,0.14); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,220,240,0.1); border-radius: 14px; cursor: pointer; overflow: hidden; display: flex; flex-direction: column; gap: 6px; }
        .hs-card-note:active { background: rgba(255,240,248,0.14); }
        .hs-card-note-label { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #fff; font-weight: 500; }
        .hs-card-note-label svg { color: rgba(255,255,255,0.7); }
        .hs-card-note-text { font-size: 13px; color: rgba(255,240,248,0.85); line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

        /* System button */
        .hs-btn-system { width: 56px; display: flex; align-items: center; justify-content: center; background: rgba(255,240,248,0.14); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,220,240,0.08); border-radius: 14px; cursor: pointer; color: #fff; }
        .hs-btn-system:active { background: rgba(255,240,248,0.12); }

        /* Chip row */
        .hs-chip-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .home-word-card { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: rgba(255,240,248,0.10); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,220,240,0.15); border-radius: 14px; }
        .word-card-avatar { flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; overflow: hidden; border: 1.5px solid rgba(255,220,240,0.3); }
        .word-card-ava-img { width: 100%; height: 100%; object-fit: cover; }
        .word-card-ava-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(255,220,240,0.15); color: rgba(255,255,255,0.6); font-size: 13px; }
        .word-card-text { flex: 1; min-width: 0; }
        .word-card-content { font-size: 12.5px; color: rgba(255,255,255,0.75); line-height: 1.5; word-break: break-all; }
        .word-card-input { flex: 1; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,220,240,0.2); border-radius: 8px; padding: 4px 8px; font-size: 12px; color: #fff; outline: none; }
        .word-card-save { background: rgba(255,180,220,0.25); border: 1px solid rgba(255,220,240,0.3); border-radius: 6px; color: #fff; padding: 4px 10px; font-size: 12px; cursor: pointer; }
        .user-word-card { cursor: pointer; }
        .hs-chip { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 16px 10px; background: rgba(255,240,248,0.12); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255,220,240,0.15); border-radius: 12px; cursor: pointer; font-size: 12px; color: #fff; font-weight: 500; white-space: nowrap; overflow: hidden; }
        .hs-chip:active { background: rgba(255,240,248,0.12); }
        .hs-chip svg { flex-shrink: 0; color: rgba(255,255,255,0.7); }

        /* Page 2 mini cards */
        .hs-card-mini { flex: 1; padding: 30px 14px; min-height: 90px; background: rgba(255,240,248,0.14); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,220,240,0.1); border-radius: 14px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .hs-card-mini:active { background: rgba(255,240,248,0.14); }
        .hs-card-mini-icon { color: #fff; }
        .hs-card-mini-label { font-size: 12px; color: #fff; font-weight: 500; }

        /* Polaroid area */
        .hs-polaroid-area { background: rgba(255,240,248,0.25); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255,220,240,0.2); border-radius: 18px; padding: 14px 10px 12px; }
        .hs-polaroid-title { text-align: center; font-size: 11px; color: rgba(255,255,255,0.6); font-weight: 500; letter-spacing: 1.5px; margin-bottom: 2px; text-transform: lowercase; }

        /* Page 3 cards */
        .hs-card-diary { padding: 24px 18px; min-height: 100px; background: rgba(255,240,248,0.14); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,220,240,0.1); border-radius: 14px; cursor: pointer; }
        .hs-card-diary:active { background: rgba(255,240,248,0.14); }
        .hs-card-diary-label { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #fff; font-weight: 500; margin-bottom: 6px; }
        .hs-card-diary-label svg { color: rgba(255,255,255,0.7); }
        .hs-card-diary-text { font-size: 12px; color: rgba(255,240,248,0.85); line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }

        .hs-card-half { flex: 1; padding: 28px 14px; min-height: 95px; background: rgba(255,240,248,0.14); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,220,240,0.1); border-radius: 14px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .hs-card-half:active { background: rgba(255,240,248,0.14); }
        .hs-card-half-icon { color: #fff; }
        .hs-card-half-label { font-size: 12px; color: #fff; font-weight: 500; }
        .hs-card-half-sub { font-size: 10px; color: rgba(255,255,255,0.6); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

        .hs-card-wide { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 22px 16px; background: rgba(255,240,248,0.14); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,220,240,0.08); border-radius: 14px; cursor: pointer; font-size: 13px; color: #fff; font-weight: 500; }
        .hs-card-wide:active { background: rgba(255,240,248,0.12); }
        .hs-card-wide svg { color: rgba(255,255,255,0.7); }


        .app-page { width: 100%; height: 100%; display: flex; flex-direction: column; background: #f5f0f5; }
        .app-page-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #e8dce8; flex-shrink: 0; background: #fff; position: relative; z-index: 20; }
        .back-btn { background: none; border: none; color: #c77dba; font-size: 20px; cursor: pointer; padding: 4px 8px; }
        .app-page-title { color: #333; font-size: 16px; font-weight: 500; }
        .app-page-body { flex: 1; overflow-y: auto; padding: 20px 16px; }
        .app-page-body-html { padding: 0; display: flex; flex-direction: column; overflow: hidden; }
        .app-page-body-html iframe { flex: 1; min-height: 0; }
        .app-content { }
        .app-content-title { font-size: 18px; color: #9b5da0; margin-bottom: 16px; text-align: center; }
        .app-content-list { display: flex; flex-direction: column; gap: 10px; }
        .app-content-item { padding: 12px 16px; background: #fff; border-radius: 12px; color: #444; font-size: 14px; border: 1px solid #e8dce8; }

        .chat-view { width: 100%; height: 100%; display: flex; flex-direction: column; background: #e5ddd5; position: relative; }
        .chat-view::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 20% 20%, rgba(255,255,255,0.28), transparent 30%), radial-gradient(circle at 80% 0%, rgba(255,255,255,0.18), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02)); pointer-events: none; opacity: 0.75; }
        .chat-header { display: flex; align-items: center; padding: calc(6px + env(safe-area-inset-top, 0px)) 12px 6px; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.12); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); flex-shrink: 0; position: relative; z-index: 1; }
        .chat-avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #ededed, #d8d8d8); display: flex; align-items: center; justify-content: center; font-size: 13px; color: #666; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
        .chat-header-info { margin-left: 8px; flex: 1; min-width: 0; }
        .chat-name { font-size: 14px; font-weight: 600; color: #111; line-height: 1.2; }
        .chat-status { font-size: 10px; color: #6b7280; margin-top: 1px; }
        .chat-messages { flex: 1; overflow-y: auto; padding: 14px 12px 10px; position: relative; z-index: 1; }
        .chat-empty { text-align: center; color: rgba(17,17,17,0.45); margin-top: 40%; font-size: 14px; }
        .msg-row { position: relative; display: flex; flex-direction: column; margin-bottom: 3px; padding: 0 12px; }
        .msg-row.user { align-items: flex-end; }
        .msg-row.assistant { align-items: flex-start; }
        .msg-avatar { width: 38px; height: 38px; border-radius: 6px; background: linear-gradient(135deg, #ededed, #d8d8d8); display: flex; align-items: center; justify-content: center; font-size: 12px; color: #666; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.15); border: 2px solid rgba(255,255,255,0.8); margin-bottom: -12px; position: relative; z-index: 2; }
        .msg-bubble { max-width: 78%; padding: 11px 14px; border-radius: 4px; font-size: 14px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; box-shadow: 0 1px 3px rgba(0,0,0,0.06); letter-spacing: 0.01em; }
        .msg-bubble.user { background: #95ec69; color: #111; }
        .msg-bubble.assistant { background: rgba(255,255,255,0.92); color: #1a1a1a; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(0,0,0,0.05); }
        .chat-input-area { display: flex; align-items: center; gap: 6px; padding: 6px 10px calc(6px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.1); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); flex-shrink: 0; position: relative; z-index: 1; overflow: hidden; margin-bottom: 62px; }
        .chat-plus-btn { width: 30px; height: 30px; border-radius: 50%; background: #fff; color: #333; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 15px; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.08); box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .emoji-panel { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 10px; background: rgba(246,246,246,0.98); border-top: 1px solid rgba(0,0,0,0.08); position: relative; z-index: 1; }
        .emoji-item { font-size: 20px; cursor: pointer; padding: 3px; border-radius: 6px; }
        .emoji-item:hover { background: rgba(0,0,0,0.06); }
        .fetch-models-btn { padding: 5px 9px; background: #07c160; color: #fff; border: none; border-radius: 8px; font-size: 11px; cursor: pointer; white-space: nowrap; }
        .chat-input { flex: 1; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; padding: 8px 12px; color: #eee; font-size: 14px; outline: none; font-family: inherit; min-height: 30px; max-height: 96px; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
        .chat-input:focus { border-color: rgba(200,125,186,0.5); box-shadow: 0 0 0 3px rgba(200,125,186,0.15); }
        .chat-send { width: 32px; height: 32px; border-radius: 50%; background: #07c160; color: #fff; border: none; cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
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
        .fish-btn.cast { background: linear-gradient(135deg, #f0c6d8, #e8a0bf); color: #fff; }
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
        /* ── Music Dynamic Island ── */
        @keyframes mi-bounce { 0%,100% { height: 4px; } 50% { height: 14px; } }
        .mi-pill { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); z-index: 200;
          display: flex; align-items: center; gap: 6px;
          background: rgba(255,230,245,0.45); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border-radius: 22px;
          padding: 5px 14px 5px 6px; cursor: pointer;
          box-shadow: 0 2px 12px rgba(200,125,186,0.2); transition: all .3s cubic-bezier(.4,0,.2,1);
          border: 1px solid rgba(255,220,240,0.35); }
        .mi-pill:active { transform: translateX(-50%) scale(0.96); }
        .mi-pill-avatars { display: flex; align-items: center; }
        .mi-ava { width: 26px; height: 26px; border-radius: 50%; object-fit: cover;
          border: 2px solid #fff; }
        .mi-ava-right { margin-left: -8px; }
        .mi-ava-fallback { background: linear-gradient(135deg, #f0c6d8, #e8a0bf); display: flex;
          align-items: center; justify-content: center; font-size: 11px; color: #fff; }
        .mi-pill-bars { display: flex; align-items: flex-end; gap: 2px; height: 16px; padding-left: 4px; }
        .mi-bar { width: 2.5px; border-radius: 2px; background: #e8a0bf;
          animation: mi-bounce .6s ease-in-out infinite; }

        /* ── Expanded Panel ── */
        .mi-panel { position: absolute; top: 0; left: 0; right: 0; z-index: 200;
          padding: 8px 12px; }
        .mi-panel-inner { background: rgba(255,230,245,0.55); backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px); box-shadow: 0 4px 24px rgba(199,125,186,0.15);
          border-radius: 22px; padding: 12px 16px 10px;
          box-shadow: 0 4px 24px rgba(200,125,186,0.3);
          border: 1px solid rgba(200,125,186,0.15);
          animation: mi-expand .3s cubic-bezier(.4,0,.2,1); }
        @keyframes mi-expand { from { opacity: 0; transform: scaleY(0.6) translateY(-10px); } to { opacity: 1; transform: scaleY(1) translateY(0); } }
        .mi-panel-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .mi-panel-avatars { display: flex; align-items: center; }
        .mi-panel-ava { width: 36px; height: 36px; border-radius: 50%; object-fit: cover;
          border: 2px solid rgba(200,125,186,0.5); }
        .mi-panel-ava-right { margin-left: -12px; border-color: rgba(199,125,186,0.3); }
        .mi-panel-together { font-size: 11px; color: #8c6480; font-weight: 500; }
        .mi-mins { font-size: 14px; font-weight: 700; color: #c77dba; }
        .mi-panel-song { text-align: center; margin-bottom: 6px; }
        .mi-song-name { font-size: 13px; font-weight: 600; color: #3a2433; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis; max-width: 260px; margin: 0 auto; }
        .mi-song-artist { font-size: 10px; color: #a08090; margin-top: 1px; }
        .mi-lyric-line { font-size: 11px; color: #c77dba; margin-top: 4px; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis; max-width: 280px; margin-left: auto; margin-right: auto;
          opacity: 0.85; animation: mi-lyric-fade .4s ease; }
        @keyframes mi-lyric-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 0.85; transform: translateY(0); } }
        .mi-progress-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .mi-time { font-size: 10px; color: #a08090; min-width: 32px; font-variant-numeric: tabular-nums; }
        .mi-time:last-child { text-align: right; }
        .mi-progress-track { flex: 1; height: 3px; background: rgba(199,125,186,0.2); border-radius: 2px; overflow: hidden; }
        .mi-progress-fill { height: 100%; background: linear-gradient(90deg, #e8a0bf, #c77dba); border-radius: 2px;
          transition: width 1s linear; }
        .mi-controls { display: flex; align-items: center; justify-content: center; gap: 20px; }
        .mi-ctrl { background: none; border: none; color: #b08a9f; cursor: pointer; padding: 4px;
          display: flex; align-items: center; justify-content: center; transition: color .15s; }
        .mi-ctrl:active { color: #c77dba; }
        .mi-ctrl-play { color: #c77dba; }
        .mi-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 199; background: rgba(0,0,0,0.15); }
        .mi-ctrl-heart { color: rgba(200,125,186,0.5); }

      
        .app-iframe { width: 100%; flex: 1; border: none; background: #fff; }
        .app-page { display: flex; flex-direction: column; height: 100%; }
      
        .settings-panel { padding: 16px; overflow-y: auto; flex: 1; background: #f5f0f5; }
        .settings-section { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; border: 1px solid #e8dce8; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .settings-title { font-size: 15px; color: #9b5da0; margin-bottom: 12px; }
        .settings-item { margin-bottom: 12px; }
        .settings-item label { display: block; font-size: 12px; color: #7a6a79; margin-bottom: 4px; }
        .settings-input { width: 100%; background: #f8f4f8; border: 1px solid #e0d0e0; border-radius: 8px; padding: 10px 12px; color: #333; font-size: 14px; outline: none; }
        .settings-input:focus { border-color: #c77dba; }
        .settings-save { width: 100%; padding: 12px; border: none; border-radius: 10px; background: linear-gradient(135deg, #f0c6d8, #e8a0bf); color: #fff; font-size: 15px; font-weight: 600; margin-top: 8px; cursor: pointer; }
        .settings-desc { font-size: 13px; color: #888; }
      
        /* msg-row position:relative moved to main rule */
        .msg-menu { position: absolute; bottom: 100%; left: 10px; z-index: 100; background: #faf8f5; border: 1px solid #e8e4df; border-radius: 12px; padding: 4px 0; box-shadow: 0 2px 12px rgba(0,0,0,.1); min-width: 120px; margin-bottom: 4px; }
        .msg-row.user .msg-menu { left: auto; right: 10px; }
        .msg-menu button { display: block; width: 100%; padding: 8px 14px; background: none; border: none; color: #5a5a5a; font-size: 13px; text-align: left; cursor: pointer; }
        .msg-menu button:active { background: rgba(0,0,0,.05); }
        .msg-system { font-size: 12px; color: #9a8a99; background: rgba(255,255,255,.03); border-radius: 8px; padding: 8px 12px; margin: 4px auto; max-width: 85%; text-align: center; border: 1px dashed #333; }
        .tool-log-wrap { width: 90%; margin: 4px auto; background: #f8f6f3; border-radius: 10px; border: 1px solid #e8e4df; cursor: pointer; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
        .tool-log-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; font-size: 11px; color: #6b5d56; font-weight: 500; }
        .tool-log-arrow { font-size: 10px; color: #9a8a84; }
        .tool-log-body { padding: 4px 0 8px; background: #fdfcfb; }
        .tool-log-section { margin: 6px 12px; padding-bottom: 6px; border-bottom: 1px solid #f0ede8; }
        .tool-log-section:last-child { border-bottom: none; }
        .tool-log-section-title { font-size: 11px; color: #8a7a74; font-weight: 600; margin-bottom: 6px; letter-spacing: 0.3px; }
        .tool-log-item { padding: 6px 0; margin-left: 8px; border-bottom: 1px solid #f5f3f0; }
        .tool-log-item:last-child { border-bottom: none; }
        .tool-log-name { font-size: 11px; color: #b08080; font-weight: 600; }
        .tool-log-args { font-size: 10px; color: #9a8a84; white-space: pre-wrap; word-break: break-all; margin-top: 2px; line-height: 1.4; }
        .tool-log-result { font-size: 10px; color: #7a9a7a; white-space: pre-wrap; word-break: break-all; margin-top: 2px; line-height: 1.4; }
        .memory-hit-item { margin-left: 8px; }
        .memory-hit-source { font-size: 10px; color: #8a7a74; margin-bottom: 4px; }
        .memory-hit-preview { font-size: 10px; color: #6b5d56; line-height: 1.5; background: #f5f3f0; padding: 6px 8px; border-radius: 6px; border-left: 2px solid #d4c8bf; }
        .msg-row.tool_log { align-items: center; justify-content: center; }
        .msg-row.group-first { margin-top: 14px; }
        .msg-row.group-cont { margin-top: 0; }
        .msg-row.group-cont .msg-bubble { margin-top: 2px; }
        .msg-row.group-first .msg-bubble { padding-top: 16px; }
        .read-status { font-size: 11px; color: #bbb; display: flex; align-items: center; gap: 2px; margin-top: 2px; }
        .read-status svg { width: 14px; height: 14px; }
        .msg-row.user .read-status { justify-content: flex-end; }
        .msg-row.assistant .read-status { justify-content: flex-start; }
        .msg-time-divider { text-align: center; padding: 10px 0 6px; font-size: 11px; color: #8a8a8a; letter-spacing: 1px; }
        .thinking-inline { margin-bottom: 6px; background: #faf7f2; border-radius: 8px; border: 1px solid rgba(210,200,185,0.4); overflow: hidden; }
        .thinking-inline-trigger { display: flex; align-items: center; gap: 6px; padding: 5px 10px; font-size: 11px; color: #9a9088; cursor: pointer; user-select: none; }
        .thinking-inline-trigger:active { background: rgba(0,0,0,0.03); }
        .thinking-inline-body { padding: 6px 10px 8px; border-top: 1px solid rgba(210,200,185,0.3); font-size: 11px; color: #8a8278; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; background: #f8f5ef; }
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
        .chat-trigger { width: 34px; height: 34px; border-radius: 50%; border: none; background: transparent; color: #999; font-size: 14px; cursor: pointer; flex-shrink: 0; box-shadow: 0 1px 3px rgba(102,126,234,0.4); }
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
        .avatar-img { width: 100%; height: 100%; border-radius: 6px; object-fit: cover; }
        .user-avatar { background: #c77dba; }
        .msg-row.assistant .msg-avatar { margin-left: -8px; }
        .msg-row.user .msg-avatar { margin-right: -8px; }

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
        .polaroid-wall { display: flex; justify-content: center; align-items: flex-start; gap: 8px; padding: 8px 8px 10px; flex-wrap: wrap; }
        .polaroid-card { position: relative; width: 28%; background: rgba(255,255,255,0.92); border-radius: 4px; padding: 5px 5px 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06); transition: transform 0.3s; }
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

