export default function handler(req, res) {
  if (req.method === 'POST') {
    console.error('[CLIENT ERROR]', JSON.stringify(req.body))
    return res.json({ ok: true })
  }
  // GET - return last errors
  return res.json({ msg: 'POST to report errors' })
}
