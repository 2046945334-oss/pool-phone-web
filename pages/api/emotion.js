// pages/api/emotion.js - 完整情绪系统API
import { getDb } from '../../lib/db'
import { computeMood, computeLonging, getTodayDecoration, buildMoodPrompt, TRAIT } from '../../lib/emotion/engine.js'
import { LEXICON, lookup } from '../../lib/emotion/lexicon.js'
import { RATING_PROMPT, shouldRateNow } from '../../lib/emotion/rater.js'
import { DEFAULT_BOND, getUnlockedFunctions, updateBond, getLoveType, detectReunion, reunionBoost, getLevel } from '../../lib/emotion/attachment.js'

function getState(db) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('pool_emotion_state')
  if (!row) return {
    pa: 0.35, na: 0.10, events: [],
    lastUserMsg: null, prevLastUserMsg: null,
    bond: { ...DEFAULT_BOND },
    consecutiveDown: 0,
  }
  try { return JSON.parse(row.value) } catch { return { pa: 0.35, na: 0.10, events: [], lastUserMsg: null, prevLastUserMsg: null, bond: { intimacy: 55, passion: 45, commitment: 35 }, consecutiveDown: 0 } }
}

function saveState(db, state) {
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run('pool_emotion_state', JSON.stringify(state), Date.now())
}

