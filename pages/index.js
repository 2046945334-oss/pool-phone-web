import { useState, useRef, useEffect } from 'react'
import Head from 'next/head'

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
  useEffect(() => { try { localStorage.setItem('pool_chat_history', JSON.stringify(messages)) } catch {} }, [messages])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [menuIdx, setMenuIdx] = useState(-1)
  const [editIdx, setEditIdx] = useState(-1)
  const [editText, setEditText] = useState('')
  const bottomRef = useRef(null)
  const timerRef = useRef(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  const [memoryContext, setMemoryContext] = useState('')
  useEffect(() => { callMemory('breath', {}).then(r => { if (r && r.result && r.result.content && r.result.content[0]) setMemoryContext(r.result.content[0].text || '') }) }, [])

  async function sendMessage(overrideMessages) {
    const msgToSend = overrideMessages || messages
    const userText = overrideMessages ? null : input.trim()
    if (!overrideMessages && !userText) return
    const newMessages = overrideMessages || [...messages, { role: 'user', content: userText }]
    if (!overrideMessages) { setMessages(newMessages); setInput(''); return }
    // Only trigger AI when explicitly called with overrideMessages
    setLoading(true)
    const cfg = JSON.parse(localStorage.getItem('pool_api_config') || '{}')
    if (!cfg.apiBase || !cfg.apiKey) {
      setMessages([...newMessages, { role: 'assistant', content: '\u8bf7\u5148\u5728\u7cfb\u7edfApp\u4e2d\u914d\u7f6eAPI' }])
      setLoading(false); return
    }
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...(memoryContext ? [{role:'system',content:'[Memory]\\n'+memoryContext}] : []), ...newMessages.slice(-20)], apiBase: cfg.apiBase, apiKey: cfg.apiKey, model: cfg.model }),
      })
      const data = await res.json()
      const reply = data.reply || data.error || '\u65e0\u54cd\u5e94'
      // Split reply into sentences and show one by one
      const sentences = reply.split(/(?<=[。！？\n.!?])/g).filter(s => s.trim())
      let current = [...newMessages]
      for (let i = 0; i < sentences.length; i++) {
        current = [...current, { role: 'assistant', content: sentences[i].trim() }]
        setMessages([...current])
        if (i < sentences.length - 1) await new Promise(r => setTimeout(r, 600))
      }
      if (data.reply) {
        const lastUser = newMessages[newMessages.length - 1]?.content || ''
        callMemory('hold', { content: lastUser + '\n---\n' + reply })
      }
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: '\u51fa\u9519: ' + e.message }])
    }
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
    const summaryPrompt = [{ role: 'system', content: '\u8bf7\u7528\u4e2d\u6587\u5bf9\u4ee5\u4e0b\u5bf9\u8bdd\u8fdb\u884c\u7b80\u6d01\u7684\u603b\u7ed3\uff0c\u4fdd\u7559\u5173\u952e\u4fe1\u606f\u548c\u4e0a\u4e0b\u6587\uff0c100\u5b57\u4ee5\u5185\u3002' }, ...messages.slice(0, menuIdx + 1)]
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: summaryPrompt, apiBase: cfg.apiBase, apiKey: cfg.apiKey, model: cfg.model }),
      })
      const data = await res.json()
      if (data.reply) {
        const summaryMsg = { role: 'system', content: '[\u4e0a\u6587\u603b\u7ed3] ' + data.reply }
        setMessages([summaryMsg, ...messages.slice(menuIdx + 1)])
      }
    } catch {}
    setLoading(false)
  }

  async function extractMemory() {
    setMenuIdx(-1)
    const cfg = getApiConfig('memory')
    if (!cfg.apiBase || !cfg.apiKey) return
    const memPrompt = [{ role: 'system', content: '\u4ece\u4ee5\u4e0b\u5bf9\u8bdd\u4e2d\u63d0\u53d6\u503c\u5f97\u8bb0\u4f4f\u7684\u5173\u952e\u4fe1\u606f\uff08\u7528\u6237\u504f\u597d\u3001\u91cd\u8981\u4e8b\u5b9e\u3001\u51b3\u5b9a\u7b49\uff09\uff0c\u7528\u7b80\u77ed\u7684\u5217\u8868\u5f62\u5f0f\u8f93\u51fa\u3002' }, ...messages]
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: memPrompt, apiBase: cfg.apiBase, apiKey: cfg.apiKey, model: cfg.model }),
      })
      const data = await res.json()
      if (data.reply) {
        const memories = JSON.parse(localStorage.getItem('pool_memories') || '[]')
        memories.push({ time: new Date().toLocaleString(), content: data.reply })
        localStorage.setItem('pool_memories', JSON.stringify(memories))
        setMessages([...messages, { role: 'system', content: '[\u8bb0\u5fc6\u5df2\u63d0\u53d6] ' + data.reply }])
      }
    } catch {}
    setLoading(false)
  }

  function clearChat() { setMessages([]); setMenuIdx(-1) }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div className="chat-avatar">{'\u6c60'}</div>
        <div className="chat-header-info"><div className="chat-name">{'\u6c60'}</div><div className="chat-status">{loading ? '\u601d\u8003\u4e2d...' : '\u5728\u7ebf'}</div></div>
        <div style={{marginLeft:'auto',display:'flex',gap:'8px'}}>
          <button onClick={extractMemory} style={{background:'none',border:'none',color:'#9a8a99',fontSize:'18px',cursor:'pointer'}} title={'\u63d0\u53d6\u8bb0\u5fc6'}>{'\ud83e\udde0'}</button>
          <button onClick={clearChat} style={{background:'none',border:'none',color:'#9a8a99',fontSize:'18px',cursor:'pointer'}} title={'\u6e05\u7a7a\u5bf9\u8bdd'}>{'\ud83d\uddd1'}</button>
        </div>
      </div>
      <div className="chat-messages" style={theme?.chatBg ? {backgroundImage:`url(${theme.chatBg})`,backgroundSize:'cover',backgroundPosition:'center'} : {}} onClick={() => setMenuIdx(-1)}>
        {messages.length === 0 && <div className="chat-empty">{'\u53d1\u6761\u6d88\u606f\u5f00\u59cb\u804a\u5929'}</div>}
        {messages.map((msg, i) => (
          <div key={i} className={`msg-row ${msg.role}`} onTouchStart={() => handleTouchStart(i)} onTouchEnd={handleTouchEnd} onContextMenu={e => { e.preventDefault(); handleLongPress(i) }}>
            {msg.role === 'assistant' && <div className="msg-avatar">{theme?.avatarAI ? <img src={theme.avatarAI} className="avatar-img" /> : '\u6c60'}</div>}
            {msg.role === 'system' ? (
              <div className="msg-system">{msg.content}</div>
            ) : editIdx === i ? (
              <div className="msg-edit-wrap">
                <textarea className="msg-edit-input" value={editText} onChange={e => setEditText(e.target.value)} />
                <div className="msg-edit-btns"><button onClick={confirmEdit}>{'\u2713'}</button><button onClick={() => setEditIdx(-1)}>{'\u2717'}</button></div>
              </div>
            ) : (
              <div className={`msg-bubble ${msg.role}`} style={msg.role==='user'?{background:theme?.bubbleUser||undefined,color:theme?.textUser||undefined}:msg.role==='assistant'?{background:theme?.bubbleAI||undefined,color:theme?.textAI||undefined}:{}}>{msg.content}</div>
            )}
            {msg.role === 'user' && <div className="msg-avatar user-avatar">{theme?.avatarUser ? <img src={theme.avatarUser} className="avatar-img" /> : '\u6211'}</div>}
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
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-area">
        <input className="chat-input" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addUserMsg() } }}
          placeholder={'\u8f93\u5165\u6d88\u606f...'} disabled={loading} />
        <button className="chat-send" onClick={() => addUserMsg()} disabled={loading || !input.trim()}>{'\u27a4'}</button>
        <button className="chat-trigger" onClick={triggerAI} disabled={loading}>{loading ? '...' : '\u2728'}</button>
      </div>
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
  const APP_LIST = ['notes','gallery','messages','music','browser','couple','system','doodle','ledger','drafts','fishing','reader','game','theme','travel']
  const APP_NAMES = {notes:'\u4fbf\u7b7e',gallery:'\u547d\u8fd0\u5361\u6c60',messages:'\u5982\u679c\u2026',music:'\u97f3\u4e50',browser:'\u6d4f\u89c8',couple:'\u60c5\u4fa3\u7a7a\u95f4',system:'\u7cfb\u7edf',doodle:'\u6d82\u9e26',ledger:'\u5360\u535c',drafts:'\u8349\u7a3f\u7bb1',fishing:'\u94d3\u9c7c',reader:'\u9605\u8bfb',game:'\u756a\u8304\u949f',theme:'\u7f8e\u5316',travel:'\u65c5\u884c'}

  function save() {
    localStorage.setItem('pool_theme', JSON.stringify(theme))
    setSaved(true); setTimeout(() => setSaved(false), 2000)
    window.dispatchEvent(new Event('theme-changed'))
  }

  function handleImageUpload(key, e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setTheme(t => ({...t, [key]: reader.result})) }
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
    reader.onload = () => { setNested(group, key, reader.result) }
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
          <label>{'\u97f3\u4e50\u5361\u7247\u80cc\u666f\u8272'}</label>
          <input type="color" value={theme.musicCardBg||'#1a1520'} onChange={e=>handleUrlInput('musicCardBg',e.target.value)} />
          <span style={{color:'#888',fontSize:11,marginLeft:6}}>{theme.musicCardBg||'#1a1520'}</span>
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
    </div>
  )
}
function SettingsPanel() {
  const FEATURES = [
    { key: 'chat', label: '\u5bf9\u8bdd\u529f\u80fd', desc: '\u4e3b\u8981\u7684AI\u5bf9\u8bdd' },
    { key: 'summary', label: '\u4e0a\u4e0b\u6587\u603b\u7ed3', desc: '\u538b\u7f29\u4e0a\u4e0b\u6587\uff0c\u751f\u6210\u6458\u8981' },
    { key: 'memory', label: '\u8bb0\u5fc6\u63d0\u53d6', desc: '\u4ece\u5bf9\u8bdd\u4e2d\u63d0\u53d6\u5173\u952e\u4fe1\u606f' },
  ]
  const [configs, setConfigs] = useState(() => JSON.parse(localStorage.getItem('pool_api_configs') || '{}'))
  const [defaultCfg, setDefaultCfg] = useState(() => JSON.parse(localStorage.getItem('pool_api_config') || '{}'))
  const [expandedKey, setExpandedKey] = useState(null)
  const [saved, setSaved] = useState(false)
  // MCP state
  const [mcpTab, setMcpTab] = useState('breath')
  const [mcpResult, setMcpResult] = useState('')
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpInput, setMcpInput] = useState('')

  function saveAll() {
    localStorage.setItem('pool_api_config', JSON.stringify(defaultCfg))
    localStorage.setItem('pool_api_configs', JSON.stringify(configs))
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
          <input value={defaultCfg.model||''} onChange={e=>setDefaultCfg({...defaultCfg,model:e.target.value})} placeholder="gpt-4o-mini" className="settings-input"/></div>
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
                  <input value={fc.model||''} onChange={e=>updateFeature(f.key,'model',e.target.value)} placeholder={defaultCfg.model||'gpt-4o-mini'} className="settings-input"/></div>
                {hasCustom && <button className="settings-reset" onClick={() => { const c = {...configs}; delete c[f.key]; setConfigs(c) }}>{'\u91cd\u7f6e\u4e3a\u9ed8\u8ba4'}</button>}
              </div>
            )}
          </div>
        )
      })}

      <button className="settings-save" onClick={saveAll}>{saved ? '\u2713 \u5df2\u4fdd\u5b58' : '\u4fdd\u5b58\u914d\u7f6e'}</button>

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
function AppContent({ appId, onBack }) {
  const appNames = { notes:'便签', gallery:'命运卡池', messages:'如果…', music:'音乐', browser:'浏览', couple:'情侣空间', system:'系统', doodle:'涂鸦', ledger:'占卜', drafts:'草稿箱', fishing:'钓鱼', reader:'阅读', game:'番茄钟', theme:'美化', travel:'旅行' }
  const appFiles = { notes:'_notes.html', fishing:'_fishing.html', music:'_music_player.html', gallery:'_gacha.html', messages:'_messages.html', couple:'_couple.html', game:'_sleep.html', ledger:'_fortune.html', drafts:'_drafts.html', doodle:'_doodle.html', system:'__settings__', theme:'__theme__' }
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
      ) : htmlFile ? (
        <iframe src={`/apps/${htmlFile}`} className="app-iframe" />
      ) : (
        <div className="app-page-body"><div className="coming-soon">{'🚧 开发中...'}</div></div>
      )}
    </div>
  )
}

