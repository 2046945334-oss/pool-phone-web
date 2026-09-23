import { useState, useEffect, useCallback, useRef } from 'react'

const SIZE = 15

function getWinLine(board, r, c) {
  const p = board[r][c]
  if (!p) return null
  const dirs = [[0,1],[1,0],[1,1],[1,-1]]
  for (const [dr,dc] of dirs) {
    const line = [[r,c]]
    for (let i = 1; i < SIZE; i++) { const nr=r+dr*i, nc=c+dc*i; if (nr<0||nr>=SIZE||nc<0||nc>=SIZE||board[nr][nc]!==p) break; line.push([nr,nc]) }
    for (let i = 1; i < SIZE; i++) { const nr=r-dr*i, nc=c-dc*i; if (nr<0||nr>=SIZE||nc<0||nc>=SIZE||board[nr][nc]!==p) break; line.push([nr,nc]) }
    if (line.length >= 5) return line
  }
  return null
}

function StatsCard({ stats, mini }) {
  if (!stats) return null
  const total = stats.wins + stats.losses + stats.draws
  const rate = total > 0 ? Math.round(stats.wins / total * 100) : 0
  return (
    <div style={{ padding: mini ? '6px 10px' : '10px 14px', background:'rgba(255,240,248,0.6)', borderRadius:12, border:'1px solid rgba(240,215,230,0.4)', marginBottom: mini ? 4 : 8 }}>
      <div style={{ display:'flex', justifyContent:'center', gap: mini ? 16 : 24, fontSize: mini ? 11 : 13, color:'#7a5a6a' }}>
        <span><b>{stats.wins}</b> 胜</span>
        <span><b>{stats.losses}</b> 负</span>
        <span><b>{stats.draws}</b> 平</span>
        <span style={{color:'#b08a9a'}}>胜率 {rate}%</span>
      </div>
      {!mini && stats.history && stats.history.length > 0 && (
        <div style={{ marginTop:8, display:'flex', gap:3, flexWrap:'wrap', justifyContent:'center' }}>
          {stats.history.slice(0, 20).map((g, i) => (
            <div key={i} title={`${g.moves}步 ${new Date(g.date).toLocaleDateString()}`} style={{
              width:18, height:18, borderRadius:4, fontSize:10, display:'flex', alignItems:'center', justifyContent:'center',
              background: g.winner === 'B' ? 'rgba(200,120,160,0.25)' : g.winner === 'W' ? 'rgba(120,100,140,0.2)' : 'rgba(180,180,180,0.2)',
              color: g.winner === 'B' ? '#a06080' : g.winner === 'W' ? '#7a6a8a' : '#999',
              border: '1px solid ' + (g.winner === 'B' ? 'rgba(200,120,160,0.3)' : 'rgba(180,160,190,0.3)')
            }}>{g.winner === 'B' ? 'W' : g.winner === 'W' ? 'L' : 'D'}</div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function GomokuApp({ mini = false, onBack, onMinimize }) {
  const [game, setGame] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [aiThinking, setAiThinking] = useState(false)
  const [winLine, setWinLine] = useState(null)
  const [error, setError] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const pollRef = useRef(null)
  const gameIdRef = useRef(null)

  const loadGame = useCallback(async () => {
    try {
      const res = await fetch('/api/gomoku')
      if (!res.ok) { setError('加载失败: ' + res.status); setLoading(false); return }
      const data = await res.json()
      setGame(data.game)
      setStats(data.stats)
      if (data.game) {
        gameIdRef.current = data.game.gameId
        if (data.game.winner && data.game.lastMove) {
          setWinLine(getWinLine(data.game.board, data.game.lastMove[0], data.game.lastMove[1]))
        }
        if (data.game.turn === 'W' && !data.game.winner) { setAiThinking(true); pollForAiMove(data.game.gameId) }
      }
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { loadGame() }, [loadGame])

  async function newGame() {
    setLoading(true); setWinLine(null); setError(null); setAiThinking(false)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    try {
      const res = await fetch('/api/gomoku', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'new' }) })
      if (!res.ok) { const t = await res.text(); setError('创建失败: ' + t.slice(0,80)); setLoading(false); return }
      const data = await res.json()
      setGame(data.game)
      setStats(data.stats)
      gameIdRef.current = data.game.gameId
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  function pollForAiMove(gid) {
    let attempts = 0
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      attempts++
      if (gid !== gameIdRef.current) { clearInterval(pollRef.current); pollRef.current = null; return }
      try {
        const res = await fetch('/api/gomoku')
        if (!res.ok) return
        const data = await res.json()
        const g = data.game
        if (!g) {
          // Game was archived (AI won or draw) — server deleted it
          clearInterval(pollRef.current); pollRef.current = null
          setStats(data.stats); setAiThinking(false); setGame(null)
          // Check latest history to determine result
          if (data.stats && data.stats.history && data.stats.history.length > 0) {
            const last = data.stats.history[0]
            setLastResult(last.winner === 'B' ? 'win' : last.winner === 'W' ? 'lose' : 'draw')
          }
          return
        }
        if (g.gameId !== gid) { clearInterval(pollRef.current); pollRef.current = null; setAiThinking(false); return }
        if (g.turn === 'B' && !g.winner) {
          clearInterval(pollRef.current); pollRef.current = null
          setGame(g); setStats(data.stats); setAiThinking(false)
        }
      } catch {}
      if (attempts >= 40) { clearInterval(pollRef.current); pollRef.current = null; setAiThinking(false); loadGame() }
    }, 500)
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function handlePlace(r, c) {
    if (!game || game.board[r][c] || game.winner || game.turn !== 'B' || aiThinking) return
    setLoading(true); setError(null)
    try {
      const gid = gameIdRef.current
      const res = await fetch('/api/gomoku', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'move', row:r, col:c, gameId: gid }) })
      if (!res.ok) { const t = await res.text(); setError('落子失败: ' + t.slice(0,80)); setLoading(false); return }
      const data = await res.json()
      if (data.error) { setError(data.error); setLoading(false); return }
      setStats(data.stats)
      if (data.game.winner) {
        // Game ended (user won or draw) — server already archived, just show result
        setLastResult(data.game.winner === 'B' ? 'win' : data.game.winner === 'W' ? 'lose' : 'draw')
        setGame(null)
        setLoading(false); return
      }
      setGame(data.game)
      setAiThinking(true); setLoading(false)
      const boardStr = data.game.board.map(row => row.map(v => v === 'B' ? 'X' : v === 'W' ? 'O' : '.').join('')).join('\n')
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gomoku-user-move', { detail: { row: r, col: c, boardStr, gameId: gid } }))
      }
      pollForAiMove(gid)
    } catch (e) { setError(e.message); setLoading(false) }
  }

  const cellSize = mini ? 20 : 24
  const boardPx = cellSize * (SIZE - 1) + cellSize
  const pad = cellSize / 2
  const isWinCell = (r, c) => winLine && winLine.some(([wr,wc]) => wr === r && wc === c)

  const header = !mini ? (
    <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', background:'rgba(255,245,250,0.98)', borderBottom:'1px solid rgba(240,215,230,0.5)', flexShrink:0, gap:8 }}>
      {onBack && <button onClick={onBack} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#b08a9a', padding:'2px 6px' }}>{'←'}</button>}
      <span style={{ flex:1, fontSize:15, fontWeight:600, color:'#7a5a6a' }}>{'五子棋'}</span>
      {onMinimize && <button onClick={onMinimize} style={{ background:'rgba(250,235,245,0.9)', color:'#a07888', border:'1px solid rgba(230,200,220,0.5)', borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer' }}>{'小窗'}</button>}
    </div>
  ) : null

  if (!game) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
        {header}
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'0 16px' }}>
          {lastResult && (
            <div style={{ fontSize:16, fontWeight:600, color: lastResult === 'win' ? '#7a5a6a' : lastResult === 'lose' ? '#8a6a7a' : '#999', padding:'8px 20px', background:'rgba(255,240,248,0.8)', borderRadius:12, marginBottom:4 }}>
              {lastResult === 'win' ? '你赢了' : lastResult === 'lose' ? 'AI赢了' : '平局'}
            </div>
          )}
          {!lastResult && <div style={{ fontSize:13, color:'#b08a9a' }}>{'你执黑棋(先手) vs AI执白棋'}</div>}
          <StatsCard stats={stats} mini={mini} />
          {error && <div style={{ fontSize:12, color:'#c44', padding:'6px 14px', background:'rgba(200,50,50,0.06)', borderRadius:10, maxWidth:'85%', textAlign:'center', wordBreak:'break-all' }}>{error}</div>}
          <button onClick={() => { setLastResult(null); newGame() }} disabled={loading} style={{ background:'linear-gradient(135deg,#e8a0bf,#d4a0c8)', color:'#fff', border:'none', borderRadius:14, padding:'10px 28px', fontSize:14, cursor:'pointer', opacity:loading?0.6:1, boxShadow:'0 2px 8px rgba(200,120,160,0.2)' }}>
            {loading ? '加载中...' : lastResult ? '再来一局' : '开始对弈'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
      {header}
      {!mini && <StatsCard stats={stats} mini={true} />}
      <div style={{ textAlign:'center', padding: mini ? '4px 0 2px' : '6px 0 4px', fontSize: mini ? 12 : 14, color:'#7a5a6a', fontWeight:500 }}>
        {aiThinking ? '等待AI...' : '轮到你了'}
      </div>
      {error && <div style={{ textAlign:'center', fontSize:12, color:'#c44', padding:'2px 8px' }}>{error}</div>}
      <div style={{ flex:1, display:'flex', alignItems:'flex-start', justifyContent:'center', overflow:'auto', padding: mini ? '0 4px 4px' : '0 8px 8px' }}>
        <div style={{ position:'relative', width:boardPx, height:boardPx, background:'linear-gradient(135deg, #f0dce5, #e8c8d8)', borderRadius:8, boxShadow:'0 2px 12px rgba(180,120,150,0.12)', flexShrink:0, opacity: aiThinking ? 0.85 : 1, transition:'opacity 0.3s' }}>
          <svg width={boardPx} height={boardPx} style={{ position:'absolute', top:0, left:0 }}>
            {Array.from({ length: SIZE }, (_, i) => { const pos = pad + i * cellSize; return (<g key={i}><line x1={pad} y1={pos} x2={boardPx-pad} y2={pos} stroke="rgba(180,140,160,0.4)" strokeWidth="0.8" /><line x1={pos} y1={pad} x2={pos} y2={boardPx-pad} stroke="rgba(180,140,160,0.4)" strokeWidth="0.8" /></g>) })}
            {[[3,3],[3,11],[7,7],[11,3],[11,11]].map(([r,c]) => <circle key={r+'-'+c} cx={pad+c*cellSize} cy={pad+r*cellSize} r={2.5} fill="rgba(180,140,160,0.5)" />)}
          </svg>
          {game.board.map((row, r) => row.map((stone, c) => {
            const cx = pad + c * cellSize, cy = pad + r * cellSize
            const isLast = game.lastMove && game.lastMove[0]===r && game.lastMove[1]===c
            const isWin = isWinCell(r, c)
            const sr = cellSize * 0.42
            return (
              <div key={r+'-'+c} onClick={() => handlePlace(r, c)} style={{ position:'absolute', left:cx-cellSize/2, top:cy-cellSize/2, width:cellSize, height:cellSize, cursor:(stone||game.winner||game.turn!=='B'||aiThinking)?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1 }}>
                {stone && <div style={{ width:sr*2, height:sr*2, borderRadius:'50%', background: stone==='B' ? 'radial-gradient(circle at 35% 35%, #6a4a5a, #2a1a2a)' : 'radial-gradient(circle at 35% 35%, #fff, #e8d8e0)', boxShadow: isWin ? '0 0 0 2px #e06080, 0 2px 4px rgba(0,0,0,0.2)' : '0 1px 3px rgba(0,0,0,0.2)', border: isLast&&!isWin ? '2px solid #d4a0c0' : 'none' }} />}
              </div>
            )
          }))}
        </div>
      </div>
      {!mini && (
        <div style={{ display:'flex', justifyContent:'center', gap:12, padding:'8px 16px 16px', flexShrink:0 }}>
          <button onClick={newGame} disabled={loading||aiThinking} style={{ background:'rgba(250,235,245,0.9)', color:'#7a5a6a', border:'1px solid rgba(230,200,220,0.5)', borderRadius:10, padding:'6px 20px', fontSize:13, cursor:'pointer', opacity:(loading||aiThinking)?0.5:1 }}>{'重新开始'}</button>
        </div>
      )}
    </div>
  )
}