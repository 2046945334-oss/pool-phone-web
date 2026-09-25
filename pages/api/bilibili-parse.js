// pages/api/bilibili-parse.js
// Parse Bilibili video info via oembed and web page scraping
// Handles cases where direct API is blocked from overseas servers

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url required' })

  try {
    // Extract BV number
    let bvid = ''
    const bvMatch = url.match(/BV[a-zA-Z0-9]+/)
    if (bvMatch) bvid = bvMatch[0]
    
    if (!bvid) return res.status(400).json({ error: '无法识别B站视频ID，请输入BV号或完整链接' })

    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    const videoUrl = `https://www.bilibili.com/video/${bvid}`
    
    // Try multiple approaches in order
    let title = bvid, desc = '', cover = '', duration = 0, owner = '', ownerFace = '', view = 0, danmaku = 0, cid = 0, playUrl = ''

    // Approach 1: Direct API (works if not blocked)
    try {
      const infoResp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
        headers: { 'User-Agent': ua, 'Referer': 'https://www.bilibili.com/' },
        signal: AbortSignal.timeout(5000)
      })
      const text = await infoResp.text()
      if (text.startsWith('{')) {
        const infoData = JSON.parse(text)
        if (infoData.code === 0 && infoData.data) {
          const v = infoData.data
          title = v.title || title
          desc = v.desc || ''
          cover = (v.pic || '').replace('http:', 'https:')
          duration = v.duration || 0
          owner = v.owner?.name || ''
          ownerFace = (v.owner?.face || '').replace('http:', 'https:')
          view = v.stat?.view || 0
          danmaku = v.stat?.danmaku || 0
          cid = v.cid || 0
        }
      }
    } catch {}

    // Approach 2: If API failed, scrape the video page for og:tags
    if (title === bvid) {
      try {
        const pageResp = await fetch(videoUrl, {
          headers: { 'User-Agent': ua },
          signal: AbortSignal.timeout(8000)
        })
        const html = await pageResp.text()
        const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/)
        const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/)
        const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/)
        if (ogTitle) title = ogTitle[1]
        if (ogImage) cover = ogImage[1].replace('http:', 'https:')
        if (ogDesc) desc = ogDesc[1]
        // Try to extract __INITIAL_STATE__ JSON
        const stateMatch = html.match(/__INITIAL_STATE__=({.*?});/)
        if (stateMatch) {
          try {
            const state = JSON.parse(stateMatch[1])
            if (state.videoData) {
              const v = state.videoData
              title = v.title || title
              cover = (v.pic || cover).replace('http:', 'https:')
              duration = v.duration || 0
              owner = v.owner?.name || ''
              cid = v.cid || 0
              view = v.stat?.view || 0
              danmaku = v.stat?.danmaku || 0
            }
          } catch {}
        }
      } catch {}
    }

    // Try to get playUrl if we have cid
    if (cid) {
      try {
        const playResp = await fetch(
          `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=32&fnval=1&platform=html5`,
          {
            headers: { 'User-Agent': ua, 'Referer': videoUrl },
            signal: AbortSignal.timeout(5000)
          }
        )
        const playText = await playResp.text()
        if (playText.startsWith('{')) {
          const playData = JSON.parse(playText)
          if (playData.data?.durl?.[0]?.url) {
            playUrl = playData.data.durl[0].url
          }
        }
      } catch {}
    }

    return res.json({
      bvid,
      title,
      desc,
      cover,
      duration,
      owner: owner || '未知',
      ownerFace,
      view,
      danmaku,
      cid,
      playUrl,
      embedUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&high_quality=1&danmaku=0&autoplay=1`
    })
  } catch (e) {
    return res.status(500).json({ error: '解析失败: ' + e.message })
  }
}