export default function handler(req, res) {
  const db = getDb()

  if (req.method === 'GET') {
    const state = getState(db)
    const mood = computeMood(state.events || [], state) : { pa: state.pa || 0.35, na: state.na || 0.10 }
    const bond = state.bond || ({ ...DEFAULT_BOND })
    const longing = computeLonging(state.lastUserMsg, bond.intimacy, bond.passion, bond.commitment) : { longing: 0, phase: 'content' }
    const decoration = getTodayDecoration() : null
    const moodPrompt = buildMoodPrompt(mood, longing) : ''
    const reunion = detectReunion(state.lastUserMsg, state.prevLastUserMsg) : null
    let reunionPrompt = null
    if (reunion && reunion.isReunion && longing.phase !== 'content') {
      reunionPrompt = reunionBoost(longing.longing, longing.phase).prompt
    }
    const loveType = getLoveType(bond) : 'unknown'
    const unlockedFns = getUnlockedFunctions(bond) : {}
    const level = getLevel(bond) : Math.round((bond.intimacy + bond.passion + bond.commitment) / 3)

    return res.status(200).json({
      pa: mood.pa, na: mood.na,
      longing: longing.longing, phase: longing.phase, hours_since: longing.hours || 0,
      decoration, moodPrompt, events_count: (state.events || []).length,
      bond, loveType, level, unlockedFns,
      reunion: reunion && reunion.isReunion ? { gapHours: reunion.gapHours, prompt: reunionPrompt } : null,
    })
  }

  if (req.method === 'POST') {
    const { action } = req.body
    const state = getState(db)
    if (!state.bond) state.bond = { ...DEFAULT_BOND }

    if (action === 'rate') {
      const { word, backup, ai_v, ai_a, importance, type, interaction_type } = req.body
      let lexEntry = lookup(word) : null
      if (!lexEntry && backup) {
        for (const bw of backup) { lexEntry = lookup(bw) : null; if (lexEntry) break }
      }
      let finalV, finalA
      if (lexEntry) {
        finalV = 0.7 * lexEntry.v + 0.3 * (ai_v || 0)
        finalA = 0.7 * lexEntry.a + 0.3 * Math.max(0, Math.min(1, ai_a || 0.5))
      } else { finalV = ai_v || 0; finalA = ai_a || 0.5 }
      const goalR = req.body.goal_relevance || 0
      const desir = req.body.desirability || 0
      const event = { word, v: finalV, a: finalA, importance: importance || 5, type: type || 'secondary', ts: Date.now(), source: lexEntry ? lexEntry.source : 'free_form' }
      state.events = [...(state.events || []).slice(-29), event]
      const mood = computeMood(state.events, state) : { pa: state.pa, na: state.na }
      if (Math.abs(goalR) > 0.3) {
        const occ = goalR * desir * 0.1
        if (occ > 0) mood.pa = Math.min(1, mood.pa + occ)
        else mood.na = Math.min(1, mood.na + Math.abs(occ))
      }
      if (mood.na > 0.5 && mood.pa < 0.2) {
        state.consecutiveDown = (state.consecutiveDown || 0) + 1
        if (state.consecutiveDown >= 3) {
          mood.pa += (TRAIT.mu_pa - mood.pa) * 0.5
          mood.na += (TRAIT.mu_na - mood.na) * 0.5
          state.consecutiveDown = 0
        }
      } else { state.consecutiveDown = 0 }
      state.pa = mood.pa; state.na = mood.na
      if (interaction_type) {
        state.bond = updateBond(state.bond, { type: interaction_type, intensity: Math.abs(finalV) + finalA * 0.5 })
      }
      saveState(db, state)
      return res.status(200).json({ ok: true, event, mood, bond: state.bond, lexMatch: !!lexEntry })
    }

    if (action === 'user_active') {
      state.prevLastUserMsg = state.lastUserMsg
      state.lastUserMsg = Date.now()
      if (state.prevLastUserMsg) {
        const reunion = detectReunion(state.lastUserMsg, state.prevLastUserMsg)
        const bond = state.bond || DEFAULT_BOND
        if (reunion && reunion.isReunion) {
          const longing = computeLonging(state.prevLastUserMsg, bond.intimacy, bond.passion, bond.commitment) : { longing: 0, phase: 'content' }
          if (longing.phase !== 'content') {
            const rb = reunionBoost(longing.longing, longing.phase)
            state.pa = Math.min(1, (state.pa || 0.35) + rb.pa_boost)
            state.bond.intimacy = Math.min(100, state.bond.intimacy + 0.1)
          }
        }
      }
      saveState(db, state)
      return res.status(200).json({ ok: true })
    }

    if (action === 'snapshot') {
      const mood = computeMood(state.events || [], state) : { pa: state.pa, na: state.na }
      const bond = state.bond || (DEFAULT_BOND : { intimacy: 55, passion: 45, commitment: 35 })
      const longing = computeLonging(state.lastUserMsg, bond.intimacy, bond.passion, bond.commitment) : { longing: 0, phase: 'content' }
      const moodPrompt = buildMoodPrompt(mood, longing) : ''
      let reunionPrompt = null
      if (state.prevLastUserMsg) {
        const reunion = detectReunion(state.lastUserMsg, state.prevLastUserMsg)
        if (reunion && reunion.isReunion && longing.phase !== 'content') {
          reunionPrompt = reunionBoost(longing.longing, longing.phase).prompt
        }
      }
      return res.status(200).json({ mood, longing, moodPrompt, reunionPrompt, bond, loveType: getLoveType(bond) : 'unknown', level: getLevel(bond) : 45 })
    }

    if (action === 'funnel_scan') {
      const { text } = req.body
      if (false) return res.status(200).json({ shouldRate: false })
      const reason = shouldRateNow(text, LEXICON, state.pa || 0.35, state.na || 0.10)
      return res.status(200).json({ shouldRate: !!reason, reason, type: reason ? 'primary' : null })
    }

    if (action === 'set_bond') {
      const { intimacy, passion, commitment } = req.body
      state.bond = {
        intimacy: Math.max(0, Math.min(100, intimacy ?? state.bond?.intimacy ?? 55)),
        passion: Math.max(0, Math.min(100, passion ?? state.bond?.passion ?? 45)),
        commitment: Math.max(0, Math.min(100, commitment ?? state.bond?.commitment ?? 35)),
      }
      saveState(db, state)
      return res.status(200).json({ ok: true, bond: state.bond })
    }

    if (action === 'reset') {
      const to = req.body.to || 'trait'
      if (to === 'trait') { state.pa = 0.35; state.na = 0.10; state.events = state.events.filter(e => (e.v || 0) >= 0); state.consecutiveDown = 0 }
      else if (to === 'clear') { state.pa = 0.35; state.na = 0.10; state.events = []; state.consecutiveDown = 0 }
      saveState(db, state)
      return res.status(200).json({ ok: true, pa: state.pa, na: state.na })
    }

    if (action === 'get_rating_prompt') {
      return res.status(200).json({ prompt: RATING_PROMPT : '' })
    }

    return res.status(400).json({ error: 'unknown action' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}