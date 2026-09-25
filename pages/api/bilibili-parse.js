// pages/api/bilibili-parse.js
// Parse Bilibili video info and extract playback URL
// Supports BV/av number input or full URL

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url required' })

  try {
    // Extract BV number from URL or direct input
    let bvid = ''
    const bvMatch = url.match(/BV[a-zA-Z0-9]+/)
    if (bvMatch) {
      bvid = bvMatch[0]
    } else {
      // Try av number
      const avMatch = url.match(/av(\d+)/)
      if (avMatch) {
        // Convert av to bv via API
        const avResp = await fetch(`https://api.bilibili.com/x/web-interface/view?aid=${avMatch[1]}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.bilibili.com/' }
        })
        const avData = await avResp.json()
        if (avData.data?.bvid) bvid = avData.data.bvid
      }
    }

    if (!bvid) return res.status(400).json({ error: '无法识别B站视频ID，请输入BV号或完整链接' })

    // Get video info
    const infoResp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/'
      }
    })
    const infoData = await infoResp.json()
    if (infoData.code !== 0) return res.status(400).json({ error: '获取视频信息失败: ' + (infoData.message || '未知错误') })

    const video = infoData.data
    const cid = video.cid

    // Get playback URL (html5 player, no login required for 360p/480p)
    const playResp = await fetch(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=32&fnval=1&platform=html5`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `https://www.bilibili.com/video/${bvid}`
        }
      }
    )
    const playData = await playResp.json()

    let playUrl = ''
    if (playData.data?.durl?.[0]?.url) {
      playUrl = playData.data.durl[0].url
    }

    // Build pages list for multi-part videos
    const pages = (video.pages || []).map(p => ({
      cid: p.cid,
      part: p.part,
      page: p.page,
      duration: p.duration
    }))

    return res.json({
      bvid,
      title: video.title,
      desc: video.desc,
      cover: video.pic?.replace('http:', 'https:'),
      duration: video.duration,
      owner: video.owner?.name,
      ownerFace: video.owner?.face?.replace('http:', 'https:'),
      view: video.stat?.view,
      danmaku: video.stat?.danmaku,
      cid,
      pages,
      playUrl,
      // Provide an embed URL as fallback (works in iframe with some limitations)
      embedUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&high_quality=1&danmaku=0&autoplay=1`
    })
  } catch (e) {
    return res.status(500).json({ error: '解析失败: ' + e.message })
  }
}
