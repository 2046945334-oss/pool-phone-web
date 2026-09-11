import { useState, useEffect, useRef, useCallback } from 'react'

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

function splitChapters(text) {
  const lines = text.split(/\r?\n/)
  const p1 = /^\s*第[\u4E00-\u9FFF\d]{1,10}[章节回卷集篇]/
  const p2 = /^\s*Chapter\s+\d+/i
  const p3 = /^\s*\d{1,4}[\s\.\u3001\uff0e]/
  let c1=0, c2=0, c3=0
  for (const l of lines) {
    if (p1.test(l) && l.trim().length <= 30) c1++
    if (p2.test(l)) c2++
    if (p3.test(l) && l.trim().length <= 20) c3++
  }
  let usePattern = null
  if (c1 >= 3) usePattern = l => p1.test(l) && l.trim().length <= 30
  else if (c2 >= 3) usePattern = l => p2.test(l)
  else if (c3 >= 5) usePattern = l => p3.test(l) && l.trim().length <= 20
  if (usePattern) {
    const chapters = []
    let curTitle = '', curLines = []
    for (const line of lines) {
      if (usePattern(line)) {
        if (curTitle || curLines.length > 0) chapters.push({ title: curTitle, content: curLines.join('\n') })
        curTitle = line.trim(); curLines = []
      } else { curLines.push(line) }
    }
    if (curTitle || curLines.length > 0) chapters.push({ title: curTitle, content: curLines.join('\n') })
    if (chapters.length >= 3) return chapters
  }
  const chapters = []; let chunk = '', idx = 0
  for (const line of lines) {
    chunk += line + '\n'
    if (chunk.length >= 2000) { chapters.push({ title: `第${++idx}章`, content: chunk }); chunk = '' }
  }
  if (chunk) chapters.push({ title: `第${++idx}章`, content: chunk })
  return chapters
}

