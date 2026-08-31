import React, { useState, useEffect } from 'react'

export default function StickerPanel({ onSelect, onClose }) {
  const [tab, setTab] = useState('emoji') // 'emoji' | 'custom'
  const [stickers, setStickers] = useState([])
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState('')

  const EMOJI_LIST = ['😊','😂','🥺','😭','❤️','🔥','👍','😘','🤗','😏','😴','😱','🎉','💕','😤','🥰','😳','👏','✨','🌸','💔','🫶','😈','🤭','💋','😙','😐','💡','🤧','🥔']

  useEffect(() => {
    if (tab === 'custom') loadStickers()
  }, [tab])

  async function loadStickers() {
    try {
      const res = await fetch('/api/stickers')
      const data = await res.json()
      setStickers(data.stickers || [])
    } catch {}
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = reader.result
        const res = await fetch('/api/stickers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: base64 })
        })
        const result = await res.json()
        if (result.success) {
          setStickers(prev => [...prev, result.sticker])
        }
      }
      reader.readAsDataURL(file)
    } catch {}
    setUploading(false)
  }

  async function handleUrlUpload() {
    if (!urlInput.trim()) return
    setUploading(true)
    try {
      // 支持格式: "名称:url" 或 直接url
      const parts = urlInput.split(':')
      const name = parts.length > 1 ? parts[0].trim() : ''
      const url = (parts.length > 1 ? parts.slice(1).join(':') : parts[0]).trim()
      
      const res = await fetch('/api/stickers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url })
      })
      const result = await res.json()
      if (result.success) {
        setStickers(prev => [...prev, result.sticker])
        setUrlInput('')
      }
    } catch {}
    setUploading(false)
  }

  async function deleteSticker(id) {
    try {
      await fetch(`/api/stickers?id=${id}`, { method: 'DELETE' })
      setStickers(prev => prev.filter(s => s.id !== id))
    } catch {}
  }

  return (
    <div className="sticker-panel" onClick={e => e.stopPropagation()}>
      <div className="sticker-header">
        <div className="sticker-tabs">
          <button 
            className={tab === 'emoji' ? 'active' : ''} 
            onClick={() => setTab('emoji')}
          >
            系统表情
          </button>
          <button 
            className={tab === 'custom' ? 'active' : ''} 
            onClick={() => setTab('custom')}
          >
            我的表情包
          </button>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="sticker-body">
        {tab === 'emoji' && (
          <div className="emoji-grid">
            {EMOJI_LIST.map((e, i) => (
              <button key={i} className="emoji-item" onClick={() => onSelect(e)}>
                {e}
              </button>
            ))}
          </div>
        )}

        {tab === 'custom' && (
          <>
            <div className="upload-area">
              <input
                type="file"
                accept="image/*"
                id="sticker-upload"
                style={{display:'none'}}
                onChange={handleFileUpload}
              />
              <label htmlFor="sticker-upload" className="upload-btn">
                {uploading ? '上传中...' : '📦 上传图片'}
              </label>
              
              <div className="url-upload">
                <input
                  type="text"
                  placeholder="名称:URL 或直接粘贴URL"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && handleUrlUpload()}
                />
                <button onClick={handleUrlUpload} disabled={uploading || !urlInput.trim()}>
                  添加
                </button>
              </div>
            </div>

            <div className="custom-grid">
              {stickers.length === 0 && <div className="empty">暂无表情包，点击上传吧</div>}
              {stickers.map(s => (
                <div key={s.id} className="custom-item">
                  <img src={s.url} alt={s.name} onClick={() => onSelect(`[img]${s.url}[/img]`)} />
                  <div className="item-name">{s.name}</div>
                  <button className="delete-btn" onClick={() => deleteSticker(s.id)}>×</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .sticker-panel {
          position: absolute;
          bottom: 60px;
          left: 50%;
          transform: translateX(-50%);
          width: 90%;
          max-width: 400px;
          max-height: 400px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          overflow: hidden;
          z-index: 1000;
        }
        .sticker-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          border-bottom: 1px solid #eee;
        }
        .sticker-tabs {
          display: flex;
          gap: 8px;
        }
        .sticker-tabs button {
          padding: 6px 16px;
          border: none;
          background: #f5f5f5;
          border-radius: 16px;
          cursor: pointer;
          font-size: 14px;
        }
        .sticker-tabs button.active {
          background: #c77dba;
          color: white;
        }
        .close-btn {
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: #999;
        }
        .sticker-body {
          padding: 12px;
          max-height: 320px;
          overflow-y: auto;
        }
        .emoji-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 8px;
        }
        .emoji-item {
          font-size: 28px;
          border: none;
          background: none;
          cursor: pointer;
          padding: 8px;
          border-radius: 8px;
          transition: background 0.2s;
        }
        .emoji-item:hover {
          background: #f5f5f5;
        }
        .upload-area {
          margin-bottom: 16px;
        }
        .upload-btn {
          display: inline-block;
          padding: 10px 20px;
          background: #c77dba;
          color: white;
          border-radius: 8px;
          cursor: pointer;
          margin-bottom: 12px;
        }
        .url-upload {
          display: flex;
          gap: 8px;
        }
        .url-upload input {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 14px;
        }
        .url-upload button {
          padding: 8px 16px;
          background: #c77dba;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }
        .url-upload button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .custom-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .custom-item {
          position: relative;
          aspect-ratio: 1;
          border-radius: 8px;
          overflow: hidden;
          background: #f5f5f5;
          cursor: pointer;
        }
        .custom-item img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .item-name {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(transparent, rgba(0,0,0,0.7));
          color: white;
          font-size: 11px;
          padding: 4px 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .delete-btn {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(0,0,0,0.6);
          color: white;
          border: none;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          display: none;
        }
        .custom-item:hover .delete-btn {
          display: block;
        }
        .empty {
          grid-column: 1 / -1;
          text-align: center;
          padding: 40px 20px;
          color: #999;
        }
      `}</style>
    </div>
  )
}
