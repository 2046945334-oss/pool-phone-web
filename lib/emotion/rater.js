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

module.exports = { RATING_PROMPT, shouldRateNow }