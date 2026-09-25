export default async function handler(req, res) {
  const API_BASE = 'https://api.ffzyapi.com/api.php/provide/vod/'

  // GET: search or get categories
  if (req.method === 'GET') {
    const { wd, ids, pg, t, h } = req.query
    try {
      let url = API_BASE + '?ac=detail'
      if (wd) url += '&wd=' + encodeURIComponent(wd)
      if (ids) url += '&ids=' + ids
      if (pg) url += '&pg=' + pg
      if (t) url += '&t=' + t
      if (h) url += '&h=' + h

      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
        signal: AbortSignal.timeout(10000)
      })
      const data = await r.json()

      // Simplify the response
      const list = (data.list || []).map(v => {
        // Parse play URLs - format: "name1$url1#name2$url2$$$source2..."
        const playFrom = (v.vod_play_from || '').split('$$$')
        const playUrls = (v.vod_play_url || '').split('$$$')
        const sources = playFrom.map((name, i) => {
          const episodes = (playUrls[i] || '').split('#').map(ep => {
            const parts = ep.split('$')
            return { name: parts[0] || '', url: parts[1] || '' }
          }).filter(ep => ep.url)
          return { name, episodes }
        }).filter(s => s.episodes.length > 0)

        return {
          id: v.vod_id,
          name: v.vod_name,
          sub: v.vod_sub || '',
          pic: v.vod_pic || '',
          type: v.type_name || '',
          year: v.vod_year || '',
          area: v.vod_area || '',
          lang: v.vod_lang || '',
          score: v.vod_douban_score || '',
          desc: v.vod_blurb || v.vod_content || '',
          director: v.vod_director || '',
          actor: v.vod_actor || '',
          duration: v.vod_duration || '',
          remarks: v.vod_remarks || '',
          sources
        }
      })

      return res.json({
        code: data.code,
        total: data.total || 0,
        page: data.page || 1,
        pagecount: data.pagecount || 0,
        list
      })
    } catch (e) {
      return res.status(500).json({ error: '\u641c\u7d22\u5931\u8d25: ' + e.message })
    }
  }

  return res.status(405).json({ error: 'GET only' })
}
