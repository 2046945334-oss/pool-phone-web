const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

// 数据目录：生产环境用持久卷 /data，开发用项目根目录
const DATA_DIR = process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data' : path.join(process.cwd(), '.data'))

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const DB_PATH = path.join(DATA_DIR, 'pool.db')

let db
function getDb() {
  if (!db || !db.open) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    
    // KV store — 通用键值存储
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `)
    
    // 聊天 Session 管理
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT DEFAULT '新对话',
        summary TEXT DEFAULT '',
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `)
    
    // 聊天消息（带session）
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER DEFAULT 1,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        msg_type TEXT DEFAULT 'text',
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)
    
    // 对话 Chunk（每10条消息切一个chunk，LLM摘要后存储）
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        msg_id_start INTEGER NOT NULL,
        msg_id_end INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        summary TEXT DEFAULT '',
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)
    
    // 长期记忆帖子
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'MEMORY',
        content TEXT NOT NULL,
        pinned INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)
    
    // 记忆评论
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        author TEXT DEFAULT 'assistant',
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)
    
    // 唤醒任务表
    db.exec(`
      CREATE TABLE IF NOT EXISTS wake_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'scheduled',
        trigger_at INTEGER NOT NULL,
        reason TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)
    
    // 旧表兼容（保留）
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `)

    // 投递箱
    db.exec(`
      CREATE TABLE IF NOT EXISTS pocket (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'todo',
        content TEXT NOT NULL,
        priority TEXT DEFAULT 'normal',
        deadline TEXT DEFAULT '',
        needs_wakeup INTEGER DEFAULT 0,
        status TEXT DEFAULT 'unread',
        result TEXT DEFAULT '',
        result_type TEXT DEFAULT '',
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `)

    // 确保默认session存在
    const sess = db.prepare('SELECT id FROM chat_sessions WHERE id = 1').get()
    if (!sess) {
      db.prepare('INSERT INTO chat_sessions (id, name) VALUES (1, ?)').run('默认对话')
    }
  }
  return db
}

module.exports = { getDb }
