import { getDb } from '../../lib/db'

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { role, content } = req.body
  if (!role || !content) return res.status(400).json({ error: 'role and content required' })
  
  try {
    const db = getDb()
    db.prepare('INSERT INTO chat_messages (session_id, role, content, msg_type) VALUES (?, ?, ?, ?)').run(
      'default',
      role,
      content,
      'text'
    )
    return res.json({ success: true })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
