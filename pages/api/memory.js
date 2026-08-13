// pages/api/memory.js - proxy calls to Ombre Brain MCP
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, params } = req.body
  const OMBRE_URL = 'https://obe.zeabur.app/mcp'
  const OMBRE_TOKEN = 'NxNrXE63qe3XakYEk-2yVYL2U8iqHGVRn0wF24e6rWg'

  // MCP Streamable HTTP: send JSON-RPC request
  const rpcBody = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: action,
      arguments: params || {}
    }
  }

  try {
    const response = await fetch(OMBRE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${OMBRE_TOKEN}`,
      },
      body: JSON.stringify(rpcBody),
    })

    if (!response.ok) {
      const errText = await response.text()
      return res.status(response.status).json({ error: errText })
    }

    const data = await response.json()
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}