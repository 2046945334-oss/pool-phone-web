import { useState, useEffect, useCallback, useRef } from 'react'

export default function MemoryMatchApp({ mini = false, onBack, onMinimize }) {
  const [game, setGame] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [aiThinking, setAiThinking] = useState(false)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef(null)

  const loadGame = useCallback(async () => {
    try {
      const res = await fetch('/api/memory-match')
      if (!res.ok) { setError('加载失败'); setLoading(false); return }
      const data = await res.json()
      setGame(data.game); setStats(data.stats)
      if (data.game && data.game.turn === 'ai') { setAiThinking(true); pollForAi() }
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { loadGame() }, [loadGame])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function newGame() {
    setLoading(true); setError(null); setLastResult(null)
    try {
      const res = await fetch('/api/memory-match', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'new' }) })
      const data = await res.json()
      setGame(data.game); setStats(data.stats)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function handleFlip(idx) {
    if (busy || !game || game.turn !== 'user' || game.matched?.includes(idx) || game.revealed?.includes(idx)) return
    if (game.pendingResolve) return // waiting for resolve
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/memory-match', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'flip', index: idx }) })
      const data = await res.json()
      if (data.error) { setError(data.error); setBusy(false); return }
      setGame(data.game); setStats(data.stats)

      // If 2 cards are now revealed (pendingResolve), show them then resolve after delay
      if (data.game?.pendingResolve) {
        setTimeout(async () => {
          try {
            const rr = await fetch('/api/memory-match', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'resolve' }) })
            const rd = await rr.json()
            if (rd.error) { setError(rd.error); setBusy(false); return }
            setGame(rd.game); setStats(rd.stats)
            if (rd.game?.result) {
              setLastResult(rd.game.result); setGame(null); setBusy(false); return
            }
            if (rd.game?.turn === 'ai') {
              setBusy(false); setAiThinking(true)
              if (typeof window !== 'undefined') {
                const boardStr = rd.game.board.map((s, i) => `${i}:${s}`).join(' ')
                const hist = rd.game.flipHistory ? rd.game.flipHistory.map(h => `${h.index}→${h.symbol}`).join(', ') : ''
                window.dispatchEvent(new CustomEvent('memory-user-done', {
                  detail: { boardStr, flipHistory: hist, userScore: rd.game.userScore, aiScore: rd.game.aiScore }
                }))
              }
              pollForAi()
            } else {
              setBusy(false)
            }
          } catch (e) { setError(e.message); setBusy(false) }
        }, 1000) // 1s delay so user can see both cards
        return
      }

      setBusy(false)
    } catch (e) { setError(e.message); setBusy(false) }
  }

  function pollForAi() {
    if (pollRef.current) clearInterval(pollRef.current)
    let attempts = 0
    let resolving = false
    pollRef.current = setInterval(async () => {
      if (resolving) return // wait for resolve to finish
      attempts++
      try {
        const res = await fetch('/api/memory-match')
        if (!res.ok) return
        const data = await res.json()
        if (!data.game) {
          clearInterval(pollRef.current); pollRef.current = null
          setAiThinking(false); setGame(null); setStats(data.stats)
          if (data.stats?.history?.length > 0) setLastResult(data.stats.history[0].result)
          return
        }
        setGame(data.game); setStats(data.stats)

        // If AI flipped 2 cards (pendingResolve), show them then resolve after delay
        if (data.game.pendingResolve && data.game.revealed?.length === 2) {
          resolving = true
          setTimeout(async () => {
            try {
              const rr = await fetch('/api/memory-match', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'resolve' }) })
              const rd = await rr.json()
              if (rd.game) {
                setGame(rd.game); setStats(rd.stats)
                if (rd.game.result) {
                  clearInterval(pollRef.current); pollRef.current = null
                  setAiThinking(false); setLastResult(rd.game.result); setGame(null)
                  return
                }
                if (rd.game.turn === 'user') {
                  clearInterval(pollRef.current); pollRef.current = null
                  setAiThinking(false)
                  return
                }
                // AI matched and continues — keep polling
              } else if (!rd.game && rd.stats) {
                clearInterval(pollRef.current); pollRef.current = null
                setAiThinking(false); setGame(null); setStats(rd.stats)
                if (rd.stats?.history?.length > 0) setLastResult(rd.stats.history[0].result)
                return
              }
            } catch {}
            resolving = false
          }, 1500)
          return
        }

        if (data.game.turn === 'user' && !data.game.pendingResolve) {
          clearInterval(pollRef.current); pollRef.current = null
          setAiThinking(false)
        }
      } catch {}
      if (attempts >= 120) { clearInterval(pollRef.current); pollRef.current = null; setAiThinking(false) }
    }, 800)
  }

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
  const bg = mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)'
  const statsLine = stats ? (
    <div style={{ display:'flex', justifyContent:'center', gap:16, fontSize:12, color:'#a08898', padding:'4px 0' }}>
      <span><b>{stats.wins}</b> 胜</span><span><b>{stats.losses}</b> 负</span><span><b>{stats.draws}</b> 平</span>
    </div>
  ) : null

  if (!game) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: bg }}>
      {header}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'0 16px' }}>
        {lastResult && <div style={{ fontSize:16, fontWeight:600, color:'#7a5a6a', padding:'8px 20px', background:'rgba(255,240,248,0.8)', borderRadius:12 }}>{lastResult === 'win' ? '你赢了' : lastResult === 'lose' ? 'AI赢了' : '平局'}</div>}
        {!lastResult && <div style={{ fontSize:13, color:'#b08a9a', textAlign:'center', lineHeight:1.6 }}>4x4共8对图案<br/>轮流翻两张，配对得分</div>}
        {statsLine}
        {error && <div style={{ fontSize:12, color:'#c44' }}>{error}</div>}
        <button onClick={() => { setLastResult(null); newGame() }} disabled={loading} style={{ ...btnStyle, opacity:loading?0.6:1 }}>{loading ? '...' : lastResult ? '再来一局' : '开始游戏'}</button>
      </div>
    </div>
  )

  const cardSize = mini ? 44 : 58
  const gap = mini ? 4 : 6

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: bg }}>
      {header}
      <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 16px', fontSize:13 }}>
        <span style={{ color: game.turn === 'user' ? '#a06080' : '#b0a0a8', fontWeight: game.turn === 'user' ? 600 : 400 }}>你: {game.userScore}</span>
        <span style={{ color:'#7a5a6a', fontSize:12 }}>{game.turn === 'user' ? '你的回合' : 'AI思考中...'}</span>
        <span style={{ color: game.turn === 'ai' ? '#a06080' : '#b0a0a8', fontWeight: game.turn === 'ai' ? 600 : 400 }}>AI: {game.aiScore}</span>
      </div>
      {error && <div style={{ textAlign:'center', fontSize:12, color:'#c44', padding:'2px 8px' }}>{error}</div>}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding: mini ? 4 : 8 }}>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(4, ${cardSize}px)`, gap, justifyContent:'center' }}>
          {game.board.map((sym, i) => {
            const isRevealed = sym !== '?'
            const isMatched = game.matched?.includes(i)
            return (
              <div key={i} onClick={() => handleFlip(i)} style={{
                width: cardSize, height: cardSize, borderRadius: 8,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize: mini ? 18 : 24,
                cursor: (game.turn === 'user' && !busy && !isMatched && !isRevealed) ? 'pointer' : 'default',
                background: isMatched ? 'rgba(200,230,200,0.4)' : isRevealed ? 'rgba(255,240,248,0.9)' : 'linear-gradient(135deg, #e8c0d5, #d8b0c5)',
                border: isRevealed ? '1px solid rgba(200,160,180,0.4)' : '1px solid rgba(200,160,180,0.3)',
                boxShadow: isRevealed ? 'none' : '0 2px 6px rgba(180,120,150,0.15)',
                transition: 'all 0.2s',
                opacity: isMatched ? 0.5 : 1,
                userSelect: 'none'
              }}>
                {isRevealed ? sym : ''}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}