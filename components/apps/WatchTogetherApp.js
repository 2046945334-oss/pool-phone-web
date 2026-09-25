import { useState, useRef, useEffect, useCallback } from 'react'

// Format seconds to mm:ss
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return m + ':' + (sec < 10 ? '0' : '') + sec
}

// Format large numbers
function fmtNum(n) {
  if (!n) return '0'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return String(n)
}

export default function WatchTogetherApp({ mini = false, onBack, onMinimize }) {
  const [searchUrl, setSearchUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [videoInfo, setVideoInfo] = useState(null) // parsed video metadata
  const [playing, setPlaying] = useState(false) // whether video is actively playing
  const [history, setHistory] = useState([]) // watch history
  const iframeRef = useRef(null)
  const watchStartRef = useRef(null)
  const screenshotTimerRef = useRef(null)

  // Load history from localStorage
  useEffect(() => {
    try {
      const h = JSON.parse(localStorage.getItem('pool_watch_history') || '[]')
      setHistory(h.slice(0, 20))
    } catch {}
  }, [])

  // Save history
  function saveHistory(info) {
    try {
      const h = JSON.parse(localStorage.getItem('pool_watch_history') || '[]')
      const filtered = h.filter(v => v.bvid !== info.bvid)
      const next = [{ bvid: info.bvid, title: info.title, cover: info.cover, owner: info.owner, ts: Date.now() }, ...filtered].slice(0, 20)
      localStorage.setItem('pool_watch_history', JSON.stringify(next))
      setHistory(next)
    } catch {}
  }

  // Parse video
  async function parseVideo() {
    if (!searchUrl.trim()) return
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('/api/bilibili-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: searchUrl.trim() })
      })
      const data = await resp.json()
      if (data.error) { setError(data.error); return }
      setVideoInfo(data)
    } catch (e) {
      setError('解析失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // Start watching (switch to player)
  function startWatch(info) {
    setVideoInfo(info || videoInfo)
    setPlaying(true)
    watchStartRef.current = Date.now()
    if (info) saveHistory(info)
    else if (videoInfo) saveHistory(videoInfo)
    // Start random screenshot timer for chat injection
    startScreenshotTimer()
  }

  // Watch from history
  async function watchFromHistory(item) {
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('/api/bilibili-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.bvid })
      })
      const data = await resp.json()
      if (data.error) { setError(data.error); return }
      setVideoInfo(data)
      startWatch(data)
    } catch (e) {
      setError('解析失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // Stop watching
  function stopWatch() {
    setPlaying(false)
    clearScreenshotTimer()
  }

  // Screenshot timer for random AI discussion trigger
  function startScreenshotTimer() {
    clearScreenshotTimer()
    function scheduleNext() {
      // Random interval: 45-120 seconds
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

  // Trigger screenshot injection into chat
  const triggerWatchScreenshot = useCallback(() => {
    if (!videoInfo) return
    const elapsed = watchStartRef.current ? Math.floor((Date.now() - watchStartRef.current) / 1000) : 0
    const detail = {
      title: videoInfo.title,
      owner: videoInfo.owner,
      elapsed: fmtTime(elapsed),
      totalDuration: fmtTime(videoInfo.duration),
      bvid: videoInfo.bvid
    }
    window.dispatchEvent(new CustomEvent('watch-together-tick', { detail }))
  }, [videoInfo])

  // Expose current watch state for sendMessage attachment
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
          bvid: videoInfo.bvid
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

  // Cleanup on unmount
  useEffect(() => {
    return () => clearScreenshotTimer()
  }, [])

  const headerStyle = {
    display: 'flex', alignItems: 'center', padding: mini ? '4px 10px' : '8px 12px',
    borderBottom: '1px solid rgba(240,215,230,0.3)', gap: 8, flexShrink: 0
  }
  const btnStyle = { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#7a5a6a' }

  // ─── PLAYING STATE: embedded player ───
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

        {/* Parsed video preview */}
        {videoInfo && !playing && (
          <div style={{
            background: 'rgba(255,250,252,0.95)', borderRadius: 14, overflow: 'hidden',
            border: '1px solid rgba(230,200,220,0.4)', marginBottom: 16
          }}>
            <div style={{ position: 'relative' }}>
              <img src={videoInfo.cover} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
              <div style={{ position: 'absolute', bottom: 6, right: 8, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
                {fmtTime(videoInfo.duration)}
              </div>
            </div>
            <div style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#3a2a40', lineHeight: 1.4, marginBottom: 6 }}>{videoInfo.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                {videoInfo.ownerFace && <img src={videoInfo.ownerFace} style={{ width: 20, height: 20, borderRadius: '50%' }} />}
                <span style={{ fontSize: 12, color: '#9a7a8a' }}>{videoInfo.owner}</span>
                <span style={{ fontSize: 11, color: '#b8a0b8', marginLeft: 'auto' }}>{'▶ ' + fmtNum(videoInfo.view)}{' · 弹幕 ' + fmtNum(videoInfo.danmaku)}</span>
              </div>
              <button
                onClick={() => startWatch()}
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #e8a0bf 0%, #c878a0 100%)',
                  color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(200,120,160,0.3)'
                }}
              >
                {'📺 一起看'}
              </button>
            </div>
          </div>
        )}

        {/* Watch history */}
        {!videoInfo && history.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#b08a9a', fontWeight: 600, marginBottom: 8 }}>{'最近看过'}</div>
            {history.map((item, idx) => (
              <div
                key={item.bvid + idx}
                onClick={() => watchFromHistory(item)}
                style={{
                  display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(240,225,235,0.4)',
                  cursor: 'pointer', alignItems: 'center'
                }}
              >
                {item.cover && <img src={item.cover} style={{ width: 80, height: 50, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 13, color: '#4a3a50', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#b8a0b8' }}>{item.owner}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!videoInfo && history.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#b8a0b8' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{'📺'}</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              {'粘贴B站视频链接'}
              <br />
              {'一起看视频吧'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
