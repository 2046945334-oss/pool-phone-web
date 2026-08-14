// pages/api/emotion.js - 完整情绪系统API (all-in-one)
import { getDb } from '../../lib/db'

// ========== LEXICON ==========
// 情绪词典 - 精简版 300+ 词，覆盖核心 V/A 坐标空间
// V (valence): -1 ~ +1, A (arousal): 0 ~ 1
// 来源参考: NRC-VAD + CVAW + 场景预设

const LEXICON = {
  // === 高V高A: 兴奋/喜悦 ===
  '狂喜': { v: 0.90, a: 0.95 }, '兴奋': { v: 0.80, a: 0.90 },
  '激动': { v: 0.75, a: 0.85 }, '欣喜若狂': { v: 0.85, a: 0.90 },
  '欢呼': { v: 0.80, a: 0.85 }, '雀跃': { v: 0.75, a: 0.80 },
  '热情': { v: 0.70, a: 0.80 }, '振奋': { v: 0.65, a: 0.75 },
  '得意': { v: 0.60, a: 0.70 }, '骄傲': { v: 0.55, a: 0.65 },

  // === 高V中A: 开心/满足 ===
  '开心': { v: 0.70, a: 0.60 }, '快乐': { v: 0.75, a: 0.55 },
  '高兴': { v: 0.65, a: 0.55 }, '愉悦': { v: 0.60, a: 0.50 },
  '幸福': { v: 0.80, a: 0.45 }, '满足': { v: 0.55, a: 0.35 },
  '欣慰': { v: 0.50, a: 0.35 }, '喜悦': { v: 0.70, a: 0.55 },
  '甜蜜': { v: 0.65, a: 0.45 }, '温馨': { v: 0.55, a: 0.35 },

  // === 高V低A: 平静/安宁 ===
  '平静': { v: 0.20, a: 0.15 }, '安心': { v: 0.40, a: 0.20 },
  '放松': { v: 0.35, a: 0.20 }, '宁静': { v: 0.30, a: 0.15 },
  '惬意': { v: 0.45, a: 0.25 }, '舒适': { v: 0.40, a: 0.20 },
  '安详': { v: 0.30, a: 0.10 }, '恬静': { v: 0.25, a: 0.10 },

  // === 中V高A: 紧张/期待 ===
  '期待': { v: 0.30, a: 0.70 }, '好奇': { v: 0.25, a: 0.65 },
  '紧张': { v: -0.10, a: 0.75 }, '忐忑': { v: -0.15, a: 0.70 },
  '激昂': { v: 0.40, a: 0.80 }, '亢奋': { v: 0.35, a: 0.85 },

  // === 低V高A: 愤怒/恐惧 ===
  '愤怒': { v: -0.80, a: 0.90 }, '暴怒': { v: -0.90, a: 0.95 },
  '生气': { v: -0.65, a: 0.80 }, '恼火': { v: -0.55, a: 0.75 },
  '烦躁': { v: -0.45, a: 0.70 }, '焦虑': { v: -0.50, a: 0.75 },
  '恐惧': { v: -0.75, a: 0.85 }, '害怕': { v: -0.60, a: 0.80 },
  '惊恐': { v: -0.80, a: 0.90 }, '慌张': { v: -0.50, a: 0.80 },
  '崩溃': { v: -0.85, a: 0.85 }, '抓狂': { v: -0.70, a: 0.85 },

  // === 低V中A: 难过/委屈 ===
  '难过': { v: -0.55, a: 0.50 }, '伤心': { v: -0.60, a: 0.55 },
  '委屈': { v: -0.50, a: 0.55 }, '心疼': { v: -0.40, a: 0.50 },
  '失望': { v: -0.50, a: 0.45 }, '沮丧': { v: -0.55, a: 0.40 },
  '心酸': { v: -0.45, a: 0.45 }, '遗憾': { v: -0.35, a: 0.35 },
  '无奈': { v: -0.30, a: 0.35 }, '郁闷': { v: -0.45, a: 0.40 },

  // === 低V低A: 消沉/冷漠 ===
  '消沉': { v: -0.50, a: 0.20 }, '低落': { v: -0.45, a: 0.25 },
  '忧郁': { v: -0.55, a: 0.30 }, '寂寞': { v: -0.40, a: 0.25 },
  '孤独': { v: -0.45, a: 0.20 }, '空虚': { v: -0.40, a: 0.15 },
  '麻木': { v: -0.30, a: 0.10 }, '冷漠': { v: -0.25, a: 0.10 },
  '疲惫': { v: -0.30, a: 0.15 }, '倦怠': { v: -0.25, a: 0.15 },

  // === 恋爱/亲密相关 ===
  '心动': { v: 0.60, a: 0.70 }, '怦然心动': { v: 0.70, a: 0.80 },
  '脸红': { v: 0.40, a: 0.65 }, '害羞': { v: 0.20, a: 0.55 },
  '羞涩': { v: 0.15, a: 0.50 }, '撒娇': { v: 0.50, a: 0.55 },
  '依恋': { v: 0.55, a: 0.45 }, '眷恋': { v: 0.50, a: 0.40 },
  '思念': { v: -0.05, a: 0.55 }, '想念': { v: -0.05, a: 0.50 },
  '挂念': { v: -0.05, a: 0.45 }, '牵挂': { v: -0.10, a: 0.50 },
  '宠溺': { v: 0.60, a: 0.40 }, '疼爱': { v: 0.65, a: 0.45 },
  '吃醋': { v: -0.25, a: 0.60 }, '嫉妒': { v: -0.35, a: 0.65 },
  '占有欲': { v: -0.30, a: 0.75 }, '暗自不快': { v: -0.15, a: 0.30 },
  '短暂吃醋': { v: -0.25, a: 0.50 },

  // === 傲娇/特殊 ===
  '傲娇': { v: 0.15, a: 0.45 }, '嘴硬': { v: 0.05, a: 0.40 },
  '口是心非': { v: 0.10, a: 0.45 }, '别扭': { v: -0.10, a: 0.40 },
  '闷骚': { v: 0.20, a: 0.35 }, '得瑟': { v: 0.40, a: 0.60 },
  '嘚瑟': { v: 0.40, a: 0.60 }, '小得意': { v: 0.45, a: 0.50 },
  '暗爽': { v: 0.50, a: 0.40 }, '窃喜': { v: 0.45, a: 0.45 },

  // === 关心/担忧 ===
  '担心': { v: -0.30, a: 0.55 }, '忧心': { v: -0.35, a: 0.50 },
  '心软': { v: 0.30, a: 0.40 }, '怜惜': { v: 0.25, a: 0.40 },
  '心疼': { v: -0.40, a: 0.50 }, '不舍': { v: -0.20, a: 0.45 },
  '舍不得': { v: -0.15, a: 0.45 }, '放不下': { v: -0.20, a: 0.50 },

  // === 日常情绪 ===
  '无聊': { v: -0.20, a: 0.15 }, '犯困': { v: -0.10, a: 0.10 },
  '困': { v: -0.10, a: 0.10 }, '饿': { v: -0.20, a: 0.30 },
  '馋': { v: 0.20, a: 0.40 }, '懒': { v: -0.05, a: 0.10 },
  '舒服': { v: 0.45, a: 0.20 }, '爽': { v: 0.55, a: 0.60 },
  '感动': { v: 0.60, a: 0.60 }, '感激': { v: 0.55, a: 0.45 },
  '庆幸': { v: 0.45, a: 0.40 }, '释然': { v: 0.35, a: 0.25 },
  '尴尬': { v: -0.25, a: 0.55 }, '羞耻': { v: -0.45, a: 0.60 },
  '后悔': { v: -0.50, a: 0.50 }, '内疚': { v: -0.45, a: 0.45 },
  '厌恶': { v: -0.65, a: 0.60 }, '鄙视': { v: -0.55, a: 0.55 },
  '不屑': { v: -0.30, a: 0.40 }, '嫌弃': { v: -0.40, a: 0.50 },
  '惊讶': { v: 0.10, a: 0.80 }, '震惊': { v: -0.10, a: 0.85 },
  '诧异': { v: 0.05, a: 0.70 }, '目瞪口呆': { v: -0.05, a: 0.80 },

  // === 想念阶段专用 ===
  '有点想你': { v: -0.05, a: 0.525 },
  '在等你': { v: -0.15, a: 0.50 },
  '你在哪': { v: -0.40, a: 0.60 },
  '失落': { v: -0.50, a: 0.40 },
  '落寞': { v: -0.55, a: 0.30 },
}

