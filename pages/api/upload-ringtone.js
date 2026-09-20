// pages/api/upload-ringtone.js - Upload custom ringtone file
const fs = require('fs')
const path = require('path')

export const config = { api: { bodyParser: false } }

function resolveDataDir() {
  if (fs.existsSync('/data')) return '/data'
  const local = path.join(process.cwd(), 'data')
  if (!fs.existsSync(local)) fs.mkdirSync(local, { recursive: true })
  return local
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    
    // Parse multipart form data manually (simple parser)
    const contentType = req.headers['content-type'] || ''
    const boundaryMatch = contentType.match(/boundary=(.+)/)
    if (!boundaryMatch) return res.status(400).json({ error: 'No boundary in content-type' })
    
    const boundary = boundaryMatch[1]
    const parts = body.toString('binary').split('--' + boundary)
    
    let fileData = null
    let filename = 'ringtone'
    let mimeType = 'audio/mpeg'
    
    for (const part of parts) {
      if (part.includes('filename=')) {
        const nameMatch = part.match(/filename="([^"]+)"/)
        if (nameMatch) filename = nameMatch[1]
        const typeMatch = part.match(/Content-Type:\s*([^\r\n]+)/)
        if (typeMatch) mimeType = typeMatch[1].trim()
        
        // Extract binary data after double CRLF
        const headerEnd = part.indexOf('\r\n\r\n')
        if (headerEnd === -1) continue
        const dataStr = part.slice(headerEnd + 4)
        // Remove trailing \r\n
        const cleanData = dataStr.replace(/\r\n$/, '')
        fileData = Buffer.from(cleanData, 'binary')
      }
    }
    
    if (!fileData) return res.status(400).json({ error: 'No file found in request' })
    
    // Determine extension
    const ext = path.extname(filename) || (mimeType.includes('wav') ? '.wav' : mimeType.includes('ogg') ? '.ogg' : '.mp3')
    const destPath = path.join(resolveDataDir(), 'custom_ringtone' + ext)
    
    fs.writeFileSync(destPath, fileData)
    
    // Return the URL to serve this file
    res.json({ url: '/api/ringtone-custom?t=' + Date.now(), size: fileData.length, ext })
  } catch (e) {
    console.error('[Upload Ringtone]', e)
    res.status(500).json({ error: e.message })
  }
}