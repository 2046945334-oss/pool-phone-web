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
  const contentRef = useRef(null)
  // === 共读笔记 state ===
  const [journal, setJournal] = useState({ cover: '', books: {} })
  const [journalView, setJournalView] = useState(null) // null=目录, bookTitle=某本书
  const [journalNoteInput, setJournalNoteInput] = useState({}) // { entryId: text }
  const [journalCoverUploading, setJournalCoverUploading] = useState(false)
  const [journalSortAsc, setJournalSortAsc] = useState(true) // true=正序(旧→新) false=倒序(新→旧)
  const journalCoverRef = useRef(null)

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

  useEffect(() => { loadState(); loadBooks(); loadJournal() }, [])

  const loadJournal = useCallback(async () => {
    try {
      const r = await fetch('/api/reader?action=journal')
      const d = await r.json()
      setJournal(d || { cover: '', books: {} })
    } catch {}
  }, [])

  // Mini mode: auto-open current book on mount
  useEffect(() => {
    if (!mini) return
    if (books.length === 0) return
    if (view === 'reader') return
    // Try current book first, fallback to first book
    let idx = -1
    if (state.currentBookId) {
      idx = books.findIndex(b => b.id === state.currentBookId)
    }
    if (idx < 0) idx = 0  // fallback to first book
    if (idx >= 0 && idx < books.length) {
      setCurrentBookIdx(idx)
      const bp = state.bookProgress?.[books[idx].id]
      if (bp) {
        setCurrentChapter(bp.chapter || 0)
        setCurrentPage(bp.page || 0)
      } else if (state.currentBookId === books[idx].id) {
        setCurrentChapter(state.userChapter || 0)
        setCurrentPage(state.userPage || 0)
      } else {
        setCurrentChapter(0)
        setCurrentPage(0)
      }
      setView('reader')
    }
  }, [mini, books, state])
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
    // Restore per-book progress if available, otherwise fall back to global state or 0
    const bp = state.bookProgress?.[book.id]
    let ch = 0, pg = 0
    if (bp) {
      ch = bp.chapter || 0
      pg = bp.page || 0
    } else if (state.currentBookId === book.id) {
      ch = state.userChapter || 0
      pg = state.userPage || 0
    }
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
        if (contentRef.current) contentRef.current.scrollTop = 0
        if (mini) {
          const txt = (prevPages[prevPages.length - 1] || '')
          const title = book.chapters[chapter - 1].title || ('第 ' + chapter + ' 章')
          typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('reader-page-change', {
            detail: { bookTitle: book.title, chapterTitle: title, page: prevPages.length, totalPages: prevPages.length, content: txt }
          }))
        }
      }
      return
    }
    if (page >= pages.length) {
      // next chapter first page
      if (chapter < book.chapters.length - 1) {
        setCurrentChapter(chapter + 1)
        setCurrentPage(0)
        syncProgress(book.id, chapter + 1, 0)
        if (contentRef.current) contentRef.current.scrollTop = 0
        if (mini) {
          const nextCh = book.chapters[chapter + 1]
          const nextPages = splitPages(nextCh.content)
          const txt = (nextPages[0] || '')
          const title = nextCh.title || ('第 ' + (chapter + 2) + ' 章')
          typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('reader-page-change', {
            detail: { bookTitle: book.title, chapterTitle: title, page: 1, totalPages: nextPages.length, content: txt }
          }))
        }
      }
      return
    }
    setCurrentPage(page)
    syncProgress(book.id, chapter, page)
    if (contentRef.current) contentRef.current.scrollTop = 0
    // Notify ChatView about page change in mini mode
    if (mini) {
      const pg = splitPages(ch.content)
      const txt = pg[page] || ''
      const title = ch.title || ('第 ' + (chapter + 1) + ' 章')
      typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('reader-page-change', {
        detail: { bookTitle: book.title, chapterTitle: title, page: page + 1, totalPages: pg.length, content: txt }
      }))
    }
  }

  function backToShelf() { setCurrentBookIdx(-1); setView('shelf'); loadState(); loadBooks(); loadJournal() }
  async function delBook(idx) {
    const book = books[idx]
    if (!confirm('确定要删除《' + book.title + '》吗？')) return
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

  // Mini mode - loading/empty fallback
  if (mini && view !== 'reader') {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', background:'#fff5f8', color:'#b06080', fontSize:13 }}>
        {books.length === 0 ? '加载中...' : '书架是空的'}
      </div>
    )
  }
  if (mini && view === 'reader' && chapter) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', width:'100%', background:'#fff5f8', fontFamily:'-apple-system,sans-serif', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', padding:'6px 10px', gap:6, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <span style={{ flex:1, fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{chapter.title || ('第 ' + (currentChapter + 1) + ' 章')}</span>
          <span style={{ fontSize:10, color:'#999' }}>{safePageIdx + 1}/{pages.length}</span>
        </div>
        <div ref={contentRef} style={{ flex:1, overflowY:'auto', padding:'8px 12px' }}>
          <div style={{ lineHeight:1.75, fontSize:14, color:'#2c2c2c' }} dangerouslySetInnerHTML={{ __html: '<p>' + escHtml(pageContent).split('\n').join( '</p><p>') + '</p>' }} />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 10px', borderTop:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={() => goPage(book, currentChapter, safePageIdx - 1)} disabled={safePageIdx === 0 && currentChapter === 0} style={{ background:'none', border:'none', color:'#e91e8c', fontSize:12, cursor:'pointer', opacity: (safePageIdx === 0 && currentChapter === 0) ? 0.4 : 1 }}>{'← 上一页'}</button>
          <button onClick={() => goPage(book, currentChapter, safePageIdx + 1)} disabled={safePageIdx >= pages.length - 1 && currentChapter >= book.chapters.length - 1} style={{ background:'none', border:'none', color:'#e91e8c', fontSize:12, cursor:'pointer', opacity: (safePageIdx >= pages.length - 1 && currentChapter >= book.chapters.length - 1) ? 0.4 : 1 }}>{'下一页 →'}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', width:'100%', background:'#fff5f8', fontFamily:'-apple-system,sans-serif', position:'relative', overflow:'hidden' }}>

      {/* SHELF */}
      {view === 'shelf' && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={onBack} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#666' }}>{'←'}</button>
          <h2 style={{ flex:1, fontSize:16, fontWeight:600, margin:0 }}>共读书架</h2>
          <button onClick={() => setView('search')} style={{ background:'#f0c0d0', color:'#7a4a5a', border:'none', padding:'7px 12px', borderRadius:8, fontSize:13, cursor:'pointer' }}>找书</button>
          <button onClick={() => setView('import')} style={{ background:'#e91e8c', color:'#fff', border:'none', padding:'7px 14px', borderRadius:8, fontSize:13, cursor:'pointer' }}>+ 导入</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:0, background:'linear-gradient(180deg, #fef6f3 0%, #faf0ed 100%)' }}>
          {state.recommendation && (
            <div style={{ background:'#fce4ec', borderRadius:10, padding:12, margin:'10px 12px', border:'1px solid #f8bbd0' }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>{'📖 池推荐了一本书'}</div>
              <div style={{ fontSize:15, fontWeight:600 }}>{state.recommendation.title}</div>
              <div style={{ fontSize:13, color:'#555', marginTop:2 }}>{state.recommendation.reason}</div>
            </div>
          )}
          {books.length === 0 ? (
            <div style={{ textAlign:'center', padding:'60px 20px', color:'#c9a0a0' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>{'📚'}</div>
              <p style={{ fontSize:14 }}>{'书架空空的，导入一本 TXT 开始共读吧'}</p>
            </div>
          ) : (() => {
            const shelfColors = ['#f8bbd0','#e1bee7','#c5cae9','#b2dfdb','#ffe0b2','#d7ccc8','#f0f4c3','#b3e5fc','#ffccbc','#dcedc8'];
            // First row: up to 3 recently viewed books (sorted by last read time)
            // Insert journal as center book if there are recent books, otherwise just show journal alone
            const recentBooks = books
              .map((b, idx) => ({ b, idx, lastRead: state.currentBookId === b.id ? (state.lastRead || 0) : (b.lastOpenedAt || b.importedAt || 0) }))
              .sort((a, c) => c.lastRead - a.lastRead)
              .filter(x => x.lastRead > 0)
              .slice(0, 2); // max 2 real books (journal takes center)
            const journalEntryCount = Object.values(journal.books || {}).reduce((s, b) => s + (b.entries?.length || 0), 0)
            // All books go to spine rows
            const spineBooks = books;
            const spineRows = [];
            for (let i = 0; i < spineBooks.length; i += 6) spineRows.push(spineBooks.slice(i, i + 6));
            const rotations = [-8, 0, 5];
            const offsets = [12, 0, -8];
            const zIndexes = [2, 3, 1];
            return (<>
              {/* Featured row: recently viewed books + journal in center */}
              <div style={{ marginBottom:0 }}>
                <div style={{ padding:'4px 20px 0', fontSize:11, color:'#b08090', fontWeight:500 }}>{'最近在读'}</div>
                <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'center', padding:'12px 20px 10px', minHeight:180, position:'relative' }}>
                  {/* Left book */}
                  {recentBooks[0] && (() => {
                    const item = recentBooks[0]; const b = item.b; const realIdx = item.idx
                    const color = shelfColors[realIdx % shelfColors.length]
                    const aiReading = state.currentBookId === b.id && state.active
                    return (
                      <div key={b.id} onClick={() => openBook(realIdx)} style={{ cursor:'pointer', position:'relative', zIndex:2, marginBottom:12, transform:'rotate(-8deg)', transformOrigin:'bottom center' }}>
                        <div style={{ width:105, height:140, borderRadius:'4px 10px 10px 4px', background: 'linear-gradient(145deg, ' + color + ' 0%, ' + color + 'aa 50%, ' + color + '66 100%)', boxShadow:'3px 4px 12px rgba(0,0,0,.2), inset -4px 0 8px rgba(0,0,0,.06)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:10, position:'relative', border:'1px solid rgba(255,255,255,.5)' }}>
                          <div style={{ position:'absolute', left:5, top:0, bottom:0, width:3, background:'rgba(0,0,0,.08)', borderRadius:2 }} />
                          <div style={{ fontSize:14, fontWeight:700, color:'#4a3040', textAlign:'center', lineHeight:1.3, wordBreak:'break-all', maxHeight:56, overflow:'hidden' }}>{b.title.length > 8 ? b.title.slice(0,8)+'...' : b.title}</div>
                          <div style={{ fontSize:9, color:'#7a6070', marginTop:8 }}>{(b.chapters?.length || 0) + '章'}</div>
                          {aiReading && <div style={{ fontSize:8, color:'#c2185b', marginTop:2 }}>{'👀 池在读'}</div>}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Center: Journal book */}
                  <div onClick={() => { setView('journal'); setJournalView(null); loadJournal() }} style={{ cursor:'pointer', position:'relative', zIndex:3, marginLeft: recentBooks.length > 0 ? -20 : 0 }}>
                    <div style={{ width:110, height:148, borderRadius:'4px 10px 10px 4px', background: journal.cover ? `url(${journal.cover}) center/cover` : 'linear-gradient(145deg, #ffe8d6 0%, #f5d0b0 50%, #e8c4a0 100%)', boxShadow:'3px 4px 14px rgba(0,0,0,.25), inset -4px 0 8px rgba(0,0,0,.06)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:10, position:'relative', border:'1px solid rgba(255,255,255,.5)' }}>
                      <div style={{ position:'absolute', left:5, top:0, bottom:0, width:3, background:'rgba(0,0,0,.08)', borderRadius:2 }} />
                      <div style={{ position:'absolute', left:10, top:8, right:8, bottom:8, border:'1px solid rgba(255,255,255,.3)', borderRadius:4, pointerEvents:'none' }} />
                      {!journal.cover && <>
                        <div style={{ fontSize:13, fontWeight:700, color:'#6d4c41', textAlign:'center', lineHeight:1.3 }}>{'共读'}</div>
                        <div style={{ fontSize:13, fontWeight:700, color:'#6d4c41', textAlign:'center', lineHeight:1.3 }}>{'笔记'}</div>
                        <div style={{ fontSize:9, color:'#8d6e63', marginTop:8 }}>{journalEntryCount + ' 篇'}</div>
                      </>}
                      {journal.cover && <div style={{ position:'absolute', bottom:8, left:0, right:0, textAlign:'center' }}><span style={{ background:'rgba(0,0,0,.5)', color:'#fff', fontSize:10, padding:'2px 8px', borderRadius:4 }}>{'共读笔记'}</span></div>}
                    </div>
                  </div>

                  {/* Right book */}
                  {recentBooks[1] && (() => {
                    const item = recentBooks[1]; const b = item.b; const realIdx = item.idx
                    const color = shelfColors[realIdx % shelfColors.length]
                    const aiReading = state.currentBookId === b.id && state.active
                    return (
                      <div key={b.id} onClick={() => openBook(realIdx)} style={{ cursor:'pointer', position:'relative', zIndex:1, marginLeft:-20, marginBottom:-8, transform:'rotate(5deg)', transformOrigin:'bottom center' }}>
                        <div style={{ width:105, height:140, borderRadius:'4px 10px 10px 4px', background: 'linear-gradient(145deg, ' + color + ' 0%, ' + color + 'aa 50%, ' + color + '66 100%)', boxShadow:'3px 4px 12px rgba(0,0,0,.2), inset -4px 0 8px rgba(0,0,0,.06)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:10, position:'relative', border:'1px solid rgba(255,255,255,.5)' }}>
                          <div style={{ position:'absolute', left:5, top:0, bottom:0, width:3, background:'rgba(0,0,0,.08)', borderRadius:2 }} />
                          <div style={{ fontSize:14, fontWeight:700, color:'#4a3040', textAlign:'center', lineHeight:1.3, wordBreak:'break-all', maxHeight:56, overflow:'hidden' }}>{b.title.length > 8 ? b.title.slice(0,8)+'...' : b.title}</div>
                          <div style={{ fontSize:9, color:'#7a6070', marginTop:8 }}>{(b.chapters?.length || 0) + '章'}</div>
                          {aiReading && <div style={{ fontSize:8, color:'#c2185b', marginTop:2 }}>{'👀 池在读'}</div>}
                        </div>
                      </div>
                    )
                  })()}
                </div>
                <div style={{ height:8, background:'linear-gradient(180deg, #c9a88c 0%, #b8957a 40%, #a68060 100%)', borderRadius:'0 0 3px 3px', boxShadow:'0 3px 6px rgba(0,0,0,.18)', margin:'0 10px' }} />
                <div style={{ height:5, background:'linear-gradient(180deg, rgba(0,0,0,.06) 0%, transparent 100%)', margin:'0 14px' }} />
              </div>
              {/* Spine rows: all books standing upright like real bookshelf */}
              {spineRows.map((row, ri) => (
                <div key={ri} style={{ marginBottom:0 }}>
                  <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'flex-start', padding:'18px 16px 4px', minHeight:140, gap:2 }}>
                    {row.map((b, bi) => {
                      const globalIdx = ri * 6 + bi;
                      const color = shelfColors[globalIdx % shelfColors.length];
                      const aiReading = state.currentBookId === b.id && state.active;
                      // Thickness based on chapter count: min 22px, max 48px
                      const chCount = b.chapters?.length || 5;
                      const thickness = Math.max(22, Math.min(48, 18 + chCount * 0.6));
                      // Height varies slightly per book for natural look
                      const baseH = 120;
                      const hVariation = ((globalIdx * 7 + 13) % 5) * 4 - 8; // -8 to +8
                      const bookH = baseH + hVariation;
                      // Tilt: some books lean slightly
                      const tiltAngles = [0, -4, 3, 0, -2, 5];
                      const tilt = tiltAngles[bi % tiltAngles.length];
                      // Spine decorations vary per book
                      const decoType = globalIdx % 4; // 0=lines, 1=dots, 2=flower, 3=plain
                      return (
                        <div key={b.id} onClick={() => openBook(globalIdx)} style={{ cursor:'pointer', position:'relative', transform: tilt ? 'rotate('+tilt+'deg)' : 'none', transformOrigin:'bottom center', zIndex: tilt < 0 ? 2 : 1 }}>
                          <div style={{
                            width: thickness, height: bookH,
                            borderRadius: '3px 5px 5px 3px',
                            background: 'linear-gradient(90deg, ' + color + 'cc 0%, ' + color + ' 30%, ' + color + 'dd 70%, ' + color + '99 100%)',
                            boxShadow: '2px 3px 8px rgba(0,0,0,.18), inset -3px 0 6px rgba(0,0,0,.08), inset 3px 0 4px rgba(255,255,255,.15)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            padding: '8px 3px', position: 'relative',
                            border: '1px solid rgba(0,0,0,.08)',
                          }}>
                            {/* Left edge shadow (spine binding) */}
                            <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:'linear-gradient(90deg, rgba(0,0,0,.12), transparent)', borderRadius:'3px 0 0 3px' }} />
                            {/* Top decoration */}
                            {decoType === 0 && (<>
                              <div style={{ position:'absolute', top:8, left:'25%', right:'25%', height:1.5, background:'rgba(255,255,255,.4)', borderRadius:1 }} />
                              <div style={{ position:'absolute', top:12, left:'25%', right:'25%', height:1.5, background:'rgba(255,255,255,.4)', borderRadius:1 }} />
                            </>)}
                            {decoType === 1 && (
                              <div style={{ position:'absolute', top:10, display:'flex', gap:3, justifyContent:'center', width:'100%' }}>
                                {[0,1,2].map(d => <div key={d} style={{ width:4, height:4, borderRadius:2, background:'rgba(255,255,255,.35)' }} />)}
                              </div>
                            )}
                            {decoType === 2 && (
                              <div style={{ position:'absolute', top:8, fontSize:8, color:'rgba(255,255,255,.4)' }}>{'\u273b'}</div>
                            )}
                            {/* Bottom decoration */}
                            <div style={{ position:'absolute', bottom:8, left:'20%', right:'20%', height:1, background:'rgba(255,255,255,.3)', borderRadius:1 }} />
                            {/* Title (vertical) */}
                            <div style={{ writingMode:'vertical-rl', fontSize: thickness > 30 ? 11 : 9, fontWeight:600, color:'#4a3040', letterSpacing:2, maxHeight: bookH - 40, overflow:'hidden', textOverflow:'ellipsis', lineHeight:1.2 }}>
                              {b.title.length > 8 ? b.title.slice(0,8)+'\u2026' : b.title}
                            </div>
                          </div>
                          {aiReading && <div style={{ position:'absolute', top:-4, right:-4, width:10, height:10, borderRadius:5, background:'#e91e8c', border:'1.5px solid #fff', zIndex:3 }} />}
                          <button onClick={(e) => { e.stopPropagation(); delBook(globalIdx) }} style={{ position:'absolute', top:-6, right:-6, background:'#f06292', color:'#fff', border:'none', width:18, height:18, borderRadius:9, fontSize:10, cursor:'pointer', lineHeight:'18px', textAlign:'center', zIndex:4, boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}>{'\u00d7'}</button>
                        </div>
                      );
                    })}
                    {row.length < 6 && <div style={{ flex:1 }} />}
                  </div>
                  <div style={{ height:8, background:'linear-gradient(180deg, #c9a88c 0%, #b8957a 40%, #a68060 100%)', borderRadius:'0 0 3px 3px', boxShadow:'0 3px 6px rgba(0,0,0,.18)', margin:'0 10px' }} />
                  <div style={{ height:4, background:'linear-gradient(180deg, rgba(0,0,0,.05) 0%, transparent 100%)', margin:'0 14px' }} />
                </div>
              ))}
            </>);
          })()}
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
            {loading && <p style={{ marginTop:12, color:'#e91e8c' }}>正在解析...</p>}
          </div>
        </div>
      </>)}

      {/* READER with pagination */}
      {view === 'reader' && chapter && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={backToShelf} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#666' }}>{'←'}</button>
          <h2 style={{ flex:1, fontSize:15, fontWeight:600, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{chapter.title || ('第 ' + (currentChapter + 1) + ' 章')}</h2>
          <span style={{ fontSize:11, color:'#999', flexShrink:0 }}>P{safePageIdx + 1}/{pages.length} · Ch{currentChapter + 1}/{book.chapters.length}</span>
          {onMinimize && <button onClick={onMinimize} style={{ background:'#f48fb1', color:'#fff', border:'none', borderRadius:8, padding:'5px 10px', fontSize:12, cursor:'pointer', flexShrink:0 }} title="小窗看书">🗗</button>}
        </div>

        <div ref={contentRef} style={{ flex:1, overflowY:'auto', padding:'14px 18px' }}>
          {(() => {
            // Split page content into paragraphs and inline notes after matching paragraphs
            const paragraphs = pageContent.split('\n').filter(p => p.trim())
            const pageNotes = chapterNotes.filter(n => {
              if (!n.quote) return false
              return pageContent.includes(n.quote.slice(0, 20))
            })
            // Track which notes have been placed inline
            const placedNoteIds = new Set()
            const elements = []

            paragraphs.forEach((para, pi) => {
              // Render the paragraph
              elements.push(
                <p key={'p' + pi} style={{ lineHeight:1.85, fontSize:15, color:'#2c2c2c', margin:'0 0 8px' }}>{para}</p>
              )
              // Check if any notes' quote appears in this paragraph
              pageNotes.forEach(n => {
                if (placedNoteIds.has(n.id)) return
                if (para.includes(n.quote.slice(0, 20))) {
                  placedNoteIds.add(n.id)
                  elements.push(
                    <div key={'n' + n.id} style={{ background:'#fff0f3', borderLeft:'3px solid #66bb6a', padding:'8px 12px', margin:'4px 0 10px', borderRadius:'0 8px 8px 0' }}>
                      <div style={{ fontSize:12, color:'#c2185b', fontWeight:600, marginBottom:3 }}>📝 池的批注</div>
                      <div style={{ fontSize:12, color:'#777', fontStyle:'italic', marginBottom:4 }}>「{n.quote}」</div>
                      <p style={{ fontSize:13, color:'#444', margin:0 }}>{n.text}</p>
                    </div>
                  )
                }
              })
            })

            // Append unplaced notes (no quote or quote not found on this page) at the bottom
            const unplacedNotes = chapterNotes.filter(n => {
              if (placedNoteIds.has(n.id)) return false
              if (!n.quote) return true
              // Show on last page as fallback
              if (safePageIdx === pages.length - 1) return true
              return false
            })
            unplacedNotes.forEach(n => {
              elements.push(
                <div key={'n' + (n.id || Math.random())} style={{ background:'#fff0f3', borderLeft:'3px solid #66bb6a', padding:'8px 12px', margin:'10px 0 0', borderRadius:'0 8px 8px 0' }}>
                  <div style={{ fontSize:12, color:'#c2185b', fontWeight:600, marginBottom:3 }}>📝 池的批注</div>
                  {n.quote && <div style={{ fontSize:12, color:'#777', fontStyle:'italic', marginBottom:4 }}>「{n.quote}」</div>}
                  <p style={{ fontSize:13, color:'#444', margin:0 }}>{n.text}</p>
                </div>
              )
            })

            return elements
          })()}

          {chapterBookmarks.filter(b => !b.quote || pageContent.includes(b.quote.slice(0, 30))).map((b, i) => (
            <div key={b.id || i} style={{ background:'#fff0f3', borderLeft:'3px solid #ffa726', padding:'8px 12px', margin:'10px 0', borderRadius:'0 8px 8px 0' }}>
              <div style={{ fontSize:12, color:'#c2185b', marginBottom:2 }}>🔖 书签</div>
              <div style={{ fontSize:13, color:'#880e4f' }}>「{b.quote}」</div>
            </div>
          ))}
        </div>

        {/* Page navigation */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 16px', borderTop:'1px solid #eee', background:'#fff', flexShrink:0 }}>
          <button onClick={() => goPage(book, currentChapter, safePageIdx - 1)} disabled={safePageIdx === 0 && currentChapter === 0} style={{ background:'#fce4ec', border:'none', padding:'8px 16px', borderRadius:8, color:'#c2185b', fontSize:13, cursor:'pointer', opacity: (safePageIdx === 0 && currentChapter === 0) ? 0.4 : 1 }}>{'← 上一页'}</button>
          <span style={{ fontSize:12, color:'#999' }}>{safePageIdx + 1} / {pages.length}</span>
          <button onClick={() => goPage(book, currentChapter, safePageIdx + 1)} disabled={safePageIdx >= pages.length - 1 && currentChapter >= book.chapters.length - 1} style={{ background:'#fce4ec', border:'none', padding:'8px 16px', borderRadius:8, color:'#c2185b', fontSize:13, cursor:'pointer', opacity: (safePageIdx >= pages.length - 1 && currentChapter >= book.chapters.length - 1) ? 0.4 : 1 }}>{'下一页 →'}</button>
        </div>

        {selectedText && (
          <div style={{ position:'absolute', bottom:50, left:0, right:0, background:'#333', color:'#fff', padding:'8px 12px', display:'flex', gap:8, alignItems:'center', zIndex:100 }}>
            <span style={{ flex:1, fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>「{selectedText.slice(0, 40)}...」</span>
            <button onClick={addBookmark} style={{ background:'#f48fb1', color:'#333', border:'none', borderRadius:6, padding:'4px 12px', fontSize:12, fontWeight:600, cursor:'pointer' }}>🔖 添加书签</button>
          </div>
        )}
      </>)}

      {/* SEARCH / BOOK SOURCES */}
      {view === 'search' && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #f0e0e8', background:'#fff', flexShrink:0 }}>
          <button onClick={() => setView('shelf')} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#c9909e' }}>{'<'}</button>
          <h2 style={{ flex:1, fontSize:15, fontWeight:600, margin:0, color:'#8a5a6a' }}>{'找书'}</h2>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'16px 14px', background:'linear-gradient(180deg, #fff8f9 0%, #fef2f4 100%)' }}>
          <p style={{ fontSize:12, color:'#b8909e', margin:'0 0 14px', lineHeight:1.5 }}>{'点击跳转到外部书源，找到 txt 后下载导入书架即可共读。'}</p>
          {[
            { name: '鸠摩搜书', url: 'https://jiumodiary.github.io/', desc: '聚合搜索，直接搜书名下载 PDF/TXT' },
            { name: 'Z-Library', url: 'https://z-lib.gs/', desc: '全球最大免费电子书库，EPUB/PDF/TXT' },
            { name: "Anna's Archive", url: 'https://annas-archive.org/', desc: '聚合 Z-Lib + LibGen，无需注册' },
            { name: 'Project Gutenberg', url: 'https://www.gutenberg.org/', desc: '7万+免费英文经典，支持 TXT' },
            { name: '书格', url: 'https://new.shuge.org/', desc: '古籍善本，高清扫描，适合传统文学' },
            { name: '知海图书馆', url: 'https://www.zhihailib.com/', desc: '中文免费电子书，多分类' },
            { name: 'SoBooks', url: 'https://sobooks.net/', desc: '豆瓣高分书籍推荐，可下载' },
          ].map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ display:'flex', alignItems:'center', gap:12, background:'#fff', borderRadius:10, padding:'12px 14px', marginBottom:8, border:'1px solid #f4e4ea', textDecoration:'none', color:'inherit' }}>
              <div style={{ width:32, height:32, borderRadius:8, background:'#fce8ee', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <span style={{ fontSize:12, fontWeight:700, color:'#d4889a' }}>{s.name.charAt(0)}</span>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:600, color:'#6a3a4a' }}>{s.name}</div>
                <div style={{ fontSize:11, color:'#b8909e', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.desc}</div>
              </div>
            </a>
          ))}
          <div style={{ fontSize:11, color:'#cca8b4', textAlign:'center', marginTop:16, lineHeight:1.5 }}>{'下载 .txt 文件后回到书架点「+ 导入」'}</div>
        </div>
      </>)}

      {/* JOURNAL VIEW */}
      {view === 'journal' && (<>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', gap:8, borderBottom:'1px solid #f0e0e8', background:'#fff', flexShrink:0 }}>
          <button onClick={() => { if (journalView) setJournalView(null); else setView('shelf') }} style={{ background:'none', border:'none', fontSize:20, padding:4, cursor:'pointer', color:'#c9909e' }}>{'<'}</button>
          <h2 style={{ flex:1, fontSize:15, fontWeight:600, margin:0, color:'#8a5a6a' }}>{journalView || '共读笔记'}</h2>
          {journalView && <button onClick={() => setJournalSortAsc(p => !p)} style={{ background:'#f8e8ee', color:'#9a6a7a', border:'1px solid #f0d0da', padding:'4px 10px', borderRadius:8, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>{journalSortAsc ? '正序 ↓' : '倒序 ↑'}</button>}
          {!journalView && <>
            <button onClick={() => journalCoverRef.current?.click()} style={{ background:'#e8c0cc', color:'#7a4a5a', border:'none', padding:'5px 10px', borderRadius:8, fontSize:11, cursor:'pointer' }}>{'封面'}</button>
            <input type="file" accept="image/*" ref={journalCoverRef} style={{ display:'none' }} onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return
              setJournalCoverUploading(true)
              const fr = new FileReader()
              fr.onload = async () => {
                try {
                  await fetch('/api/reader?action=journal_cover', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ cover: fr.result }) })
                  await loadJournal()
                } catch {}
                setJournalCoverUploading(false)
              }
              fr.readAsDataURL(file)
            }} />
          </>}
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'16px 14px', background:'linear-gradient(180deg, #fff8f9 0%, #fef2f4 100%)' }}>
          {!journalView ? (
            /* 目录 */
            Object.keys(journal.books || {}).length === 0 ? (
              <div style={{ textAlign:'center', padding:'60px 20px', color:'#d4a0b0' }}>
                <div style={{ width:40, height:40, borderRadius:20, background:'#f8e0e8', margin:'0 auto 12px', display:'flex', alignItems:'center', justifyContent:'center' }}><span style={{ fontSize:16, color:'#c4889a' }}>{'~'}</span></div>
                <p style={{ fontSize:14, color:'#b88a98' }}>{'还没有笔记'}</p>
                <p style={{ fontSize:12, color:'#cca8b4', marginTop:6 }}>{'池唤醒读书时会自动同步感想到这里'}</p>
              </div>
            ) : (
              Object.entries(journal.books).map(([title, data]) => (
                <div key={title} onClick={() => setJournalView(title)} style={{ cursor:'pointer', background:'#fff', borderRadius:12, padding:'14px 16px', marginBottom:10, border:'1px solid #f4e0e6', display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:36, height:36, borderRadius:8, background:'#fce8ee', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><span style={{ fontSize:13, color:'#d4889a', fontWeight:700 }}>{title.charAt(0)}</span></div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:600, color:'#6a3a4a' }}>{title}</div>
                    <div style={{ fontSize:11, color:'#b8909e', marginTop:2 }}>{(data.entries?.length || 0) + ' 篇'}</div>
                  </div>
                  <div style={{ fontSize:14, color:'#dcc0ca' }}>{'>'}</div>
                </div>
              ))
            )
          ) : (
            /* 时间线 */
            (() => {
              const bookData = journal.books?.[journalView]
              const entries = [...(bookData?.entries || [])]
              if (!journalSortAsc) entries.reverse()
              if (entries.length === 0) return <div style={{ textAlign:'center', padding:40, color:'#c4a0b0' }}>{'暂无笔记'}</div>
              return (
                <div style={{ position:'relative', paddingLeft:20 }}>
                  {/* 时间线竖线 */}
                  <div style={{ position:'absolute', left:7, top:0, bottom:0, width:2, background:'linear-gradient(180deg, #f0c0d0, #e8d0da)', borderRadius:1 }} />
                  {entries.map((entry, ei) => {
                    const time = entry.time ? new Date(entry.time) : null
                    const timeStr = time ? `${String(time.getMonth()+1).padStart(2,'0')}.${String(time.getDate()).padStart(2,'0')}  ${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}` : ''
                    return (
                      <div key={entry.id || ei} style={{ position:'relative', marginBottom:20 }}>
                        {/* 时间线圆点 */}
                        <div style={{ position:'absolute', left:-17, top:6, width:8, height:8, borderRadius:4, background:'#e8a0b4', border:'2px solid #fff', boxShadow:'0 0 0 1px #f0d0da' }} />
                        {/* 时间 */}
                        <div style={{ fontSize:11, color:'#c0909e', marginBottom:6, fontFamily:'monospace', letterSpacing:0.5 }}>{timeStr}</div>
                        {/* 内容 */}
                        <div style={{ background:'#fff', borderRadius:10, padding:'12px 14px', border:'1px solid #f4e4ea' }}>
                          <div style={{ fontSize:13, color:'#5a3a4a', lineHeight:1.75, whiteSpace:'pre-wrap' }}>{entry.content}</div>

                          {/* 用户笔记 */}
                          {(entry.user_notes || []).map((un, ni) => (
                            <div key={ni} style={{ background:'#fef4f6', borderLeft:'2px solid #e8a0b4', padding:'6px 10px', margin:'8px 0 0', borderRadius:'0 6px 6px 0', display:'flex', alignItems:'flex-start', gap:6 }}>
                              <div style={{ flex:1 }}>
                                <div style={{ fontSize:10, color:'#c4889a', fontWeight:600, marginBottom:2 }}>{'my note'}</div>
                                <div style={{ fontSize:12, color:'#6a4a5a' }}>{un.text}</div>
                              </div>
                              <button onClick={async () => {
                                await fetch('/api/reader?action=journal_delete_user_note', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ book_title: journalView, entry_id: entry.id, note_index: ni }) })
                                await loadJournal()
                              }} style={{ background:'none', border:'none', color:'#dcc0ca', fontSize:12, cursor:'pointer', padding:2, flexShrink:0 }}>{'x'}</button>
                            </div>
                          ))}

                          {/* 添加笔记 */}
                          <div style={{ display:'flex', gap:6, marginTop:8 }}>
                            <input value={journalNoteInput[entry.id] || ''} onChange={e => setJournalNoteInput(p => ({...p, [entry.id]: e.target.value}))} placeholder="写点什么..." style={{ flex:1, border:'1px solid #f0e0e6', borderRadius:6, padding:'5px 8px', fontSize:11, outline:'none', background:'#fefafa', color:'#6a4a5a' }} onKeyDown={async e => {
                              if (e.key === 'Enter' && journalNoteInput[entry.id]?.trim()) {
                                await fetch('/api/reader?action=journal_user_note', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ book_title: journalView, entry_id: entry.id, note: journalNoteInput[entry.id].trim() }) })
                                setJournalNoteInput(p => ({...p, [entry.id]: ''}))
                                await loadJournal()
                              }
                            }} />
                            <button onClick={async () => {
                              if (!journalNoteInput[entry.id]?.trim()) return
                              await fetch('/api/reader?action=journal_user_note', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ book_title: journalView, entry_id: entry.id, note: journalNoteInput[entry.id].trim() }) })
                              setJournalNoteInput(p => ({...p, [entry.id]: ''}))
                              await loadJournal()
                            }} style={{ background:'#e8a0b4', color:'#fff', border:'none', borderRadius:6, padding:'5px 10px', fontSize:11, cursor:'pointer', flexShrink:0 }}>{'+'}</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()
          )}
        </div>
      </>)}
    </div>
  )
}
