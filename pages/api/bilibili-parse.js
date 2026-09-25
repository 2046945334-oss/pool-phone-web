export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url required' })

  try {
    let bvid = ''
    const bvMatch = url.match(/BV[a-zA-Z0-9]+/)
    if (bvMatch) bvid = bvMatch[0]
    if (!bvid) return res.status(400).json({ error: '\u65e0\u6cd5\u8bc6\u522bBV\u53f7' })

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/',
      'Origin': 'https://www.bilibili.com',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }

    let title = '', desc = '', cover = '', duration = 0, owner = '', view = 0, danmaku = 0, cid = 0
    let ok = false

    try {
      const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, { headers, signal: AbortSignal.timeout(8000) })
      const text = await r.text()
      if (text.startsWith('{')) {
        const j = JSON.parse(text)
        if (j.code === 0 && j.data) {
          const v = j.data
          title = v.title || ''; desc = v.desc || ''
          cover = (v.pic || '').replace('http:', 'https:')
          duration = v.duration || 0; owner = v.owner?.name || ''
          view = v.stat?.view || 0; danmaku = v.stat?.danmaku || 0; cid = v.cid || 0
          ok = true
        }
      }
    } catch {}

    if (!ok) {
      try {
        const r = await fetch('https://www.bilibili.com/video/' + bvid + '/', {
          headers: { ...headers, Accept: 'text/html' }, signal: AbortSignal.timeout(10000)
        })
        const html = await r.text()
        const ogT = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/)
        const ogI = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/)
        if (ogT) title = ogT[1]
        if (ogI) cover = ogI[1].replace('http:', 'https:')
        const sm = html.match(/__INITIAL_STATE__=({.*?});/)
        if (sm) {
          try {
            const st = JSON.parse(sm[1])
            if (st.videoData) {
              const v = st.videoData
              title = v.title || title; cover = (v.pic || cover).replace('http:', 'https:')
              duration = v.duration || 0; owner = v.owner?.name || ''
              cid = v.cid || 0; view = v.stat?.view || 0; danmaku = v.stat?.danmaku || 0
            }
          } catch {}
        }
        if (title) ok = true
      } catch {}
    }

    if (!ok || !title) return res.status(502).json({ error: '\u65e0\u6cd5\u83b7\u53d6\u89c6\u9891\u4fe1\u606f' })

    let videoshot = null
    if (cid) {
      try {
        const r = await fetch('https://api.bilibili.com/x/player/videoshot?bvid=' + bvid + '&cid=' + cid + '&index=1', { headers, signal: AbortSignal.timeout(5000) })
        const text = await r.text()
        if (text.startsWith('{')) {
          const j = JSON.parse(text)
          if (j.code === 0 && j.data) {
            const d = j.data
            videoshot = {
              images: (d.image || []).map(u => u.startsWith('//') ? 'https:' + u : u),
              index: d.index || [], xLen: d.img_x_len || 10, yLen: d.img_y_len || 10,
              xSize: d.img_x_size || 160, ySize: d.img_y_size || 90
            }
          }
        }
      } catch {}
    }

    return res.json({
      bvid, title, desc, cover, duration, owner: owner || '\u672a\u77e5',
      view, danmaku, cid, videoshot,
      embedUrl: 'https://player.bilibili.com/player.html?bvid=' + bvid + '&high_quality=1&danmaku=0&autoplay=1'
    })
  } catch (e) {
    return res.status(500).json({ error: '\u89e3\u6790\u5931\u8d25: ' + e.message })
  }
}