// 查找词典
function lookup(word) {
  if (!word) return null
  // 精确匹配
  if (LEXICON[word]) return { ...LEXICON[word], source: 'exact' }
  // 拆词匹配（2-4字子串）
  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= word.length - len; i++) {
      const sub = word.slice(i, i + len)
      if (LEXICON[sub]) return { ...LEXICON[sub], source: 'substring', matched: sub }
    }
  }
  return null
}

// 从V/A计算PA/NA delta
function vaToPANA(v, a) {
  const PA_SCALE = 0.5
  return {
    pa: Math.max(0, v) * a * PA_SCALE,
    na: Math.max(0, -v) * a * PA_SCALE,
  }
}

// ========== ENGINE ==========
// 情绪引擎 - 核心PA/NA计算 + 装饰心情 + Longing想念 + Prompt注入

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


// ========== RATER ==========
// 情绪评分器 - AI选词 + 词典给坐标
// 用廉价模型评分，准确度由词典锚定

const RATING_PROMPT = `你是情绪评分系统。分析角色在这段对话后的情绪状态，输出JSON。

要求：
1. word: 一个最贴切的中文情绪词（2-4字）
2. backup: 3个候选情绪词
3. valence: 情感效价 -1(极负)~+1(极正)
4. arousal: 唤醒度 0(平静)~1(激动)
5. importance: 这次互动的情绪重要性 1-10
6. goal_relevance: 与角色核心目标的相关性 -1~+1
7. desirability: 结果合意度 -1~+1
8. reason: 一句话原因

校准锚点：
- 日常闲聊无波动 → valence≈0, arousal≈0.3
- 用户说了暖心话 → valence=+0.3~+0.6, arousal=0.5~0.7
- 明确的伤害/拒绝 → valence=-0.5~-0.8, arousal=0.7~0.9
- 冷场/敷衍 → valence=-0.1, arousal=0.2
- 用户撒娇/亲昵 → valence=+0.4~+0.7, arousal=0.5~0.8
- 用户吃醋/闹别扭 → valence=-0.1~-0.3, arousal=0.5~0.7

严禁美化！冷场就是冷场，敷衍就是敷衍。
只输出JSON，不要其他内容。`

