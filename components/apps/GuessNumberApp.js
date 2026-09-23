import { useState, useEffect, useCallback, useRef } from 'react'

export default function GuessNumberApp({ mini = false, onBack, onMinimize }) {
  const [game, setGame] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [guessInput, setGuessInput] = useState('')
  const [secretInput, setSecretInput] = useState('')
  const [error, setError] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [aiThinking, setAiThinking] = useState(false)
  const pollRef = useRef(null)

  const loadGame = useCallback(async () => {
    try {
      const res = await fetch('/api/guess')
      if (!res.ok) { setError('加载失败'); setLoading(false); return }
      const data = await res.json()
      setGame(data.game); setStats(data.stats)
      if (data.game && data.game.phase === 'aiGuess') { setAiThinking(true); pollForAiGuess() }
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { loadGame() }, [loadGame])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function newGame() {
    setLoading(true); setError(null); setLastResult(null)
    try {
      const res = await fetch('/api/guess', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'new' }) })
      const data = await res.json()
      setGame(data.game); setStats(data.stats)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function handleUserGuess() {
    if (!guessInput || guessInput.length !== 4) { setError('请输入4位数字'); return }
    setError(null)
    try {
      const res = await fetch('/api/guess', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'userGuess', guess: guessInput }) })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setGame(data.game); setStats(data.stats); setGuessInput('')
    } catch (e) { setError(e.message) }
  }

  async function handleSetSecret() {
    if (!secretInput || secretInput.length !== 4) { setError('请输入4位不重复数字'); return }
    setError(null)
    try {
      const res = await fetch('/api/guess', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'setSecret', secret: secretInput }) })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setGame(data.game); setStats(data.stats); setSecretInput('')
      setAiThinking(true)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('guess-user-set-secret', {
          detail: { userSecret: secretInput, userRounds: data.game.userHistory.length }
        }))
      }
      pollForAiGuess()
    } catch (e) { setError(e.message) }
  }

  function pollForAiGuess() {
    if (pollRef.current) clearInterval(pollRef.current)
    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts++
      try {
        const res = await fetch('/api/guess')
        if (!res.ok) return
        const data = await res.json()
        if (!data.game) {
          clearInterval(pollRef.current); pollRef.current = null
          setAiThinking(false); setGame(null); setStats(data.stats)
          if (data.stats?.history?.length > 0) setLastResult(data.stats.history[0].result)
          return
        }
        setGame(data.game); setStats(data.stats)
      } catch {}
      if (attempts >= 60) { clearInterval(pollRef.current); pollRef.current = null; setAiThinking(false) }
    }, 1000)
  }

  const header = (!mini && (onBack || onMinimize)) ? (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid rgba(240,215,230,0.3)' }}>
      <div style={{ display:'flex', gap:8 }}>
        {onBack && <button onClick={onBack} style={{ background:'none', border:'none', fontSize:16, cursor:'pointer', color:'#7a5a6a' }}>{'←'}</button>}
      </div>
      <span style={{ fontSize:14, fontWeight:600, color:'#7a5a6a' }}>1A2B 猜数字</span>
      <div style={{ display:'flex', gap:8 }}>
        {onMinimize && <button onClick={onMinimize} style={{ background:'none', border:'none', fontSize:14, cursor:'pointer', color:'#b08a9a' }}>{'−'}</button>}
      </div>
    </div>
  ) : null

  const btnStyle = { background:'linear-gradient(135deg,#e8a0bf,#d4a0c8)', color:'#fff', border:'none', borderRadius:14, padding:'10px 28px', fontSize:14, cursor:'pointer', boxShadow:'0 2px 8px rgba(200,120,160,0.2)' }
  const inputStyle = { width:120, textAlign:'center', fontSize:20, letterSpacing:8, padding:'8px 12px', border:'1px solid rgba(200,170,190,0.5)', borderRadius:10, background:'rgba(255,245,250,0.8)', color:'#5a3a4a', outline:'none' }
  const bg = mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)'
  const statsLine = stats ? (
    <div style={{ display:'flex', justifyContent:'center', gap:16, fontSize:12, color:'#a08898', padding:'4px 0' }}>
      <span><b>{stats.wins}</b> 胜</span><span><b>{stats.losses}</b> 负</span><span><b>{stats.draws}</b> 平</span>
    </div>
  ) : null

  if (!game) return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: bg }}>
      {header}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'0 16px' }}>
        {lastResult && <div style={{ fontSize:16, fontWeight:600, color:'#7a5a6a', padding:'8px 20px', background:'rgba(255,240,248,0.8)', borderRadius:12 }}>{lastResult === 'win' ? '你赢了' : lastResult === 'lose' ? 'AI赢了' : '平局'}</div>}
        {!lastResult && <div style={{ fontSize:13, color:'#b08a9a', textAlign:'center', lineHeight:1.6 }}>猜对方的4位数(不重复)<br/>xA=位置对 yB=数字对位置不对</div>}
        {statsLine}
        {error && <div style={{ fontSize:12, color:'#c44' }}>{error}</div>}
        <button onClick={() => { setLastResult(null); newGame() }} disabled={loading} style={{ ...btnStyle, opacity:loading?0.6:1 }}>{loading ? '...' : lastResult ? '再来一局' : '开始游戏'}</button>
      </div>
    </div>
  )

  if (game.phase === 'userGuess') return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: bg }}>
      {header}
      <div style={{ padding:'8px 12px', textAlign:'center', fontSize:13, color:'#7a5a6a', fontWeight:500 }}>你来猜AI的数字</div>
      <div style={{ flex:1, overflow:'auto', padding:'0 16px' }}>
        {game.userHistory.map((h, i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 12px', margin:'3px 0', background:'rgba(255,240,248,0.6)', borderRadius:8, fontSize:14 }}>
            <span style={{ fontFamily:'monospace', letterSpacing:4, color:'#5a3a4a' }}>{h.guess}</span>
            <span style={{ color:'#a06080', fontWeight:600 }}>{h.a}A{h.b}B</span>
          </div>
        ))}
      </div>
      {error && <div style={{ textAlign:'center', fontSize:12, color:'#c44', padding:'4px' }}>{error}</div>}
      <div style={{ display:'flex', gap:8, justifyContent:'center', padding:'8px 16px 12px' }}>
        <input value={guessInput} onChange={e => setGuessInput(e.target.value.replace(/\D/g,'').slice(0,4))} onKeyDown={e => e.key === 'Enter' && handleUserGuess()} style={inputStyle} placeholder="0123" maxLength={4} inputMode="numeric" />
        <button onClick={handleUserGuess} style={{ ...btnStyle, padding:'8px 20px', fontSize:13 }}>猜</button>
      </div>
    </div>
  )

  if (game.phase === 'setSecret') return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: bg }}>
      {header}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'0 16px' }}>
        <div style={{ fontSize:13, color:'#6a8a6a' }}>猜对了，用了 {game.userHistory.length} 轮</div>
        <div style={{ fontSize:14, color:'#7a5a6a', fontWeight:500 }}>现在你出题，让AI来猜</div>
        {error && <div style={{ fontSize:12, color:'#c44' }}>{error}</div>}
        <input value={secretInput} onChange={e => setSecretInput(e.target.value.replace(/\D/g,'').slice(0,4))} onKeyDown={e => e.key === 'Enter' && handleSetSecret()} style={inputStyle} placeholder="----" maxLength={4} inputMode="numeric" />
        <button onClick={handleSetSecret} style={{ ...btnStyle, padding:'8px 20px', fontSize:13 }}>确定</button>
      </div>
    </div>
  )

  if (game.phase === 'aiGuess') return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: bg }}>
      {header}
      <div style={{ padding:'8px 12px', textAlign:'center', fontSize:13, color:'#7a5a6a', fontWeight:500 }}>AI来猜你的数字 ({game.userSecret}){aiThinking ? ' — 思考中...' : ''}</div>
      <div style={{ flex:1, overflow:'auto', padding:'0 16px' }}>
        {game.aiHistory.map((h, i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 12px', margin:'3px 0', background:'rgba(255,240,248,0.6)', borderRadius:8, fontSize:14 }}>
            <span style={{ fontFamily:'monospace', letterSpacing:4, color:'#5a3a4a' }}>{h.guess}</span>
            <span style={{ color:'#a06080', fontWeight:600 }}>{h.a}A{h.b}B</span>
          </div>
        ))}
      </div>
    </div>
  )

  return null
}