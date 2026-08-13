import { useState, useRef, useEffect } from 'react'

export default function Home() {
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

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div style={styles.container}>
      {/* 顶部标题栏 */}
      <div style={styles.header}>
        <div style={styles.avatar}>池</div>
        <div style={styles.headerText}>
          <div style={styles.headerName}>池</div>
          <div style={styles.headerStatus}>{loading ? '正在输入...' : '在线'}</div>
        </div>
      </div>

      {/* 消息区域 */}
      <div style={styles.chatArea}>
        {messages.length === 0 && (
          <div style={styles.emptyHint}>发条消息开始聊天 💬</div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.msgRow,
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            {msg.role === 'assistant' && <div style={styles.msgAvatar}>池</div>}
            <div
              style={{
                ...styles.bubble,
                ...(msg.role === 'user' ? styles.userBubble : styles.aiBubble),
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 输入区域 */}
      <div style={styles.inputArea}>
        <textarea
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="说点什么..."
          rows={1}
          disabled={loading}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: input.trim() && !loading ? 1 : 0.4,
          }}
          onClick={sendMessage}
          disabled={!input.trim() || loading}
        >
          ↑
        </button>
      </div>
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    maxWidth: '480px',
    margin: '0 auto',
    background: '#0d0d0d',
    color: '#e0e0e0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #1a1a1a',
    background: '#111',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    flexShrink: 0,
  },
  headerText: {
    marginLeft: 12,
  },
  headerName: {
    fontSize: 16,
    fontWeight: 600,
    color: '#f0f0f0',
  },
  headerStatus: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  chatArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 16px 8px',
  },
  emptyHint: {
    textAlign: 'center',
    color: '#4b5563',
    marginTop: '40%',
    fontSize: 14,
  },
  msgRow: {
    display: 'flex',
    alignItems: 'flex-end',
    marginBottom: 12,
    gap: 8,
  },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    color: '#fff',
    flexShrink: 0,
  },
  bubble: {
    maxWidth: '75%',
    padding: '10px 14px',
    borderRadius: 18,
    fontSize: 14,
    lineHeight: 1.5,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  userBubble: {
    background: '#4f46e5',
    color: '#fff',
    borderBottomRightRadius: 6,
  },
  aiBubble: {
    background: '#1f1f1f',
    color: '#e0e0e0',
    borderBottomLeftRadius: 6,
  },
  inputArea: {
    display: 'flex',
    alignItems: 'flex-end',
    padding: '12px 16px',
    borderTop: '1px solid #1a1a1a',
    background: '#111',
    gap: 8,
  },
  input: {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 20,
    padding: '10px 16px',
    color: '#e0e0e0',
    fontSize: 14,
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    maxHeight: 120,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
}