import { useState, useEffect, useRef } from 'react'

const DATA_KEY = 'pool_reader_books'
const TOGETHER_KEY = 'pool_reader_together'

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

export default function ReaderApp() {
  const [books, setBooks] = useState([])
  const [together, setTogether] = useState('')
  const [aiProgress, setAiProgress] = useState(0)
  const [aiNotes, setAiNotes] = useState(null)
  const [view, setView] = useState('shelf') // shelf | import | reader
  const [currentBookIdx, setCurrentBookIdx] = useState(-1)
  const [currentChapter, setCurrentChapter] = useState(0)
  const fileRef = useRef(null)

  useEffect(() => {
    try { const raw = localStorage.getItem(DATA_KEY); if (raw) setBooks(JSON.parse(raw)) } catch {}
    try { setTogether(localStorage.getItem(TOGETHER_KEY) || '') } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(books)) } catch {}
    try { localStorage.setItem(TOGETHER_KEY, together) } catch {}
  }, [books, together])

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      if (text.indexOf('\ufffd') > -1) {
        const reader2 = new FileReader()
        reader2.onload = (e2) => importText(file.name, e2.target.result)
        reader2.readAsText(file, 'GBK')
      } else { importText(file.name, text) }
    }
    reader.readAsText(file, 'UTF-8')
  }

  function importText(filename, text) {
    const title = filename.replace(/\.txt$/i, '')
    const chapters = splitChapters(text)
    const id = Math.random().toString(36).substr(2, 8)
    setBooks(prev => [...prev, { id, title, chapters, lastChapter: 0 }])
    setView('shelf')
  }

  function openBook(idx) {
    setCurrentBookIdx(idx)
    setCurrentChapter(books[idx].lastChapter || 0)
    setView('reader')
  }

  function backToShelf() {
    if (currentBookIdx >= 0) {
      setBooks(prev => { const next = [...prev]; next[currentBookIdx] = { ...next[currentBookIdx], lastChapter: currentChapter }; return next })
    }
    setCurrentBookIdx(-1)
    setView('shelf')
  }

  function delBook(idx) {
    setBooks(prev => prev.filter((_, i) => i !== idx))
  }

  const book = currentBookIdx >= 0 ? books[currentBookIdx] : null
  const chapter = book ? book.chapters[currentChapter] : null

  return (
    <div style={{ fontFamily: '-apple-system, sans-serif', background: '#f8f4f0', color: '#333', padding: '12px', fontSize: '15px', height: '100%', overflowY: 'auto' }}>
      {/* Shelf */}
      {view === 'shelf' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
            <h2 style={{ flex: 1, fontSize: '18px', margin: 0 }}>书架</h2>
            <button onClick={() => setView('import')} style={{ display: 'inline-block', background: '#1976d2', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' }}>+ 导入TXT</button>
          </div>
          {books.length === 0 ? (
            <p style={{ color: '#999', textAlign: 'center', padding: '40px' }}>还没有书，点右上角导入</p>
          ) : books.map((b, i) => (
            <div key={b.id} onClick={() => openBook(i)} style={{ background: '#fff', borderRadius: '12px', padding: '14px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,.08)', cursor: 'pointer', position: 'relative' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>{b.title}</div>
              <div style={{ fontSize: '12px', color: '#888' }}>{b.chapters?.length || 0}章 · 读到第{(b.lastChapter || 0) + 1}章</div>
              {together && b.id === together && (
                <div style={{ display: 'inline-block', background: '#fff3e0', color: '#e65100', fontSize: '11px', padding: '2px 8px', borderRadius: '10px', marginTop: '4px' }}>
                  👀 池在看{aiProgress > 0 ? `（读到第${aiProgress + 1}章）` : ''}
                </div>
              )}
              <button onClick={(e) => { e.stopPropagation(); delBook(i) }} style={{ position: 'absolute', top: '14px', right: '14px', background: '#e53935', color: '#fff', border: 'none', padding: '4px 12px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>删</button>
            </div>
          ))}
        </>
      )}

      {/* Import */}
      {view === 'import' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
            <button onClick={() => setView('shelf')} style={{ background: 'none', border: 'none', fontSize: '20px', padding: '8px', cursor: 'pointer' }}>←</button>
            <h2 style={{ flex: 1, fontSize: '18px', margin: 0 }}>导入书籍</h2>
          </div>
          <div style={{ border: '2px dashed #ccc', borderRadius: '12px', padding: '30px', textAlign: 'center', margin: '16px 0' }}>
            <p>选择 .txt 文件</p>
            <input type="file" accept=".txt" onChange={handleFile} ref={fileRef} />
          </div>
        </>
      )}

      {/* Reader */}
      {view === 'reader' && chapter && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
            <button onClick={backToShelf} style={{ background: 'none', border: 'none', fontSize: '20px', padding: '8px', cursor: 'pointer' }}>←</button>
            <h2 style={{ flex: 1, fontSize: '18px', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chapter.title || `第${currentChapter + 1}章`}</h2>
          </div>
          <div style={{ lineHeight: 1.8, padding: '8px 4px', fontSize: '16px' }} dangerouslySetInnerHTML={{ __html: '<p>' + escHtml(chapter.content).replace(/\n/g, '</p><p>') + '</p>' }} />
          {aiNotes && together && book.id === together && (
            (() => {
              const notes = aiNotes.filter(n => n.chapter === currentChapter)
              if (notes.length === 0) return null
              return (
                <div style={{ background: '#e8f5e9', borderLeft: '3px solid #4caf50', padding: '10px 12px', marginTop: '12px', borderRadius: '0 8px 8px 0' }}>
                  <h4 style={{ color: '#2e7d32', fontSize: '13px', marginBottom: '6px' }}>📝 池的批注</h4>
                  {notes.map((n, i) => <p key={i} style={{ fontSize: '13px', color: '#333', marginBottom: '4px' }}>{n.text}</p>)}
                </div>
              )
            })()
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
            <button onClick={() => { if (currentChapter > 0) setCurrentChapter(c => c - 1) }} style={{ background: '#e3f2fd', border: 'none', padding: '8px 14px', borderRadius: '8px', color: '#1565c0', fontSize: '13px', cursor: 'pointer' }}>← 上一章</button>
            <span style={{ fontSize: '12px', color: '#999', alignSelf: 'center' }}>{currentChapter + 1}/{book.chapters.length}</span>
            <button onClick={() => { if (currentChapter < book.chapters.length - 1) setCurrentChapter(c => c + 1) }} style={{ background: '#e3f2fd', border: 'none', padding: '8px 14px', borderRadius: '8px', color: '#1565c0', fontSize: '13px', cursor: 'pointer' }}>下一章 →</button>
          </div>
        </>
      )}
    </div>
  )
}