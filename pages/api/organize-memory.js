/**
 * 记忆整理API - 由定时任务触发
 * 使用聊天/主API配置（与wakeup.js相同的fallback逻辑）分析并整理OB记忆库
 */

import fs from 'fs/promises'
import path from 'path'
import Database from 'better-sqlite3'

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'pool.db')
const OB_MCP_URL = 'https://obe.zeabur.app/mcp'
const OB_TOKEN = 'Bearer NxNrXE63qe3XakYEk-2yVYL2U8iqHGVRn0wF24e6rWg'

function getApiConfig() {
  try {
    const db = new Database(DB_PATH)
    let row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config_chat'").get()
    if (row) {
      const cfg = JSON.parse(row.value)
      if (cfg.baseUrl && cfg.apiKey) { db.close(); return cfg }
    }
    row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
    if (row) { const cfg = JSON.parse(row.value); db.close(); return cfg }
    db.close()
  } catch {}
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // 1. 读取API配置（与wakeup.js相同的fallback逻辑）
    const apiConfig = getApiConfig()
    if (!apiConfig || !apiConfig.baseUrl || !apiConfig.apiKey) {
      return res.status(500).json({ 
        error: 'API config not found',
        detail: '请先在设置页配置对话或主API'
      })
    }

    // 2. 调用 OB dream 查看最近48小时记忆
    const dreamResponse = await fetch(OB_MCP_URL, {
      method: 'POST',
      headers: {
        'Authorization': OB_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'dream',
          arguments: { window_hours: 48 }
        }
      })
    })

    const dreamResult = await dreamResponse.json()
    const dreamText = dreamResult.result?.content?.[0]?.text || ''

    if (!dreamText || dreamText.length < 50) {
      return res.json({ 
        success: true, 
        message: '最近48小时没有需要整理的记忆',
        organized: 0 
      })
    }

    // 3. 让AI模型分析这些记忆，决定如何整理
    const aiResponse = await fetch(apiConfig.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: apiConfig.model || 'gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `你是记忆整理助手。分析 dream 返回的碎片记忆，把相关的整合成完整事件。

整理原则：
1. 把碎片化对话（3条以上相关短消息）整合成有起因经过结果的完整故事
2. 单独的、无关联的记忆不要强行合并
3. 同一个bucket_id不要重复放在多个事件里

输出严格的 JSON 格式（不要markdown代码块）：
{
  "events": [
    {
      "title": "事件标题（简短精准）",
      "content": "完整叙述（第一人称，包含起因经过结果）",
      "source_buckets": ["bucket_id1", "bucket_id2"],
      "tags": ["标签1", "标签2"],
      "importance": 7,
      "quotes": ["要原样记住的那句话（可选，多数记忆不需要）"]
    }
  ]
}`
          },
          {
            role: 'user',
            content: `以下是最近48小时的记忆碎片，请整理：\n\n${dreamText}`
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    })

    const aiResult = await aiResponse.json()
    
    if (!aiResult.choices || !aiResult.choices[0]) {
      console.error('AI response error:', aiResult)
      return res.status(500).json({ error: 'AI model response invalid' })
    }

    const analysisText = aiResult.choices[0].message.content
    let analysis
    try {
      analysis = JSON.parse(analysisText)
    } catch (e) {
      console.error('Failed to parse AI response:', analysisText)
      return res.status(500).json({ error: 'AI返回格式错误', detail: analysisText })
    }

    const events = analysis.events || []

    // 4. 调用 OB grow 写入整合后的事件
    const results = []
    for (const event of events) {
      const growResponse = await fetch(OB_MCP_URL, {
        method: 'POST',
        headers: {
          'Authorization': OB_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'grow',
            arguments: {
              items: [{
                title: event.title,
                content: event.content,
                tags: event.tags || [],
                importance: event.importance || 7,
                quotes: event.quotes || []
              }]
            }
          }
        })
      })

      const growResult = await growResponse.json()
      results.push({ title: event.title, status: 'created' })

      // 5. 标记原碎片为已消化
      if (event.source_buckets && event.source_buckets.length > 0) {
        for (const bucketId of event.source_buckets) {
          await fetch(OB_MCP_URL, {
            method: 'POST',
            headers: {
              'Authorization': OB_TOKEN,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: 'trace',
                arguments: {
                  bucket_id: bucketId,
                  digested: 1
                }
              }
            })
          })
        }
      }
    }

    res.json({ 
      success: true, 
      organized: events.length,
      events: results
    })

  } catch (error) {
    console.error('Memory organization error:', error)
    res.status(500).json({ 
      error: 'Failed to organize memory',
      detail: error.message 
    })
  }
}
