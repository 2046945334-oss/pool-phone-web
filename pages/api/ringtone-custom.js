// pages/api/ringtone-custom.js - Serve custom ringtone file
const fs = require('fs')
const path = require('path')

function resolveDataDir() {
  if (fs.existsSync('/data')) return '/data'
  return path.join(process.cwd(), 'data')
}

export default function handler(req, res) {
  const dataDir = resolveDataDir()
  
  // Look for custom_ringtone with any extension
  const exts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm']
  let filePath = null
  for (const ext of exts) {
    const p = path.join(dataDir, 'custom_ringtone' + ext)
    if (fs.existsSync(p)) { filePath = p; break }
  }
  
  if (!filePath) return res.status(404).json({ error: 'No custom ringtone' })
  
  const ext = path.extname(filePath).toLowerCase()
  const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm' }
  const mime = mimeMap[ext] || 'audio/mpeg'
  
  const stat = fs.statSync(filePath)
  res.setHeader('Content-Type', mime)
  res.setHeader('Content-Length', stat.size)
  res.setHeader('Cache-Control', 'no-cache')
  fs.createReadStream(filePath).pipe(res)
}