export default function ReaderApp({ onBack }) {
  const [books, setBooks] = useState([])
  const [state, setState] = useState({ active: false, currentBookId: null, userChapter: 0, aiChapter: 0 })
  const [notes, setNotes] = useState([])
  const [bookmarks, setBookmarks] = useState([])
  const [view, setView] = useState('shelf')
  const [currentBookIdx, setCurrentBookIdx] = useState(-1)
  const [currentChapter, setCurrentChapter] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef(null)
  const bodyRef = useRef(null)
  const chatEndRef = useRef(null)

  const loadState = useCallback(async () => {
    try {
      const r = await fetch('/api/reader?action=state')
      const d = await r.json()
      if (d.state) setState(d.state)
      if (d.notes) setNotes(d.notes)
      if (d.bookmarks) setBookmarks(d.bookmarks)
    } catch {}
  }, [])

  const loadBooks = useCallback(async () => {
    try {
      const r = await fetch('/api/data/pool_reader_books')
      const d = await r.json()
      if (d.value) setBooks(d.value)
    } catch {}
  }, [])

  useEffect(() => { loadState(); loadBooks() }, [])
  useEffect(() => {
    if (view !== 'reader') return
    const iv = setInterval(loadState, 15000)
    return () => clearInterval(iv)
  }, [view, loadState])

  useEffect(() => {
    if (view !== 'reader') return
    const handler = () => {
      const sel = window.getSelection()
      setSelectedText(sel?.toString()?.trim() || '')
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [view])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages])

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      let text = ev.target.result
      if (text.indexOf('\ufffd') > -1) {
        const r2 = new FileReader()
        r2.onload = (e2) => doImport(file.name, e2.target.result)
        r2.readAsText(file, 'GBK')
        return
      }
      await doImport(file.name, text)
    }
    reader.readAsText(file, 'UTF-8')
  }

  async function doImport(filename, text) {
    const title = filename.replace(/\.txt$/i, '')
    const chapters = splitChapters(text)
    try {
      await fetch('/api/reader?action=import', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, chapters })
      })
      await loadBooks()
    } catch {}
    setLoading(false)
    setView('shelf')
  }

  async function openBook(idx) {
    const book = books[idx]
    setCurrentBookIdx(idx)
    const ch = state.currentBookId === book.id ? (state.userChapter || 0) : 0
    setCurrentChapter(ch)
    setView('reader')
    await fetch('/api/reader?action=progress', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: book.id, chapter: ch })
    })
    await loadState()
  }

  async function goChapter(ch) {
    const book = books[currentBookIdx]
    if (!book || ch < 0 || ch >= book.chapters.length) return
    setCurrentChapter(ch)
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    await fetch('/api/reader?action=progress', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: book.id, chapter: ch })
    })
  }

  function backToShelf() { setCurrentBookIdx(-1); setView('shelf'); setDrawerOpen(false); loadState(); loadBooks() }
  async function delBook(idx) {
    const book = books[idx]
    await fetch('/api/reader?action=book&id=' + book.id, { method: 'DELETE' })
    await loadBooks()
  }

  async function addBookmark() {
    if (!selectedText) return
    const book = books[currentBookIdx]
    await fetch('/api/reader?action=bookmark', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: book.id, chapter: currentChapter, quote: selectedText })
    })
    setSelectedText(''); window.getSelection()?.removeAllRanges(); await loadState()
  }

  async function sendChat() {
    if (!chatInput.trim()) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: msg, time: Date.now() }])
    await fetch('/api/reader?action=chat_msg', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: msg })
    })
  }

  const book = currentBookIdx >= 0 ? books[currentBookIdx] : null
  const chapter = book ? book.chapters?.[currentChapter] : null
  const chapterNotes = notes.filter(n => book && n.bookId === book.id && n.chapter === currentChapter)
  const chapterBookmarks = bookmarks.filter(b => book && b.bookId === book.id && b.chapter === currentChapter)

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', width:'100%', background:'#faf8f5', fontFamily:'-apple-system,sans-serif', position:'relative', overflow:'hidden' }}>

      {/* === SHELF === */}
      {view === 'shelf' && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={onBack} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#666' }}>{'\u2190'}</button>
          <h2 style={{ flex:1, fontSize:16, fontWeight:600, margin:0 }}>\u5171\u8bfb\u4e66\u67b6</h2>
          <button onClick={() => setView('import')} style={{ background:'#1976d2', color:'#fff', border:'none', padding:'7px 14px', borderRadius:8, fontSize:13, cursor:'pointer' }}>+ \u5bfc\u5165</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:12 }}>
          {state.recommendation && (
            <div style={{ background:'#e3f2fd', borderRadius:10, padding:12, marginBottom:10, border:'1px solid #90caf9' }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>\ud83d\udcd6 \u6c60\u63a8\u8350\u4e86\u4e00\u672c\u4e66</div>
              <div style={{ fontSize:15, fontWeight:600 }}>{state.recommendation.title}</div>
              <div style={{ fontSize:13, color:'#555', marginTop:2 }}>{state.recommendation.reason}</div>
            </div>
          )}
          {books.length === 0 ? (
            <p style={{ color:'#999', textAlign:'center', padding:40 }}>\u4e66\u67b6\u7a7a\u7a7a\u7684\uff0c\u5bfc\u5165\u4e00\u672c TXT \u5f00\u59cb\u5171\u8bfb\u5427</p>
          ) : books.map((b, i) => (
            <div key={b.id} onClick={() => openBook(i)} style={{ background:'#fff', borderRadius:12, padding:14, marginBottom:10, boxShadow:'0 1px 3px rgba(0,0,0,.06)', cursor:'pointer', position:'relative' }}>
              <div style={{ fontSize:15, fontWeight:600, marginBottom:3 }}>{b.title}</div>
              <div style={{ fontSize:12, color:'#888' }}>{b.chapters?.length || 0} \u7ae0 \u00b7 \u8bfb\u5230\u7b2c {(state.currentBookId === b.id ? (state.userChapter || 0) : 0) + 1} \u7ae0</div>
              {state.currentBookId === b.id && state.active && (
                <div style={{ display:'inline-block', background:'#fff3e0', color:'#e65100', fontSize:11, padding:'2px 8px', borderRadius:10, marginTop:4 }}>\ud83d\udc40 \u6c60\u5728\u8bfb \u00b7 \u7b2c {(state.aiChapter || 0) + 1} \u7ae0</div>
              )}
              <button onClick={(e) => { e.stopPropagation(); delBook(i) }} style={{ position:'absolute', top:12, right:12, background:'#e53935', color:'#fff', border:'none', padding:'3px 10px', borderRadius:6, fontSize:11, cursor:'pointer' }}>\u5220\u9664</button>
            </div>
          ))}
        </div>
      </>)}

      {/* === IMPORT === */}
      {view === 'import' && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={() => setView('shelf')} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#666' }}>{'\u2190'}</button>
          <h2 style={{ flex:1, fontSize:16, fontWeight:600, margin:0 }}>\u5bfc\u5165\u4e66\u7c4d</h2>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:12 }}>
          <div style={{ border:'2px dashed #d0ccc6', borderRadius:12, padding:30, textAlign:'center', margin:'16px 0', background:'#fff' }}>
            <p style={{ marginBottom:12, color:'#666' }}>\u9009\u62e9 .txt \u6587\u4ef6\u5bfc\u5165\u5230\u5171\u8bfb\u4e66\u67b6</p>
            <input type="file" accept=".txt" onChange={handleFile} ref={fileRef} />
            {loading && <p style={{ marginTop:12, color:'#1976d2' }}>\u6b63\u5728\u89e3\u6790...</p>}
          </div>
        </div>
      </>)}

      {/* === READER === */}
      {view === 'reader' && chapter && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={backToShelf} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#666' }}>{'\u2190'}</button>
          <h2 style={{ flex:1, fontSize:15, fontWeight:600, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{chapter.title || ('\u7b2c ' + (currentChapter + 1) + ' \u7ae0')}</h2>
          <span style={{ fontSize:11, color:'#999', flexShrink:0 }}>{currentChapter + 1}/{book.chapters.length}</span>
          <button onClick={() => setDrawerOpen(true)} style={{ background:'#1976d2', color:'#fff', border:'none', borderRadius:8, padding:'5px 10px', fontSize:12, cursor:'pointer', flexShrink:0 }}>\ud83d\udcac \u804a</button>
        </div>

        <div ref={bodyRef} style={{ flex:1, overflowY:'auto', padding:'12px 16px' }}>
          {chapterNotes.length > 0 && chapterNotes.map((n, i) => (
            <div key={n.id || i} style={{ background:'#f0f7f0', borderLeft:'3px solid #66bb6a', padding:'8px 12px', margin:'0 0 10px', borderRadius:'0 8px 8px 0' }}>
              <div style={{ fontSize:12, color:'#2e7d32', fontWeight:600, marginBottom:3 }}>\ud83d\udcdd \u6c60\u7684\u6279\u6ce8</div>
              {n.quote && <div style={{ fontSize:12, color:'#777', fontStyle:'italic', marginBottom:4 }}>\u300c{n.quote}\u300d</div>}
              <p style={{ fontSize:13, color:'#444', margin:0 }}>{n.text}</p>
            </div>
          ))}
          <div style={{ lineHeight:1.85, fontSize:15, color:'#2c2c2c' }} dangerouslySetInnerHTML={{ __html: '<p>' + escHtml(chapter.content).replace(/\n/g, '</p><p>') + '</p>' }} />
          {chapterBookmarks.length > 0 && chapterBookmarks.map((b, i) => (
            <div key={b.id || i} style={{ background:'#fff8e1', borderLeft:'3px solid #ffa726', padding:'8px 12px', margin:'10px 0', borderRadius:'0 8px 8px 0' }}>
              <div style={{ fontSize:12, color:'#e65100', marginBottom:2 }}>\ud83d\udd16 \u4e66\u7b7e</div>
              <div style={{ fontSize:13, color:'#5d4037' }}>\u300c{b.quote}\u300d</div>
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 0', borderTop:'1px solid #eee', marginTop:12 }}>
            <button onClick={() => goChapter(currentChapter - 1)} disabled={currentChapter === 0} style={{ background:'#e8f0fe', border:'none', padding:'7px 14px', borderRadius:8, color:'#1a5bb5', fontSize:13, cursor:'pointer', opacity: currentChapter === 0 ? 0.4 : 1 }}>{'\u2190 \u4e0a\u4e00\u7ae0'}</button>
            <button onClick={() => goChapter(currentChapter + 1)} disabled={currentChapter >= book.chapters.length - 1} style={{ background:'#e8f0fe', border:'none', padding:'7px 14px', borderRadius:8, color:'#1a5bb5', fontSize:13, cursor:'pointer', opacity: currentChapter >= book.chapters.length - 1 ? 0.4 : 1 }}>{'\u4e0b\u4e00\u7ae0 \u2192'}</button>
          </div>
        </div>

        {/* Selection bookmark bar */}
        {selectedText && (
          <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'#333', color:'#fff', padding:'8px 12px', display:'flex', gap:8, alignItems:'center', zIndex:100 }}>
            <span style={{ flex:1, fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>\u300c{selectedText.slice(0, 40)}...\u300d</span>
            <button onClick={addBookmark} style={{ background:'#ffa726', color:'#333', border:'none', borderRadius:6, padding:'4px 12px', fontSize:12, fontWeight:600, cursor:'pointer' }}>\ud83d\udd16 \u6dfb\u52a0\u4e66\u7b7e</button>
          </div>
        )}

        {/* === RIGHT DRAWER CHAT === */}
        {drawerOpen && <div onClick={() => setDrawerOpen(false)} style={{ position:'absolute', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.3)', zIndex:200 }} />}
        <div style={{
          position:'absolute', top:0, right: drawerOpen ? 0 : '-80%', bottom:0, width:'80%',
          background:'#fff', zIndex:300, display:'flex', flexDirection:'column',
          boxShadow: drawerOpen ? '-2px 0 12px rgba(0,0,0,0.15)' : 'none',
          transition:'right 0.3s ease'
        }}>
          <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', borderBottom:'1px solid #eee', flexShrink:0 }}>
            <button onClick={() => setDrawerOpen(false)} style={{ background:'none', border:'none', fontSize:18, padding:4, cursor:'pointer', color:'#666' }}>{'\u2190'}</button>
            <h3 style={{ flex:1, fontSize:15, fontWeight:600, margin:0, marginLeft:8 }}>\u548c\u6c60\u804a\u804a\u8fd9\u672c\u4e66</h3>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'10px 14px' }}>
            {chatMessages.length === 0 && <p style={{ fontSize:13, color:'#bbb', textAlign:'center', marginTop:40 }}>\u548c\u6c60\u8ba8\u8bba\u6b63\u5728\u8bfb\u7684\u5185\u5bb9...</p>}
            {chatMessages.map((m, i) => (
              <div key={i} style={{ marginBottom:8, display:'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <span style={{ background: m.role === 'user' ? '#d4e8fc' : '#f0f0f0', padding:'6px 12px', borderRadius:12, display:'inline-block', maxWidth:'85%', fontSize:14, lineHeight:1.5, wordBreak:'break-word' }}>{m.content}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div style={{ display:'flex', gap:6, padding:'8px 12px', borderTop:'1px solid #eee', flexShrink:0 }}>
            <input style={{ flex:1, border:'1px solid #ddd', borderRadius:10, padding:'8px 12px', fontSize:14, outline:'none' }} value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="\u8bf4\u70b9\u4ec0\u4e48..." />
            <button style={{ background:'#1976d2', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:14, cursor:'pointer' }} onClick={sendChat}>\u53d1\u9001</button>
          </div>
        </div>
      </>)}
    </div>
  )
}
