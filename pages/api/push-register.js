export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  const { token } = req.body || {}
  if (!token) {
    return res.status(400).json({ error: 'Missing token' })
  }

  // 存储 FCM token（简单实现：存到文件或内存）
  // 后续可以存到数据库
  const fs = require('fs')
  const path = require('path')
  const tokenFile = path.join(process.cwd(), 'data', 'fcm_tokens.json')
  
  try {
    const dir = path.dirname(tokenFile)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    
    let tokens = []
    if (fs.existsSync(tokenFile)) {
      tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'))
    }
    
    // 去重后添加
    if (!tokens.includes(token)) {
      tokens.push(token)
      fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2))
    }
    
    console.log(`[push-register] FCM token registered. Total: ${tokens.length}`)
    res.status(200).json({ ok: true, total: tokens.length })
  } catch (e) {
    console.error('[push-register] Error:', e)
    res.status(500).json({ error: e.message })
  }
}