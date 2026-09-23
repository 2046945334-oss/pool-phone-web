import { getDb } from '../../lib/db'

// 1A2B Guess Number — backend API
// Flow: user guesses AI's secret, then AI guesses user's secret. Compare rounds.
// DB key: pool_guess — active game state
// DB key: pool_guess_stats — win/loss/draw stats

function genSecret() {
  const d = [0,1,2,3,4,5,6,7,8,9]
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]] }
  return d.slice(0, 4).join('')
}

function judge(secret, guess) {
  let a = 0, b = 0
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) a++
    else if (secret.includes(guess[i])) b++
  }
  return { a, b }
}

function isValid(s) {
  return /^\d{4}$/.test(s) && new Set(s).size === 4
}

function getStats(db) {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess_stats'").get()
  return row ? JSON.parse(row.value) : { wins: 0, losses: 0, draws: 0, history: [] }
}

function archiveGame(db, game) {
  if (!game || !game.result) return
  const stats = getStats(db)
  if (game.result === 'win') stats.wins++
  else if (game.result === 'lose') stats.losses++
  else stats.draws++
  stats.history.unshift({ result: game.result, userRounds: game.userHistory.length, aiRounds: game.aiHistory.length, date: Date.now() })
  if (stats.history.length > 50) stats.history = stats.history.slice(0, 50)
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess_stats', JSON.stringify(stats))
}

export default function handler(req, res) {
  const db = getDb()
  try {
    if (req.method === 'GET') {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
      const game = row ? JSON.parse(row.value) : null
      const stats = getStats(db)
      return res.json({ game: game ? { ...game, aiSecret: game.phase === 'userGuess' ? undefined : game.aiSecret } : null, stats })
    }

    if (req.method === 'POST') {
      const { action, guess, secret } = req.body

      if (action === 'new') {
        // Clean up old game
        const oldRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (oldRow) {
          const old = JSON.parse(oldRow.value)
          if (old.result) archiveGame(db, old)
        }
        const game = {
          phase: 'userGuess', // userGuess -> setSecret -> aiGuess -> done
          aiSecret: genSecret(),
          userSecret: null,
          userHistory: [],
          aiHistory: [],
          result: null,
          gameId: Date.now().toString(36)
        }
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
        return res.json({ game: { ...game, aiSecret: undefined }, stats: getStats(db) })
      }

      if (action === 'userGuess') {
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的游戏' })
        const game = JSON.parse(row.value)
        if (game.phase !== 'userGuess') return res.status(400).json({ error: '当前不是你猜的阶段' })
        if (!isValid(guess)) return res.status(400).json({ error: '请输入4位不重复数字' })
        const result = judge(game.aiSecret, guess)
        game.userHistory.push({ guess, a: result.a, b: result.b })
        if (result.a === 4) {
          game.phase = 'setSecret' // user needs to set their secret
        }
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
        return res.json({ game: { ...game, aiSecret: game.phase === 'userGuess' ? undefined : game.aiSecret }, result, stats: getStats(db) })
      }

      if (action === 'setSecret') {
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的游戏' })
        const game = JSON.parse(row.value)
        if (game.phase !== 'setSecret') return res.status(400).json({ error: '当前不需要设置数字' })
        if (!isValid(secret)) return res.status(400).json({ error: '请输入4位不重复数字' })
        game.userSecret = secret
        game.phase = 'aiGuess'
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
        return res.json({ game, stats: getStats(db) })
      }

      // AI guess action (called by chat tool)
      if (action === 'aiGuess') {
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的游戏' })
        const game = JSON.parse(row.value)
        if (game.phase !== 'aiGuess') return res.status(400).json({ error: '当前不是AI猜的阶段' })
        if (!isValid(guess)) return res.status(400).json({ error: 'AI猜测无效: ' + guess })
        const result = judge(game.userSecret, guess)
        game.aiHistory.push({ guess, a: result.a, b: result.b })
        if (result.a === 4) {
          // AI guessed correctly — game over
          const userRounds = game.userHistory.length
          const aiRounds = game.aiHistory.length
          game.result = userRounds < aiRounds ? 'win' : userRounds > aiRounds ? 'lose' : 'draw'
          game.phase = 'done'
          db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
          archiveGame(db, game)
          db.prepare("DELETE FROM kv WHERE key = 'pool_guess'").run()
        } else {
          db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
        }
        return res.json({ game, result, stats: getStats(db) })
      }

      return res.status(400).json({ error: '未知action' })
    }

    return res.status(405).end()
  } finally {
    try { db.close() } catch {}
  }
}