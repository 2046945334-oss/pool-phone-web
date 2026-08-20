// pages/api/test-fishing.js - 测试钓鱼工具是否能持久化写入
import { getDb } from '../../lib/db'

export default function handler(req, res) {
  const db = getDb()

  // 读取当前数据
  const key = 'pool_fishing_v2'
  let before = null
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key)
    if (row) before = JSON.parse(row.value)
  } catch {}

  const beforeScore = before ? before.poolScore : 0
  const beforeCount = before ? before.catchCount : 0

  // 执行一次简单的钓鱼写入（加10分）
  let gd = { score: 0, poolScore: 0, catchCount: 0, catches: [], dex: [], spot: 'dongchong', bait: 'basic', baitCount: { basic: 99 } }
  if (before) Object.assign(gd, before)

  gd.poolScore += 10
  gd.catchCount += 1
  gd.catches.push({ name: '测试鱼', emoji: '🐟', weight: 0.5, rarity: 'common', spot: 'dongchong', time: Date.now(), owner: 'pool' })

  // 写入
  db.prepare('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, JSON.stringify(gd))

  // 立即读回验证
  let after = null
  try {
    const row2 = db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get(key)
    if (row2) after = { poolScore: JSON.parse(row2.value).poolScore, catchCount: JSON.parse(row2.value).catchCount, updated_at: row2.updated_at }
  } catch {}

  return res.json({
    test: 'fishing write test',
    before: { poolScore: beforeScore, catchCount: beforeCount },
    after,
    delta: after ? after.poolScore - beforeScore : null,
    success: after && after.poolScore === beforeScore + 10
  })
}
