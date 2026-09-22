import { useState, useEffect, useCallback, useRef } from 'react'

const SIZE = 15
const WIN = 5

function checkWin(board, r, c) {
  const p = board[r][c]
  if (!p) return false
  const dirs = [[0,1],[1,0],[1,1],[1,-1]]
  for (const [dr,dc] of dirs) {
    let count = 1
    for (let i = 1; i < WIN; i++) {
      const nr = r + dr*i, nc = c + dc*i
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== p) break
      count++
    }
    for (let i = 1; i < WIN; i++) {
      const nr = r - dr*i, nc = c - dc*i
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== p) break
      count++
    }
    if (count >= WIN) return true
  }
  return false
}

function getWinLine(board, r, c) {
  const p = board[r][c]
  if (!p) return null
  const dirs = [[0,1],[1,0],[1,1],[1,-1]]
  for (const [dr,dc] of dirs) {
    const line = [[r,c]]
    for (let i = 1; i < SIZE; i++) {
      const nr = r + dr*i, nc = c + dc*i
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== p) break
      line.push([nr,nc])
    }
    for (let i = 1; i < SIZE; i++) {
      const nr = r - dr*i, nc = c - dc*i
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== p) break
      line.push([nr,nc])
    }
    if (line.length >= WIN) return line
  }
  return null
}

