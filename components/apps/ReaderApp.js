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
      setCurrentChapter(state.currentBookId === books[idx].id ? (state.userChapter || 0) : 0)
      setCurrentPage(state.currentBookId === books[idx].id ? (state.userPage || 0) : 0)
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

  function backToShelf() { setCurrentBookIdx(-1); setView('shelf'); loadState(); loadBooks() }
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
            const recentBooks = books
              .map((b, idx) => ({ b, idx, lastRead: state.currentBookId === b.id ? (state.lastRead || 0) : (b.lastOpenedAt || b.importedAt || 0) }))
              .sort((a, c) => c.lastRead - a.lastRead)
              .filter(x => x.lastRead > 0)
              .slice(0, 3);
            // All books go to spine rows
            const spineBooks = books;
            const spineRows = [];
            for (let i = 0; i < spineBooks.length; i += 6) spineRows.push(spineBooks.slice(i, i + 6));
            const rotations = [-8, 0, 5];
            const offsets = [12, 0, -8];
            const zIndexes = [2, 3, 1];
            return (<>
              {/* Featured row: recently viewed books (stacked/angled covers) */}
              {recentBooks.length > 0 && (
              <div style={{ marginBottom:0 }}>
                <div style={{ padding:'4px 20px 0', fontSize:11, color:'#b08090', fontWeight:500 }}>{'最近在读'}</div>
                <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'center', padding:'12px 20px 10px', minHeight:180, position:'relative' }}>
                  {recentBooks.map((item, bi) => {
                    const b = item.b;
                    const realIdx = item.idx;
                    const color = shelfColors[realIdx % shelfColors.length];
                    const aiReading = state.currentBookId === b.id && state.active;
                    const userCh = state.currentBookId === b.id ? (state.userChapter || 0) : 0;
                    const progress = b.chapters?.length ? Math.round(((userCh + 1) / b.chapters.length) * 100) : 0;
                    const rot = rotations[bi] || 0;
                    const offsetY = offsets[bi] || 0;
                    const zIdx = zIndexes[bi] || 1;
                    return (
                      <div key={b.id} onClick={() => openBook(realIdx)} style={{ cursor:'pointer', position:'relative', zIndex:zIdx, marginLeft: bi === 0 ? 0 : -20, marginBottom:offsetY, transform:'rotate('+rot+'deg)', transformOrigin:'bottom center', transition:'transform 0.2s' }}>
                        <div style={{ width:105, height:140, borderRadius:'4px 10px 10px 4px', background: 'linear-gradient(145deg, ' + color + ' 0%, ' + color + 'aa 50%, ' + color + '66 100%)', boxShadow:'3px 4px 12px rgba(0,0,0,.2), inset -4px 0 8px rgba(0,0,0,.06)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:10, position:'relative', border:'1px solid rgba(255,255,255,.5)' }}>
                          <div style={{ position:'absolute', left:5, top:0, bottom:0, width:3, background:'rgba(0,0,0,.08)', borderRadius:2 }} />
                          <div style={{ position:'absolute', left:10, top:8, right:8, bottom:8, border:'1px solid rgba(255,255,255,.3)', borderRadius:4, pointerEvents:'none' }} />
                          <div style={{ fontSize:14, fontWeight:700, color:'#4a3040', textAlign:'center', lineHeight:1.3, wordBreak:'break-all', maxHeight:56, overflow:'hidden' }}>{b.title.length > 8 ? b.title.slice(0,8)+'...' : b.title}</div>
                          <div style={{ fontSize:9, color:'#7a6070', marginTop:8 }}>{(b.chapters?.length || 0) + '章'}</div>
                          {aiReading && <div style={{ fontSize:8, color:'#c2185b', marginTop:2 }}>{'👀 池在读'}</div>}
                        </div>
                        <div style={{ height:2, margin:'2px 10px 0', background:'#e0d0d0', borderRadius:2, overflow:'hidden' }}><div style={{ height:'100%', width:progress+'%', background:'#e91e8c', borderRadius:2 }} /></div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ height:8, background:'linear-gradient(180deg, #c9a88c 0%, #b8957a 40%, #a68060 100%)', borderRadius:'0 0 3px 3px', boxShadow:'0 3px 6px rgba(0,0,0,.18)', margin:'0 10px' }} />
                <div style={{ height:5, background:'linear-gradient(180deg, rgba(0,0,0,.06) 0%, transparent 100%)', margin:'0 14px' }} />
              </div>
              )}
              {/* Spine rows: all books */}
              {spineRows.map((row, ri) => (
                <div key={ri} style={{ marginBottom:0 }}>
                  <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'flex-start', padding:'14px 16px 6px', minHeight:100, gap:0 }}>
                    {row.map((b, bi) => {
                      const globalIdx = ri * 6 + bi;
                      const color = shelfColors[globalIdx % shelfColors.length];
                      const aiReading = state.currentBookId === b.id && state.active;
                      const spineW = 30 + Math.min((b.chapters?.length || 5), 40) * 0.6;
                      const spineH = 78 + (bi % 3) * 4;
                      const tilt = bi % 3 === 1 ? -3 : bi % 3 === 2 ? 4 : 0;
                      return (
                        <div key={b.id} onClick={() => openBook(globalIdx)} style={{ cursor:'pointer', position:'relative', marginRight:1, transform: tilt ? 'rotate('+tilt+'deg)' : 'none', transformOrigin:'bottom center' }}>
                          <div style={{ width:spineW, height:spineH, borderRadius:'2px 4px 4px 2px', background: 'linear-gradient(180deg, ' + color + ' 0%, ' + color + 'bb 100%)', boxShadow:'1px 2px 5px rgba(0,0,0,.12), inset -2px 0 4px rgba(0,0,0,.05)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'4px 2px', border:'1px solid rgba(0,0,0,.05)', position:'relative' }}>
                            <div style={{ position:'absolute', left:3, top:6, bottom:6, width:2, background:'rgba(255,255,255,.35)', borderRadius:1 }} />
                            <div style={{ position:'absolute', top:5, left:6, right:6, height:1, background:'rgba(255,255,255,.25)' }} />
                            <div style={{ position:'absolute', bottom:5, left:6, right:6, height:1, background:'rgba(255,255,255,.25)' }} />
                            <div style={{ writingMode:'vertical-rl', fontSize:10, fontWeight:600, color:'#4a3040', letterSpacing:1, maxHeight:60, overflow:'hidden', textOverflow:'ellipsis' }}>{b.title.length > 6 ? b.title.slice(0,6)+'\u2026' : b.title}</div>
                          </div>
                          {aiReading && <div style={{ position:'absolute', top:-4, right:-4, width:10, height:10, borderRadius:5, background:'#e91e8c', border:'1.5px solid #fff' }} />}
                          <button onClick={(e) => { e.stopPropagation(); delBook(globalIdx) }} style={{ position:'absolute', top:-5, right:-5, background:'#f06292', color:'#fff', border:'none', width:16, height:16, borderRadius:8, fontSize:9, cursor:'pointer', lineHeight:'16px', textAlign:'center', zIndex:2 }}>{'\u00d7'}</button>
                        </div>
                      );
                    })}
                    {row.length < 6 && <div style={{ flex:1 }} />}
                  </div>
                  <div style={{ height:7, background:'linear-gradient(180deg, #c9a88c 0%, #b8957a 40%, #a68060 100%)', borderRadius:'0 0 2px 2px', boxShadow:'0 2px 5px rgba(0,0,0,.15)', margin:'0 10px' }} />
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
          {chapterNotes.filter(n => !n.quote || pageContent.includes(n.quote.slice(0, 30))).map((n, i) => (
            <div key={n.id || i} style={{ background:'#fff0f3', borderLeft:'3px solid #66bb6a', padding:'8px 12px', margin:'0 0 10px', borderRadius:'0 8px 8px 0' }}>
              <div style={{ fontSize:12, color:'#c2185b', fontWeight:600, marginBottom:3 }}>📝 池的批注</div>
              {n.quote && <div style={{ fontSize:12, color:'#777', fontStyle:'italic', marginBottom:4 }}>「{n.quote}」</div>}
              <p style={{ fontSize:13, color:'#444', margin:0 }}>{n.text}</p>
            </div>
          ))}

          <div style={{ lineHeight:1.85, fontSize:15, color:'#2c2c2c', minHeight:'60%' }} dangerouslySetInnerHTML={{ __html: '<p>' + escHtml(pageContent).split('\n').join( '</p><p>') + '</p>' }} />

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
    </div>
  )
}
