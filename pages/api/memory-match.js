import { getDb } from '../../lib/db'

// Memory Match — backend API
// 4x4 grid = 8 pairs. User and AI take turns flipping 2 cards.
// DB key: pool_match — active game
// DB key: pool_match_stats — stats

const SYMBOLS = ['♥','♦','♣','♠','★','●','▲','■']

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

function getStats(db) {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_match_stats'").get()
  return row ? JSON.parse(row.value) : { wins: 0, losses: 0, draws: 0, history: [] }
}

function archiveGame(db, game) {
  if (!game || !game.result) return
  const stats = getStats(db)
  if (game.result === 'win') stats.wins++
  else if (game.result === 'lose') stats.losses++
  else stats.draws++
  stats.history.unshift({ result: game.result, userScore: game.userScore, aiScore: game.aiScore, date: Date.now() })
  if (stats.history.length > 50) stats.history = stats.history.slice(0, 50)
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_match_stats', JSON.stringify(stats))
}

function clientGame(game) {
  if (!game) return null
  // Hide board symbols for unmatched+unrevealed cards
  const visible = game.board.map((sym, i) => {
    if (game.matched.includes(i) || game.revealed.includes(i)) return sym
    return '?'
  })
  return { ...game, board: visible, _board: undefined }
}

export default function handler(req, res) {
  const db = getDb()
  try {
    if (req.method === 'GET') {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_match'").get()
      const game = row ? JSON.parse(row.value) : null
      return res.json({ game: clientGame(game), stats: getStats(db) })
    }

    if (req.method === 'POST') {
      const { action, index } = req.body

      if (action === 'new') {
        const oldRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_match'").get()
        if (oldRow) { const old = JSON.parse(oldRow.value); if (old.result) archiveGame(db, old) }
        const board = shuffle([...SYMBOLS, ...SYMBOLS])
        const game = {
          board, // actual symbols (hidden from client)
          matched: [],
          revealed: [],
          turn: 'user',
          userScore: 0,
          aiScore: 0,
          result: null,
          gameId: Date.now().toString(36),
          flipHistory: [] // track what's been seen: [{index, symbol}]
        }
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_match', JSON.stringify(game))
        return res.json({ game: clientGame(game), stats: getStats(db) })
      }

      if (action === 'flip') {
        // User or AI flips a card
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_match'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的游戏' })
        const game = JSON.parse(row.value)
        if (game.result) return res.status(400).json({ error: '游戏已结束' })
        const idx = parseInt(index)
        if (idx < 0 || idx > 15 || game.matched.includes(idx) || game.revealed.includes(idx)) {
          return res.status(400).json({ error: '无效选择' })
        }

        game.revealed.push(idx)
        // Record in flip history for AI to reference
        game.flipHistory.push({ index: idx, symbol: game.board[idx] })

        if (game.revealed.length === 2) {
          const [a, b] = game.revealed
          if (game.board[a] === game.board[b]) {
            // Match found
            game.matched.push(a, b)
            if (game.turn === 'user') game.userScore++
            else game.aiScore++
            game.revealed = []
            // Check game end
            if (game.matched.length >= 16) {
              game.result = game.userScore > game.aiScore ? 'win' : game.userScore < game.aiScore ? 'lose' : 'draw'
              db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_match', JSON.stringify(game))
              archiveGame(db, game)
              db.prepare("DELETE FROM kv WHERE key = 'pool_match'").run()
              return res.json({ game: clientGame(game), matched: true, stats: getStats(db) })
            }
            // Same player continues — don't switch turn
          } else {
            // No match — cards will be hidden, switch turn
            game.revealed = []
            game.turn = game.turn === 'user' ? 'ai' : 'user'
          }
        }

        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_match', JSON.stringify(game))
        return res.json({
          game: clientGame(game),
          flippedSymbol: game.board[idx],
          matched: game.revealed.length === 0 && game.matched.includes(idx),
          stats: getStats(db)
        })
      }

      return res.status(400).json({ error: '未知action' })
    }
    return res.status(405).end()
  } finally {
    try { db.close() } catch {}
  }
}