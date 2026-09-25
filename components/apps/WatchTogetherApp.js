import { useState, useRef, useEffect, useCallback } from 'react'
import Script from 'next/script'

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  s = Math.floor(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec
  return m + ':' + (sec < 10 ? '0' : '') + sec
}

export default function WatchTogetherApp({ onBack, onMinimize, mini = false }) {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedMovie, setSelectedMovie] = useState(null)
  const [selectedSource, setSelectedSource] = useState(0)
  const [selectedEp, setSelectedEp] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playUrl, setPlayUrl] = useState('')
  const [history, setHistory] = useState([])
  const [hlsReady, setHlsReady] = useState(false)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const hlsRef = useRef(null)
  const screenshotTimerRef = useRef(null)

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem('pool_watch_history2') || '[]')) } catch {}
  }, [])

  function saveHistory(movie, epName) {
    try {
      const h = JSON.parse(localStorage.getItem('pool_watch_history2') || '[]')
      const filtered = h.filter(v => v.id !== movie.id)
      const next = [{ id: movie.id, name: movie.name, pic: movie.pic, type: movie.type, epName, ts: Date.now() }, ...filtered].slice(0, 30)
      localStorage.setItem('pool_watch_history2', JSON.stringify(next))
      setHistory(next)
    } catch {}
  }

  async function search() {
    if (!keyword.trim()) return
    setLoading(true); setError(''); setResults([]); setSelectedMovie(null)
    try {
      const r = await fetch('/api/movie-search?wd=' + encodeURIComponent(keyword.trim()))
      const data = await r.json()
      if (data.error) { setError(data.error); return }
      setResults(data.list || [])
      if (!data.list?.length) setError('\u6ca1\u6709\u627e\u5230\u76f8\u5173\u5f71\u89c6')
    } catch (e) {
      setError('\u641c\u7d22\u5931\u8d25: ' + e.message)
    } finally { setLoading(false) }
  }

  function selectMovie(movie) {
    setSelectedMovie(movie)
    setSelectedSource(0)
    setSelectedEp(0)
  }

  function startPlay(movie, srcIdx, epIdx) {
    const src = movie.sources[srcIdx]
    if (!src) return
    const ep = src.episodes[epIdx]
    if (!ep) return
    setPlayUrl(ep.url)
    setPlaying(true)
    setSelectedMovie(movie)
    setSelectedSource(srcIdx)
    setSelectedEp(epIdx)
    saveHistory(movie, ep.name)
    startScreenshotTimer()
  }

  function stopPlay() {
    setPlaying(false)
    setPlayUrl('')
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    clearScreenshotTimer()
  }

  // HLS.js setup
  useEffect(() => {
    if (!playing || !playUrl || !videoRef.current || !hlsReady) return
    const video = videoRef.current
    if (playUrl.includes('.m3u8')) {
      if (window.Hls && window.Hls.isSupported()) {
        if (hlsRef.current) hlsRef.current.destroy()
        const hls = new window.Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 })
        hls.loadSource(playUrl)
        hls.attachMedia(video)
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}) })
        hls.on(window.Hls.Events.ERROR, (_, data) => {
          if (data.fatal) setError('\u64ad\u653e\u5931\u8d25: ' + data.type)
        })
        hlsRef.current = hls
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = playUrl
        video.play().catch(() => {})
      }
    } else {
      video.src = playUrl
      video.play().catch(() => {})
    }
    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null } }
  }, [playing, playUrl, hlsReady])

  // Canvas capture from video element
  function captureCurrentFrame() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return null
    try {
      canvas.width = Math.min(video.videoWidth || 320, 480)
      canvas.height = Math.round(canvas.width * ((video.videoHeight || 180) / (video.videoWidth || 320)))
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.6)
    } catch { return null }
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
    if (!selectedMovie || !videoRef.current) return
    const video = videoRef.current
    const frame = captureCurrentFrame()
    const ep = selectedMovie.sources?.[selectedSource]?.episodes?.[selectedEp]
    const detail = {
      title: selectedMovie.name + (ep ? ' - ' + ep.name : ''),
      owner: selectedMovie.director || selectedMovie.actor || '',
      elapsed: fmtTime(video.currentTime),
      totalDuration: fmtTime(video.duration),
      cover: selectedMovie.pic, desc: selectedMovie.desc, frame
    }
    window.dispatchEvent(new CustomEvent('watch-together-tick', { detail }))
  }, [selectedMovie, selectedSource, selectedEp])

  useEffect(() => {
    if (playing && selectedMovie) {
      window.__watchTogetherActive = true
      window.__watchTogetherInfo = async () => {
        const video = videoRef.current
        const frame = captureCurrentFrame()
        const ep = selectedMovie.sources?.[selectedSource]?.episodes?.[selectedEp]
        return {
          title: selectedMovie.name + (ep ? ' - ' + ep.name : ''),
          owner: selectedMovie.director || selectedMovie.actor || '',
          elapsed: fmtTime(video?.currentTime || 0),
          totalDuration: fmtTime(video?.duration || 0),
          cover: selectedMovie.pic, desc: selectedMovie.desc, frame
        }
      }
    } else {
      window.__watchTogetherActive = false
      window.__watchTogetherInfo = null
    }
    return () => { window.__watchTogetherActive = false; window.__watchTogetherInfo = null }
  }, [playing, selectedMovie, selectedSource, selectedEp])

  useEffect(() => { return () => clearScreenshotTimer() }, [])

  const headerStyle = {
    display: 'flex', alignItems: 'center', padding: mini ? '4px 10px' : '8px 12px',
    borderBottom: '1px solid rgba(240,215,230,0.3)', gap: 8, flexShrink: 0
  }
  const btnStyle = { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#7a5a6a' }

  // Playing view
  if (playing && selectedMovie) {
    const src = selectedMovie.sources[selectedSource]
    const eps = src?.episodes || []
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000' }}>
        <Script src="https://cdn.jsdelivr.net/npm/hls.js@latest" onLoad={() => setHlsReady(true)} />
        {!mini && (
          <div style={{ ...headerStyle, background: 'rgba(0,0,0,0.8)', borderColor: 'rgba(255,255,255,0.1)' }}>
            <button onClick={stopPlay} style={{ ...btnStyle, color: '#ddd' }}>{'\u2190'}</button>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#eee', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedMovie.name}{eps[selectedEp] ? ' - ' + eps[selectedEp].name : ''}
            </span>
            {onMinimize && <button onClick={onMinimize} style={{ ...btnStyle, fontSize: 14, color: '#aaa' }}>{'\u2212'}</button>}
          </div>
        )}
        <div style={{ flex: 1, position: 'relative', background: '#000' }}>
          <video ref={videoRef} controls playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
        {eps.length > 1 && !mini && (
          <div style={{ maxHeight: 80, overflow: 'auto', padding: '6px 8px', background: 'rgba(0,0,0,0.9)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {eps.map((ep, i) => (
              <button key={i} onClick={() => { setSelectedEp(i); setPlayUrl(ep.url); saveHistory(selectedMovie, ep.name) }}
                style={{
                  padding: '3px 8px', borderRadius: 6, border: 'none', fontSize: 11, cursor: 'pointer',
                  background: i === selectedEp ? 'rgba(232,160,191,0.8)' : 'rgba(255,255,255,0.1)',
                  color: i === selectedEp ? '#fff' : '#aaa'
                }}>{ep.name}</button>
            ))}
          </div>
        )}
        {mini && (
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', background: 'rgba(0,0,0,0.6)', gap: 6 }}>
            <span style={{ flex: 1, fontSize: 11, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedMovie.name}
            </span>
            <button onClick={stopPlay} style={{ background: 'none', border: 'none', color: '#f8a0b0', fontSize: 11, cursor: 'pointer' }}>{'\u9000\u51fa'}</button>
          </div>
        )}
      </div>
    )
  }

  // Detail view
  if (selectedMovie) {
    const m = selectedMovie
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
        <Script src="https://cdn.jsdelivr.net/npm/hls.js@latest" onLoad={() => setHlsReady(true)} />
        <div style={headerStyle}>
          <button onClick={() => setSelectedMovie(null)} style={btnStyle}>{'\u2190'}</button>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#7a5a6a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            {m.pic && <img src={m.pic} style={{ width: 100, height: 140, objectFit: 'cover', borderRadius: 10 }} alt="" />}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#4a3040', marginBottom: 4 }}>{m.name}</div>
              {m.score && m.score !== '0' && <div style={{ fontSize: 12, color: '#e8a040', marginBottom: 2 }}>{'\u2b50 ' + m.score}</div>}
              <div style={{ fontSize: 11, color: '#9a7a8a', lineHeight: 1.6 }}>
                {m.type && <div>{m.type}{m.year ? ' \u00b7 ' + m.year : ''}{m.area ? ' \u00b7 ' + m.area : ''}</div>}
                {m.director && <div>{'\u5bfc\u6f14: ' + m.director}</div>}
                {m.actor && <div>{'\u6f14\u5458: ' + m.actor.substring(0, 60)}</div>}
                {m.remarks && <div style={{ color: '#d08a9a' }}>{m.remarks}</div>}
              </div>
            </div>
          </div>
          {m.desc && <div style={{ fontSize: 12, color: '#8a6a7a', lineHeight: 1.5, marginBottom: 12, maxHeight: 60, overflow: 'hidden' }}>{m.desc.replace(/<[^>]+>/g, '')}</div>}
          {m.sources.map((src, si) => (
            <div key={si} style={{ marginBottom: 12 }}>
              {m.sources.length > 1 && <div style={{ fontSize: 11, color: '#b08a9a', marginBottom: 6, fontWeight: 600 }}>{'\u7ebf\u8def ' + (si + 1) + ': ' + src.name}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {src.episodes.map((ep, ei) => (
                  <button key={ei} onClick={() => startPlay(m, si, ei)}
                    style={{
                      padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(230,200,220,0.4)',
                      background: 'rgba(255,250,252,0.9)', fontSize: 12, color: '#5a3a4a', cursor: 'pointer'
                    }}>{ep.name}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Search view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
      <Script src="https://cdn.jsdelivr.net/npm/hls.js@latest" onLoad={() => setHlsReady(true)} />
      {!mini && (
        <div style={headerStyle}>
          {onBack && <button onClick={onBack} style={btnStyle}>{'\u2190'}</button>}
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#7a5a6a' }}>{'\ud83c\udfac \u4e00\u8d77\u770b'}</span>
          {onMinimize && <button onClick={onMinimize} style={{ ...btnStyle, fontSize: 14, color: '#b08a9a' }}>{'\u2212'}</button>}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: mini ? '8px' : '12px 16px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder={'\u641c\u7d22\u7535\u5f71\u3001\u7535\u89c6\u5267\u3001\u52a8\u6f2b...'}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(230,200,220,0.5)',
              background: 'rgba(255,250,252,0.9)', fontSize: 13, color: '#4a3a50', outline: 'none'
            }}
          />
          <button onClick={search} disabled={loading}
            style={{
              padding: '8px 14px', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg, #e8a0bf 0%, #d080a0 100%)',
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1
            }}>{loading ? '...' : '\u641c\u7d22'}</button>
        </div>
        {error && <div style={{ color: '#d06080', fontSize: 12, marginBottom: 8, padding: '6px 10px', background: 'rgba(255,220,230,0.5)', borderRadius: 8 }}>{error}</div>}
        {results.length > 0 && (
          <div>
            {results.map((m, i) => (
              <div key={i} onClick={() => selectMovie(m)}
                style={{
                  display: 'flex', gap: 10, padding: '8px', marginBottom: 8, borderRadius: 12,
                  background: 'rgba(255,252,254,0.95)', cursor: 'pointer', border: '1px solid rgba(240,220,230,0.3)'
                }}>
                {m.pic && <img src={m.pic} style={{ width: 60, height: 84, objectFit: 'cover', borderRadius: 8 }} alt="" />}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#4a3040', marginBottom: 2 }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: '#9a7a8a' }}>
                    {m.type}{m.year ? ' \u00b7 ' + m.year : ''}{m.score && m.score !== '0' ? ' \u00b7 \u2b50' + m.score : ''}
                  </div>
                  {m.remarks && <div style={{ fontSize: 10, color: '#d08a9a', marginTop: 2 }}>{m.remarks}</div>}
                  {m.actor && <div style={{ fontSize: 10, color: '#a08090', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.actor.substring(0, 40)}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
        {results.length === 0 && history.length > 0 && !loading && (
          <div>
            <div style={{ fontSize: 12, color: '#b08a9a', marginBottom: 8, fontWeight: 600 }}>{'\u6700\u8fd1\u770b\u8fc7'}</div>
            {history.map((item, idx) => (
              <div key={idx} onClick={() => {
                setKeyword(item.name)
                setLoading(true); setError('')
                fetch('/api/movie-search?wd=' + encodeURIComponent(item.name)).then(r => r.json()).then(data => {
                  if (data.list?.length) {
                    const found = data.list.find(m => m.id === item.id) || data.list[0]
                    selectMovie(found)
                  }
                }).catch(() => {}).finally(() => setLoading(false))
              }}
                style={{
                  display: 'flex', gap: 10, padding: '8px', marginBottom: 6, borderRadius: 10,
                  background: 'rgba(255,250,252,0.8)', cursor: 'pointer', border: '1px solid rgba(240,220,230,0.3)'
                }}>
                {item.pic ? <img src={item.pic} style={{ width: 50, height: 70, objectFit: 'cover', borderRadius: 6 }} alt="" /> : <div style={{ width: 50, height: 70, borderRadius: 6, background: 'rgba(200,160,180,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{'\ud83c\udfac'}</div>}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#5a3a4a' }}>{item.name}</div>
                  <div style={{ fontSize: 10, color: '#a08090', marginTop: 2 }}>{item.type}{item.epName ? ' \u00b7 ' + item.epName : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {results.length === 0 && history.length === 0 && !loading && (
          <div style={{ textAlign: 'center', paddingTop: 60, color: '#b8a0a8' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{'\ud83c\udfac'}</div>
            <div style={{ fontSize: 13 }}>{'\u641c\u7d22\u4f60\u60f3\u770b\u7684\u5f71\u89c6'}</div>
            <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>{'\u7535\u5f71\u3001\u7535\u89c6\u5267\u3001\u52a8\u6f2b\u90fd\u6709'}</div>
          </div>
        )}
      </div>
    </div>
  )
}