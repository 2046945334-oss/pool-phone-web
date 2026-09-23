import { useState, useCallback, useRef } from 'react'

// Memory Match (翻牌配对)
// 4x4 grid = 8 pairs. Two players take turns flipping 2 cards.
// If they match, that player scores and goes again. Otherwise, cards flip back and turn passes.

const SYMBOLS = ['♥','♦','♣','♠','★','●','▲','■']

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

function initBoard() {
  return shuffle([...SYMBOLS, ...SYMBOLS])
}

export default function MemoryMatchApp({ mini = false, onBack, onMinimize }) {
  const [phase, setPhase] = useState('menu') // 'menu' | 'play' | 'result'
  const [board, setBoard] = useState([])
  const [revealed, setRevealed] = useState([])  // indices currently flipped
  const [matched, setMatched] = useState([])    // indices of matched cards
  const [turn, setTurn] = useState('user')      // 'user' | 'ai'
  const [scores, setScores] = useState({ user: 0, ai: 0 })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const aiMemory = useRef({})  // AI remembers seen cards: { symbol: [indices] }
  const [stats, setStats] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('pool_memory_stats') || '{}') } catch { return {} }
    }
    return {}
  })

  const saveStats = useCallback((s) => {
    setStats(s)
    try { localStorage.setItem('pool_memory_stats', JSON.stringify(s)) } catch {}
  }, [])

  const startGame = () => {
    const b = initBoard()
    setBoard(b)
    setRevealed([])
    setMatched([])
    setTurn('user')
    setScores({ user: 0, ai: 0 })
    setBusy(false)
    setMessage('')
    aiMemory.current = {}
    setPhase('play')
  }

  const checkEnd = (newMatched, newScores) => {
    if (newMatched.length >= 16) {
      const result = newScores.user > newScores.ai ? 'win' : newScores.user < newScores.ai ? 'lose' : 'draw'
      setMessage(result === 'win' ? '你赢了' : result === 'lose' ? 'AI赢了' : '平局')
      const newStats = { ...stats }
      newStats[result] = (newStats[result] || 0) + 1
      saveStats(newStats)
      setPhase('result')
    }
  }

  const handleFlip = (idx) => {
    if (busy || turn !== 'user' || matched.includes(idx) || revealed.includes(idx)) return
    const newRevealed = [...revealed, idx]
    setRevealed(newRevealed)

    // Remember for AI
    rememberCard(idx, board[idx])

    if (newRevealed.length === 2) {
      setBusy(true)
      setTimeout(() => {
        const [a, b] = newRevealed
        if (board[a] === board[b]) {
          const newMatched = [...matched, a, b]
          const newScores = { ...scores, user: scores.user + 1 }
          setMatched(newMatched)
          setScores(newScores)
          setRevealed([])
          setBusy(false)
          checkEnd(newMatched, newScores)
        } else {
          setRevealed([])
          setBusy(false)
          setTurn('ai')
          setTimeout(() => aiTurn(), 600)
        }
      }, 800)
    }
  }

  const rememberCard = (idx, symbol) => {
    const mem = aiMemory.current
    if (!mem[symbol]) mem[symbol] = []
    if (!mem[symbol].includes(idx)) mem[symbol].push(idx)
  }

  const aiTurn = useCallback(() => {
    setBusy(true)
    const available = []
    for (let i = 0; i < 16; i++) if (!matched.includes(i)) available.push(i)
    if (available.length < 2) { setBusy(false); return }

    const mem = aiMemory.current
    // Check if AI knows a pair
    let knownPair = null
    for (const sym of Object.keys(mem)) {
      const positions = mem[sym].filter(i => !matched.includes(i))
      if (positions.length >= 2) { knownPair = [positions[0], positions[1]]; break }
    }

    let first, second
    if (knownPair) {
      [first, second] = knownPair
    } else {
      // Pick randomly
      const shuffled = shuffle(available)
      first = shuffled[0]
      second = shuffled[1]
    }

    // Show first card
    setRevealed([first])
    rememberCard(first, board[first])

    setTimeout(() => {
      // After seeing first, check if AI now knows a match
      const sym1 = board[first]
      const positions = (mem[sym1] || []).filter(i => !matched.includes(i) && i !== first)
      if (positions.length > 0) {
        second = positions[0]
      }

      setRevealed([first, second])
      rememberCard(second, board[second])

      setTimeout(() => {
        if (board[first] === board[second]) {
          const newMatched = [...matched, first, second]
          const newScores = { ...scores, ai: scores.ai + 1 }
          setMatched(newMatched)
          setScores(newScores)
          setRevealed([])
          setBusy(false)
          if (newMatched.length >= 16) {
            checkEnd(newMatched, newScores)
          } else {
            // AI goes again
            setTimeout(() => aiTurn(), 400)
          }
        } else {
          setRevealed([])
          setBusy(false)
          setTurn('user')
        }
      }, 800)
    }, 600)
  }, [board, matched, scores, stats])

  // Update aiTurn when dependencies change
  const aiTurnRef = useRef(aiTurn)
  aiTurnRef.current = aiTurn

  const header = (!mini && (onBack || onMinimize)) ? (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid rgba(240,215,230,0.3)' }}>
      <div style={{ display:'flex', gap:8 }}>
        {onBack && <button onClick={onBack} style={{ background:'none', border:'none', fontSize:16, cursor:'pointer', color:'#7a5a6a' }}>{'←'}</button>}
      </div>
      <span style={{ fontSize:14, fontWeight:600, color:'#7a5a6a' }}>翻牌配对</span>
      <div style={{ display:'flex', gap:8 }}>
        {onMinimize && <button onClick={onMinimize} style={{ background:'none', border:'none', fontSize:14, cursor:'pointer', color:'#b08a9a' }}>{'−'}</button>}
      </div>
    </div>
  ) : null

  const btnStyle = { background:'linear-gradient(135deg,#e8a0bf,#d4a0c8)', color:'#fff', border:'none', borderRadius:14, padding:'10px 28px', fontSize:14, cursor:'pointer', boxShadow:'0 2px 8px rgba(200,120,160,0.2)' }

  const statsLine = (
    <div style={{ display:'flex', justifyContent:'center', gap:16, fontSize:12, color:'#a08898', padding:'4px 0' }}>
      <span><b>{stats.win||0}</b> 胜</span>
      <span><b>{stats.lose||0}</b> 负</span>
      <span><b>{stats.draw||0}</b> 平</span>
    </div>
  )

  if (phase === 'menu') {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
        {header}
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, padding:'0 16px' }}>
          <div style={{ fontSize:13, color:'#b08a9a', textAlign:'center', lineHeight:1.6 }}>
            4x4共8对图案<br/>轮流翻两张牌<br/>配对成功得分并继续
          </div>
          {statsLine}
          <button onClick={startGame} style={btnStyle}>开始游戏</button>
        </div>
      </div>
    )
  }

  if (phase === 'result') {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
        {header}
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'0 16px' }}>
          <div style={{ fontSize:18, fontWeight:600, color:'#7a5a6a' }}>{message}</div>
          <div style={{ fontSize:13, color:'#a08898' }}>你 {scores.user} 对 / AI {scores.ai} 对</div>
          {statsLine}
          <button onClick={startGame} style={btnStyle}>再来一局</button>
        </div>
      </div>
    )
  }

  // play phase
  const cardSize = mini ? 44 : 58
  const gap = mini ? 4 : 6

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
      {header}
      <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 16px', fontSize:13 }}>
        <span style={{ color: turn === 'user' ? '#a06080' : '#b0a0a8', fontWeight: turn === 'user' ? 600 : 400 }}>你: {scores.user}</span>
        <span style={{ color:'#7a5a6a', fontSize:12 }}>{turn === 'user' ? '你的回合' : 'AI的回合'}</span>
        <span style={{ color: turn === 'ai' ? '#a06080' : '#b0a0a8', fontWeight: turn === 'ai' ? 600 : 400 }}>AI: {scores.ai}</span>
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding: mini ? 4 : 8 }}>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(4, ${cardSize}px)`, gap, justifyContent:'center' }}>
          {board.map((sym, i) => {
            const isFlipped = revealed.includes(i) || matched.includes(i)
            const isMatched = matched.includes(i)
            return (
              <div key={i} onClick={() => handleFlip(i)} style={{
                width: cardSize, height: cardSize, borderRadius: 8,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize: mini ? 18 : 24,
                cursor: (turn === 'user' && !busy && !isMatched && !revealed.includes(i)) ? 'pointer' : 'default',
                background: isMatched ? 'rgba(200,230,200,0.4)' : isFlipped ? 'rgba(255,240,248,0.9)' : 'linear-gradient(135deg, #e8c0d5, #d8b0c5)',
                border: isFlipped ? '1px solid rgba(200,160,180,0.4)' : '1px solid rgba(200,160,180,0.3)',
                boxShadow: isFlipped ? 'none' : '0 2px 6px rgba(180,120,150,0.15)',
                transition: 'all 0.2s',
                opacity: isMatched ? 0.5 : 1,
                userSelect: 'none'
              }}>
                {isFlipped ? sym : ''}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}