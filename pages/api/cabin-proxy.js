// Proxy for xinchao cabin dashboard API (avoids CORS in srcdoc iframe)
const XINCHAO_URL = 'https://xingchao.zeabur.app'
const DASHBOARD_TOKEN = 'pool_cabin_dashboard_token_2026abc'

let sessionToken = ''
let sessionExpires = 0

async function getSession() {
  const res = await fetch(XINCHAO_URL + '/dashboard/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: DASHBOARD_TOKEN, mode: 'header' })
  })
  const data = await res.json()
  if (data.token) {
    sessionToken = data.token
    sessionExpires = Date.now() + 10 * 3600 * 1000 // 10h
    return true
  }
  return false
}

export default async function handler(req, res) {
  // Get or refresh session
  if (!sessionToken || Date.now() > sessionExpires) {
    if (!await getSession()) return res.status(502).json({ error: 'cannot connect to xinchao' })
  }

  const { action, ...params } = req.method === 'GET' ? req.query : (req.body || {})

  try {
    let url, method, body
    if (action === 'list' || req.method === 'GET') {
      url = XINCHAO_URL + '/dashboard/api/cabin'
      method = 'GET'
    } else if (action === 'send') {
      url = XINCHAO_URL + '/dashboard/api/cabin/note'
      method = 'POST'
      body = JSON.stringify(params)
    } else if (action === 'lock' || action === 'read') {
      url = XINCHAO_URL + '/dashboard/api/cabin/note'
      method = 'PATCH'
      body = JSON.stringify(params)
    } else {
      return res.status(400).json({ error: 'unknown action' })
    }

    let resp = await fetch(url, {
      method,
      headers: { 'Authorization': 'Bearer ' + sessionToken, 'Content-Type': 'application/json' },
      ...(body ? { body } : {})
    })

    if (resp.status === 401) {
      await getSession()
      resp = await fetch(url, {
        method,
        headers: { 'Authorization': 'Bearer ' + sessionToken, 'Content-Type': 'application/json' },
        ...(body ? { body } : {})
      })
    }

    const data = await resp.json()
    return res.status(resp.status).json(data)
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
}
