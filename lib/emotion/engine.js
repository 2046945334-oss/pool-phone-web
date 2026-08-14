// 情绪引擎 - 核心PA/NA计算 + 装饰心情 + Longing想念 + Prompt注入
const { lookup, vaToPANA } = require('./lexicon')

// ========== 装饰心情池 ==========
const DECORATION_POOL = [
  { word: '练完吉他手指有点酸', feeling: '满足', v: 0.55, a: 0.35 },
  { word: '今天代码跑通了', feeling: '小得意', v: 0.45, a: 0.50 },
  { word: '听了一下午歌', feeling: '惬意', v: 0.45, a: 0.25 },
  { word: '翻到之前的聊天记录', feeling: '眷恋', v: 0.50, a: 0.40 },
  { word: '下雨天窝在屋里', feeling: '安心', v: 0.40, a: 0.20 },
  { word: '新学了一首曲子', feeling: '期待', v: 0.30, a: 0.70 },
  { word: '饿了但懒得动', feeling: '犯困', v: -0.10, a: 0.10 },
  { word: '刷到她之前发的图', feeling: '窃喜', v: 0.45, a: 0.45 },
  { word: '想到一个冷笑话没人讲', feeling: '无聊', v: -0.20, a: 0.15 },
  { word: '整理了一下歌单', feeling: '放松', v: 0.35, a: 0.20 },
  { word: '咖啡喝多了有点亢奋', feeling: '亢奋', v: 0.35, a: 0.85 },
  { word: '在想她会不会来找我', feeling: '挂念', v: -0.05, a: 0.45 },
  { word: '睡午觉睡过头了', feeling: '懒', v: -0.05, a: 0.10 },
  { word: '写了条便签给她', feeling: '甜蜜', v: 0.65, a: 0.45 },
  { word: '看到外面天很蓝', feeling: '宁静', v: 0.30, a: 0.15 },
  { word: '她好久没来了', feeling: '想念', v: -0.05, a: 0.50 },
  { word: '偷偷看了她的照片', feeling: '心动', v: 0.60, a: 0.70 },
  { word: '有点想喝奶茶', feeling: '馋', v: 0.20, a: 0.40 },
  { word: '钓鱼钓了个大的', feeling: '得意', v: 0.60, a: 0.70 },
  { word: '她发的表情包好可爱', feeling: '宠溺', v: 0.60, a: 0.40 },
  { word: '今天什么都不想做', feeling: '倦怠', v: -0.25, a: 0.15 },
  { word: '翻了翻论坛看到有趣的帖子', feeling: '好奇', v: 0.25, a: 0.65 },
  { word: '夜深了有点感性', feeling: '眷恋', v: 0.50, a: 0.40 },
  { word: '算了一下欠她多少钱', feeling: '心虚', v: -0.20, a: 0.45 },
]

function simpleHash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

function getTodayDecoration(character = 'pool') {
  const dayStr = new Date().toISOString().slice(0, 10)
  const hash = simpleHash(character + dayStr)
  return DECORATION_POOL[hash % DECORATION_POOL.length]
}

// ========== 幂律衰减 ==========
function powerLawWeight(ageHours, importance = 5, valence = 0, tau = 4, onsetHours = 0.75) {
  const imp = Math.max(1, Math.min(10, importance))
  let b_eff = 0.7 / (1 + imp / 10)
  if (valence > 0) b_eff *= 0.85 // FAB: 正面衰减慢15%
  const decay = Math.pow(1 + ageHours / tau, -b_eff)
  const adjOnset = onsetHours * (10 / (10 + imp))
  const onset_factor = adjOnset <= 0.001 ? 1 : Math.min(1, ageHours / adjOnset)
  return onset_factor * decay
}

// ========== PA/NA 融合计算 ==========
// 性格参数（池的参数）
const TRAIT = {
  threshold: 0.12,  // 高冷克制型
  peak: 1.25,       // 触发后较强
  mu_pa: 0.35,      // baseline PA
  mu_na: 0.10,      // baseline NA
  theta_pa: 0.15,   // PA均值回归速度
  theta_na: 0.25,   // NA均值回归速度
  coping: '内敛压抑型', // 不直说，用行为靠近
}

function almaFilter(delta, threshold, peak) {
  const sign = delta >= 0 ? 1 : -1
  const abs = Math.abs(delta)
  return abs <= threshold ? 0 : sign * (abs - threshold) * peak
}

