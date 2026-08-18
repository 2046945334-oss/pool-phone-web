// pages/api/mcp-proxy.js - MCP httpStream client proxy
// Supports: initialize, tools/list, tools/call
import { getDb } from '../../lib/db'

// Get MCP connections from DB
function getMcpConnections() {
  const db = getDb()
  const row = db.prepare("SELECT value FROM kv WHERE key = 'pool_mcp_connections'").get()
  if (!row) return []
  try { return JSON.parse(row.value) } catch { return [] }
}

// Send JSON-RPC request to MCP endpoint via httpStream
async function mcpRequest(endpoint, token, method, params = {}, sessionId = null) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params
  }
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (sessionId) headers['Mcp-Session-Id'] = sessionId

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`MCP ${method} failed (${resp.status}): ${errText}`)
  }

  // Get session ID from response headers
  const newSessionId = resp.headers.get('mcp-session-id') || sessionId

  const contentType = resp.headers.get('content-type') || ''
  
  if (contentType.includes('text/event-stream')) {
    // Parse SSE stream for JSON-RPC response
    const text = await resp.text()
    const lines = text.split('\n')
    let result = null
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6))
          if (parsed.result !== undefined || parsed.error !== undefined) {
            result = parsed
          }
        } catch {}
      }
    }
    return { result: result?.result || result, sessionId: newSessionId }
  } else {
    // Direct JSON response
    const data = await resp.json()
    return { result: data.result || data, sessionId: newSessionId }
  }
}

// Initialize + get tools from an MCP connection
async function getMcpTools(endpoint, token) {
  // Initialize
  const initResp = await mcpRequest(endpoint, token, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pool-phone-web', version: '1.0.0' }
  })
  const sessionId = initResp.sessionId

  // Send initialized notification
  const notifHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  }
  if (token) notifHeaders['Authorization'] = `Bearer ${token}`
  if (sessionId) notifHeaders['Mcp-Session-Id'] = sessionId
  
  await fetch(endpoint, {
    method: 'POST',
    headers: notifHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }).catch(() => {})

  // List tools
  const toolsResp = await mcpRequest(endpoint, token, 'tools/list', {}, sessionId)
  return { tools: toolsResp.result?.tools || [], sessionId }
}

// Call a tool on an MCP connection
async function callMcpTool(endpoint, token, toolName, args, sessionId) {
  const resp = await mcpRequest(endpoint, token, 'tools/call', {
    name: toolName,
    arguments: args
  }, sessionId)
  return resp.result
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  
  const { action, connectionId, toolName, args } = req.body

  try {
    const connections = getMcpConnections()

    if (action === 'list_connections') {
      return res.json({ connections })
    }

    if (action === 'list_tools') {
      // List tools from all enabled connections
      const allTools = []
      for (const conn of connections) {
        if (!conn.enabled) continue
        try {
          const { tools, sessionId } = await getMcpTools(conn.url, conn.token)
          // Store session for later calls
          conn._sessionId = sessionId
          for (const t of tools) {
            allTools.push({
              connectionId: conn.id,
              connectionName: conn.name,
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema
            })
          }
        } catch (e) {
          allTools.push({ connectionId: conn.id, connectionName: conn.name, error: e.message })
        }
      }
      return res.json({ tools: allTools })
    }

    if (action === 'call_tool') {
      // Find the connection
      const conn = connections.find(c => c.id === connectionId)
      if (!conn) return res.status(404).json({ error: 'Connection not found' })
      
      // We need to re-initialize to get a fresh session (httpStream is stateless per request in many impls)
      const { tools, sessionId } = await getMcpTools(conn.url, conn.token)
      const result = await callMcpTool(conn.url, conn.token, toolName, args || {}, sessionId)
      return res.json({ result })
    }

    if (action === 'test_connection') {
      // Test a single connection
      const { url, token } = req.body
      const { tools, sessionId } = await getMcpTools(url, token)
      return res.json({ success: true, toolCount: tools.length, tools: tools.map(t => ({ name: t.name, description: t.description })) })
    }

    return res.status(400).json({ error: 'Unknown action: ' + action })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
