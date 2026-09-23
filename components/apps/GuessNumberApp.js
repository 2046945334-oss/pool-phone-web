import { useState, useCallback } from 'react'

// 1A2B Guess Number Game
// Rules: one player sets a 4-digit number (digits 0-9, no repeats), the other guesses.
// Feedback: xA yB — A = correct digit+position, B = correct digit wrong position.
// Two modes: user guesses AI's number, AI guesses user's number. Compare rounds.

function genSecret() {
  const d = [0,1,2,3,4,5,6,7,8,9]
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]] }
  return d.slice(0, 4).join('')
}

function judge(secret, guess) {
  let a = 0, b = 0
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) a++
    else if (secret.includes(guess[i])) b++
  }
  return { a, b }
}

function isValidGuess(s) {
  if (!/^\d{4}$/.test(s)) return false
  return new Set(s).size === 4
}

// Simple AI strategy: maintain candidate list, pick random from candidates
function aiGuess(candidates) {
  return candidates[Math.floor(Math.random() * candidates.length)]
}

function filterCandidates(candidates, guess, result) {
  return candidates.filter(c => {
    const j = judge(c, guess)
    return j.a === result.a && j.b === result.b
  })
}

function initCandidates() {
  const list = []
  for (let i = 0; i < 10000; i++) {
    const s = String(i).padStart(4, '0')
    if (new Set(s).size === 4) list.push(s)
  }
  return list
}

