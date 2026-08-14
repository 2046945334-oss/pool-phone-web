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

export {
  DEFAULT_BOND, ATTACHMENT_STYLES, CHARACTER_ATTACHMENT,
  getUnlockedFunctions, updateBond, passionDecay,
  getLoveType, detectReunion, reunionBoost, getLevel,
}