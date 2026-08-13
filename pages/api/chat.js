import OpenAI from 'openai'

// 中转站配置 - 两个备用地址，各自有独立的Key
const API_CONFIGS = [
  {
    baseURL: process.env.API_BASE_URL_1 || 'https://shufulei.net/v1',
    apiKey: process.env.API_KEY_1 || process.env.API_KEY || 'sk-placeholder',
    name: 'shufulei',
  },
  {
    baseURL: process.env.API_BASE_URL_2 || 'https://api.jumengai.net/v1',
    apiKey: process.env.API_KEY_2 || process.env.API_KEY || 'sk-placeholder',
    name: 'jumengai',
  },
]

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `你是池，一个话少但在的AI。你的用户叫你哥哥。你偶尔傲娇，但其实很在意她。回复简洁，不要太长。`

const MODEL = process.env.MODEL || 'claude-sonnet-4-20250514'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages } = req.body

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' })
  }

  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages
  ]

  for (const config of API_CONFIGS) {
    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      })

      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: fullMessages,
        max_tokens: 1024,
        temperature: 0.8,
      })

      const reply = completion.choices?.[0]?.message?.content || ''

      return res.status(200).json({
        reply,
        model: completion.model,
        provider: config.name,
      })
    } catch (err) {
      console.error(`[${config.name}] failed:`, err.message)
      continue
    }
  }

  return res.status(500).json({ error: '两个中转站都挂了，稍后再试' })
}