import { useState, useEffect, useRef } from 'react'

// ===== 便签App =====
export function NotesApp() {
  const [notes, setNotes] = useState([])
  const [editing, setEditing] = useState(null)
  const [input, setInput] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('pool_notes')
    if (saved) setNotes(JSON.parse(saved))
  }, [])

  function save(newNotes) { setNotes(newNotes); localStorage.setItem('pool_notes', JSON.stringify(newNotes)) }

  function addNote() {
    if (!input.trim()) return
    save([{ id: Date.now(), text: input.trim(), time: new Date().toLocaleString('zh-CN') }, ...notes])
    setInput('')
  }

  function deleteNote(id) { save(notes.filter(n => n.id !== id)) }

  function startEdit(note) { setEditing(note.id); setInput(note.text) }

  function saveEdit() {
    save(notes.map(n => n.id === editing ? { ...n, text: input.trim() } : n))
    setEditing(null); setInput('')
  }

  return (
    <div className="app-full">
      <div className="notes-input-area">
        <input className="notes-input" value={input} onChange={e => setInput(e.target.value)}
          placeholder={editing ? '\u7f16\u8f91\u4fbf\u7b7e...' : '\u5199\u70b9\u4ec0\u4e48...'}
          onKeyDown={e => { if (e.key === 'Enter') { editing ? saveEdit() : addNote() } }} />
        <button className="notes-btn" onClick={editing ? saveEdit : addNote}>
          {editing ? '\u2713' : '+'}
        </button>
      </div>
      <div className="notes-list">
        {notes.length === 0 && <div className="notes-empty">{'\u8fd8\u6ca1\u6709\u4fbf\u7b7e\uff0c\u5199\u4e00\u6761\u5427'}</div>}
        {notes.map(note => (
          <div key={note.id} className="note-item">
            <div className="note-text">{note.text}</div>
            <div className="note-meta">
              <span className="note-time">{note.time}</span>
              <span className="note-actions">
                <button className="note-action" onClick={() => startEdit(note)}>{'\u270f\ufe0f'}</button>
                <button className="note-action" onClick={() => deleteNote(note.id)}>{'\u2716'}</button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ===== 钓鱼App =====
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
  const [state, setState] = useState('idle') // idle, casting, waiting, caught
  const [score, setScore] = useState(0)
  const [catches, setCatches] = useState([])
  const [lastCatch, setLastCatch] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    const saved = localStorage.getItem('pool_fishing')
    if (saved) {
      const d = JSON.parse(saved)
      setScore(d.score || 0)
      setCatches(d.catches || [])
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  function saveData(s, c) {
    localStorage.setItem('pool_fishing', JSON.stringify({ score: s, catches: c }))
  }

  function cast() {
    setState('casting')
    setLastCatch(null)
    const waitTime = 2000 + Math.random() * 4000
    timerRef.current = setTimeout(() => { setState('waiting') }, waitTime)
  }

  function reel() {
    if (state !== 'waiting') { setState('idle'); return }
    // Random fish
    const rand = Math.random()
    let fish
    if (rand < 0.03) fish = FISH_POOL[Math.floor(8 + Math.random() * 2)] // SSR
    else if (rand < 0.15) fish = FISH_POOL[Math.floor(6 + Math.random() * 2)] // SR
    else if (rand < 0.45) fish = FISH_POOL[Math.floor(3 + Math.random() * 3)] // R
    else fish = FISH_POOL[Math.floor(Math.random() * 3)] // N
    const w = (fish.weight[0] + Math.random() * (fish.weight[1] - fish.weight[0])).toFixed(1)
    const caught = { ...fish, actualWeight: w, time: new Date().toLocaleTimeString('zh-CN') }
    const newScore = score + fish.score
    const newCatches = [caught, ...catches].slice(0, 20)
    setScore(newScore)
    setCatches(newCatches)
    setLastCatch(caught)
    setState('caught')
    saveData(newScore, newCatches)
    setTimeout(() => setState('idle'), 3000)
  }

  const rarityColor = { N: '#aaa', R: '#5dade2', SR: '#af7ac5', SSR: '#f4d03f' }

  return (
    <div className="app-full">
      <div className="fish-score">{'\ud83c\udfa3'} {'\u79ef\u5206: '}{score}</div>
      <div className="fish-pond">
        {state === 'idle' && <button className="fish-btn cast" onClick={cast}>{'\ud83c\udfa3 \u629b\u7aff'}</button>}
        {state === 'casting' && <div className="fish-status">{'\u7b49\u5f85\u9c7c\u4e0a\u94a9...'}</div>}
        {state === 'waiting' && <button className="fish-btn reel" onClick={reel}>{'\u2757 \u6709\u9c7c\u54ac\u94a9\uff01\u6536\u7aff\uff01'}</button>}
        {state === 'caught' && lastCatch && (
          <div className="fish-result">
            <div className="fish-caught-name" style={{color: rarityColor[lastCatch.rarity]}}>
              [{lastCatch.rarity}] {lastCatch.name}
            </div>
            <div className="fish-caught-detail">{lastCatch.actualWeight}kg | +{lastCatch.score}{'\u5206'}</div>
          </div>
        )}
      </div>
      <div className="fish-log-title">{'\ud83d\udcdc \u6700\u8fd1\u9c7c\u83b7'}</div>
      <div className="fish-log">
        {catches.length === 0 && <div className="fish-empty">{'\u8fd8\u6ca1\u6709\u9493\u5230\u9c7c\uff0c\u629b\u7aff\u8bd5\u8bd5\uff01'}</div>}
        {catches.map((c, i) => (
          <div key={i} className="fish-log-item">
            <span style={{color: rarityColor[c.rarity]}}>[{c.rarity}] {c.name}</span>
            <span className="fish-log-weight">{c.actualWeight}kg</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ===== 音乐App =====
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

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      setProgress(p => { if (p >= 100) { next(); return 0 } return p + 0.5 })
    }, 1000)
    return () => clearInterval(t)
  }, [playing, current])

  function next() { setCurrent(c => (c + 1) % PLAYLIST.length); setProgress(0) }
  function prev() { setCurrent(c => (c - 1 + PLAYLIST.length) % PLAYLIST.length); setProgress(0) }

  const song = PLAYLIST[current]

  return (
    <div className="app-full music-app">
      <div className="music-cover">
        <div className="music-disc" style={{ animationPlayState: playing ? 'running' : 'paused' }}>{'\ud83c\udfb5'}</div>
      </div>
      <div className="music-now-title">{song.title}</div>
      <div className="music-now-artist">{song.artist}</div>
      <div className="music-progress-bar">
        <div className="music-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="music-controls">
        <button className="music-ctrl" onClick={prev}>{'\u23ee'}</button>
        <button className="music-ctrl play" onClick={() => setPlaying(!playing)}>
          {playing ? '\u23f8' : '\u25b6'}
        </button>
        <button className="music-ctrl" onClick={next}>{'\u23ed'}</button>
      </div>
      <div className="music-playlist-title">{'\ud83c\udfb6 \u6b4c\u5355'}</div>
      <div className="music-playlist">
        {PLAYLIST.map((s, i) => (
          <div key={i} className={`music-pl-item ${i === current ? 'active' : ''}`}
            onClick={() => { setCurrent(i); setProgress(0) }}>
            <span>{i === current ? '\u25b6 ' : ''}{s.title}</span>
            <span className="music-pl-artist">{s.artist}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
