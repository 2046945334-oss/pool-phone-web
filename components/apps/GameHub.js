import { useState } from 'react'
import GomokuApp from './GomokuApp'
import MemoryMatchApp from './MemoryMatchApp'

const GAMES = [
  { id: 'gomoku', name: '五子棋', desc: '你执黑 vs AI执白' },
  { id: 'memory', name: '翻牌配对', desc: '记住位置配成对' },
]

export default function GameHub({ mini = false, onBack, onMinimize }) {
  const [activeGame, setActiveGame] = useState(null)

  if (activeGame === 'gomoku') return <GomokuApp mini={mini} onBack={() => setActiveGame(null)} onMinimize={onMinimize} />
  if (activeGame === 'memory') return <MemoryMatchApp mini={mini} onBack={() => setActiveGame(null)} onMinimize={onMinimize} />

  const header = (!mini && (onBack || onMinimize)) ? (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid rgba(240,215,230,0.3)' }}>
      <div style={{ display:'flex', gap:8 }}>
        {onBack && <button onClick={onBack} style={{ background:'none', border:'none', fontSize:16, cursor:'pointer', color:'#7a5a6a' }}>{'←'}</button>}
      </div>
      <span style={{ fontSize:14, fontWeight:600, color:'#7a5a6a' }}>游戏</span>
      <div style={{ display:'flex', gap:8 }}>
        {onMinimize && <button onClick={onMinimize} style={{ background:'none', border:'none', fontSize:14, cursor:'pointer', color:'#b08a9a' }}>{'−'}</button>}
      </div>
    </div>
  ) : null

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background: mini ? 'transparent' : 'linear-gradient(180deg, rgba(255,245,250,1) 0%, rgba(255,240,248,0.95) 100%)' }}>
      {header}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap: mini ? 8 : 12, padding: mini ? '8px 12px' : '16px 24px' }}>
        {GAMES.map(g => (
          <button key={g.id} onClick={() => setActiveGame(g.id)} style={{
            width:'100%', maxWidth:260, padding: mini ? '10px 14px' : '14px 18px',
            background:'rgba(255,240,248,0.7)', border:'1px solid rgba(230,200,220,0.5)',
            borderRadius:14, cursor:'pointer', textAlign:'left',
            display:'flex', flexDirection:'column', gap:3,
            transition:'all 0.15s',
          }}>
            <span style={{ fontSize: mini ? 13 : 15, fontWeight:600, color:'#7a5a6a' }}>{g.name}</span>
            <span style={{ fontSize: mini ? 11 : 12, color:'#b08a9a' }}>{g.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}