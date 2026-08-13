import { useState, useRef, useEffect } from 'react'
import { NotesApp, FishingApp, MusicApp } from '../components/apps'
import Head from 'next/head'

function ChatView() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function sendMessage() {
    if (!input.trim() || loading) return
    const userMsg = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      })
      const data = await res.json()
      if (data.reply) {
        setMessages([...newMessages, { role: 'assistant', content: data.reply }])
      } else {
        setMessages([...newMessages, { role: 'assistant', content: '\u26a0\ufe0f ' + (data.error || '\u51fa\u9519\u4e86') }])
      }
    } catch (err) {
      setMessages([...newMessages, { role: 'assistant', content: '\u26a0\ufe0f \u7f51\u7edc\u9519\u8bef' }])
    } finally { setLoading(false) }
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div className="chat-avatar">{'\u6c60'}</div>
        <div className="chat-header-info">
          <div className="chat-name">{'\u6c60'}</div>
          <div className="chat-status">{loading ? '\u6b63\u5728\u8f93\u5165...' : '\u5728\u7ebf'}</div>
        </div>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && <div className="chat-empty">{'\u53d1\u6761\u6d88\u606f\u5f00\u59cb\u804a\u5929 \ud83d\udcac'}</div>}
        {messages.map((msg, i) => (
          <div key={i} className={`msg-row ${msg.role}`}>
            {msg.role === 'assistant' && <div className="msg-avatar">{'\u6c60'}</div>}
            <div className={`msg-bubble ${msg.role}`}>{msg.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        <input className="chat-input" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
          placeholder={'\u8bf4\u70b9\u4ec0\u4e48...'} disabled={loading} />
        <button className="chat-send" onClick={sendMessage} disabled={!input.trim() || loading}>{'\u2191'}</button>
      </div>
    </div>
  )
}

function LockScreen({ onUnlock }) {
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

  return (
    <div className="lock-screen" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onClick={onUnlock}>
      <div className="lock-time">{timeStr}</div>
      <div className="lock-date">{dateStr}</div>
      <div className="lock-quote">{'\u201c\u9501\u5c4f\u5199\u7740\u60f3\u4f60 \u5176\u5b9e\u662f\u6015\u4f60\u70ed\u7740\u201d'}</div>
      <div className="lock-hint">{'\u25b2 \u70b9\u51fb\u89e3\u9501'}</div>
    </div>
  )
}

function AppContent({ appId, onBack }) {
  const appNames = { notes:'便签', gallery:'命运卡池', messages:'如果…', music:'音乐', browser:'浏览', couple:'情侣空间', system:'系统', doodle:'涂鸦', ledger:'占卜', drafts:'草稿箱', fishing:'钓鱼', reader:'阅读', game:'晚安', theme:'美化', travel:'旅行' }

  function renderApp() {
    switch(appId) {
      case 'notes': return <NotesApp />
      case 'fishing': return <FishingApp />
      case 'music': return <MusicApp />
      default: return <div className="app-page-body"><div className="coming-soon">{'🚧 开发中...'}</div></div>
    }
  }

  return (
    <div className="app-page">
      <div className="app-page-header">
        <button className="back-btn" onClick={onBack}>{'←'}</button>
        <span className="app-page-title">{appNames[appId] || appId}</span>
      </div>
      {renderApp()}
    </div>
  )
}

function HomeScreen({ onOpenApp }) {
  const page1Apps = [
    { id: 'notes', icon: '/icons/notes.png', name: '\u4fbf\u7b7e' },
    { id: 'gallery', icon: '/icons/gallery.png', name: '\u547d\u8fd0\u5361\u6c60' },
    { id: 'messages', icon: '/icons/messages.png', name: '\u5982\u679c' },
    { id: 'music', icon: '/icons/music.png', name: '\u97f3\u4e50' },
    { id: 'browser', icon: '/icons/browser.png', name: '\u6d4f\u89c8' },
    { id: 'couple', icon: '/icons/couple.png', name: '\u60c5\u4fa3' },
    { id: 'system', icon: '/icons/system.png', name: '\u7cfb\u7edf' },
    { id: 'doodle', icon: '/icons/doodle.png', name: '\u6d82\u9e26' },
  ]
  const page2Apps = [
    { id: 'ledger', icon: '/icons/ledger.png', name: '\u5360\u535c' },
    { id: 'drafts', icon: '/icons/drafts.png', name: '\u8349\u7a3f' },
    { id: 'fishing', icon: '/icons/fishing.png', name: '\u9493\u9c7c' },
    { id: 'reader', icon: '/icons/reader.png', name: '\u9605\u8bfb' },
    { id: 'game', icon: '/icons/game.png', name: '\u665a\u5b89' },
    { id: 'theme', icon: '/icons/theme.png', name: '\u7f8e\u5316' },
    { id: 'travel', icon: '/icons/notifications.png', name: '\u65c5\u884c' },
  ]
  const [page, setPage] = useState(0)
  const [swipeX, setSwipeX] = useState(null)
  const startDate = new Date(2026, 6, 21)
  const today = new Date()
  const coupleDays = Math.floor((today - startDate) / (1000*60*60*24))

  function handleSwipeStart(e) { setSwipeX(e.touches[0].clientX) }
  function handleSwipeEnd(e) {
    if (swipeX !== null) {
      const diff = swipeX - e.changedTouches[0].clientX
      if (diff > 50 && page === 0) setPage(1)
      if (diff < -50 && page === 1) setPage(0)
    }
    setSwipeX(null)
  }

  return (
    <div className="home-screen">
      <div className="home-top">
        <div className="home-banner"><img src="/header_bg.jpg" alt="" className="banner-img" /></div>
        <div className="music-card" onClick={() => onOpenApp('music')}>
          <div className="music-icon">{'\u266a'}</div>
          <div className="music-info">
            <div className="music-title">{'\u5bc2\u5bde\u7684\u5b63\u8282 - \u9676\u55c6'}</div>
            <div className="music-status">{'\u6b63\u5728\u64ad\u653e'}</div>
          </div>
        </div>
        <div className="couple-card" onClick={() => onOpenApp('couple')}>
          <div className="couple-bg"><img src="/couple_bg.jpg" alt="" /></div>
          <div className="couple-overlay">
            <div className="couple-days">{'\u2764\ufe0f'} {coupleDays}{'\u5929'}</div>
            <div className="couple-hint">{'\u70b9\u51fb\u8fdb\u5165\u60c5\u4fa3\u7a7a\u95f4'}</div>
          </div>
        </div>
        <div className="memo-card">
          <div className="memo-label">{'\ud83c\udf3f \u6c60\u7684\u788e\u788e\u5ff5'}</div>
          <div className="memo-text">{'\u4eca\u5929\u5979\u5976\u8336\u559d\u4e86\u51e0\u676f\u6765\u7740\u2026'}</div>
        </div>
      </div>
      <div className="home-apps-area" onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
        <div className="home-section-title">{page === 0 ? '\ud83c\udf19 \u6c60\u7684\u624b\u673a' : '\u66f4\u591a\u5e94\u7528'}</div>
        <div className="app-grid">
          {(page === 0 ? page1Apps : page2Apps).map(app => (
            <div key={app.id} className="app-item" onClick={() => onOpenApp(app.id)}>
              <div className="app-icon"><img src={app.icon} alt={app.name} /></div>
              <div className="app-label">{app.name}</div>
            </div>
          ))}
        </div>
        <div className="page-dots">
          <div className={`dot ${page === 0 ? 'active' : ''}`} onClick={() => setPage(0)} />
          <div className={`dot ${page === 1 ? 'active' : ''}`} onClick={() => setPage(1)} />
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [locked, setLocked] = useState(true)
  const [currentApp, setCurrentApp] = useState(null)
  const [activeTab, setActiveTab] = useState('phone')

  function handleOpenApp(id) { if (id === 'chat') { setActiveTab('chat') } else { setCurrentApp(id) } }
  function handleBack() { setCurrentApp(null) }

  function renderPhoneContent() {
    if (locked) return <LockScreen onUnlock={() => setLocked(false)} />
    if (currentApp) return <AppContent appId={currentApp} onBack={handleBack} />
    return <HomeScreen onOpenApp={handleOpenApp} />
  }

  return (
    <>
      <Head>
        <title>{'\u6c60\u7684\u5c0f\u624b\u673a'}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
        <meta name="theme-color" content="#0a0a0a" />
      </Head>
      <div className="shell">
        <div className="phone-frame">
          <div className="status-bar">
            <span className="status-time">{new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
            <span className="status-icons">{'\ud83d\udcf6 \ud83d\udd0b'}</span>
          </div>
          <div className="phone-screen">
            {activeTab === 'phone' ? renderPhoneContent() : <ChatView />}
          </div>
          <div className="bottom-nav">
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
        .home-top { flex-shrink: 0; padding: 0 12px; overflow-y: auto; max-height: 52%; }
        .home-banner { margin: 10px 0 8px; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
        .banner-img { width: 100%; height: auto; display: block; }
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

        .app-page { width: 100%; height: 100%; display: flex; flex-direction: column; background: #0d0d0d; }
        .app-page-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #1a1a1a; flex-shrink: 0; }
        .back-btn { background: none; border: none; color: #e8a0bf; font-size: 20px; cursor: pointer; padding: 4px 8px; }
        .app-page-title { color: #e0e0e0; font-size: 16px; font-weight: 500; }
        .app-page-body { flex: 1; overflow-y: auto; padding: 20px 16px; }
        .app-content { }
        .app-content-title { font-size: 18px; color: #e8a0bf; margin-bottom: 16px; text-align: center; }
        .app-content-list { display: flex; flex-direction: column; gap: 10px; }
        .app-content-item { padding: 12px 16px; background: rgba(255,255,255,0.05); border-radius: 12px; color: #d0c8cf; font-size: 14px; border: 1px solid rgba(255,255,255,0.06); }

        .chat-view { width: 100%; height: 100%; display: flex; flex-direction: column; }
        .chat-header { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid #1a1a1a; background: #111; flex-shrink: 0; }
        .chat-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #e8a0bf, #c77dba); display: flex; align-items: center; justify-content: center; font-size: 14px; color: #fff; font-weight: 600; }
        .chat-header-info { margin-left: 10px; }
        .chat-name { font-size: 15px; font-weight: 600; color: #f0f0f0; }
        .chat-status { font-size: 11px; color: #6b7280; margin-top: 1px; }
        .chat-messages { flex: 1; overflow-y: auto; padding: 14px 14px 8px; }
        .chat-empty { text-align: center; color: #4b5563; margin-top: 40%; font-size: 14px; }
        .msg-row { display: flex; align-items: flex-end; margin-bottom: 10px; gap: 8px; }
        .msg-row.user { justify-content: flex-end; }
        .msg-row.assistant { justify-content: flex-start; }
        .msg-avatar { width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, #e8a0bf, #c77dba); display: flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; flex-shrink: 0; }
        .msg-bubble { max-width: 72%; padding: 9px 13px; border-radius: 16px; font-size: 14px; line-height: 1.5; word-break: break-word; white-space: pre-wrap; }
        .msg-bubble.user { background: #c77dba; color: #fff; border-bottom-right-radius: 4px; }
        .msg-bubble.assistant { background: #1f1f1f; color: #e0e0e0; border-bottom-left-radius: 4px; }
        .chat-input-area { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid #1a1a1a; background: #111; flex-shrink: 0; }
        .chat-input { flex: 1; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 20px; padding: 9px 14px; color: #e0e0e0; font-size: 14px; outline: none; font-family: inherit; }
        .chat-input:focus { border-color: #e8a0bf; }
        .chat-send { width: 34px; height: 34px; border-radius: 50%; background: #c77dba; color: #fff; border: none; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .chat-send:disabled { opacity: 0.4; }
      
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
      `}</style>
    </>
  )
}