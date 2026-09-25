import { useState, useRef, useEffect, useCallback } from 'react'

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
  const canvasRef = useRef(null)
  const watchStartRef = useRef(null)
  const screenshotTimerRef = useRef(null)
  const videoshotRef = useRef(null)

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

  function captureFrameAtTime(elapsedSec) {
    const vs = videoshotRef.current
    const canvas = canvasRef.current
    if (!vs || !canvas || !vs.images.length || !vs.index.length) return Promise.resolve(null)
    let bestIdx = 0
    for (let i = 0; i < vs.index.length; i++) {
      if (vs.index[i] <= elapsedSec) bestIdx = i
      else break
    }
    const framesPerSheet = vs.xLen * vs.yLen
    const sheetIdx = Math.floor(bestIdx / framesPerSheet)
    const frameInSheet = bestIdx % framesPerSheet
    const col = frameInSheet % vs.xLen
    const row = Math.floor(frameInSheet / vs.xLen)
    if (sheetIdx >= vs.images.length) return Promise.resolve(null)
    return new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          canvas.width = vs.xSize
          canvas.height = vs.ySize
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, col * vs.xSize, row * vs.ySize, vs.xSize, vs.ySize, 0, 0, vs.xSize, vs.ySize)
          resolve(canvas.toDataURL('image/jpeg', 0.7))
        } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = vs.images[sheetIdx]
    })
  }

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
      if (data.videoshot) videoshotRef.current = data.videoshot
    } catch (e) {
      setError('\u89e3\u6790\u5931\u8d25: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  function startWatch(info) {
    const v = info || videoInfo
    setVideoInfo(v)
    setPlaying(true)
    watchStartRef.current = Date.now()
    if (v?.videoshot) videoshotRef.current = v.videoshot
    if (info) saveHistory(info)
    else if (videoInfo) saveHistory(videoInfo)
    startScreenshotTimer()
  }

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
      if (data.videoshot) videoshotRef.current = data.videoshot
      startWatch(data)
    } catch (e) {
      setError('\u89e3\u6790\u5931\u8d25: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  function stopWatch() {
    setPlaying(false)
    clearScreenshotTimer()
    videoshotRef.current = null
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

  const triggerWatchScreenshot = useCallback(async () => {
    if (!videoInfo) return
    const elapsed = watchStartRef.current ? Math.floor((Date.now() - watchStartRef.current) / 1000) : 0
    let frame = null
    try { frame = await captureFrameAtTime(elapsed) } catch {}
    const detail = {
      title: videoInfo.title, owner: videoInfo.owner,
      elapsed: fmtTime(elapsed), totalDuration: fmtTime(videoInfo.duration),
      bvid: videoInfo.bvid, cover: videoInfo.cover, desc: videoInfo.desc, frame
    }
    window.dispatchEvent(new CustomEvent('watch-together-tick', { detail }))
  }, [videoInfo])

  useEffect(() => {
    if (playing && videoInfo) {
      window.__watchTogetherActive = true
      window.__watchTogetherInfo = async () => {
        const elapsed = watchStartRef.current ? Math.floor((Date.now() - watchStartRef.current) / 1000) : 0
        let frame = null
        try { frame = await captureFrameAtTime(elapsed) } catch {}
        return {
          title: videoInfo.title, owner: videoInfo.owner,
          elapsed: fmtTime(elapsed), totalDuration: fmtTime(videoInfo.duration),
          bvid: videoInfo.bvid, cover: videoInfo.cover, desc: videoInfo.desc, frame
        }
      }
    } else {
      window.__watchTogetherActive = false
      window.__watchTogetherInfo = null
    }
    return () => { window.__watchTogetherActive = false; window.__watchTogetherInfo = null }
  }, [playing, videoInfo])

  useEffect(() => { return () => clearScreenshotTimer() }, [])

  const headerStyle = {
    display: 'flex', alignItems: 'center', padding: mini ? '4px 10px' : '8px 12px',
    borderBottom: '1px solid rgba(240,215,230,0.3)', gap: 8, flexShrink: 0
  }
  const btnStyle = { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#7a5a6a' }

  if (playing && videoInfo) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: mini ? 'transparent' : '#000' }}>
        {!mini && (
          <div style={headerStyle}>
            <button onClick={stopWatch} style={btnStyle}>{'\u2190'}</button>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#7a5a6a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {videoInfo.title}
            </span>
            {onMinimize && <button onClick={() => { onMinimize() }} style={{ ...btnStyle, fontSize: 14, color: '#b08a9a' }}>{'\u2212'}</button>}
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
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
        {mini && (
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', background: 'rgba(0,0,0,0.6)', gap: 6 }}>
            <span style={{ flex: 1, fontSize: 11, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {videoInfo.title}
            </span>
            <button onClick={stopWatch} style={{ background: 'none', border: 'none', color: '#f8a0b0', fontSize: 11, cursor: 'pointer' }}>{'\u9000\u51fa'}</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
      {!mini && (
        <div style={headerStyle}>
          {onBack && <button onClick={onBack} style={btnStyle}>{'\u2190'}</button>}
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#7a5a6a' }}>{'\ud83d\udcfa \u4e00\u8d77\u770b'}</span>
          {onMinimize && <button onClick={onMinimize} style={{ ...btnStyle, fontSize: 14, color: '#b08a9a' }}>{'\u2212'}</button>}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: mini ? '8px' : '12px 16px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={searchUrl}
            onChange={e => setSearchUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && parseVideo()}
            placeholder={'\u7c98\u8d34B\u7ad9\u94fe\u63a5\u6216BV\u53f7...'}
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
            {loading ? '...' : '\u89e3\u6790'}
          </button>
        </div>
        {error && <div style={{ color: '#d06080', fontSize: 12, marginBottom: 8, padding: '6px 10px', background: 'rgba(255,220,230,0.5)', borderRadius: 8 }}>{error}</div>}
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
                <span>{'\u25b6 ' + (videoInfo.view || 0).toLocaleString() + ' \u00b7 \u5f39\u5e55 ' + (videoInfo.danmaku || 0)}</span>
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
                {'\ud83d\udcfa \u4e00\u8d77\u770b'}
              </button>
            </div>
          </div>
        )}
        {!videoInfo && history.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#b08a9a', marginBottom: 8, fontWeight: 600 }}>{'\u6700\u8fd1\u770b\u8fc7'}</div>
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
        {!videoInfo && history.length === 0 && !loading && (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#b8a0a8' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{'\ud83d\udcfa'}</div>
            <div style={{ fontSize: 13 }}>{'\u7c98\u8d34B\u7ad9\u89c6\u9891\u94fe\u63a5'}</div>
            <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>{'\u4e00\u8d77\u770b\u89c6\u9891\u5427'}</div>
          </div>
        )}
      </div>
    </div>
  )
}