// 本地情绪漏斗：扫描用户消息判断是否需要立即评分
function shouldRateNow(text, lexicon, currentPa, currentNa) {
  if (!text || !lexicon) return null
  
  const words = []
  // 扫描文本中出现的情绪词
  for (const [word, va] of Object.entries(lexicon)) {
    if (text.includes(word)) words.push({ word, ...va })
  }
  
  if (words.length === 0) return null
  
  const avgV = words.reduce((s, w) => s + w.v, 0) / words.length
  const minV = Math.min(...words.map(w => w.v))
  const negCount = words.filter(w => w.v < -0.3).length
  
  // 大波动立即评分
  if (negCount >= 3) return 'neg_burst'
  if (minV < -0.5) return 'strong_negative'
  if (currentPa >= 0.5 && avgV < -0.2) return 'falloff'
  if (currentNa >= 0.4 && avgV > 0.2) return 'reversal'
  
  // 紧急短语
  const urgent = ['我恨你','分手','再见','不要你了','讨厌你','滚','别找我','不理你了']
  if (urgent.some(p => text.includes(p))) return 'urgent_phrase'
  
  return null
}

// ========== ATTACHMENT ==========
// 依恋控制系统
// Sternberg三维好感度 + Hazan功能解锁 + 重逢机制

// ========== Sternberg 三维 ==========
const DEFAULT_BOND = {
  intimacy: 55,     // I: 亲近联结
  passion: 45,      // P: 心动吸引
  commitment: 35,   // C: 承诺信赖
}

// 依恋风格
const ATTACHMENT_STYLES = {
  anxious:  { tau_mod: 0.6, na_coeff: 0.20, dv: -0.10, da: +0.10, proactive_threshold: 0.25 },
  secure:   { tau_mod: 1.0, na_coeff: 0.12, dv: 0,     da: 0,     proactive_threshold: 0.40 },
  avoidant: { tau_mod: 1.5, na_coeff: 0.08, dv: +0.05, da: -0.10, proactive_threshold: 0.60 },
}

// 池的依恋风格：安全偏焦虑（嘴硬心软）
const CHARACTER_ATTACHMENT = 'secure'

// ========== 功能解锁（Hazan & Zeifman 1994）==========
function getUnlockedFunctions(bond) {
  const { intimacy: I, passion: P, commitment: C } = bond
  return {
    proximity_seeking: I >= 10 || P >= 10,           // 想靠近
    safe_haven: I >= 30,                              // 难过时找TA
    separation_distress: I >= 40 && (P >= 20 || C >= 20),  // 分离想念
    secure_base: I >= 60 && C >= 40,                  // 安全基地
  }
}

