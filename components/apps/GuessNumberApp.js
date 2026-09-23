import { useState, useEffect, useCallback, useRef } from 'react'

export default function GuessNumberApp({ mini = false, onBack, onMinimize }) {
  const [game, setGame] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [guessInput, setGuessInput] = useState('')
  const [secretInput, setSecretInput] = useState('')
  const [feedbackInput, setFeedbackInput] = useState('')
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
      // Resume polling if AI needs to act
      if (data.game && (data.game.phase === 'waitAiSecret' || data.game.phase === 'aiGuess')) {
        setAiThinking(true); pollForAi()
      }
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { loadGame() }, [loadGame])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function newGame() {
    setLoading(true); setError(null); setLastResult(null)
    try {
      const res = await fetch('/api/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'new' }) })
      const data = await res.json()
      setGame(data.game); setStats(data.stats)
      // Trigger AI to set its secret
      setAiThinking(true)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('guess-new-game', { detail: {} }))
      }
      pollForAi()
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function handleUserGuess() {
    if (!guessInput || guessInput.length !== 4) { setError('请输入4位数字'); return }
    setError(null)
    try {
      const res = await fetch('/api/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'userGuess', guess: guessInput }) })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setGame(data.game); setStats(data.stats); setGuessInput('')
      // Inject guess result into chat
      if (typeof window !== 'undefined') {
        const lastH = data.game.userHistory[data.game.userHistory.length - 1]
        window.dispatchEvent(new CustomEvent('guess-user-guessed', {
          detail: {
            guess: lastH.guess,
            result: `${lastH.a}A${lastH.b}B`,
            round: data.game.userHistory.length,
            guessedCorrect: data.guessedCorrect
          }
        }))
      }
    } catch (e) { setError(e.message) }
  }

  async function handleSetSecret() {
    if (!secretInput || secretInput.length !== 4) { setError('请输入4位不重复数字'); return }
    if (new Set(secretInput).size !== 4) { setError('数字不能重复'); return }
    setError(null)
    try {
      const res = await fetch('/api/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setSecret', secret: secretInput }) })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setGame(data.game); setStats(data.stats); setSecretInput('')
      setAiThinking(true)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('guess-user-set-secret', {
          detail: { userRounds: data.game.userHistory.length }
        }))
      }
      pollForAi()
    } catch (e) { setError(e.message) }
  }

  async function handleFeedback() {
    const fb = feedbackInput.toUpperCase().trim()
    if (!/^\d[aA]\d[bB]$/.test(fb)) { setError('请输入格式如 2A1B'); return }
    setError(null)
    try {
      const res = await fetch('/api/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'userFeedback', feedback: fb }) })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setGame(data.game); setStats(data.stats); setFeedbackInput('')
      // Inject feedback into chat
      if (typeof window !== 'undefined') {
        const lastH = data.game.aiHistory[data.game.aiHistory.length - 1]
        window.dispatchEvent(new CustomEvent('guess-user-feedback', {
          detail: {
            guess: lastH.guess,
            feedback: `${lastH.a}A${lastH.b}B`,
            correct: data.correct,
            round: data.game.aiHistory.length
          }
        }))
      }
      if (data.correct) {
        // Game over
        setLastResult(data.game.result); setGame(null)
      } else {
        // AI needs to guess again
        setAiThinking(true)
        pollForAi()
      }
    } catch (e) { setError(e.message) }
  }

  function pollForAi() {
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
        // If AI has finished its action, stop polling
        if (data.game.phase === 'userGuess' || data.game.phase === 'userFeedback') {
          clearInterval(pollRef.current); pollRef.current = null
          setAiThinking(false)
        }
      } catch {}
      if (attempts >= 90) { clearInterval(pollRef.current); pollRef.current = null; setAiThinking(false) }
    }, 1000)
  }

  const header = (!mini && (onBack || onMinimize)) ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid rgba(240,215,230,0.3)' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {onBack && <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#7a5a6a' }}>{'←'}</button>}
      </div>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#7a5a6a' }}>1A2B 猜数字</span>
      <div style={{ display: 'flex', gap: 8 }}>
        {onMinimize && <button onClick={onMinimize} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: '#b08a9a' }}>{'−'}</button>}
      </div>
    </div>
  ) : null

  const btnStyle = { background: 'linear-gradient(135deg,#e8a0bf,#d4a0c8)', color: '#fff', border: 'none', borderRadius: 14, padding: '10px 28px', fontSize: 14, cursor: 'pointer', boxShadow: '0 2px 8px rgba(200,120,160,0.2)' }
  const inputStyle = { width: 120, textAlign: 'center', fontSize: 20, letterSpacing: 8, padding: '8px 12px', border: '1px solid rgba(200,170,190,0.5)', borderRadius: 10, background: 'rgba(255,245,250,0.8)', color: '#5a3a4a', outline: 'none' }
  const bg = mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)'
  const statsLine = stats ? (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 12, color: '#a08898', padding: '4px 0' }}>
      <span><b>{stats.wins}</b> 胜</span><span><b>{stats.losses}</b> 负</span><span><b>{stats.draws}</b> 平</span>
    </div>
  ) : null

  // Lobby / game over
  if (!game) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>
      {header}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 16px' }}>
        {lastResult && <div style={{ fontSize: 16, fontWeight: 600, color: '#7a5a6a', padding: '8px 20px', background: 'rgba(255,240,248,0.8)', borderRadius: 12 }}>{lastResult === 'win' ? '你赢了' : lastResult === 'lose' ? 'AI赢了' : '平局'}</div>}
        {!lastResult && <div style={{ fontSize: 13, color: '#b08a9a', textAlign: 'center', lineHeight: 1.6 }}>双方各出4位不重复数字<br/>互猜对方的数字，比谁用的轮数少<br/>xA=位置对 yB=数字对位置不对</div>}
        {statsLine}
        {error && <div style={{ fontSize: 12, color: '#c44' }}>{error}</div>}
        <button onClick={() => { setLastResult(null); newGame() }} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }}>{loading ? '...' : lastResult ? '再来一局' : '开始游戏'}</button>
      </div>
    </div>
  )

  // Waiting for AI to set its secret
  if (game.phase === 'waitAiSecret') return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>
      {header}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 16px' }}>
        <div style={{ fontSize: 14, color: '#7a5a6a', fontWeight: 500 }}>AI正在想数字...</div>
        <div style={{ width: 24, height: 24, border: '2px solid #e8a0bf', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    </div>
  )

  // User guessing AI's number
  if (game.phase === 'userGuess') return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>
      {header}
      <div style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, color: '#7a5a6a', fontWeight: 500 }}>你来猜AI的数字</div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
        {game.userHistory.map((h, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', margin: '3px 0', background: 'rgba(255,240,248,0.6)', borderRadius: 8, fontSize: 14 }}>
            <span style={{ fontFamily: 'monospace', letterSpacing: 4, color: '#5a3a4a' }}>{h.guess}</span>
            <span style={{ color: '#a06080', fontWeight: 600 }}>{h.a}A{h.b}B</span>
          </div>
        ))}
      </div>
      {error && <div style={{ textAlign: 'center', fontSize: 12, color: '#c44', padding: '4px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '8px 16px 12px' }}>
        <input value={guessInput} onChange={e => setGuessInput(e.target.value.replace(/\D/g, '').slice(0, 4))} onKeyDown={e => e.key === 'Enter' && handleUserGuess()} style={inputStyle} placeholder="0123" maxLength={4} inputMode="numeric" />
        <button onClick={handleUserGuess} style={{ ...btnStyle, padding: '8px 20px', fontSize: 13 }}>猜</button>
      </div>
    </div>
  )

  // User sets their secret
  if (game.phase === 'setSecret') return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>
      {header}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 16px' }}>
        <div style={{ fontSize: 13, color: '#6a8a6a' }}>猜对了，用了 {game.userHistory.length} 轮</div>
        <div style={{ fontSize: 14, color: '#7a5a6a', fontWeight: 500 }}>现在你出题，让AI来猜</div>
        <div style={{ fontSize: 12, color: '#b08a9a' }}>设一个4位不重复数字</div>
        {error && <div style={{ fontSize: 12, color: '#c44' }}>{error}</div>}
        <input value={secretInput} onChange={e => setSecretInput(e.target.value.replace(/\D/g, '').slice(0, 4))} onKeyDown={e => e.key === 'Enter' && handleSetSecret()} style={inputStyle} placeholder="----" maxLength={4} inputMode="numeric" />
        <button onClick={handleSetSecret} style={{ ...btnStyle, padding: '8px 20px', fontSize: 13 }}>确定</button>
      </div>
    </div>
  )

  // AI guessing — waiting for AI to make a guess
  if (game.phase === 'aiGuess') return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>
      {header}
      <div style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, color: '#7a5a6a', fontWeight: 500 }}>AI来猜你的数字 ({game.userSecret}){aiThinking ? ' — 思考中...' : ''}</div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
        {game.aiHistory.map((h, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', margin: '3px 0', background: 'rgba(255,240,248,0.6)', borderRadius: 8, fontSize: 14 }}>
            <span style={{ fontFamily: 'monospace', letterSpacing: 4, color: '#5a3a4a' }}>{h.guess}</span>
            <span style={{ color: '#a06080', fontWeight: 600 }}>{h.a}A{h.b}B</span>
          </div>
        ))}
      </div>
    </div>
  )

  // User provides feedback for AI's guess
  if (game.phase === 'userFeedback') return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>
      {header}
      <div style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, color: '#7a5a6a', fontWeight: 500 }}>AI来猜你的数字 ({game.userSecret})</div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
        {game.aiHistory.map((h, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', margin: '3px 0', background: 'rgba(255,240,248,0.6)', borderRadius: 8, fontSize: 14 }}>
            <span style={{ fontFamily: 'monospace', letterSpacing: 4, color: '#5a3a4a' }}>{h.guess}</span>
            <span style={{ color: '#a06080', fontWeight: 600 }}>{h.a}A{h.b}B</span>
          </div>
        ))}
        {/* Show AI's pending guess */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', margin: '3px 0', background: 'rgba(232,160,191,0.15)', borderRadius: 8, fontSize: 14, border: '1px dashed rgba(200,140,170,0.4)' }}>
          <span style={{ fontFamily: 'monospace', letterSpacing: 4, color: '#5a3a4a' }}>{game.pendingAiGuess}</span>
          <span style={{ color: '#a06080', fontSize: 12 }}>等你反馈</span>
        </div>
      </div>
      {error && <div style={{ textAlign: 'center', fontSize: 12, color: '#c44', padding: '4px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', padding: '8px 16px 12px' }}>
        <span style={{ fontSize: 12, color: '#b08a9a' }}>AI猜了 {game.pendingAiGuess}，结果是</span>
        <input value={feedbackInput} onChange={e => setFeedbackInput(e.target.value.slice(0, 4))} onKeyDown={e => e.key === 'Enter' && handleFeedback()} style={{ ...inputStyle, width: 80, fontSize: 16, letterSpacing: 2 }} placeholder="xAxB" maxLength={4} />
        <button onClick={handleFeedback} style={{ ...btnStyle, padding: '8px 16px', fontSize: 13 }}>确认</button>
      </div>
    </div>
  )

  // Done state (shouldn't reach here normally)
  if (game.phase === 'done') return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>
      {header}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#7a5a6a' }}>{game.result === 'win' ? '你赢了' : game.result === 'lose' ? 'AI赢了' : '平局'}</div>
        <button onClick={() => { setGame(null); setLastResult(game.result) }} style={btnStyle}>返回</button>
      </div>
    </div>
  )

  return null
}