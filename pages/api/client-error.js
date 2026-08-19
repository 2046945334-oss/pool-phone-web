import { getDb } from '../../lib/db'
export default function handler(req, res) {
  try {
    const db = getDb()
    if (req.method === 'POST') {
      const errStr = JSON.stringify(req.body)
      db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('_client_error_last', ?)").run(errStr)
      // Also append to list
      const existing = db.prepare("SELECT value FROM kv WHERE key = '_client_errors'").get()
      let list = []
      try { list = JSON.parse(existing?.value || '[]') } catch {}
      list.push({ time: new Date().toISOString(), ...req.body })
      if (list.length > 20) list = list.slice(-20)
      db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('_client_errors', ?)").run(JSON.stringify(list))
      return res.json({ ok: true })
    }
    // GET - return stored errors
    const row = db.prepare("SELECT value FROM kv WHERE key = '_client_errors'").get()
    return res.json({ errors: JSON.parse(row?.value || '[]') })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
