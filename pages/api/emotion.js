// pages/api/emotion.js - 情绪系统API
import { getDb } from '../../lib/db'

// 这些模块在服务端运行
let engine, lexicon
try {
  engine = require('../../lib/emotion/engine')
  lexicon = require('../../lib/emotion/lexicon')
} catch(e) {
  console.error('emotion modules not loaded:', e.message)
}

function getState(db) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_emotion_state')
  if (!row) return { pa: 0.35, na: 0.10, events: [], lastUserMsg: null, longing: {} }
  try { return JSON.parse(row.value) } catch { return { pa: 0.35, na: 0.10, events: [], lastUserMsg: null, longing: {} } }
}

function saveState(db, state) {
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run('pool_emotion_state', JSON.stringify(state), Date.now())
}

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'GET') {
    // 获取当前心情快照
    const state = getState(db)
    const mood = engine ? engine.computeMood(state.events || [], state) : { pa: state.pa, na: state.na }
    const longing = engine ? engine.computeLonging(state.lastUserMsg) : { longing: 0, phase: 'content' }
    const decoration = engine ? engine.getTodayDecoration() : null
    const moodPrompt = engine ? engine.buildMoodPrompt(mood, longing) : ''
    
    return res.status(200).json({
      pa: mood.pa,
      na: mood.na,
      longing: longing.longing,
      phase: longing.phase,
      hours_since: longing.hours || 0,
      decoration,
      moodPrompt,
      events_count: (state.events || []).length,
    })
  }

  if (req.method === 'POST') {
    const { action } = req.body
    const state = getState(db)

    if (action === 'rate') {
      // 评分：AI选词 + 词典给坐标
      const { word, backup, ai_v, ai_a, importance, type } = req.body
      
      // 5层词典匹配
      let lexEntry = lexicon ? lexicon.lookup(word) : null
      if (!lexEntry && backup) {
        for (const bw of backup) {
          lexEntry = lexicon ? lexicon.lookup(bw) : null
          if (lexEntry) break
        }
      }
      
      // 70/30融合
      let finalV, finalA
      if (lexEntry) {
        finalV = 0.7 * lexEntry.v + 0.3 * (ai_v || 0)
        finalA = 0.7 * lexEntry.a + 0.3 * (ai_a || 0.5)
      } else {
        finalV = ai_v || 0
        finalA = ai_a || 0.5
      }
      
      const event = {
        word, v: finalV, a: finalA,
        importance: importance || 5,
        type: type || 'secondary',
        ts: Date.now(),
        source: lexEntry ? lexEntry.source : 'free_form',
      }
      
      state.events = [...(state.events || []).slice(-29), event]
      const mood = engine ? engine.computeMood(state.events, state) : { pa: state.pa, na: state.na }
      state.pa = mood.pa
      state.na = mood.na
      saveState(db, state)
      
      return res.status(200).json({ ok: true, event, mood, lexMatch: !!lexEntry })
    }

    if (action === 'user_active') {
      // 用户发消息时调用，更新lastUserMsg时间
      state.lastUserMsg = Date.now()
      saveState(db, state)
      return res.status(200).json({ ok: true })
    }

    if (action === 'snapshot') {
      // 获取完整快照（含心情prompt）
      const mood = engine ? engine.computeMood(state.events || [], state) : { pa: state.pa, na: state.na }
      const longing = engine ? engine.computeLonging(state.lastUserMsg) : { longing: 0, phase: 'content' }
      const moodPrompt = engine ? engine.buildMoodPrompt(mood, longing) : ''
      return res.status(200).json({ mood, longing, moodPrompt })
    }

    return res.status(400).json({ error: 'unknown action' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}