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

export default function GomokuApp({ mini = false, onBack, onMinimize }) {
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(false)
  const [aiThinking, setAiThinking] = useState(false)
  const [winLine, setWinLine] = useState(null)
  const pollRef = useRef(null)

  const loadGame = useCallback(async () => {
    try {
      const res = await fetch('/api/gomoku')
      const data = await res.json()
      setGame(data)
      if (data?.winner && data.lastMove) {
        setWinLine(getWinLine(data.board, data.lastMove[0], data.lastMove[1]))
      } else { setWinLine(null) }
    } catch {}
  }, [])

  useEffect(() => { loadGame() }, [loadGame])

  async function newGame() {
    setLoading(true); setWinLine(null)
    try {
      const res = await fetch('/api/gomoku', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'new' }) })
      setGame(await res.json())
    } catch {}
    setLoading(false)
  }

  function pollForAiMove() {
    let attempts = 0
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      attempts++
      try {
        const res = await fetch('/api/gomoku')
        const data = await res.json()
        if (data && (data.turn === 'B' || data.winner)) {
          clearInterval(pollRef.current); pollRef.current = null
          setGame(data); setAiThinking(false)
          if (data.winner && data.lastMove) setWinLine(getWinLine(data.board, data.lastMove[0], data.lastMove[1]))
        }
      } catch {}
      if (attempts >= 40) { clearInterval(pollRef.current); pollRef.current = null; setAiThinking(false); loadGame() }
    }, 500)
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function handlePlace(r, c) {
    if (!game || game.board[r][c] || game.winner || game.turn !== 'B' || aiThinking) return
    setLoading(true)
    try {
      const res = await fetch('/api/gomoku', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'move', row:r, col:c }) })
      const data = await res.json()
      if (data.error) { setLoading(false); return }
      setGame(data)
      if (data.winner === 'B' && data.lastMove) {
        setWinLine(getWinLine(data.board, data.lastMove[0], data.lastMove[1]))
        setLoading(false); return
      }
      setAiThinking(true); setLoading(false)
      const boardStr = data.board.map(row => row.map(v => v === 'B' ? '●' : v === 'W' ? '○' : '·').join('')).join('\n')
      try {
        const cfg = JSON.parse(localStorage.getItem('pool_api_config') || '{}')
        const cfgs = JSON.parse(localStorage.getItem('pool_api_configs') || '{}')
        const tc = cfgs.tool || {}
        await fetch('/api/chat', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            messages: [{ role:'user', content:`[五子棋] 我下了黑棋(${r},${c})。当前棋盘:\n${boardStr}\n轮到你(白棋)了，请用gomoku_move工具落子。` }],
            apiBase: tc.apiBase || cfg.apiBase || '', apiKey: tc.apiKey || cfg.apiKey || '',
            model: tc.model || cfg.model || '', stream: false
          })
        })
      } catch {}
      pollForAiMove()
    } catch { setLoading(false) }
  }

  const cellSize = mini ? 20 : 24
  const boardPx = cellSize * (SIZE - 1) + cellSize
  const padding = cellSize / 2
  const isWinCell = (r, c) => winLine && winLine.some(([wr,wc]) => wr === r && wc === c)

  if (!game) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', background: mini ? 'transparent' : '#f5ede4', gap:12 }}>
        <div style={{ fontSize:16, color:'#5a4a3a', fontWeight:600 }}>{'🎮 五子棋'}</div>
        <div style={{ fontSize:13, color:'#8b7355' }}>{'你执黑棋(先手) vs AI执白棋'}</div>
        <button onClick={newGame} disabled={loading} style={{ background:'#d4a574', color:'#fff', border:'none', borderRadius:12, padding:'10px 28px', fontSize:14, cursor:'pointer' }}>
          {loading ? '创建中...' : '开始对弈'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : '#f5ede4', fontFamily:"'PingFang SC','Hiragino Sans GB',sans-serif" }}>
      {!mini && (
        <div style={{ display:'flex', alignItems:'center', padding:'10px 14px', background:'#efe6dc', borderBottom:'1px solid #e0d5c8', flexShrink:0, gap:8 }}>
          {onBack && <button onClick={onBack} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#8b7355', padding:'2px 6px' }}>{'←'}</button>}
          <span style={{ flex:1, fontSize:15, fontWeight:600, color:'#5a4a3a' }}>{'五子棋'}</span>
          {onMinimize && <button onClick={onMinimize} style={{ background:'#e8ddd0', color:'#8b7355', border:'1px solid #d4c4b0', borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer' }}>{'小窗'}</button>}
        </div>
      )}
      <div style={{ textAlign:'center', padding: mini ? '6px 0 4px' : '12px 0 8px', fontSize: mini ? 12 : 14, color:'#5a4a3a', fontWeight:500 }}>
        {game.winner === 'draw' ? '平局！' : game.winner === 'B' ? '⚫ 你赢了！' : game.winner === 'W' ? '⚪ AI赢了！' : aiThinking ? '⚪ AI思考中...' : game.turn === 'B' ? '⚫ 轮到你了' : '⚪ 等待AI...'}
        {game.winner && <button onClick={newGame} disabled={loading} style={{ marginLeft:12, background:'#d4a574', color:'#fff', border:'none', borderRadius:12, padding:'4px 14px', fontSize:12, cursor:'pointer' }}>{loading ? '...' : '再来一局'}</button>}
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'flex-start', justifyContent:'center', overflow:'auto', padding: mini ? '0 4px 4px' : '0 8px 8px' }}>
        <div style={{ position:'relative', width:boardPx, height:boardPx, background:'#dcb97a', borderRadius:4, boxShadow:'0 2px 8px rgba(0,0,0,0.12)', flexShrink:0, opacity: aiThinking ? 0.85 : 1, transition:'opacity 0.3s' }}>
          <svg width={boardPx} height={boardPx} style={{ position:'absolute', top:0, left:0 }}>
            {Array.from({ length: SIZE }, (_, i) => { const pos = padding + i * cellSize; return (<g key={i}><line x1={padding} y1={pos} x2={boardPx-padding} y2={pos} stroke="#b89a5a" strokeWidth="0.8" /><line x1={pos} y1={padding} x2={pos} y2={boardPx-padding} stroke="#b89a5a" strokeWidth="0.8" /></g>) })}
            {[[3,3],[3,11],[7,7],[11,3],[11,11]].map(([r,c]) => <circle key={`${r}-${c}`} cx={padding+c*cellSize} cy={padding+r*cellSize} r={2.5} fill="#b89a5a" />)}
          </svg>
          {game.board.map((row, r) => row.map((stone, c) => {
            const cx = padding + c * cellSize, cy = padding + r * cellSize
            const isLast = game.lastMove && game.lastMove[0]===r && game.lastMove[1]===c
            const isWin = isWinCell(r, c)
            const sr = cellSize * 0.42
            return (
              <div key={`${r}-${c}`} onClick={() => handlePlace(r, c)} style={{ position:'absolute', left:cx-cellSize/2, top:cy-cellSize/2, width:cellSize, height:cellSize, cursor:(stone||game.winner||game.turn!=='B'||aiThinking)?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1 }}>
                {stone && <div style={{ width:sr*2, height:sr*2, borderRadius:'50%', background: stone==='B' ? 'radial-gradient(circle at 35% 35%, #555, #111)' : 'radial-gradient(circle at 35% 35%, #fff, #d8d8d8)', boxShadow: isWin ? '0 0 0 2px #ff6b6b, 0 2px 4px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.3)', border: isLast&&!isWin ? '2px solid #e8a040' : 'none', transition:'box-shadow 0.2s' }} />}
              </div>
            )
          }))}
        </div>
      </div>
      {!mini && (
        <div style={{ display:'flex', justifyContent:'center', gap:12, padding:'8px 16px 16px', flexShrink:0 }}>
          <button onClick={newGame} disabled={loading||aiThinking} style={{ background:'#e8ddd0', color:'#5a4a3a', border:'1px solid #d4c4b0', borderRadius:8, padding:'6px 20px', fontSize:13, cursor:'pointer', opacity:(loading||aiThinking)?0.5:1 }}>{'重新开始'}</button>
        </div>
      )}
    </div>
  )
}