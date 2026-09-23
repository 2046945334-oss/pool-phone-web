import { getDb } from '../../lib/db'

// 1A2B Guess Number — backend API
// New flow:
//   1. new game → phase 'waitAiSecret' — AI sets its secret via tool
//   2. AI sets secret → phase 'userGuess' — user guesses AI's number, system judges xAxB
//   3. user guesses correct → phase 'setSecret' — user sets their secret
//   4. user sets secret → phase 'aiGuess' — AI guesses, user provides xAxB feedback
//   5. AI guesses correct → done, compare rounds

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

function clientGame(game) {
  if (!game) return null
  // Never expose aiSecret to client during userGuess phase
  const g = { ...game }
  if (g.phase === 'userGuess' || g.phase === 'waitAiSecret') {
    delete g.aiSecret
  }
  return g
}

export default function handler(req, res) {
  const db = getDb()
  try {
    if (req.method === 'GET') {
      const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
      const game = row ? JSON.parse(row.value) : null
      return res.json({ game: clientGame(game), stats: getStats(db) })
    }

    if (req.method === 'POST') {
      const { action, guess, secret, feedback } = req.body

      if (action === 'new') {
        const oldRow = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (oldRow) { const old = JSON.parse(oldRow.value); if (old.result) archiveGame(db, old) }
        const game = {
          phase: 'waitAiSecret',
          aiSecret: null,
          userSecret: null,
          userHistory: [],
          aiHistory: [],
          result: null,
          gameId: Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
        }
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
        return res.json({ game: clientGame(game), stats: getStats(db) })
      }

      // AI sets its secret (called by chat tool)
      if (action === 'aiSetSecret') {
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的游戏' })
        const game = JSON.parse(row.value)
        if (game.phase !== 'waitAiSecret') return res.status(400).json({ error: '当前不需要设置数字' })
        if (!isValid(secret)) return res.status(400).json({ error: '请设置4位不重复数字' })
        game.aiSecret = secret
        game.phase = 'userGuess'
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
        return res.json({ game: clientGame(game), stats: getStats(db) })
      }

      // User guesses AI's secret — system judges automatically
      if (action === 'userGuess') {
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的游戏' })
        const game = JSON.parse(row.value)
        if (game.phase !== 'userGuess') return res.status(400).json({ error: '当前不是你猜的阶段' })
        if (!isValid(guess)) return res.status(400).json({ error: '请输入4位不重复数字' })
        const result = judge(game.aiSecret, guess)
        game.userHistory.push({ guess, a: result.a, b: result.b })
        if (result.a === 4) {
          game.phase = 'setSecret'
        }
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
        return res.json({ game: clientGame(game), result, guessedCorrect: result.a === 4, stats: getStats(db) })
      }

      // User sets their secret for AI to guess
      if (action === 'setSecret') {
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的游戏' })
        const game = JSON.parse(row.value)
        if (game.phase !== 'setSecret') return res.status(400).json({ error: '当前不需要设置数字' })
        if (!isValid(secret)) return res.status(400).json({ error: '请输入4位不重复数字' })
        game.userSecret = secret
        game.phase = 'aiGuess'
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
        return res.json({ game: clientGame(game), stats: getStats(db) })
      }

      // AI makes a guess (called by chat tool) — but doesn't judge, waits for user feedback
      if (action === 'aiGuess') {
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的游戏' })
        const game = JSON.parse(row.value)
        if (game.phase !== 'aiGuess') return res.status(400).json({ error: '当前不是AI猜的阶段' })
        if (!isValid(guess)) return res.status(400).json({ error: 'AI猜测无效: ' + guess })
        // Store AI's pending guess, wait for user to provide xAxB
        game.pendingAiGuess = guess
        game.phase = 'userFeedback'
        db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
        return res.json({ game: clientGame(game), pendingGuess: guess, stats: getStats(db) })
      }

      // User provides xAxB feedback for AI's guess
      if (action === 'userFeedback') {
        const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_guess'").get()
        if (!row) return res.status(400).json({ error: '没有进行中的游戏' })
        const game = JSON.parse(row.value)
        if (game.phase !== 'userFeedback') return res.status(400).json({ error: '当前不需要反馈' })
        const fb = String(feedback || '').toUpperCase().trim()
        const fbMatch = fb.match(/^(\d)A(\d)B$/)
        if (!fbMatch) return res.status(400).json({ error: '请输入格式如 2A1B' })
        const a = parseInt(fbMatch[1]), b = parseInt(fbMatch[2])
        if (a + b > 4 || a < 0 || b < 0) return res.status(400).json({ error: '反馈数值不合理' })
        game.aiHistory.push({ guess: game.pendingAiGuess, a, b })
        delete game.pendingAiGuess

        if (a === 4) {
          const userRounds = game.userHistory.length
          const aiRounds = game.aiHistory.length
          game.result = userRounds < aiRounds ? 'win' : userRounds > aiRounds ? 'lose' : 'draw'
          game.phase = 'done'
          db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
          archiveGame(db, game)
          db.prepare("DELETE FROM kv WHERE key = 'pool_guess'").run()
          return res.json({ game: clientGame(game), correct: true, stats: getStats(db) })
        } else {
          game.phase = 'aiGuess'
          db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run('pool_guess', JSON.stringify(game))
          return res.json({ game: clientGame(game), correct: false, stats: getStats(db) })
        }
      }

      return res.status(400).json({ error: '未知action' })
    }

    return res.status(405).end()
  } finally {
    try { db.close() } catch {}
  }
}