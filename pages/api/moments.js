// pages/api/moments.js — 朋友圈API
import { getDb } from '../../lib/db'

function randomDelay(minMin, maxMin) {
  return Math.round(minMin + Math.random() * (maxMin - minMin))
}

function getBjTime() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
}

function initMomentsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL DEFAULT '',
      context_note TEXT,
      image_description TEXT,
      images TEXT NOT NULL DEFAULT '[]',
      reply_due_at INTEGER,
      reply_status TEXT NOT NULL DEFAULT 'pending',
      liked INTEGER NOT NULL DEFAULT 0,
      reply_content TEXT,
      replied_at TEXT,
      user_liked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS moment_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      moment_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      reply_due_at INTEGER,
      reply_status TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    )
  `)
}

export default async function handler(req, res) {
  const db = getDb()
  initMomentsTable(db)

  // GET — 获取朋友圈列表（惰性触发回复生成）
  if (req.method === 'GET') {
    // 先处理到期的待回复
    const now = Math.floor(Date.now() / 1000)
    const dueMoments = db.prepare(
      "SELECT * FROM moments WHERE reply_status = 'pending' AND reply_due_at <= ? AND author = 'user' LIMIT 3"
    ).all(now)
    
    // 标记为processing避免重复（简单方案）
    for (const m of dueMoments) {
      db.prepare("UPDATE moments SET reply_status = 'processing' WHERE id = ? AND reply_status = 'pending'").run(m.id)
    }

    // 查询所有动态
    const moments = db.prepare(
      "SELECT * FROM moments ORDER BY created_at DESC LIMIT 30"
    ).all()

    // 查询评论
    const allComments = db.prepare(
      "SELECT * FROM moment_comments ORDER BY created_at ASC"
    ).all()

    const result = moments.map(m => ({
      ...m,
      images: JSON.parse(m.images || '[]'),
      liked: !!m.liked,
      user_liked: !!m.user_liked,
      comments: allComments.filter(c => c.moment_id === m.id)
    }))

    return res.json({ entries: result, pendingReplies: dueMoments.length })
  }

  // POST — 发一条动态
  if (req.method === 'POST') {
    const { content, images, author, context_note } = req.body
    if (!content) return res.status(400).json({ error: '内容不能为空' })

    const who = author || 'user'
    const delayMin = who === 'pool' ? 0 : randomDelay(5, 15)
    const replyDueAt = Math.floor(Date.now() / 1000) + delayMin * 60
    const replyStatus = who === 'pool' ? 'done' : 'pending'

    const stmt = db.prepare(
      `INSERT INTO moments (author, content, context_note, images, reply_due_at, reply_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const info = stmt.run(
      who,
      content,
      context_note || null,
      JSON.stringify(images || []),
      replyDueAt,
      replyStatus,
      getBjTime()
    )

    return res.json({ ok: true, id: info.lastInsertRowid, reply_due_in: delayMin + '分钟' })
  }

  // PATCH — 点赞/取消赞
  if (req.method === 'PATCH') {
    const { id, action, comment_content } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })

    if (action === 'user_like') {
      const m = db.prepare("SELECT * FROM moments WHERE id = ?").get(id)
      if (!m) return res.status(404).json({ error: 'not found' })
      db.prepare("UPDATE moments SET user_liked = ? WHERE id = ?").run(m.user_liked ? 0 : 1, id)
      return res.json({ ok: true, user_liked: !m.user_liked })
    }

    if (action === 'comment') {
      if (!comment_content) return res.status(400).json({ error: 'comment_content required' })
      const delayMin = randomDelay(3, 8)
      const replyDueAt = Math.floor(Date.now() / 1000) + delayMin * 60
      db.prepare(
        `INSERT INTO moment_comments (moment_id, author, content, reply_due_at, reply_status, created_at)
         VALUES (?, 'user', ?, ?, 'pending', ?)`
      ).run(id, comment_content, replyDueAt, getBjTime())
      return res.json({ ok: true, reply_in: delayMin + '分钟' })
    }

    return res.status(400).json({ error: 'unknown action' })
  }

  res.setHeader('Allow', 'GET, POST, PATCH')
  return res.status(405).end()
}

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } }
}