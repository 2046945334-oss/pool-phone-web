// lib/memory.js — 精简版：只保留消息存取，长期记忆全部走 Ombre Brain
const { getDb } = require('./db')

// === 消息存储 ===

function saveMessage(sessionId, role, content, msgType = 'text') {
  const db = getDb()
  const serialized = typeof content === 'string' ? content : JSON.stringify(content)
  const r = db.prepare(
    'INSERT INTO chat_messages (session_id, role, content, msg_type) VALUES (?, ?, ?, ?)'
  ).run(sessionId, role, serialized, msgType)
  db.prepare('UPDATE chat_sessions SET updated_at = unixepoch() WHERE id = ?').run(sessionId)
  return r.lastInsertRowid
}

function getRecentMessages(sessionId, limit = 20) {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
  ).all(sessionId, limit).reverse()
}

module.exports = {
  saveMessage,
  getRecentMessages,
}