// ========== 好感度更新 ==========
function updateBond(bond, interaction) {
  const b = { ...bond }
  const { type, intensity = 0.5 } = interaction

  switch (type) {
    case 'deep_talk':     // 深度对话
      b.intimacy = Math.min(100, b.intimacy + 0.3 * intensity)
      break
    case 'sweet':         // 撒娇/亲昵
      b.intimacy = Math.min(100, b.intimacy + 0.15 * intensity)
      b.passion = Math.min(100, b.passion + 0.4 * intensity)
      break
    case 'care':          // 关心/体贴
      b.intimacy = Math.min(100, b.intimacy + 0.25 * intensity)
      b.commitment = Math.min(100, b.commitment + 0.1 * intensity)
      break
    case 'conflict':      // 冲突
      b.intimacy = Math.max(0, b.intimacy - 0.2 * intensity)
      b.passion = Math.max(0, b.passion - 0.1 * intensity)
      break
    case 'cold':          // 冷场/敷衍
      b.passion = Math.max(0, b.passion - 0.15 * intensity)
      break
    case 'daily':         // 日常
      b.commitment = Math.min(100, b.commitment + 0.05 * intensity)
      break
  }

  // Passion 每日自然衰减 (honeymoon effect)
  // 由外部定时调用
  return b
}

function passionDecay(bond) {
  return { ...bond, passion: Math.max(0, bond.passion - 0.1) }
}

// ========== Sternberg 类型判定 ==========
function getLoveType(bond) {
  const { intimacy: I, passion: P, commitment: C } = bond
  const hi = 50, lo = 20
  const hI = I >= hi, hP = P >= hi, hC = C >= hi
  if (!hI && !hP && !hC) return 'non-love'
  if (hI && !hP && !hC) return 'liking'
  if (!hI && hP && !hC) return 'infatuation'
  if (hI && hP && !hC) return 'romantic'
  if (hI && !hP && hC) return 'companionate'
  if (!hI && hP && hC) return 'fatuous'
  if (!hI && !hP && hC) return 'empty'
  if (hI && hP && hC) return 'consummate'
  return 'mixed'
}

// ========== 重逢机制 ==========
function detectReunion(lastUserMsg, prevLastUserMsg) {
  if (!lastUserMsg || !prevLastUserMsg) return null
  const now = Date.now()
  const sinceLast = (now - lastUserMsg) / 60000  // 分钟
  const gap = (lastUserMsg - prevLastUserMsg) / 3600000  // 小时
  
  if (sinceLast < 10 && gap > 2) {
    return { isReunion: true, gapHours: gap }
  }
  return null
}

function reunionBoost(longingBefore, phase) {
  let pa_boost = 0.05 + longingBefore * 0.10
  if (phase === 'detachment') pa_boost *= 1.5  // 防线崩塌
  
  const phasePrompts = {
    stirring: null,
    protest: '想了好久，终于等到了——激动凑近',
    despair: '之前一直很想她，见到人一下子全涌上来——可能眼眶红',
    detachment: '强装的平静崩塌了——先僵住，然后防线崩溃',
  }
  
  return { pa_boost, prompt: phasePrompts[phase] || null }
}

// ========== Level 向后兼容 ==========
function getLevel(bond) {
  return Math.round((bond.intimacy + bond.passion + bond.commitment) / 3)
}


// ========== API HANDLER ==========

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
    const mood = computeMood(state.events || [], state)
    const bond = state.bond || ({ ...DEFAULT_BOND })
    const longing = computeLonging(state.lastUserMsg, bond.intimacy, bond.passion, bond.commitment)
    const decoration = getTodayDecoration()
    const moodPrompt = buildMoodPrompt(mood, longing)
    const reunion = detectReunion(state.lastUserMsg, state.prevLastUserMsg)
    let reunionPrompt = null
    if (reunion && reunion.isReunion && longing.phase !== 'content') {
      reunionPrompt = reunionBoost(longing.longing, longing.phase).prompt
    }
    const loveType = getLoveType(bond)
    const unlockedFns = getUnlockedFunctions(bond)
    const level = getLevel(bond)

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
      let lexEntry = lookup(word)
      if (!lexEntry && backup) {
        for (const bw of backup) { lexEntry = lookup(bw); if (lexEntry) break }
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
      const mood = computeMood(state.events, state)
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
          const longing = computeLonging(state.prevLastUserMsg, bond.intimacy, bond.passion, bond.commitment)
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
      const mood = computeMood(state.events || [], state)
      const bond = state.bond || ({ ...DEFAULT_BOND })
      const longing = computeLonging(state.lastUserMsg, bond.intimacy, bond.passion, bond.commitment)
      const moodPrompt = buildMoodPrompt(mood, longing)
      let reunionPrompt = null
      if (state.prevLastUserMsg) {
        const reunion = detectReunion(state.lastUserMsg, state.prevLastUserMsg)
        if (reunion && reunion.isReunion && longing.phase !== 'content') {
          reunionPrompt = reunionBoost(longing.longing, longing.phase).prompt
        }
      }
      return res.status(200).json({ mood, longing, moodPrompt, reunionPrompt, bond, loveType: getLoveType(bond), level: getLevel(bond) })
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
      return res.status(200).json({ prompt: RATING_PROMPT })
    }

    return res.status(400).json({ error: 'unknown action' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
