import { getDb } from '../../lib/db'

function checkWin(board, r, c) {
  const p = board[r][c]
  if (!p) return false
  const dirs = [[0,1],[1,0],[1,1],[1,-1]]
  for (const [dr,dc] of dirs) {
    let count = 1
    for (let i = 1; i < 5; i++) { const nr=r+dr*i, nc=c+dc*i; if (nr<0||nr>14||nc<0||nc>14||board[nr][nc]!==p) break; count++ }
    for (let i = 1; i < 5; i++) { const nr=r-dr*i, nc=c-dc*i; if (nr<0||nr>14||nc<0||nc>14||board[nr][nc]!==p) break; count++ }
    if (count >= 5) return true
  }
  return false
}

export default function handler(req, res) {
  const db = getDb()
  try {
    if (req.method === 'GET') {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_gomoku'").get()
      return res.json(row ? JSON.parse(row.value) : null)
    }

    if (req.method === 'POST') {
      const { action, row: r, col: c } = req.body

      if (action === 'new') {
        const game = {
          board: Array.from({ length: 15 }, () => Array(15).fill(null)),
          turn: 'B',
          moves: 0,
          lastMove: null,
          winner: null,
          startedAt: Date.now()
        }
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_gomoku', JSON.stringify(game))
        return res.json(game)
      }

      if (action === 'move') {
        const ri = parseInt(r), ci = parseInt(c)
        if (ri < 0 || ri > 14 || ci < 0 || ci > 14) return res.status(400).json({ error: '坐标越界' })
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_gomoku'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的棋局，请先开始新游戏' })
        const game = JSON.parse(row.value)
        if (game.winner) return res.status(400).json({ error: '棋局已结束', game })
        if (game.turn !== 'B') return res.status(400).json({ error: '还没轮到你（黑棋）', game })
        if (game.board[ri][ci]) return res.status(400).json({ error: '这个位置已经有棋子了' })

        game.board[ri][ci] = 'B'
        game.lastMove = [ri, ci]
        game.moves++
        if (checkWin(game.board, ri, ci)) {
          game.winner = 'B'
        } else if (game.moves >= 225) {
          game.winner = 'draw'
        } else {
          game.turn = 'W'
        }
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_gomoku', JSON.stringify(game))
        return res.json(game)
      }

      return res.status(400).json({ error: 'Unknown action' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('[gomoku] error:', e)
    return res.status(500).json({ error: e.message })
  }
}