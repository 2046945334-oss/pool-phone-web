import { useState, useRef, useEffect } from 'react'
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
        {messages.length === 0 && <div className="chat-empty">{'\u53d1\u6761\u6d88\u606f\u5f00\u59cb\u804a\u5929'} {'\ud83d\udcac'}</div>}
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
      <div className="lock-hint">{'\u25b2'} {'\u70b9\u51fb\u89e3\u9501'}</div>
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
  ]
  const [page, setPage] = useState(0)
  const startDate = new Date(2026, 6, 21)
  const today = new Date()
  const coupleDays = Math.floor((today - startDate) / (1000*60*60*24))

  return (
    <div className="home-screen">
      <div className="home-scroll">
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
        <div className="home-section-title">{page === 0 ? '\ud83c\udf19 \u6c60\u7684\u624b\u673a' : '\u66f4\u591a\u5e94\u7528'}</div>
        <div className="home-pager">
          <div style={{ display: page === 0 ? 'block' : 'none' }}>
            <div className="app-grid">
              {page1Apps.map(app => (
                <div key={app.id} className="app-item" onClick={() => onOpenApp(app.id)}>
                  <div className="app-icon"><img src={app.icon} alt={app.name} /></div>
                  <div className="app-label">{app.name}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: page === 1 ? 'block' : 'none' }}>
            <div className="app-grid">
              {page2Apps.map(app => (
                <div key={app.id} className="app-item" onClick={() => onOpenApp(app.id)}>
                  <div className="app-icon"><img src={app.icon} alt={app.name} /></div>
                  <div className="app-label">{app.name}</div>
                </div>
              ))}
            </div>
          </div>
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
    if (currentApp) {
      const names = { notes:'\u4fbf\u7b7e', gallery:'\u547d\u8fd0\u5361\u6c60', messages:'\u5982\u679c\u2026', music:'\u97f3\u4e50', browser:'\u6d4f\u89c8', couple:'\u60c5\u4fa3\u7a7a\u95f4', system:'\u7cfb\u7edf', doodle:'\u6d82\u9e26', ledger:'\u5360\u535c', drafts:'\u8349\u7a3f\u7bb1', fishing:'\u9493\u9c7c', reader:'\u9605\u8bfb', game:'\u665a\u5b89' }
      return (
        <div className="app-page">
          <div className="app-page-header">
            <button className="back-btn" onClick={handleBack}>{'\u2190'}</button>
            <span className="app-page-title">{names[currentApp] || currentApp}</span>
          </div>
          <div className="app-page-body"><div className="coming-soon">{'\ud83d\udea7 \u5f00\u53d1\u4e2d...'}</div></div>
        </div>
      )
    }
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

        .home-screen { width: 100%; height: 100%; display: flex; flex-direction: column; background: linear-gradient(180deg, #1a1520 0%, #12101a 100%); }
        .home-scroll { flex: 1; overflow-y: auto; padding: 0 12px 16px; }
        .home-banner { margin: 12px 0 10px; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
        .banner-img { width: 100%; height: auto; display: block; }

        .music-card { display: flex; align-items: center; gap: 12px; padding: 12px 16px; margin-bottom: 10px; background: rgba(255,255,255,0.06); border-radius: 14px; border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: background 0.2s; }
        .music-card:active { background: rgba(255,255,255,0.1); }
        .music-icon { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #e8a0bf, #c77dba); display: flex; align-items: center; justify-content: center; font-size: 16px; color: #fff; flex-shrink: 0; }
        .music-info { flex: 1; }
        .music-title { font-size: 13px; color: #f0e6ef; font-weight: 500; }
        .music-status { font-size: 11px; color: #9a8a99; margin-top: 2px; }

        .couple-card { margin-bottom: 10px; border-radius: 14px; overflow: hidden; position: relative; height: 100px; cursor: pointer; box-shadow: 0 2px 12px rgba(0,0,0,0.3); }
        .couple-bg { position: absolute; inset: 0; }
        .couple-bg img { width: 100%; height: 100%; object-fit: cover; }
        .couple-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.3); display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .couple-days { font-size: 22px; font-weight: 700; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.5); }
        .couple-hint { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 4px; }

        .memo-card { padding: 12px 16px; margin-bottom: 14px; background: rgba(232,160,191,0.08); border-radius: 14px; border: 1px solid rgba(232,160,191,0.15); }
        .memo-label { font-size: 11px; color: #9a8a99; margin-bottom: 4px; }
        .memo-text { font-size: 13px; color: #e0d6de; }

        .home-section-title { text-align: center; color: #e8a0bf; font-size: 14px; font-weight: 500; margin-bottom: 14px; padding-top: 4px; }
        .app-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 6px; }
        .app-item { display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; padding: 6px 4px; border-radius: 12px; transition: transform 0.1s, background 0.2s; }
        .app-item:active { transform: scale(0.92); background: rgba(232,160,191,0.08); }
        .app-icon { width: 52px; height: 52px; border-radius: 14px; overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
        .app-icon img { width: 100%; height: 100%; object-fit: cover; border-radius: 14px; }
        .app-label { font-size: 11px; color: #fff; text-align: center; }
        .page-dots { display: flex; justify-content: center; gap: 8px; padding: 14px 0 8px; }
        .dot { width: 6px; height: 6px; border-radius: 3px; background: #444; cursor: pointer; transition: all 0.3s; }
        .dot.active { width: 16px; background: #e8a0bf; }

        .app-page { width: 100%; height: 100%; display: flex; flex-direction: column; background: #0d0d0d; }
        .app-page-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #1a1a1a; }
        .back-btn { background: none; border: none; color: #e8a0bf; font-size: 20px; cursor: pointer; padding: 4px 8px; }
        .app-page-title { color: #e0e0e0; font-size: 16px; font-weight: 500; }
        .app-page-body { flex: 1; display: flex; align-items: center; justify-content: center; }
        .coming-soon { color: #555; font-size: 16px; }

        .chat-view { width: 100%; height: 100%; display: flex; flex-direction: column; }
        .chat-header { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid #1a1a1a; background: #111; }
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
        .chat-input-area { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid #1a1a1a; background: #111; }
        .chat-input { flex: 1; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 20px; padding: 9px 14px; color: #e0e0e0; font-size: 14px; outline: none; font-family: inherit; }
        .chat-input:focus { border-color: #e8a0bf; }
        .chat-send { width: 34px; height: 34px; border-radius: 50%; background: #c77dba; color: #fff; border: none; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .chat-send:disabled { opacity: 0.4; }
      `}</style>
    </>
  )
}
