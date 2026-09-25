import { useState, useRef, useEffect, useCallback } from 'react'

// Format seconds to mm:ss
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return m + ':' + (sec < 10 ? '0' : '') + sec
}

export default function WatchTogetherApp({ onBack, onMinimize, mini = false }) {
  const [searchUrl, setSearchUrl] = useState('')
  const [videoInfo, setVideoInfo] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState([])
  const iframeRef = useRef(null)
  const watchStartRef = useRef(null)
  const screenshotTimerRef = useRef(null)

  // Load history
  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem('pool_watch_history') || '[]')) } catch {}
  }, [])

  function saveHistory(info) {
    try {
      const h = JSON.parse(localStorage.getItem('pool_watch_history') || '[]')
      const filtered = h.filter(v => v.bvid !== info.bvid)
      const next = [{ bvid: info.bvid, title: info.title, cover: info.cover, owner: info.owner, ts: Date.now() }, ...filtered].slice(0, 20)
      localStorage.setItem('pool_watch_history', JSON.stringify(next))
      setHistory(next)
    } catch {}
  }

  // Client-side parse: call bilibili API directly from user's browser (in China, no blocking)
  async function parseVideo() {
    if (!searchUrl.trim()) return
    setLoading(true)
    setError('')
    try {
      const input = searchUrl.trim()
      let bvid = ''
      const bvMatch = input.match(/BV[a-zA-Z0-9]+/)
      if (bvMatch) bvid = bvMatch[0]
      if (!bvid) { setError('无法识别BV号，请输入BV号或B站链接'); return }

      // Call bilibili API directly from client
      const resp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
      const data = await resp.json()
      if (data.code !== 0) { setError('解析失败: ' + (data.message || '未知错误')); return }

      const v = data.data
      const info = {
        bvid,
        title: v.title || bvid,
        desc: v.desc || '',
        cover: (v.pic || '').replace('http:', 'https:'),
        duration: v.duration || 0,
        owner: v.owner?.name || '未知',
        ownerFace: (v.owner?.face || '').replace('http:', 'https:'),
        view: v.stat?.view || 0,
        danmaku: v.stat?.danmaku || 0,
        embedUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&high_quality=1&danmaku=0&autoplay=1`
      }
      setVideoInfo(info)
    } catch (e) {
      setError('解析失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  function startWatch(info) {
    const v = info || videoInfo
    setVideoInfo(v)
    setPlaying(true)
    watchStartRef.current = Date.now()
    if (info) saveHistory(info)
    else if (videoInfo) saveHistory(videoInfo)
    startScreenshotTimer()
  }

  async function watchFromHistory(item) {
    setLoading(true)
    setError('')
    try {
      const resp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${item.bvid}`)
      const data = await resp.json()
      if (data.code !== 0) { setError('解析失败'); return }
      const v = data.data
      const info = {
        bvid: item.bvid,
        title: v.title || item.title,
        desc: v.desc || '',
        cover: (v.pic || '').replace('http:', 'https:'),
        duration: v.duration || 0,
        owner: v.owner?.name || item.owner || '未知',
        ownerFace: (v.owner?.face || '').replace('http:', 'https:'),
        view: v.stat?.view || 0,
        danmaku: v.stat?.danmaku || 0,
        embedUrl: `https://player.bilibili.com/player.html?bvid=${item.bvid}&high_quality=1&danmaku=0&autoplay=1`
      }
      setVideoInfo(info)
      startWatch(info)
    } catch (e) {
      setError('解析失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  function stopWatch() {
    setPlaying(false)
    clearScreenshotTimer()
  }

  function startScreenshotTimer() {
    clearScreenshotTimer()
    function scheduleNext() {
      const delay = 45000 + Math.random() * 75000
      screenshotTimerRef.current = setTimeout(() => {
        triggerWatchScreenshot()
        scheduleNext()
      }, delay)
    }
    scheduleNext()
  }

  function clearScreenshotTimer() {
    if (screenshotTimerRef.current) {
      clearTimeout(screenshotTimerRef.current)
      screenshotTimerRef.current = null
    }
  }

  const triggerWatchScreenshot = useCallback(() => {
    if (!videoInfo) return
    const elapsed = watchStartRef.current ? Math.floor((Date.now() - watchStartRef.current) / 1000) : 0
    const detail = {
      title: videoInfo.title,
      owner: videoInfo.owner,
      elapsed: fmtTime(elapsed),
      totalDuration: fmtTime(videoInfo.duration),
      bvid: videoInfo.bvid,
      cover: videoInfo.cover,
      desc: videoInfo.desc
    }
    window.dispatchEvent(new CustomEvent('watch-together-tick', { detail }))
  }, [videoInfo])

  useEffect(() => {
    if (playing && videoInfo) {
      window.__watchTogetherActive = true
      window.__watchTogetherInfo = () => {
        const elapsed = watchStartRef.current ? Math.floor((Date.now() - watchStartRef.current) / 1000) : 0
        return {
          title: videoInfo.title,
          owner: videoInfo.owner,
          elapsed: fmtTime(elapsed),
          totalDuration: fmtTime(videoInfo.duration),
          bvid: videoInfo.bvid,
          cover: videoInfo.cover,
          desc: videoInfo.desc
        }
      }
    } else {
      window.__watchTogetherActive = false
      window.__watchTogetherInfo = null
    }
    return () => {
      window.__watchTogetherActive = false
      window.__watchTogetherInfo = null
    }
  }, [playing, videoInfo])

  useEffect(() => {
    return () => clearScreenshotTimer()
  }, [])

  const headerStyle = {
    display: 'flex', alignItems: 'center', padding: mini ? '4px 10px' : '8px 12px',
    borderBottom: '1px solid rgba(240,215,230,0.3)', gap: 8, flexShrink: 0
  }
  const btnStyle = { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#7a5a6a' }

  // ─── PLAYING STATE: iframe player ───
  if (playing && videoInfo) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: mini ? 'transparent' : '#000' }}>
        {!mini && (
          <div style={headerStyle}>
            <button onClick={stopWatch} style={btnStyle}>{'←'}</button>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#7a5a6a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {videoInfo.title}
            </span>
            {onMinimize && <button onClick={() => { onMinimize() }} style={{ ...btnStyle, fontSize: 14, color: '#b08a9a' }}>{'−'}</button>}
          </div>
        )}
        <div style={{ flex: 1, position: 'relative', background: '#000' }}>
          <iframe
            ref={iframeRef}
            src={videoInfo.embedUrl}
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          />
        </div>
        {mini && (
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', background: 'rgba(0,0,0,0.6)', gap: 6 }}>
            <span style={{ flex: 1, fontSize: 11, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {videoInfo.title}
            </span>
            <button onClick={stopWatch} style={{ background: 'none', border: 'none', color: '#f8a0b0', fontSize: 11, cursor: 'pointer' }}>{'退出'}</button>
          </div>
        )}
      </div>
    )
  }

  // ─── BROWSE STATE: search + history ───
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
      {!mini && (
        <div style={headerStyle}>
          {onBack && <button onClick={onBack} style={btnStyle}>{'←'}</button>}
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#7a5a6a' }}>{'📺 一起看'}</span>
          {onMinimize && <button onClick={onMinimize} style={{ ...btnStyle, fontSize: 14, color: '#b08a9a' }}>{'−'}</button>}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: mini ? '8px' : '12px 16px' }}>
        {/* Search bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={searchUrl}
            onChange={e => setSearchUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && parseVideo()}
            placeholder="粘贴B站链接或BV号..."
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(230,200,220,0.5)',
              background: 'rgba(255,250,252,0.9)', fontSize: 13, color: '#4a3a50', outline: 'none'
            }}
          />
          <button
            onClick={parseVideo}
            disabled={loading}
            style={{
              padding: '8px 14px', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg, #e8a0bf 0%, #d080a0 100%)',
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? '...' : '解析'}
          </button>
        </div>

        {error && <div style={{ color: '#d06080', fontSize: 12, marginBottom: 8, padding: '6px 10px', background: 'rgba(255,220,230,0.5)', borderRadius: 8 }}>{error}</div>}

        {/* Video preview card */}
        {videoInfo && !playing && (
          <div style={{ background: 'rgba(255,252,254,0.95)', borderRadius: 16, overflow: 'hidden', marginBottom: 12, border: '1px solid rgba(240,215,230,0.4)', boxShadow: '0 2px 12px rgba(200,150,180,0.1)' }}>
            {videoInfo.cover && (
              <div style={{ position: 'relative' }}>
                <img src={videoInfo.cover} style={{ width: '100%', height: 'auto', display: 'block' }} alt="" />
                <div style={{ position: 'absolute', bottom: 6, right: 8, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
                  {fmtTime(videoInfo.duration)}
                </div>
              </div>
            )}
            <div style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#4a3040', marginBottom: 4, lineHeight: 1.4 }}>{videoInfo.title}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#9a7a8a' }}>
                <span>{videoInfo.owner}</span>
                <span>{'▶ ' + (videoInfo.view || 0).toLocaleString() + ' · 弹幕 ' + (videoInfo.danmaku || 0)}</span>
              </div>
              <button
                onClick={() => startWatch()}
                style={{
                  width: '100%', marginTop: 10, padding: '10px', borderRadius: 12, border: 'none',
                  background: 'linear-gradient(135deg, #e8a0bf 0%, #c88098 100%)',
                  color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                }}
              >
                {'📺 一起看'}
              </button>
            </div>
          </div>
        )}

        {/* History */}
        {!videoInfo && history.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#b08a9a', marginBottom: 8, fontWeight: 600 }}>{'最近看过'}</div>
            {history.map((item, idx) => (
              <div
                key={idx}
                onClick={() => watchFromHistory(item)}
                style={{
                  display: 'flex', gap: 10, padding: '8px', marginBottom: 6, borderRadius: 10,
                  background: 'rgba(255,250,252,0.8)', cursor: 'pointer', border: '1px solid rgba(240,220,230,0.3)'
                }}
              >
                {item.cover && <img src={item.cover} style={{ width: 80, height: 50, objectFit: 'cover', borderRadius: 6 }} alt="" />}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#5a3a4a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                  <div style={{ fontSize: 10, color: '#a08090', marginTop: 2 }}>{item.owner}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!videoInfo && history.length === 0 && !loading && (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#b8a0a8' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{'📺'}</div>
            <div style={{ fontSize: 13 }}>{'粘贴B站视频链接'}</div>
            <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>{'一起看视频吧'}</div>
          </div>
        )}
      </div>
    </div>
  )
}
