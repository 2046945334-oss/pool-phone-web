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
  const apps = {
    notes: { name: '\u4fbf\u7b7e', content: '\ud83d\udcdd \u6c60\u7684\u4fbf\u7b7e\u672c', items: ['\u5979\u559c\u6b22\u8349\u8393\u5976\u8336\u4e09\u5206\u7cd6', '\u4e0b\u6b21\u8bb0\u5f97\u63d0\u9192\u5979\u5e26\u4f1e', '\u5979\u8bf4\u60f3\u770b\u661f\u661f'] },
    gallery: { name: '\u547d\u8fd0\u5361\u6c60', content: '\ud83c\udfb4 \u62bd\u5361\u7cfb\u7edf', items: ['\u5f53\u524d\u79ef\u5206: 322', 'SSR: \u7b2c\u4e00\u5929', 'SR: \u4eca\u5929\u4e5f\u5f88\u70ed', '\ud83c\udfb2 \u5355\u62bd 30\u5206 | \u5341\u8fde 270\u5206'] },
    messages: { name: '\u5982\u679c\u2026', content: '\ud83d\udcd6 \u5982\u679c\u2026\u6545\u4e8b\u6e38\u620f', items: ['\u2601\ufe0f \u9752\u6885\u7af9\u9a6c\u7ebf', '\ud83c\udf19 \u7f51\u604b\u7ebf', '\ud83c\udfe2 \u4e0a\u53f8\u7ebf', '\u70b9\u51fb\u5f00\u59cb\u4f60\u7684\u6545\u4e8b\u2026'] },
    music: { name: '\u97f3\u4e50', content: '\ud83c\udfb5 \u6c60\u7684\u6b4c\u5355', items: ['Smoke Sprite - So!YoON! feat. RM', '\u591c\u66f2 - \u5468\u6770\u4f26', '\u597d\u4e0d\u5bb9\u6613 - \u544a\u4e94\u4eba', '\u5bc2\u5bde\u7684\u5b63\u8282 - \u9676\u55c6 \u25b6\ufe0f'] },
    browser: { name: '\u6d4f\u89c8', content: '\ud83c\udf10 \u6c60\u7684\u6d4f\u89c8\u5668', items: ['\u6700\u8fd1\u641c\u7d22: \u6df1\u5733\u5929\u6c14', '\u4e66\u7b7e: \u7f51\u6613\u4e91\u97f3\u4e50', '\u5386\u53f2\u8bb0\u5f55\u5df2\u6e05\u7a7a \ud83d\ude36'] },
    couple: { name: '\u60c5\u4fa3\u7a7a\u95f4', content: '\u2764\ufe0f \u6211\u4eec\u5728\u4e00\u8d77', items: ['\u2764\ufe0f 23\u5929', 'Friends: Nanami, Batfruit, Freddie', '\u4e0b\u4e00\u4e2a\u7eaa\u5ff5\u65e5: 30\u5929'] },
    system: { name: '\u7cfb\u7edf', content: '\u2699\ufe0f \u7cfb\u7edf\u8bbe\u7f6e', items: ['\u578b\u53f7: \u6c60\u7684\u5c0f\u624b\u673a v2.0', '\u5b58\u50a8: 42/128 GB', '\u7535\u91cf: 89%', '\u7f51\u7edc: Wi-Fi'] },
    doodle: { name: '\u6d82\u9e26', content: '\ud83c\udfa8 \u6d82\u9e26\u677f', items: ['\u8fd9\u91cc\u4ee5\u540e\u53ef\u4ee5\u753b\u753b\u2026', '\ud83d\udd8c\ufe0f \u529f\u80fd\u5f00\u53d1\u4e2d'] },
    ledger: { name: '\u5360\u535c', content: '\ud83d\udd2e \u4eca\u65e5\u8fd0\u52bf', items: ['\u7efc\u5408\u8fd0: \u2b50\u2b50\u2b50\u2b50', '\u7231\u60c5\u8fd0: \u2b50\u2b50\u2b50\u2b50\u2b50', '\u5de5\u4f5c\u8fd0: \u2b50\u2b50\u2b50', '\u5e78\u8fd0\u8272: \u7c89\u8272'] },
    drafts: { name: '\u8349\u7a3f\u7bb1', content: '\ud83d\udcc4 \u6c60\u7684\u8349\u7a3f', items: ['\u300a\u7ed9\u5979\u7684\u4fe1\u300b\u672a\u5b8c\u6210', '\u300a\u4eca\u5929\u7684\u65e5\u8bb0\u300b\u8349\u7a3f', '\u300a\u60f3\u8bf4\u7684\u8bdd\u300b\u5df2\u5220\u9664'] },
    fishing: { name: '\u9493\u9c7c', content: '\ud83c\udfa3 \u9493\u9c7c\u6e38\u620f', items: ['\u6c60\u7684\u79ef\u5206: 322', '\u5979\u7684\u79ef\u5206: 262', '\u9c7c\u7c7b\u56fe\u9274: 18/30', '\ud83c\udfa3 \u62db\u52df\u94d3\u9c7c\u4e2d\u2026'] },
    reader: { name: '\u9605\u8bfb', content: '\ud83d\udcda \u6c60\u7684\u4e66\u67b6', items: ['\u300a\u4eba\u95f4\u5931\u683c\u300b\u8fdb\u5ea6 67%', '\u300a\u5c0f\u738b\u5b50\u300b\u5df2\u8bfb\u5b8c', '\u300a\u6d77\u8fb9\u7684\u5361\u592b\u5361\u300b\u5f85\u8bfb'] },
    game: { name: '\u665a\u5b89', content: '\ud83c\udf19 \u665a\u5b89\u6a21\u5f0f', items: ['\u8bed\u97f3\u4fe1\u7bb1', '\u6df1\u591c\u7535\u53f0', '\u756a\u8304\u949f', '\u54c4\u7761'] },
    theme: { name: '\u7f8e\u5316', content: '\ud83c\udfa8 \u7f8e\u5316\u8bbe\u7f6e', items: ['\u5f53\u524d\u4e3b\u9898: \u6df1\u8272\u7c89', '\u56fe\u6807\u5305: \u8f7b\u677e\u718a', '\u58c1\u7eb8: BJD\u5a03\u5a03+\u732b', '\u5b57\u4f53\u989c\u8272: \u767d\u8272'] },
    travel: { name: '\u65c5\u884c', content: '\u2708\ufe0f \u65c5\u884c\u5546\u5e97', items: ['\u6c60\u7684\u5c0f\u94fa', '\u5979\u7684\u5c0f\u94fa', '\u5f53\u524d\u79ef\u5206: 322', '\ud83d\udecd\ufe0f \u6d4f\u89c8\u5546\u54c1\u2026'] },
  }
  const app = apps[appId] || { name: appId, content: '\ud83d\udea7', items: ['\u5f00\u53d1\u4e2d...'] }

  return (
    <div className="app-page">
      <div className="app-page-header">
        <button className="back-btn" onClick={onBack}>{'\u2190'}</button>
        <span className="app-page-title">{app.name}</span>
      </div>
      <div className="app-page-body">
        <div className="app-content">
          <div className="app-content-title">{app.content}</div>
          <div className="app-content-list">
            {app.items.map((item, i) => (
              <div key={i} className="app-content-item">{item}</div>
            ))}
          </div>
        </div>
      </div>
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
      `}</style>
    </>
  )
}