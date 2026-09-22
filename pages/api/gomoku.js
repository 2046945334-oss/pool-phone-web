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

function getStats(db) {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_gomoku_stats'").get()
  return row ? JSON.parse(row.value) : { wins: 0, losses: 0, draws: 0, history: [] }
}

function saveStats(db, stats) {
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_gomoku_stats', JSON.stringify(stats))
}

function archiveGame(db, game) {
  if (!game || !game.winner) return
  const stats = getStats(db)
  if (game.winner === 'B') stats.wins++
  else if (game.winner === 'W') stats.losses++
  else if (game.winner === 'draw') stats.draws++
  stats.history.unshift({
    winner: game.winner,
    moves: game.moves,
    date: Date.now(),
    gameId: game.gameId || ''
  })
  if (stats.history.length > 50) stats.history = stats.history.slice(0, 50)
  saveStats(db, stats)
}

export default function handler(req, res) {
  const db = getDb()
  try {
    if (req.method === 'GET') {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_gomoku'").get()
      const game = row ? JSON.parse(row.value) : null
      const stats = getStats(db)
      return res.json({ game, stats })
    }

    if (req.method === 'POST') {
      const { action, row: r, col: c, gameId } = req.body

      if (action === 'new') {
        const oldRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_gomoku'").get()
        if (oldRow) {
          const oldGame = JSON.parse(oldRow.value)
          if (oldGame.winner) archiveGame(db, oldGame)
        }
        const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        const game = {
          board: Array.from({ length: 15 }, () => Array(15).fill(null)),
          turn: 'B', moves: 0, lastMove: null, winner: null,
          gameId: newId, startedAt: Date.now()
        }
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_gomoku', JSON.stringify(game))
        const stats = getStats(db)
        return res.json({ game, stats })
      }

      if (action === 'move') {
        const ri = parseInt(r), ci = parseInt(c)
        if (ri < 0 || ri > 14 || ci < 0 || ci > 14) return res.status(400).json({ error: '坐标越界' })
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_gomoku'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的棋局' })
        const game = JSON.parse(row.value)
        if (gameId && game.gameId && gameId !== game.gameId) {
          return res.status(409).json({ error: '棋局已更新', stale: true })
        }
        if (game.winner) return res.status(400).json({ error: '棋局已结束' })
        if (game.board[ri][ci]) return res.status(400).json({ error: '这个位置已有棋子' })

        const stone = game.turn
        game.board[ri][ci] = stone
        game.lastMove = [ri, ci]
        game.moves++
        if (checkWin(game.board, ri, ci)) {
          game.winner = stone
        } else if (game.moves >= 225) {
          game.winner = 'draw'
        } else {
          game.turn = stone === 'B' ? 'W' : 'B'
        }
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_gomoku', JSON.stringify(game))
        const stats = getStats(db)
        return res.json({ game, stats })
      }

      if (action === 'stats') {
        return res.json({ stats: getStats(db) })
      }

      return res.status(400).json({ error: 'Unknown action' })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('[gomoku] error:', e)
    return res.status(500).json({ error: e.message })
  }
}