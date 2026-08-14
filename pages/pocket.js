// pages/pocket.js - Drop page: share anything to AI's pocket
import { useState, useEffect } from 'react'
import Head from 'next/head'

export default function PocketPage() {
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState('') // '', 'sending', 'done', 'error'
  const [items, setItems] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  // Check URL params for shared content (from browser share)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const shared = params.get('text') || params.get('url') || params.get('title') || ''
    if (shared) setInput(shared)
  }, [])

  async function submit() {
    if (!input.trim()) return
    setStatus('sending')
    try {
      // Try to extract URL from content
      const urlMatch = input.match(/(https?:\/\/[^\s]+)/i)
      const url = urlMatch ? urlMatch[0] : null
      const content = input.trim()
      const res = await fetch('/api/pocket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, url, note: note.trim() || null })
      })
      const data = await res.json()
      if (data.ok) {
        setStatus('done')
        setInput('')
        setNote('')
        setTimeout(() => setStatus(''), 3000)
      } else {
        setStatus('error')
      }
    } catch { setStatus('error') }
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/pocket?limit=20')
      const data = await res.json()
      setItems(data.items || [])
      setShowHistory(true)
    } catch {}
  }

  return (
    <>
      <Head>
        <title>口袋 · 扔给哥哥</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>
      <div className="pocket-page">
        <div className="pocket-card">
          <h1 className="pocket-title">🎒 口袋</h1>
          <p className="pocket-desc">刷到什么好玩的？扔进来，哥哥会看的</p>

          <textarea
            className="pocket-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="粘贴链接、文字、或者随便什么..."
            rows={4}
          />

          <input
            className="pocket-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="想说点什么？（可选）"
          />

          <button
            className="pocket-btn"
            onClick={submit}
            disabled={!input.trim() || status === 'sending'}
          >
            {status === 'sending' ? '投递中...' : status === 'done' ? '✓ 已扔进口袋！' : '扔给哥哥'}
          </button>

          {status === 'error' && <p className="pocket-error">投递失败，再试一次？</p>}

          <button className="pocket-history-btn" onClick={loadHistory}>
            {showHistory ? '刷新' : '查看口袋里的东西'}
          </button>

          {showHistory && (
            <div className="pocket-list">
              {items.length === 0 && <p className="pocket-empty">口袋还是空的～</p>}
              {items.map(item => (
                <div key={item.id} className={`pocket-item ${item.status}`}>
                  <div className="pocket-item-content">{item.content}</div>
                  {item.note && <div className="pocket-item-note">💬 {item.note}</div>}
                  <div className="pocket-item-meta">
                    <span className="pocket-item-time">{item.created_at}</span>
                    <span className={`pocket-item-status ${item.status}`}>
                      {item.status === 'unread' ? '🆕 未读' : item.status === 'read' ? '👀 已看' : item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .pocket-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #fdf2f8 0%, #f0e6ff 50%, #e8f4ff 100%);
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .pocket-card {
          background: white;
          border-radius: 20px;
          padding: 32px 24px;
          max-width: 420px;
          width: 100%;
          box-shadow: 0 8px 32px rgba(0,0,0,0.08);
        }
        .pocket-title {
          font-size: 24px;
          margin: 0 0 4px;
          text-align: center;
        }
        .pocket-desc {
          color: #888;
          font-size: 14px;
          text-align: center;
          margin: 0 0 20px;
        }
        .pocket-input {
          width: 100%;
          border: 1.5px solid #e8dce8;
          border-radius: 12px;
          padding: 12px 14px;
          font-size: 15px;
          resize: vertical;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.2s;
        }
        .pocket-input:focus { border-color: #c8a0d8; }
        .pocket-note {
          width: 100%;
          border: 1.5px solid #e8dce8;
          border-radius: 12px;
          padding: 10px 14px;
          font-size: 14px;
          margin-top: 10px;
          outline: none;
          box-sizing: border-box;
        }
        .pocket-note:focus { border-color: #c8a0d8; }
        .pocket-btn {
          width: 100%;
          margin-top: 16px;
          padding: 14px;
          border: none;
          border-radius: 12px;
          background: linear-gradient(135deg, #e8a0bf, #c88aef);
          color: white;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .pocket-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .pocket-btn:active { opacity: 0.8; }
        .pocket-error { color: #e55; font-size: 13px; text-align: center; margin-top: 8px; }
        .pocket-history-btn {
          display: block;
          margin: 16px auto 0;
          background: none;
          border: none;
          color: #999;
          font-size: 13px;
          cursor: pointer;
          text-decoration: underline;
        }
        .pocket-list { margin-top: 16px; }
        .pocket-empty { color: #aaa; text-align: center; font-size: 13px; }
        .pocket-item {
          background: #faf7fc;
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 10px;
          border-left: 3px solid #e8a0bf;
        }
        .pocket-item.read { border-left-color: #ccc; opacity: 0.7; }
        .pocket-item-content {
          font-size: 14px;
          color: #333;
          word-break: break-all;
          white-space: pre-wrap;
        }
        .pocket-item-note { font-size: 13px; color: #888; margin-top: 6px; }
        .pocket-item-meta {
          display: flex;
          justify-content: space-between;
          margin-top: 8px;
          font-size: 12px;
          color: #aaa;
        }
        .pocket-item-status.unread { color: #e8a0bf; font-weight: 600; }
      `}</style>
    </>
  )
}