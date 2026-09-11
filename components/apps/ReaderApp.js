import { useState, useEffect, useRef, useCallback } from 'react'

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

const CHARS_PER_PAGE = 500

function splitPages(content) {
  if (!content) return ['']
  const lines = content.split('\n')
  const pages = []
  let buf = ''
  for (const line of lines) {
    if (buf.length + line.length + 1 > CHARS_PER_PAGE && buf.length > 0) {
      pages.push(buf)
      buf = line
    } else {
      buf += (buf ? '\n' : '') + line
    }
  }
  if (buf) pages.push(buf)
  return pages.length > 0 ? pages : ['']
}

function splitChapters(text) {
  const lines = text.split(/\r?\n/)
  const p1 = /^\s*第[一-鿿\d]{1,10}[章节回卷集篇]/
  const p2 = /^\s*Chapter\s+\d+/i
  const p3 = /^\s*\d{1,4}[\s\.、．]/
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
    if (chunk.length >= 2000) { chapters.push({ title: '第' + (++idx) + '章', content: chunk }); chunk = '' }
  }
  if (chunk) chapters.push({ title: '第' + (++idx) + '章', content: chunk })
  return chapters
}

export default function ReaderApp({ onBack, onMinimize, mini }) {
  const [books, setBooks] = useState([])
  const [state, setState] = useState({ active: false, currentBookId: null, userChapter: 0, aiChapter: 0 })
  const [notes, setNotes] = useState([])
  const [bookmarks, setBookmarks] = useState([])
  const [view, setView] = useState('shelf')
  const [currentBookIdx, setCurrentBookIdx] = useState(-1)
  const [currentChapter, setCurrentChapter] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [selectedText, setSelectedText] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef(null)

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
      let val = d.value
      if (typeof val === 'string') try { val = JSON.parse(val) } catch {}
      if (Array.isArray(val)) setBooks(val)
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

  // Sync page to backend whenever it changes
  const syncProgress = useCallback(async (bookId, chapter, page) => {
    try {
      await fetch('/api/reader?action=progress', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, chapter, page })
      })
    } catch {}
  }, [])

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      let text = ev.target.result
      if (text.indexOf('�') > -1) {
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
    const pg = state.currentBookId === book.id ? (state.userPage || 0) : 0
    setCurrentChapter(ch)
    setCurrentPage(pg)
    setView('reader')
    await syncProgress(book.id, ch, pg)
    await loadState()
  }

  function goPage(book, chapter, page) {
    const ch = book.chapters?.[chapter]
    if (!ch) return
    const pages = splitPages(ch.content)
    if (page < 0) {
      // prev chapter last page
      if (chapter > 0) {
        const prevPages = splitPages(book.chapters[chapter - 1].content)
        setCurrentChapter(chapter - 1)
        setCurrentPage(prevPages.length - 1)
        syncProgress(book.id, chapter - 1, prevPages.length - 1)
      }
      return
    }
    if (page >= pages.length) {
      // next chapter first page
      if (chapter < book.chapters.length - 1) {
        setCurrentChapter(chapter + 1)
        setCurrentPage(0)
        syncProgress(book.id, chapter + 1, 0)
      }
      return
    }
    setCurrentPage(page)
    syncProgress(book.id, chapter, page)
  }

  function backToShelf() { setCurrentBookIdx(-1); setView('shelf'); loadState(); loadBooks() }
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

  const book = currentBookIdx >= 0 ? books[currentBookIdx] : null
  const chapter = book ? book.chapters?.[currentChapter] : null
  const pages = chapter ? splitPages(chapter.content) : ['']
  const safePageIdx = Math.min(currentPage, pages.length - 1)
  const pageContent = pages[safePageIdx] || ''
  const chapterNotes = notes.filter(n => book && n.bookId === book.id && n.chapter === currentChapter)
  const chapterBookmarks = bookmarks.filter(b => book && b.bookId === book.id && b.chapter === currentChapter)

  // Mini mode
  if (mini && view === 'reader' && chapter) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', width:'100%', background:'#faf8f5', fontFamily:'-apple-system,sans-serif', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', padding:'6px 10px', gap:6, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <span style={{ flex:1, fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{chapter.title || ('第 ' + (currentChapter + 1) + ' 章')}</span>
          <span style={{ fontSize:10, color:'#999' }}>{safePageIdx + 1}/{pages.length}</span>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'8px 12px' }}>
          <div style={{ lineHeight:1.75, fontSize:14, color:'#2c2c2c' }} dangerouslySetInnerHTML={{ __html: '<p>' + escHtml(pageContent).replace(/
/g, '</p><p>') + '</p>' }} />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 10px', borderTop:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={() => goPage(book, currentChapter, safePageIdx - 1)} disabled={safePageIdx === 0 && currentChapter === 0} style={{ background:'none', border:'none', color:'#1976d2', fontSize:12, cursor:'pointer', opacity: (safePageIdx === 0 && currentChapter === 0) ? 0.4 : 1 }}>{'← 上一页'}</button>
          <button onClick={() => goPage(book, currentChapter, safePageIdx + 1)} disabled={safePageIdx >= pages.length - 1 && currentChapter >= book.chapters.length - 1} style={{ background:'none', border:'none', color:'#1976d2', fontSize:12, cursor:'pointer', opacity: (safePageIdx >= pages.length - 1 && currentChapter >= book.chapters.length - 1) ? 0.4 : 1 }}>{'下一页 →'}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', width:'100%', background:'#faf8f5', fontFamily:'-apple-system,sans-serif', position:'relative', overflow:'hidden' }}>

      {/* SHELF */}
      {view === 'shelf' && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={onBack} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#666' }}>{'←'}</button>
          <h2 style={{ flex:1, fontSize:16, fontWeight:600, margin:0 }}>共读书架</h2>
          <button onClick={() => setView('import')} style={{ background:'#1976d2', color:'#fff', border:'none', padding:'7px 14px', borderRadius:8, fontSize:13, cursor:'pointer' }}>+ 导入</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:12 }}>
          {state.recommendation && (
            <div style={{ background:'#e3f2fd', borderRadius:10, padding:12, marginBottom:10, border:'1px solid #90caf9' }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>📖 池推荐了一本书</div>
              <div style={{ fontSize:15, fontWeight:600 }}>{state.recommendation.title}</div>
              <div style={{ fontSize:13, color:'#555', marginTop:2 }}>{state.recommendation.reason}</div>
            </div>
          )}
          {books.length === 0 ? (
            <p style={{ color:'#999', textAlign:'center', padding:40 }}>书架空空的，导入一本 TXT 开始共读吧</p>
          ) : books.map((b, i) => (
            <div key={b.id} onClick={() => openBook(i)} style={{ background:'#fff', borderRadius:12, padding:14, marginBottom:10, boxShadow:'0 1px 3px rgba(0,0,0,.06)', cursor:'pointer', position:'relative' }}>
              <div style={{ fontSize:15, fontWeight:600, marginBottom:3 }}>{b.title}</div>
              <div style={{ fontSize:12, color:'#888' }}>{b.chapters?.length || 0} 章 · 读到第 {(state.currentBookId === b.id ? (state.userChapter || 0) : 0) + 1} 章</div>
              {state.currentBookId === b.id && state.active && (
                <div style={{ display:'inline-block', background:'#fff3e0', color:'#e65100', fontSize:11, padding:'2px 8px', borderRadius:10, marginTop:4 }}>👀 池在读 · 第 {(state.aiChapter || 0) + 1} 章</div>
              )}
              <button onClick={(e) => { e.stopPropagation(); delBook(i) }} style={{ position:'absolute', top:12, right:12, background:'#e53935', color:'#fff', border:'none', padding:'3px 10px', borderRadius:6, fontSize:11, cursor:'pointer' }}>删除</button>
            </div>
          ))}
        </div>
      </>)}

      {/* IMPORT */}
      {view === 'import' && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={() => setView('shelf')} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#666' }}>{'←'}</button>
          <h2 style={{ flex:1, fontSize:16, fontWeight:600, margin:0 }}>导入书籍</h2>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:12 }}>
          <div style={{ border:'2px dashed #d0ccc6', borderRadius:12, padding:30, textAlign:'center', margin:'16px 0', background:'#fff' }}>
            <p style={{ marginBottom:12, color:'#666' }}>选择 .txt 文件导入到共读书架</p>
            <input type="file" accept=".txt" onChange={handleFile} ref={fileRef} />
            {loading && <p style={{ marginTop:12, color:'#1976d2' }}>正在解析...</p>}
          </div>
        </div>
      </>)}

      {/* READER with pagination */}
      {view === 'reader' && chapter && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={backToShelf} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#666' }}>{'←'}</button>
          <h2 style={{ flex:1, fontSize:15, fontWeight:600, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{chapter.title || ('第 ' + (currentChapter + 1) + ' 章')}</h2>
          <span style={{ fontSize:11, color:'#999', flexShrink:0 }}>P{safePageIdx + 1}/{pages.length} · Ch{currentChapter + 1}/{book.chapters.length}</span>
          {onMinimize && <button onClick={onMinimize} style={{ background:'#ff9800', color:'#fff', border:'none', borderRadius:8, padding:'5px 10px', fontSize:12, cursor:'pointer', flexShrink:0 }} title="小窗看书">🗗</button>}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'14px 18px' }}>
          {chapterNotes.length > 0 && safePageIdx === 0 && chapterNotes.map((n, i) => (
            <div key={n.id || i} style={{ background:'#f0f7f0', borderLeft:'3px solid #66bb6a', padding:'8px 12px', margin:'0 0 10px', borderRadius:'0 8px 8px 0' }}>
              <div style={{ fontSize:12, color:'#2e7d32', fontWeight:600, marginBottom:3 }}>📝 池的批注</div>
              {n.quote && <div style={{ fontSize:12, color:'#777', fontStyle:'italic', marginBottom:4 }}>「{n.quote}」</div>}
              <p style={{ fontSize:13, color:'#444', margin:0 }}>{n.text}</p>
            </div>
          ))}

          <div style={{ lineHeight:1.85, fontSize:15, color:'#2c2c2c', minHeight:'60%' }} dangerouslySetInnerHTML={{ __html: '<p>' + escHtml(pageContent).replace(/
/g, '</p><p>') + '</p>' }} />

          {chapterBookmarks.length > 0 && safePageIdx === 0 && chapterBookmarks.map((b, i) => (
            <div key={b.id || i} style={{ background:'#fff8e1', borderLeft:'3px solid #ffa726', padding:'8px 12px', margin:'10px 0', borderRadius:'0 8px 8px 0' }}>
              <div style={{ fontSize:12, color:'#e65100', marginBottom:2 }}>🔖 书签</div>
              <div style={{ fontSize:13, color:'#5d4037' }}>「{b.quote}」</div>
            </div>
          ))}
        </div>

        {/* Page navigation */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 16px', borderTop:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={() => goPage(book, currentChapter, safePageIdx - 1)} disabled={safePageIdx === 0 && currentChapter === 0} style={{ background:'#e8f0fe', border:'none', padding:'8px 16px', borderRadius:8, color:'#1a5bb5', fontSize:13, cursor:'pointer', opacity: (safePageIdx === 0 && currentChapter === 0) ? 0.4 : 1 }}>{'← 上一页'}</button>
          <span style={{ fontSize:12, color:'#999' }}>{safePageIdx + 1} / {pages.length}</span>
          <button onClick={() => goPage(book, currentChapter, safePageIdx + 1)} disabled={safePageIdx >= pages.length - 1 && currentChapter >= book.chapters.length - 1} style={{ background:'#e8f0fe', border:'none', padding:'8px 16px', borderRadius:8, color:'#1a5bb5', fontSize:13, cursor:'pointer', opacity: (safePageIdx >= pages.length - 1 && currentChapter >= book.chapters.length - 1) ? 0.4 : 1 }}>{'下一页 →'}</button>
        </div>

        {selectedText && (
          <div style={{ position:'absolute', bottom:50, left:0, right:0, background:'#333', color:'#fff', padding:'8px 12px', display:'flex', gap:8, alignItems:'center', zIndex:100 }}>
            <span style={{ flex:1, fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>「{selectedText.slice(0, 40)}...」</span>
            <button onClick={addBookmark} style={{ background:'#ffa726', color:'#333', border:'none', borderRadius:6, padding:'4px 12px', fontSize:12, fontWeight:600, cursor:'pointer' }}>🔖 添加书签</button>
          </div>
        )}
      </>)}
    </div>
  )
}