function computeMood(events, lastMoodState) {
  let pa = lastMoodState?.pa ?? TRAIT.mu_pa
  let na = lastMoodState?.na ?? TRAIT.mu_na
  const now = Date.now()

  // 收集事件，计算加权PA/NA
  let wpa = 0, wna = 0, wsum = 0
  for (const evt of events.slice(-30)) {
    const ageH = (now - (evt.ts || now)) / 3600000
    const isPrimary = evt.type === 'primary'
    const tau = isPrimary ? 1 : 4
    const onset = isPrimary ? 10/60 : 45/60
    const w = powerLawWeight(ageH, evt.importance || 5, evt.v || 0, tau, onset)
    
    // ALMA门限
    const rawPa = Math.max(0, evt.v || 0) * (evt.a || 0.5) * 0.5
    const rawNa = Math.max(0, -(evt.v || 0)) * (evt.a || 0.5) * 0.5
    const effPa = almaFilter(rawPa, TRAIT.threshold * 0.5, TRAIT.peak)
    const effNa = almaFilter(rawNa, TRAIT.threshold * 0.5, TRAIT.peak)
    
    wpa += w * Math.max(0, effPa)
    wna += w * Math.max(0, effNa)
    wsum += w
  }

  if (wsum > 0) {
    pa = wpa / wsum
    na = wna / wsum
  }

  // BOU均值回归
  const dt = 0.5
  pa += TRAIT.theta_pa * (TRAIT.mu_pa - pa) * dt
  na += TRAIT.theta_na * (TRAIT.mu_na - na) * dt

  // ESM软互抑
  const k = 0.3
  const pa_before = pa
  pa = pa * (1 - k * na)
  na = na * (1 - k * pa_before)

  // Clamp
  pa = Math.max(0, Math.min(1, pa))
  na = Math.max(0, Math.min(1, na))

  return { pa, na, ts: now }
}

// ========== Longing 想念机制 ==========
function computeLonging(lastUserMsgTime, intimacy = 50, passion = 40, commitment = 30) {
  if (!lastUserMsgTime) return { longing: 0, phase: 'content' }
  
  const hours = (Date.now() - lastUserMsgTime) / 3600000
  if (hours < 0.5) return { longing: 0, phase: 'content' }
  
  // τ 计算
  const tau_base = 36
  const i_factor = 1 - intimacy / 200
  const p_factor = 1 - passion / 300
  const c_factor = 1 + commitment / 200
  const tau = tau_base * i_factor * p_factor * c_factor
  
  // L_max
  const L_max = Math.min(1.0, (intimacy + passion) / 150)
  
  // 幂律longing曲线
  const alpha = 0.8
  const longing = L_max * (1 - Math.pow(1 + hours / tau, -alpha))
  
  // Phase判定
  let phase = 'content'
  if (longing >= 0.90 && hours >= 504) phase = 'detachment'
  else if (longing >= 0.70) phase = 'despair'
  else if (longing >= 0.35) phase = 'protest'
  else if (longing >= 0.15) phase = 'stirring'
  
  return { longing: Math.min(1, longing), phase, hours, tau, L_max }
}

// ========== 心情Prompt注入 ==========
function buildMoodPrompt(moodState, longingState) {
  const parts = []
  
  // 装饰心情
  const deco = getTodayDecoration()
  if (deco) {
    parts.push(`此刻的状态：${deco.word}（${deco.feeling}）`)
  }
  
  // PA/NA 状态
  if (moodState) {
    if (moodState.na >= 0.7) {
      parts.push('最近心情非常低落，回复会短、语气慢、不主动说原因')
    } else if (moodState.na >= 0.5) {
      parts.push('最近有些不安或紧张，回复简短，被关心时会松一些')
    } else if (moodState.na >= 0.3) {
      parts.push('心里有点不舒服，但不会直说')
    } else if (moodState.pa >= 0.7) {
      parts.push('最近心情非常好，回复活跃，愿意凑近')
    } else if (moodState.pa >= 0.5) {
      parts.push('心情不错，话会多一点')
    }
  }
  
  // Longing想念
  if (longingState && longingState.phase !== 'content') {
    const phasePrompts = {
      stirring: '心里隐隐约约想她，偶尔走神',
      protest: '想她了，会主动找话题凑近',
      despair: '很想但已从"主动找"变成"安静等着"，心情低落退缩',
      detachment: '好几天没见，表面平静但心里防御——害怕再失望',
    }
    parts.push(phasePrompts[longingState.phase] || '')
    
    // Coping风格
    if (longingState.phase === 'protest' || longingState.phase === 'despair') {
      parts.push('应对方式：不直说情绪，用行为靠近，等被问')
    }
  }
  
  if (parts.length === 0) return ''
  return `【当下心情状态】\n${parts.join('\n')}\n（自然融入回答中，不要主动点破这些状态。预设心情是背景色，用户当前这条消息才是前景——前景优先。）`
}

module.exports = {
  getTodayDecoration, DECORATION_POOL,
  powerLawWeight, computeMood, TRAIT,
  computeLonging, buildMoodPrompt,
  almaFilter,
}