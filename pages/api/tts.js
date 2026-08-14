// pages/api/tts.js - TTS proxy via MiniMax
import { getDb } from '../../lib/db'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'No text' })

  let ttsConfig = {}
  try {
    const db = getDb()
    const row = db.prepare("SELECT value FROM kv WHERE key = ?").get('pool_tts_config')
    if (row) ttsConfig = JSON.parse(row.value)
  } catch {}

  if (!ttsConfig.apiKey || !ttsConfig.groupId) {
    return res.status(400).json({ error: 'TTS not configured' })
  }

  const region = ttsConfig.region || 'china'
  const base = ttsConfig.endpoint || (region === 'global' ? 'https://api.minimaxi.chat' : 'https://api.minimax.chat')
  const model = ttsConfig.model || 'speech-02-hd'
  const voice = ttsConfig.voiceId || 'female-tianmei'

  try {
    const ttsRes = await fetch(`${base}/v1/t2a_v2?GroupId=${ttsConfig.groupId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ttsConfig.apiKey}` },
      body: JSON.stringify({
        model, text: text.slice(0, 500), stream: false,
        voice_setting: { voice_id: voice, speed: 1.0, vol: 1.0, pitch: 0 },
        audio_setting: { format: 'mp3', sample_rate: 32000 }
      })
    })
    const data = await ttsRes.json()
    if (data?.data?.audio) {
      return res.json({ audio: data.data.audio })
    }
    return res.json({ error: data?.base_resp?.status_msg || 'TTS failed', raw: data })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}