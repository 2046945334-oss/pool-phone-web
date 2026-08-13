import { useState, useEffect, useRef, useCallback } from 'react'

// ===== Notes App (free canvas style) =====
const PAPERS = ['/notes_assets/paper1.png','/notes_assets/paper2.png','/notes_assets/paper6.png','/notes_assets/paper7.png','/notes_assets/paper8.png','/notes_assets/paper9.png']
const STICKERS = ['/notes_assets/sticker_wings.png','/notes_assets/sticker_star.png','/notes_assets/sticker_heart.png']
const EMOJIS = ['\ud83c\udf38','\ud83d\udc95','\u2b50','\ud83c\udf80','\ud83d\udc31','\ud83c\udf19','\u2728','\ud83c\udf53','\ud83e\udd8b','\u2601\ufe0f','\ud83c\udf08','\ud83d\udcab','\ud83c\udfb5','\ud83d\udc3e','\ud83d\udc8c','\ud83c\udf70']

function uid(){return Date.now()+'_'+Math.random().toString(36).slice(2,7)}

export function NotesApp() {
  const [state, setState] = useState({pages:[[]], currentPage:0})
  const [modal, setModal] = useState(null) // 'note'|'sticker'|'emoji'|'edit'
  const [noteText, setNoteText] = useState('')
  const [selPaper, setSelPaper] = useState(0)
  const [editId, setEditId] = useState(null)
  const wallRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    const saved = localStorage.getItem('pool_notes_web_v1')
    if (saved) { try { setState(JSON.parse(saved)) } catch(e){} }
  }, [])

  function save(s) { setState(s); localStorage.setItem('pool_notes_web_v1', JSON.stringify(s)) }

  function curNotes() { return state.pages[state.currentPage] || [] }
  function setCurNotes(items) {
    const newPages = [...state.pages]
    newPages[state.currentPage] = items
    save({...state, pages: newPages})
  }

  function prevPage() { if (state.currentPage > 0) save({...state, currentPage: state.currentPage - 1}) }
  function nextPage() {
    const newPages = [...state.pages]
    if (state.currentPage >= newPages.length - 1) newPages.push([])
    save({pages: newPages, currentPage: state.currentPage + 1})
  }

  function addNote() {
    if (!noteText.trim()) { setModal(null); return }
    const items = [...curNotes()]
    items.push({ id: uid(), type:'note', text: noteText.trim(), paper: selPaper, x: 20+Math.random()*120, y: 30+Math.random()*200, rot: (Math.random()-0.5)*10 })
    setCurNotes(items)
    setNoteText(''); setModal(null)
  }

  function addSticker(src) {
    const items = [...curNotes()]
    items.push({ id: uid(), type:'sticker', src, x: 60+Math.random()*100, y: 80+Math.random()*150, w:55, h:55, rot:0 })
    setCurNotes(items)
    setModal(null)
  }

  function addEmoji(em) {
    const items = [...curNotes()]
    items.push({ id: uid(), type:'emoji', content: em, x: 50+Math.random()*120, y: 60+Math.random()*180, w:40, h:40, rot:(Math.random()-0.5)*20 })
    setCurNotes(items)
    setModal(null)
  }

  function deleteItem(id) {
    setCurNotes(curNotes().filter(n => n.id !== id))
    setModal(null); setEditId(null)
  }

  function saveEditText(newText) {
    const items = curNotes().map(n => n.id === editId ? {...n, text: newText} : n)
    setCurNotes(items)
    setModal(null); setEditId(null)
  }

  // Touch drag
  function handleTouchStart(e, item) {
    const t = e.touches[0]
    dragRef.current = { id: item.id, startX: t.clientX, startY: t.clientY, origX: item.x, origY: item.y, moved: false }
  }

  function handleTouchMove(e) {
    if (!dragRef.current) return
    e.preventDefault()
    const t = e.touches[0]
    const dx = t.clientX - dragRef.current.startX
    const dy = t.clientY - dragRef.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true
    if (dragRef.current.moved) {
      const items = curNotes().map(n => n.id === dragRef.current.id ? {...n, x: dragRef.current.origX + dx, y: dragRef.current.origY + dy} : n)
      const newPages = [...state.pages]
      newPages[state.currentPage] = items
      setState({...state, pages: newPages})
    }
  }

  function handleTouchEnd() {
    if (dragRef.current && dragRef.current.moved) {
      localStorage.setItem('pool_notes_web_v1', JSON.stringify(state))
    }
    if (dragRef.current && !dragRef.current.moved) {
      const item = curNotes().find(n => n.id === dragRef.current.id)
      if (item && item.type === 'note') { setEditId(item.id); setNoteText(item.text); setModal('edit') }
    }
    dragRef.current = null
  }

  return (
    <div className="notes-canvas" onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="notes-wall" ref={wallRef}>
        {curNotes().map(item => {
          if (item.type === 'note') {
            return (
              <div key={item.id} className="free-note" style={{
                left: item.x, top: item.y, transform: `rotate(${item.rot||0}deg)`,
                backgroundImage: `url(${PAPERS[item.paper]||PAPERS[0]})`,
              }} onTouchStart={e => handleTouchStart(e, item)}>
                <span className="free-note-text">{item.text}</span>
              </div>
            )
          }
          if (item.type === 'sticker') {
            return (
              <div key={item.id} className="free-deco" style={{
                left: item.x, top: item.y, width: item.w, height: item.h, transform: `rotate(${item.rot||0}deg)`
              }} onTouchStart={e => handleTouchStart(e, item)}>
                <img src={item.src} alt="" draggable={false} />
              </div>
            )
          }
          if (item.type === 'emoji') {
            return (
              <div key={item.id} className="free-deco emoji-deco" style={{
                left: item.x, top: item.y, width: item.w, height: item.h, transform: `rotate(${item.rot||0}deg)`,
                fontSize: (item.w||40)*0.7
              }} onTouchStart={e => handleTouchStart(e, item)}>
                {item.content}
              </div>
            )
          }
          return null
        })}
      </div>

      {/* Toolbar */}
      <div className="notes-toolbar">
        <button className="nt-btn" onClick={prevPage}>{'\u25c0'}</button>
        <span className="nt-page">{state.currentPage+1}/{state.pages.length}</span>
        <button className="nt-btn" onClick={nextPage}>{'\u25b6'}</button>
        <div className="nt-sep"/>
        <button className="nt-btn" onClick={()=>{setNoteText('');setModal('note')}}>{'\ud83d\udcdd'}</button>
        <button className="nt-btn" onClick={()=>setModal('sticker')}>{'\ud83c\udfa8'}</button>
        <button className="nt-btn" onClick={()=>setModal('emoji')}>{'\ud83d\ude0a'}</button>
      </div>

      {/* Note Modal */}
      {modal==='note' && (
        <div className="notes-modal-bg" onClick={()=>setModal(null)}>
          <div className="notes-modal" onClick={e=>e.stopPropagation()}>
            <h3>{'\u5199\u4fbf\u7b7e'}</h3>
            <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder={'\u5199\u70b9\u4ec0\u4e48...'} className="nm-textarea"/>
            <div className="nm-papers">
              {PAPERS.map((p,i) => (
                <img key={i} src={p} className={`nm-paper ${i===selPaper?'sel':''}`} onClick={()=>setSelPaper(i)} alt=""/>
              ))}
            </div>
            <div className="nm-btns">
              <button className="nm-cancel" onClick={()=>setModal(null)}>{'\u53d6\u6d88'}</button>
              <button className="nm-ok" onClick={addNote}>{'\u8d34\u4e0a\u53bb'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {modal==='edit' && (
        <div className="notes-modal-bg" onClick={()=>{setModal(null);setEditId(null)}}>
          <div className="notes-modal" onClick={e=>e.stopPropagation()}>
            <h3>{'\u7f16\u8f91\u4fbf\u7b7e'}</h3>
            <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} className="nm-textarea"/>
            <div className="nm-btns">
              <button className="nm-del" onClick={()=>deleteItem(editId)}>{'\ud83d\uddd1 \u5220\u9664'}</button>
              <button className="nm-ok" onClick={()=>saveEditText(noteText)}>{'\u4fdd\u5b58'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Sticker Modal */}
      {modal==='sticker' && (
        <div className="notes-modal-bg" onClick={()=>setModal(null)}>
          <div className="notes-modal" onClick={e=>e.stopPropagation()}>
            <h3>{'\u9009\u8d34\u7eb8'}</h3>
            <div className="nm-sticker-grid">
              {STICKERS.map((s,i) => (
                <div key={i} className="nm-sticker-item" onClick={()=>addSticker(s)}>
                  <img src={s} alt="" />
                </div>
              ))}
            </div>
            <div className="nm-btns"><button className="nm-cancel" onClick={()=>setModal(null)}>{'\u5173\u95ed'}</button></div>
          </div>
        </div>
      )}

      {/* Emoji Modal */}
      {modal==='emoji' && (
        <div className="notes-modal-bg" onClick={()=>setModal(null)}>
          <div className="notes-modal" onClick={e=>e.stopPropagation()}>
            <h3>{'\u9009Emoji'}</h3>
            <div className="nm-sticker-grid emoji-grid">
              {EMOJIS.map((em,i) => (
                <div key={i} className="nm-sticker-item emoji-item" onClick={()=>addEmoji(em)}>{em}</div>
              ))}
            </div>
            <div className="nm-btns"><button className="nm-cancel" onClick={()=>setModal(null)}>{'\u5173\u95ed'}</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

// ===== Fishing App =====
const FISH_POOL = [
  { name: '\u9ca4\u9c7c', weight: [0.5, 3], score: 5, rarity: 'N' },
  { name: '\u9ca9\u9c7c', weight: [0.3, 2], score: 4, rarity: 'N' },
  { name: '\u9c88\u9c7c', weight: [0.2, 1.5], score: 3, rarity: 'N' },
  { name: '\u8349\u9c7c', weight: [1, 5], score: 8, rarity: 'R' },
  { name: '\u9ec4\u82b1\u9c7c', weight: [0.5, 4], score: 10, rarity: 'R' },
  { name: '\u77f3\u6591\u9c7c', weight: [2, 8], score: 15, rarity: 'R' },
  { name: '\u91d1\u67aa\u9c7c', weight: [5, 15], score: 25, rarity: 'SR' },
  { name: '\u5927\u9ec4\u9c7c', weight: [3, 12], score: 30, rarity: 'SR' },
  { name: '\u6d77\u9f9f', weight: [10, 50], score: 60, rarity: 'SSR' },
  { name: '\u9cb8\u9c7c', weight: [100, 500], score: 100, rarity: 'SSR' },
]

export function FishingApp() {
  const [gameState, setGameState] = useState('idle')
  const [score, setScore] = useState(0)
  const [catches, setCatches] = useState([])
  const [lastCatch, setLastCatch] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    const saved = localStorage.getItem('pool_fishing_web')
    if (saved) { try { const d = JSON.parse(saved); setScore(d.score||0); setCatches(d.catches||[]) } catch(e){} }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  function saveData(s, c) { localStorage.setItem('pool_fishing_web', JSON.stringify({ score: s, catches: c })) }

  function cast() {
    setGameState('casting'); setLastCatch(null)
    timerRef.current = setTimeout(() => setGameState('waiting'), 2000 + Math.random() * 4000)
  }

  function reel() {
    if (gameState !== 'waiting') { setGameState('idle'); return }
    const rand = Math.random()
    let fish
    if (rand < 0.03) fish = FISH_POOL[8 + Math.floor(Math.random()*2)]
    else if (rand < 0.15) fish = FISH_POOL[6 + Math.floor(Math.random()*2)]
    else if (rand < 0.45) fish = FISH_POOL[3 + Math.floor(Math.random()*3)]
    else fish = FISH_POOL[Math.floor(Math.random()*3)]
    const w = (fish.weight[0] + Math.random()*(fish.weight[1]-fish.weight[0])).toFixed(1)
    const caught = {...fish, actualWeight: w, time: new Date().toLocaleTimeString('zh-CN')}
    const ns = score + fish.score
    const nc = [caught, ...catches].slice(0,20)
    setScore(ns); setCatches(nc); setLastCatch(caught); setGameState('caught')
    saveData(ns, nc)
    setTimeout(() => setGameState('idle'), 3000)
  }

  const rc = { N:'#aaa', R:'#5dade2', SR:'#af7ac5', SSR:'#f4d03f' }

  return (
    <div className="app-full">
      <div className="fish-score">{'\ud83c\udfa3'} {'\u79ef\u5206: '}{score}</div>
      <div className="fish-pond">
        {gameState==='idle' && <button className="fish-btn cast" onClick={cast}>{'\ud83c\udfa3 \u629b\u7aff'}</button>}
        {gameState==='casting' && <div className="fish-status">{'\u7b49\u5f85\u9c7c\u4e0a\u94a9...'}</div>}
        {gameState==='waiting' && <button className="fish-btn reel" onClick={reel}>{'\u2757 \u6709\u9c7c\u54ac\u94a9\uff01\u6536\u7aff\uff01'}</button>}
        {gameState==='caught' && lastCatch && (
          <div className="fish-result">
            <div className="fish-caught-name" style={{color:rc[lastCatch.rarity]}}>[{lastCatch.rarity}] {lastCatch.name}</div>
            <div className="fish-caught-detail">{lastCatch.actualWeight}kg | +{lastCatch.score}{'\u5206'}</div>
          </div>
        )}
      </div>
      <div className="fish-log-title">{'\ud83d\udcdc \u6700\u8fd1\u9c7c\u83b7'}</div>
      <div className="fish-log">
        {catches.length===0 && <div className="fish-empty">{'\u8fd8\u6ca1\u6709\u9493\u5230\u9c7c\uff0c\u629b\u7aff\u8bd5\u8bd5\uff01'}</div>}
        {catches.map((c,i) => (
          <div key={i} className="fish-log-item">
            <span style={{color:rc[c.rarity]}}>[{c.rarity}] {c.name}</span>
            <span className="fish-log-weight">{c.actualWeight}kg</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ===== Music App =====
const PLAYLIST = [
  { title: 'Smoke Sprite', artist: 'So!YoON! feat. RM' },
  { title: '\u591c\u66f2', artist: '\u5468\u6770\u4f26' },
  { title: '\u597d\u4e0d\u5bb9\u6613', artist: '\u544a\u4e94\u4eba' },
  { title: '\u5bc2\u5bde\u7684\u5b63\u8282', artist: '\u9676\u55c6' },
]

export function MusicApp() {
  const [current, setCurrent] = useState(3)
  const [playing, setPlaying] = useState(true)
  const [progress, setProgress] = useState(42)

  function next() { setCurrent(c => (c+1)%PLAYLIST.length); setProgress(0) }
  function prev() { setCurrent(c => (c-1+PLAYLIST.length)%PLAYLIST.length); setProgress(0) }

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      setProgress(p => { if (p >= 100) { setCurrent(c => (c+1)%PLAYLIST.length); return 0 } return p + 0.5 })
    }, 1000)
    return () => clearInterval(t)
  }, [playing])

  const song = PLAYLIST[current]

  return (
    <div className="app-full music-app">
      <div className="music-cover">
        <div className="music-disc" style={{animationPlayState: playing?'running':'paused'}}>{'\ud83c\udfb5'}</div>
      </div>
      <div className="music-now-title">{song.title}</div>
      <div className="music-now-artist">{song.artist}</div>
      <div className="music-progress-bar"><div className="music-progress-fill" style={{width:`${progress}%`}}/></div>
      <div className="music-controls">
        <button className="music-ctrl" onClick={prev}>{'\u23ee'}</button>
        <button className="music-ctrl play" onClick={()=>setPlaying(!playing)}>{playing?'\u23f8':'\u25b6'}</button>
        <button className="music-ctrl" onClick={next}>{'\u23ed'}</button>
      </div>
      <div className="music-playlist-title">{'\ud83c\udfb6 \u6b4c\u5355'}</div>
      <div className="music-playlist">
        {PLAYLIST.map((s,i) => (
          <div key={i} className={`music-pl-item ${i===current?'active':''}`} onClick={()=>{setCurrent(i);setProgress(0)}}>
            <span>{i===current?'\u25b6 ':''}{s.title}</span>
            <span className="music-pl-artist">{s.artist}</span>
          </div>
        ))}
      </div>
    </div>
  )
}