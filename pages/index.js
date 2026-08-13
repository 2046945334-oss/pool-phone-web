import { useState, useRef, useEffect } from 'react'
import Head from 'next/head'

// ===== 聊天组件 =====
function ChatView() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
        setMessages([...newMessages, { role: 'assistant', content: '⚠️ ' + (data.error || '出错了') }])
      }
    } catch (err) {
      setMessages([...newMessages, { role: 'assistant', content: '⚠️ 网络错误' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div className="chat-avatar">池</div>
        <div className="chat-header-info">
          <div className="chat-name">池</div>
          <div className="chat-status">{loading ? '正在输入...' : '在线'}</div>
        </div>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && <div className="chat-empty">发条消息开始聊天 💬</div>}
        {messages.map((msg, i) => (
          <div key={i} className={`msg-row ${msg.role}`}>
            {msg.role === 'assistant' && <div className="msg-avatar">池</div>}
            <div className={`msg-bubble ${msg.role}`}>{msg.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        <input
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
          placeholder="说点什么..."
          disabled={loading}
        />
        <button className="chat-send" onClick={sendMessage} disabled={!input.trim() || loading}>↑</button>
      </div>
    </div>
  )
}

// ===== 锁屏组件 =====
function LockScreen({ onUnlock }) {
  const [touchStart, setTouchStart] = useState(null)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  function handleTouchStart(e) {
    setTouchStart(e.touches[0].clientY)
  }
  function handleTouchEnd(e) {
    if (touchStart !== null) {
      const diff = touchStart - e.changedTouches[0].clientY
      if (diff > 60) onUnlock()
    }
    setTouchStart(null)
  }

  return (
    <div
      className="lock-screen"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={onUnlock}
    >
      <div className="lock-time">{timeStr}</div>
      <div className="lock-date">{dateStr}</div>
      <div className="lock-hint">上滑解锁</div>
    </div>
  )
}

// ===== 主屏组件 =====
function HomeScreen({ onOpenApp }) {
  // App列表 - 跟Operit小手机一致，使用自定义图标
  const page1Apps = [
    { id: 'notes', icon: '/icons/notes.png', name: '便签' },
    { id: 'gallery', icon: '/icons/gallery.png', name: '命运卡池' },
    { id: 'messages', icon: '/icons/messages.png', name: '如果' },
    { id: 'music', icon: '/icons/music.png', name: '音乐' },
    { id: 'browser', icon: '/icons/browser.png', name: '浏览' },
    { id: 'couple', icon: '/icons/couple.png', name: '情侣' },
    { id: 'system', icon: '/icons/system.png', name: '系统' },
    { id: 'doodle', icon: '/icons/doodle.png', name: '涂鸦' },
  ]
  const page2Apps = [
    { id: 'ledger', icon: '/icons/ledger.png', name: '占卜' },
    { id: 'drafts', icon: '/icons/drafts.png', name: '草稿' },
    { id: 'fishing', icon: '/icons/fishing.png', name: '钓鱼' },
    { id: 'reader', icon: '/icons/reader.png', name: '阅读' },
    { id: 'game', icon: '/icons/game.png', name: '晚安' },
  ]

  const [page, setPage] = useState(0)

  return (
    <div className="home-screen">
      <div className="home-pager">
        <div className="home-page" style={{ display: page === 0 ? 'block' : 'none' }}>
          <div className="home-greeting">
            <span className="home-greeting-emoji">🌙</span>
            <span>池的手机</span>
          </div>
          <div className="app-grid">
            {page1Apps.map(app => (
              <div key={app.id} className="app-item" onClick={() => onOpenApp(app.id)}>
                <div className="app-icon">
                  <img src={app.icon} alt={app.name} />
                </div>
                <div className="app-label">{app.name}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="home-page" style={{ display: page === 1 ? 'block' : 'none' }}>
          <div className="home-greeting">
            <span>更多应用</span>
          </div>
          <div className="app-grid">
            {page2Apps.map(app => (
              <div key={app.id} className="app-item" onClick={() => onOpenApp(app.id)}>
                <div className="app-icon">
                  <img src={app.icon} alt={app.name} />
                </div>
                <div className="app-label">{app.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 页面指示点 */}
      <div className="page-dots">
        <div className={`dot ${page === 0 ? 'active' : ''}`} onClick={() => setPage(0)} />
        <div className={`dot ${page === 1 ? 'active' : ''}`} onClick={() => setPage(1)} />
      </div>
    </div>
  )
}

// ===== 主页面 =====
export default function Home() {
  const [locked, setLocked] = useState(true)
  const [currentApp, setCurrentApp] = useState(null)
  const [activeTab, setActiveTab] = useState('phone')

  function handleOpenApp(id) {
    if (id === 'chat') {
      setActiveTab('chat')
    } else {
      setCurrentApp(id)
    }
  }

  function handleBack() {
    setCurrentApp(null)
  }

  function renderPhoneContent() {
    if (locked) return <LockScreen onUnlock={() => setLocked(false)} />
    if (currentApp) {
      const appNames = {
        notes: '便签', gallery: '命运卡池', messages: '如果…',
        music: '音乐', browser: '浏览', couple: '情侣空间',
        system: '系统', doodle: '涂鸦', ledger: '占卜',
        drafts: '草稿箱', fishing: '钓鱼', reader: '阅读', game: '晚安'
      }
      return (
        <div className="app-page">
          <div className="app-page-header">
            <button className="back-btn" onClick={handleBack}>←</button>
            <span className="app-page-title">{appNames[currentApp] || currentApp}</span>
          </div>
          <div className="app-page-body">
            <div className="coming-soon">🚧 开发中...</div>
          </div>
        </div>
      )
    }
    return <HomeScreen onOpenApp={handleOpenApp} />
  }

  return (
    <>
      <Head>
        <title>池的小手机</title>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
        <meta name="theme-color" content="#0a0a0a" />
      </Head>
      <div className="shell">
        <div className="phone-frame">
          <div className="status-bar">
            <span className="status-time">{new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
            <span className="status-icons">📶 🔋</span>
          </div>
          <div className="phone-screen">
            {activeTab === 'phone' ? renderPhoneContent() : <ChatView />}
          </div>
          <div className="bottom-nav">
            <button className={`nav-btn ${activeTab === 'phone' ? 'active' : ''}`} onClick={() => setActiveTab('phone')}>
              <span className="nav-icon">📱</span>
              <span className="nav-label">手机</span>
            </button>
            <button className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => { setActiveTab('chat'); setLocked(false) }}>
              <span className="nav-icon">💬</span>
              <span className="nav-label">聊天</span>
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { height: 100%; background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }

        .shell { width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; }

        .phone-frame {
          width: 100%; max-width: 420px; height: 100vh;
          background: #111; display: flex; flex-direction: column;
          overflow: hidden; position: relative;
        }
        @media (min-width: 768px) {
          .phone-frame {
            height: 90vh; max-height: 800px;
            border-radius: 40px; border: 3px solid #333;
            box-shadow: 0 20px 60px rgba(0,0,0,0.8);
          }
        }

        .status-bar {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 20px 4px; font-size: 12px; color: #999;
          background: #111; flex-shrink: 0;
        }

        .phone-screen { flex: 1; overflow: hidden; position: relative; background: #0d0d0d; }

        .bottom-nav {
          display: flex; justify-content: space-around; align-items: center;
          padding: 8px 0 12px; background: #111;
          border-top: 1px solid #1a1a1a; flex-shrink: 0;
        }
        .nav-btn {
          background: none; border: none; color: #666;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          cursor: pointer; padding: 4px 16px; transition: color 0.2s;
        }
        .nav-btn.active { color: #a78bfa; }
        .nav-icon { font-size: 20px; }
        .nav-label { font-size: 10px; }

        /* ===== 锁屏 ===== */
        .lock-screen {
          width: 100%; height: 100%;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: url('/wallpaper_lock.jpg') center/cover no-repeat;
          color: #fff; cursor: pointer; user-select: none;
          position: relative;
        }
        .lock-screen::before {
          content: ''; position: absolute; inset: 0;
          background: rgba(0,0,0,0.3);
        }
        .lock-time { font-size: 64px; font-weight: 200; letter-spacing: -2px; position: relative; z-index: 1; text-shadow: 0 2px 8px rgba(0,0,0,0.5); }
        .lock-date { font-size: 14px; color: rgba(255,255,255,0.7); margin-top: 8px; position: relative; z-index: 1; text-shadow: 0 1px 4px rgba(0,0,0,0.5); }
        .lock-hint {
          position: absolute; bottom: 30px; z-index: 1;
          font-size: 12px; color: rgba(255,255,255,0.5);
          animation: pulse 2s infinite;
        }
        @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }

        /* ===== 主屏 ===== */
        .home-screen {
          width: 100%; height: 100%; display: flex; flex-direction: column;
          background: linear-gradient(180deg, #12101a 0%, #0d0d0d 100%);
        }
        .home-pager { flex: 1; overflow-y: auto; padding: 16px 12px; }
        .home-greeting {
          text-align: center; color: #a78bfa;
          font-size: 16px; font-weight: 500;
          margin-bottom: 20px; padding-top: 8px;
        }
        .home-greeting-emoji { margin-right: 6px; }
        .app-grid {
          display: grid; grid-template-columns: repeat(4, 1fr);
          gap: 18px 6px;
        }
        .app-item {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          cursor: pointer; padding: 6px 4px; border-radius: 12px;
          transition: transform 0.1s, background 0.2s;
        }
        .app-item:active { transform: scale(0.92); background: rgba(167,139,250,0.08); }
        .app-icon {
          width: 52px; height: 52px; border-radius: 14px;
          overflow: hidden;
          display: flex; align-items: center; justify-content: center;
        }
        .app-icon img { width: 100%; height: 100%; object-fit: cover; border-radius: 14px; }
        .app-label { font-size: 11px; color: #fff; text-align: center; }

        /* 页面指示点 */
        .page-dots {
          display: flex; justify-content: center; gap: 8px;
          padding: 12px 0 16px; flex-shrink: 0;
        }
        .dot {
          width: 6px; height: 6px; border-radius: 3px;
          background: #444; cursor: pointer; transition: all 0.3s;
        }
        .dot.active { width: 16px; background: #a78bfa; }

        /* ===== App页面 ===== */
        .app-page { width: 100%; height: 100%; display: flex; flex-direction: column; background: #0d0d0d; }
        .app-page-header {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 16px; border-bottom: 1px solid #1a1a1a;
        }
        .back-btn { background: none; border: none; color: #a78bfa; font-size: 20px; cursor: pointer; padding: 4px 8px; }
        .app-page-title { color: #e0e0e0; font-size: 16px; font-weight: 500; }
        .app-page-body { flex: 1; display: flex; align-items: center; justify-content: center; }
        .coming-soon { color: #555; font-size: 16px; }

        /* ===== 聊天 ===== */
        .chat-view { width: 100%; height: 100%; display: flex; flex-direction: column; }
        .chat-header {
          display: flex; align-items: center; padding: 12px 16px;
          border-bottom: 1px solid #1a1a1a; background: #111;
        }
        .chat-avatar {
          width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, #667eea, #764ba2);
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; color: #fff; font-weight: 600;
        }
        .chat-header-info { margin-left: 10px; }
        .chat-name { font-size: 15px; font-weight: 600; color: #f0f0f0; }
        .chat-status { font-size: 11px; color: #6b7280; margin-top: 1px; }
        .chat-messages { flex: 1; overflow-y: auto; padding: 14px 14px 8px; }
        .chat-empty { text-align: center; color: #4b5563; margin-top: 40%; font-size: 14px; }
        .msg-row { display: flex; align-items: flex-end; margin-bottom: 10px; gap: 8px; }
        .msg-row.user { justify-content: flex-end; }
        .msg-row.assistant { justify-content: flex-start; }
        .msg-avatar {
          width: 26px; height: 26px; border-radius: 50%;
          background: linear-gradient(135deg, #667eea, #764ba2);
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; color: #fff; flex-shrink: 0;
        }
        .msg-bubble {
          max-width: 72%; padding: 9px 13px; border-radius: 16px;
          font-size: 14px; line-height: 1.5; word-break: break-word; white-space: pre-wrap;
        }
        .msg-bubble.user { background: #4f46e5; color: #fff; border-bottom-right-radius: 4px; }
        .msg-bubble.assistant { background: #1f1f1f; color: #e0e0e0; border-bottom-left-radius: 4px; }
        .chat-input-area {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px; border-top: 1px solid #1a1a1a; background: #111;
        }
        .chat-input {
          flex: 1; background: #1a1a1a; border: 1px solid #2a2a2a;
          border-radius: 20px; padding: 9px 14px; color: #e0e0e0;
          font-size: 14px; outline: none; font-family: inherit;
        }
        .chat-send {
          width: 34px; height: 34px; border-radius: 50%;
          background: #4f46e5; color: #fff; border: none;
          cursor: pointer; font-size: 16px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .chat-send:disabled { opacity: 0.4; }
      `}</style>
    </>
  )
}