export default function GuessNumberApp({ mini = false, onBack, onMinimize }) {
  // phase: 'menu' | 'userGuess' | 'aiGuess' | 'result'
  const [phase, setPhase] = useState('menu')
  const [secret, setSecret] = useState('')          // AI's secret (userGuess mode)
  const [userSecret, setUserSecret] = useState('')   // user's secret (aiGuess mode)
  const [secretInput, setSecretInput] = useState('')
  const [guessInput, setGuessInput] = useState('')
  const [history, setHistory] = useState([])         // { guess, a, b }
  const [aiHistory, setAiHistory] = useState([])
  const [candidates, setCandidates] = useState([])
  const [message, setMessage] = useState('')
  const [stats, setStats] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('pool_1a2b_stats') || '{}') } catch { return {} }
    }
    return {}
  })
  const [roundResults, setRoundResults] = useState(null) // { userRounds, aiRounds }

  const saveStats = useCallback((s) => {
    setStats(s)
    try { localStorage.setItem('pool_1a2b_stats', JSON.stringify(s)) } catch {}
  }, [])

  const startUserGuess = () => {
    setSecret(genSecret())
    setHistory([])
    setGuessInput('')
    setMessage('')
    setPhase('userGuess')
  }

  const handleUserGuess = () => {
    if (!isValidGuess(guessInput)) { setMessage('请输入4位不重复数字'); return }
    const result = judge(secret, guessInput)
    const newHistory = [...history, { guess: guessInput, a: result.a, b: result.b }]
    setHistory(newHistory)
    setGuessInput('')
    if (result.a === 4) {
      setMessage('猜对了! 用了' + newHistory.length + '轮')
      // Now start AI guessing phase
      setTimeout(() => {
        setPhase('aiGuess')
        setSecretInput('')
        setUserSecret('')
        setAiHistory([])
        setCandidates(initCandidates())
        setMessage('现在轮到你出题，输入一个4位不重复数字')
      }, 1500)
    } else {
      setMessage('')
    }
  }

  const startAiGuessPhase = () => {
    if (!isValidGuess(secretInput)) { setMessage('请输入4位不重复数字'); return }
    setUserSecret(secretInput)
    setMessage('')
    const cands = initCandidates()
    setCandidates(cands)
    const g = aiGuess(cands)
    setAiHistory([{ guess: g, a: null, b: null, pending: true }])
  }

  const confirmAiResult = (a, b) => {
    const last = aiHistory[aiHistory.length - 1]
    if (!last || !last.pending) return
    const updated = [...aiHistory.slice(0, -1), { ...last, a, b, pending: false }]
    setAiHistory(updated)

    if (a === 4) {
      // AI guessed correctly
      const userRounds = history.length
      const aiRounds = updated.length
      const result = userRounds < aiRounds ? 'win' : userRounds > aiRounds ? 'lose' : 'draw'
      setRoundResults({ userRounds, aiRounds, result })
      const newStats = { ...stats }
      newStats[result] = (newStats[result] || 0) + 1
      saveStats(newStats)
      setPhase('result')
      return
    }

    // Filter and make next guess
    const newCands = filterCandidates(candidates, last.guess, { a, b })
    setCandidates(newCands)
    if (newCands.length === 0) {
      setMessage('没有符合条件的数字了，请确认反馈是否正确')
      return
    }
    const g = aiGuess(newCands)
    setAiHistory([...updated, { guess: g, a: null, b: null, pending: true }])
  }

  // Auto-judge for AI guesses (we know the secret)
  const autoJudgeAi = () => {
    if (!userSecret) return
    const last = aiHistory[aiHistory.length - 1]
    if (!last || !last.pending) return
    const result = judge(userSecret, last.guess)
    confirmAiResult(result.a, result.b)
  }

  const reset = () => {
    setPhase('menu')
    setHistory([])
    setAiHistory([])
    setMessage('')
    setRoundResults(null)
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

  const statsLine = (
    <div style={{ display:'flex', justifyContent:'center', gap:16, fontSize:12, color:'#a08898', padding:'4px 0' }}>
      <span><b>{stats.win||0}</b> 胜</span>
      <span><b>{stats.lose||0}</b> 负</span>
      <span><b>{stats.draw||0}</b> 平</span>
    </div>
  )

  const btnStyle = { background:'linear-gradient(135deg,#e8a0bf,#d4a0c8)', color:'#fff', border:'none', borderRadius:14, padding:'10px 28px', fontSize:14, cursor:'pointer', boxShadow:'0 2px 8px rgba(200,120,160,0.2)' }
  const inputStyle = { width:120, textAlign:'center', fontSize:20, letterSpacing:8, padding:'8px 12px', border:'1px solid rgba(200,170,190,0.5)', borderRadius:10, background:'rgba(255,245,250,0.8)', color:'#5a3a4a', outline:'none' }

  if (phase === 'menu') {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
        {header}
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, padding:'0 16px' }}>
          <div style={{ fontSize:13, color:'#b08a9a', textAlign:'center', lineHeight:1.6 }}>
            猜对方的4位数(不重复)<br/>xA = 数字和位置都对<br/>yB = 数字对位置不对
          </div>
          {statsLine}
          <button onClick={startUserGuess} style={btnStyle}>开始游戏</button>
        </div>
      </div>
    )
  }

  if (phase === 'result') {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
        {header}
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'0 16px' }}>
          <div style={{ fontSize:18, fontWeight:600, color:'#7a5a6a' }}>
            {roundResults.result === 'win' ? '你赢了' : roundResults.result === 'lose' ? 'AI赢了' : '平局'}
          </div>
          <div style={{ fontSize:13, color:'#a08898' }}>
            你用了 {roundResults.userRounds} 轮 / AI用了 {roundResults.aiRounds} 轮
          </div>
          {statsLine}
          <button onClick={reset} style={btnStyle}>再来一局</button>
        </div>
      </div>
    )
  }

  if (phase === 'userGuess') {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
        {header}
        <div style={{ padding:'8px 12px', textAlign:'center', fontSize:13, color:'#7a5a6a', fontWeight:500 }}>你来猜AI的数字</div>
        <div style={{ flex:1, overflow:'auto', padding:'0 16px' }}>
          {history.map((h, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 12px', margin:'3px 0', background:'rgba(255,240,248,0.6)', borderRadius:8, fontSize:14 }}>
              <span style={{ fontFamily:'monospace', letterSpacing:4, color:'#5a3a4a' }}>{h.guess}</span>
              <span style={{ color:'#a06080', fontWeight:600 }}>{h.a}A{h.b}B</span>
            </div>
          ))}
        </div>
        {message && <div style={{ textAlign:'center', fontSize:12, color: message.includes('猜对') ? '#6a8a6a' : '#c44', padding:'4px' }}>{message}</div>}
        <div style={{ display:'flex', gap:8, justifyContent:'center', padding:'8px 16px 12px' }}>
          <input value={guessInput} onChange={e => setGuessInput(e.target.value.replace(/\D/g,'').slice(0,4))} onKeyDown={e => e.key === 'Enter' && handleUserGuess()} style={inputStyle} placeholder="0123" maxLength={4} inputMode="numeric" />
          <button onClick={handleUserGuess} style={{ ...btnStyle, padding:'8px 20px', fontSize:13 }}>猜</button>
        </div>
      </div>
    )
  }

  if (phase === 'aiGuess') {
    const pending = aiHistory.length > 0 && aiHistory[aiHistory.length - 1].pending

    if (!userSecret) {
      // User hasn't set their number yet
      return (
        <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
          {header}
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'0 16px' }}>
            <div style={{ fontSize:13, color:'#7a5a6a' }}>你猜对了，用了 {history.length} 轮</div>
            <div style={{ fontSize:14, color:'#7a5a6a', fontWeight:500 }}>现在轮到你出题</div>
            <div style={{ fontSize:12, color:'#b08a9a' }}>输入一个4位不重复数字，让AI来猜</div>
            {message && <div style={{ fontSize:12, color:'#c44' }}>{message}</div>}
            <input value={secretInput} onChange={e => setSecretInput(e.target.value.replace(/\D/g,'').slice(0,4))} onKeyDown={e => e.key === 'Enter' && startAiGuessPhase()} style={inputStyle} placeholder="----" maxLength={4} inputMode="numeric" />
            <button onClick={startAiGuessPhase} style={{ ...btnStyle, padding:'8px 20px', fontSize:13 }}>确定</button>
          </div>
        </div>
      )
    }

    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
        {header}
        <div style={{ padding:'8px 12px', textAlign:'center', fontSize:13, color:'#7a5a6a', fontWeight:500 }}>AI来猜你的数字 ({userSecret})</div>
        <div style={{ flex:1, overflow:'auto', padding:'0 16px' }}>
          {aiHistory.map((h, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 12px', margin:'3px 0', background:'rgba(255,240,248,0.6)', borderRadius:8, fontSize:14 }}>
              <span style={{ fontFamily:'monospace', letterSpacing:4, color:'#5a3a4a' }}>{h.guess}</span>
              {h.pending
                ? <span style={{ color:'#b08a9a', fontSize:12 }}>等待判定...</span>
                : <span style={{ color:'#a06080', fontWeight:600 }}>{h.a}A{h.b}B</span>
              }
            </div>
          ))}
        </div>
        {message && <div style={{ textAlign:'center', fontSize:12, color:'#c44', padding:'4px' }}>{message}</div>}
        {pending && (
          <div style={{ display:'flex', justifyContent:'center', padding:'8px 16px 12px' }}>
            <button onClick={autoJudgeAi} style={{ ...btnStyle, padding:'8px 20px', fontSize:13 }}>确认</button>
          </div>
        )}
      </div>
    )
  }

  return null
}