export default function GomokuApp({ mini = false, onBack, onMinimize }) {
  const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null))
  const [board, setBoard] = useState(emptyBoard)
  const [isBlack, setIsBlack] = useState(true) // black goes first
  const [winner, setWinner] = useState(null)
  const [lastMove, setLastMove] = useState(null)
  const [winLine, setWinLine] = useState(null)
  const [moveCount, setMoveCount] = useState(0)
  const boardRef = useRef(null)

  // Dispatch game events for the AI mini-window system
  const dispatchGameEvent = useCallback((type, detail) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('game-event', { detail: { game: 'gomoku', type, ...detail } }))
    }
  }, [])

  function handlePlace(r, c) {
    if (board[r][c] || winner) return
    const next = board.map(row => [...row])
    next[r][c] = isBlack ? 'B' : 'W'
    setBoard(next)
    setLastMove([r, c])
    setMoveCount(prev => prev + 1)
    if (checkWin(next, r, c)) {
      const line = getWinLine(next, r, c)
      setWinLine(line)
      setWinner(isBlack ? 'B' : 'W')
      dispatchGameEvent('win', { winner: isBlack ? 'black' : 'white', moves: moveCount + 1 })
    } else if (moveCount + 1 >= SIZE * SIZE) {
      setWinner('draw')
      dispatchGameEvent('draw', { moves: SIZE * SIZE })
    } else {
      dispatchGameEvent('move', { color: isBlack ? 'black' : 'white', row: r, col: c, moves: moveCount + 1 })
    }
    setIsBlack(!isBlack)
  }

  function reset() {
    setBoard(emptyBoard())
    setIsBlack(true)
    setWinner(null)
    setLastMove(null)
    setWinLine(null)
    setMoveCount(0)
    dispatchGameEvent('reset', {})
  }

  const cellSize = mini ? 20 : 24
  const boardPx = cellSize * (SIZE - 1) + cellSize
  const padding = cellSize / 2
  const isWinCell = (r, c) => winLine && winLine.some(([wr,wc]) => wr === r && wc === c)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: mini ? 'transparent' : '#f5ede4',
      fontFamily: "'PingFang SC', 'Hiragino Sans GB', sans-serif",
    }}>
      {/* Header */}
      {!mini && (
        <div style={{
          display: 'flex', alignItems: 'center', padding: '10px 14px',
          background: '#efe6dc', borderBottom: '1px solid #e0d5c8', flexShrink: 0,
          gap: 8
        }}>
          {onBack && <button onClick={onBack} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#8b7355', padding:'2px 6px' }}>{'←'}</button>}
          <span style={{ flex:1, fontSize:15, fontWeight:600, color:'#5a4a3a' }}>{'五子棋'}</span>
          {onMinimize && <button onClick={onMinimize} style={{ background:'#e8ddd0', color:'#8b7355', border:'1px solid #d4c4b0', borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer' }}>{'小窗'}</button>}
        </div>
      )}

      {/* Status */}
      <div style={{
        textAlign: 'center', padding: mini ? '6px 0 4px' : '12px 0 8px',
        fontSize: mini ? 12 : 14, color: '#5a4a3a', fontWeight: 500
      }}>
        {winner === 'draw' ? '平局！'
          : winner ? `${winner === 'B' ? '⚫ 黑棋' : '⚪ 白棋'} 获胜！`
          : `${isBlack ? '⚫ 黑棋' : '⚪ 白棋'} 落子`}
        {winner && (
          <button onClick={reset} style={{
            marginLeft: 12, background:'#d4a574', color:'#fff', border:'none',
            borderRadius:12, padding:'4px 14px', fontSize:12, cursor:'pointer'
          }}>{'再来一局'}</button>
        )}
      </div>

      {/* Board */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        overflow: 'auto', padding: mini ? '0 4px 4px' : '0 8px 8px'
      }}>
        <div ref={boardRef} style={{
          position: 'relative',
          width: boardPx, height: boardPx,
          background: '#dcb97a',
          borderRadius: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          flexShrink: 0
        }}>
          {/* Grid lines */}
          <svg width={boardPx} height={boardPx} style={{ position:'absolute', top:0, left:0 }}>
            {Array.from({ length: SIZE }, (_, i) => {
              const pos = padding + i * cellSize
              return (
                <g key={i}>
                  <line x1={padding} y1={pos} x2={boardPx - padding} y2={pos} stroke="#b89a5a" strokeWidth="0.8" />
                  <line x1={pos} y1={padding} x2={pos} y2={boardPx - padding} stroke="#b89a5a" strokeWidth="0.8" />
                </g>
              )
            })}
            {/* Star points */}
            {[[3,3],[3,11],[7,7],[11,3],[11,11]].map(([r,c]) => (
              <circle key={`${r}-${c}`} cx={padding + c * cellSize} cy={padding + r * cellSize} r={2.5} fill="#b89a5a" />
            ))}
          </svg>

          {/* Stones & click areas */}
          {Array.from({ length: SIZE }, (_, r) =>
            Array.from({ length: SIZE }, (_, c) => {
              const cx = padding + c * cellSize
              const cy = padding + r * cellSize
              const stone = board[r][c]
              const isLast = lastMove && lastMove[0] === r && lastMove[1] === c
              const isWin = isWinCell(r, c)
              const stoneR = cellSize * 0.42
              return (
                <div key={`${r}-${c}`} onClick={() => handlePlace(r, c)} style={{
                  position: 'absolute',
                  left: cx - cellSize/2, top: cy - cellSize/2,
                  width: cellSize, height: cellSize,
                  cursor: stone || winner ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 1
                }}>
                  {stone && (
                    <div style={{
                      width: stoneR * 2, height: stoneR * 2, borderRadius: '50%',
                      background: stone === 'B'
                        ? 'radial-gradient(circle at 35% 35%, #555, #111)'
                        : 'radial-gradient(circle at 35% 35%, #fff, #d8d8d8)',
                      boxShadow: isWin
                        ? `0 0 0 2px ${stone === 'B' ? '#ff6b6b' : '#ff6b6b'}, 0 2px 4px rgba(0,0,0,0.3)`
                        : '0 1px 3px rgba(0,0,0,0.3)',
                      border: isLast && !isWin ? '2px solid #e8a040' : 'none',
                      transition: 'box-shadow 0.2s'
                    }} />
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Bottom controls */}
      {!mini && (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 12,
          padding: '8px 16px 16px', flexShrink: 0
        }}>
          <button onClick={reset} style={{
            background: '#e8ddd0', color: '#5a4a3a', border: '1px solid #d4c4b0',
            borderRadius: 8, padding: '6px 20px', fontSize: 13, cursor: 'pointer'
          }}>{'重新开始'}</button>
        </div>
      )}
    </div>
  )
}
