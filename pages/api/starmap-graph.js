import fs from 'fs'
import path from 'path'

const DATA_FILE = path.join(process.cwd(), 'data', 'starmap.json')

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  let stars = []
  try { stars = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) } catch {}

  // Convert to memory-starmap format
  const nodes = stars.map(s => ({
    id: s.id,
    name: s.title,
    type: s.from === 'ai' ? 'feel' : 'diary',
    importance: (s.brightness || 3) * 2,
    score: (s.brightness || 3) * 20,
    pinned: (s.brightness || 3) >= 4,
    resolved: false,
    domain: [s.from === 'ai' ? 'pool' : 'user', s.date || ''],
    content: s.content
  }))

  // Create edges between adjacent stars (simple proximity)
  const edges = []
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ source: nodes[i].id, target: nodes[i+1].id, similarity: 0.3 + Math.random() * 0.4 })
  }

  return res.json({ nodes, edges })
}