function HomeScreen({ onOpenApp, theme }) {
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
      if (diff > 50 && page === 0) setPage(1)
      if (diff < -50 && page === 1) setPage(0)
    }
    setSwipeX(null)
  }

  return (
    <div className="home-screen" style={theme?.wallpaper ? {backgroundImage:`url(${theme.wallpaper})`,backgroundSize:'cover',backgroundPosition:'center'} : {}}>
      <div className="home-top">
        <div className="home-banner"><img src={theme?.bannerImg || '/header_bg.jpg'} alt="" className="banner-img" /></div>
        <div className="music-card" onClick={() => onOpenApp('music')} style={theme?.musicCardBg?{background:theme.musicCardBg}:{}}>
          <div className="music-icon">{'\u266a'}</div>
          <div className="music-info">
            <div className="music-title">{'\u5bc2\u5bde\u7684\u5b63\u8282 - \u9676\u55c6'}</div>
            <div className="music-status">{'\u6b63\u5728\u64ad\u653e'}</div>
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
      </div>
      <div className="home-apps-area" onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
        <div className="home-section-title">{page === 0 ? '\ud83c\udf19 \u6c60\u7684\u624b\u673a' : '\u66f4\u591a\u5e94\u7528'}</div>
        <div className="app-grid">
          {(page === 0 ? page1Apps : page2Apps).map(app => (
            <div key={app.id} className="app-item" onClick={() => onOpenApp(app.id)}>
              <div className="app-icon"><img src={getIcon(app)} alt={app.name} /></div>
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
  const [theme, setTheme] = useState({})

  useEffect(() => {
    const load = () => setTheme(JSON.parse(localStorage.getItem('pool_theme') || '{}'))
    load()
    window.addEventListener('theme-changed', load)
    return () => window.removeEventListener('theme-changed', load)
  }, [])

  function handleOpenApp(id) { if (id === 'chat') { setActiveTab('chat') } else { setCurrentApp(id) } }
  function handleBack() { setCurrentApp(null) }

  function renderPhoneContent() {
    if (locked) return <LockScreen onUnlock={() => setLocked(false)} theme={theme} />
    if (currentApp) return <AppContent appId={currentApp} onBack={handleBack} />
    return <HomeScreen onOpenApp={handleOpenApp} theme={theme} />
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
            <div style={{display: activeTab === 'phone' ? 'block' : 'none', height:'100%'}}>{renderPhoneContent()}</div>
            <div style={{display: activeTab === 'chat' ? 'flex' : 'none', height:'100%', flexDirection:'column'}}><ChatView theme={theme} /></div>
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
      
        .app-iframe { width: 100%; flex: 1; border: none; background: #fff; }
        .app-page { display: flex; flex-direction: column; height: 100%; }
      
        .settings-panel { padding: 16px; overflow-y: auto; flex: 1; }
        .settings-section { background: rgba(255,255,255,0.05); border-radius: 12px; padding: 16px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.06); }
        .settings-title { font-size: 15px; color: #e8a0bf; margin-bottom: 12px; }
        .settings-item { margin-bottom: 12px; }
        .settings-item label { display: block; font-size: 12px; color: #9a8a99; margin-bottom: 4px; }
        .settings-input { width: 100%; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 10px 12px; color: #e0e0e0; font-size: 14px; outline: none; }
        .settings-input:focus { border-color: #e8a0bf; }
        .settings-save { width: 100%; padding: 12px; border: none; border-radius: 10px; background: linear-gradient(135deg, #e8a0bf, #c77dba); color: #fff; font-size: 15px; font-weight: 600; margin-top: 8px; cursor: pointer; }
        .settings-desc { font-size: 13px; color: #666; }
      
        .msg-row { position: relative; }
        .msg-menu { position: absolute; top: 100%; left: 10px; z-index: 100; background: #1a1a1a; border: 1px solid #333; border-radius: 10px; padding: 4px 0; box-shadow: 0 4px 16px rgba(0,0,0,.6); min-width: 130px; }
        .msg-row.user .msg-menu { left: auto; right: 10px; }
        .msg-menu button { display: block; width: 100%; padding: 9px 14px; background: none; border: none; color: #e0e0e0; font-size: 13px; text-align: left; cursor: pointer; }
        .msg-menu button:active { background: rgba(232,160,191,.15); }
        .msg-system { font-size: 12px; color: #9a8a99; background: rgba(255,255,255,.03); border-radius: 8px; padding: 8px 12px; margin: 4px auto; max-width: 85%; text-align: center; border: 1px dashed #333; }
        .msg-edit-wrap { max-width: 72%; }
        .msg-edit-input { width: 100%; min-height: 60px; background: #1a1a1a; border: 1px solid #e8a0bf; border-radius: 12px; padding: 8px 12px; color: #e0e0e0; font-size: 14px; resize: none; outline: none; }
        .msg-edit-btns { display: flex; gap: 8px; margin-top: 4px; }
        .msg-edit-btns button { background: #222; border: 1px solid #333; border-radius: 6px; color: #e0e0e0; padding: 4px 12px; cursor: pointer; font-size: 14px; }
      
        .settings-feature-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 4px 0; }
        .settings-feature-header strong { font-size: 14px; color: #e0e0e0; }
        .settings-arrow { color: #666; font-size: 12px; }
        .settings-badge { font-size: 11px; color: #e8a0bf; margin-left: 8px; }
        .settings-badge-default { font-size: 11px; color: #666; margin-left: 8px; }
        .settings-feature-body { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.06); }
        .settings-reset { background: none; border: 1px solid #333; border-radius: 6px; color: #999; padding: 6px 12px; font-size: 12px; cursor: pointer; margin-top: 4px; }
        .mcp-tab, .mcp-tab-active { padding: 6px 12px; border-radius: 14px; border: 1px solid #444; background: #1a1a2e; color: #aaa; font-size: 12px; cursor: pointer; }
        .mcp-tab-active { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; border-color: transparent; }
        .mcp-action-btn { width: 100%; padding: 10px; border: none; border-radius: 8px; background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; font-size: 13px; cursor: pointer; margin-top: 8px; }
        .mcp-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .mcp-result { background: #0d0d1a; border: 1px solid #333; border-radius: 8px; padding: 10px; margin-top: 10px; color: #ccc; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; font-family: monospace; }
        .chat-trigger { width: 44px; height: 44px; border-radius: 50%; border: none; background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; font-size: 18px; cursor: pointer; flex-shrink: 0; }
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
        .theme-icon-name { color: #ccc; font-size: 12px; width: 60px; flex-shrink: 0; }
        .theme-icon-input { flex: 1; font-size: 11px !important; }
        .theme-upload-sm { padding: 4px 8px; background: #2a2a3e; border: 1px solid #444; border-radius: 6px; color: #aaa; font-size: 12px; cursor: pointer; }
        .theme-preview-sm { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; margin-top: 6px; border: 2px solid #444; }
        .avatar-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .user-avatar { background: #c77dba; }
        .msg-row.user { flex-direction: row-reverse; }
      `}</style>
    </>
  )
}