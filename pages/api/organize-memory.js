/**
 * 记忆整理API - 由定时任务触发
 * 使用聊天/主API配置（与wakeup.js相同的fallback逻辑）
 * OB MCP连接信息从数据库pool_mcp_connections读取
 */

import path from 'path'
import Database from 'better-sqlite3'
import fs from 'fs'

const DATA_DIR = process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data' : path.join(process.cwd(), '.data'))
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
const DB_PATH = path.join(DATA_DIR, 'pool.db')

function getApiConfig() {
  try {
    const db = new Database(DB_PATH, { readonly: true })
    let row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config_chat'").get()
    if (row) {
      const cfg = JSON.parse(row.value)
      if (cfg.baseUrl && cfg.apiKey) { db.close(); return cfg }
    }
    row = db.prepare("SELECT value FROM kv WHERE key = 'pool_api_config'").get()
    if (row) {
      const cfg = JSON.parse(row.value)
      if (cfg.apiBase) cfg.baseUrl = cfg.apiBase
      if (cfg.baseUrl && cfg.apiKey) { db.close(); return cfg }
    }
    db.close()
  } catch (e) {
    console.error('[organize-memory] getApiConfig error:', e.message)
  }
  return null
}

function getObConnection() {
  try {
    const db = new Database(DB_PATH, { readonly: true })
    const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_mcp_connections'").get()
    db.close()
    if (!row) return null
    const conns = JSON.parse(row.value)
    const ob = conns.find(c => c.enabled && c.url && c.url.includes('obe'))
    if (ob) return { url: ob.url, token: ob.token }
  } catch (e) {
    console.error('[organize-memory] getObConnection error:', e.message)
  }
  return null
}

/**
 * 健壮的JSON解析：处理markdown代码块、转义字符等
 */
function robustJsonParse(text) {
  if (!text || typeof text !== 'string') return null

  // 尝试1：直接解析
  try { return JSON.parse(text) } catch (e) { /* continue */ }

  // 尝试2：去掉markdown代码块 ```json ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()) } catch (e) { /* continue */ }
  }

  // 尝试3：提取第一个 { 到最后一个 } 之间的内容
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const extracted = text.substring(firstBrace, lastBrace + 1)
    try { return JSON.parse(extracted) } catch (e) { /* continue */ }
  }

  // 尝试4：处理literal \n（模型输出的不是真换行而是\n字符串）
  // 以及修复常见的JSON格式问题
  try {
    let cleaned = text
    // 如果整个文本被引号包裹（字符串化的JSON），先解一层
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = JSON.parse(cleaned)
    }
    return JSON.parse(cleaned)
  } catch (e) { /* continue */ }

  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // 1. 读取API配置
    const apiConfig = getApiConfig()
    if (!apiConfig || !apiConfig.baseUrl || !apiConfig.apiKey) {
      return res.status(500).json({ 
        error: 'API config not found',
        detail: '请先在设置页配置对话或主API'
      })
    }

    // 2. 读取OB MCP连接
    const obConn = getObConnection()
    if (!obConn) {
      return res.status(500).json({
        error: 'OB MCP connection not found',
        detail: '请先在MCP管理中配置Ombre Brain连接'
      })
    }

    const obHeaders = { 'Content-Type': 'application/json' }
    if (obConn.token) obHeaders['Authorization'] = `Bearer ${obConn.token}`

    // 3. 调用 OB dream 查看最近48小时记忆
    const dreamResponse = await fetch(obConn.url, {
      method: 'POST',
      headers: obHeaders,
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

    // 4. 让AI模型分析这些记忆，决定如何整理
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
            content: '你是记忆整理助手。分析 dream 返回的碎片记忆，把相关的整合成完整事件。\n\n整理原则：\n1. 把碎片化对话（3条以上相关短消息）整合成有起因经过结果的完整故事\n2. 单独的、无关联的记忆不要强行合并\n3. 同一个bucket_id不要重复放在多个事件里\n\n你必须且只能输出一个合法的JSON对象，不要输出任何其他文本、注释或markdown。格式：\n{"events":[{"title":"事件标题","content":"完整叙述","source_buckets":["id1","id2"],"tags":["标签"],"importance":7,"quotes":[]}]}'
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
      return res.status(500).json({ error: 'AI model response invalid', detail: JSON.stringify(aiResult).substring(0, 500) })
    }

    const analysisText = aiResult.choices[0].message.content
    const analysis = robustJsonParse(analysisText)
    
    if (!analysis) {
      console.error('Failed to parse AI response:', analysisText?.substring(0, 500))
      return res.status(500).json({ 
        error: 'AI返回格式错误', 
        detail: (analysisText || '').substring(0, 300),
        hint: '模型未返回有效JSON，请检查模型是否支持json_object格式'
      })
    }

    const events = analysis.events || []

    if (events.length === 0) {
      return res.json({
        success: true,
        message: 'AI分析后认为无需整合',
        organized: 0
      })
    }

    // 5. 调用 OB grow 写入整合后的事件
    const results = []
    for (const event of events) {
      try {
        const growResp = await fetch(obConn.url, {
          method: 'POST',
          headers: obHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'grow',
              arguments: {
                items: [{
                  title: event.title || '未命名事件',
                  content: event.content || '',
                  tags: event.tags || [],
                  importance: event.importance || 7,
                  quotes: event.quotes || []
                }]
              }
            }
          })
        })
        const growResult = await growResp.json()
        results.push({ title: event.title, status: 'created' })

        // 6. 标记原碎片为已消化
        if (event.source_buckets && event.source_buckets.length > 0) {
          for (const bucketId of event.source_buckets) {
            try {
              await fetch(obConn.url, {
                method: 'POST',
                headers: obHeaders,
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
            } catch (traceErr) {
              console.error(`Failed to trace bucket ${bucketId}:`, traceErr.message)
            }
          }
        }
      } catch (growErr) {
        console.error(`Failed to grow event "${event.title}":`, growErr.message)
        results.push({ title: event.title, status: 'error', error: growErr.message })
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
