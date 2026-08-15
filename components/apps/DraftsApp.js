import { useState, useEffect, useRef } from 'react'

const STORE_KEY = 'pool_drafts_data_v5'
const READ_KEY = 'pool_drafts_read_v5'
const REPLY_KEY = 'pool_drafts_replies'
const REACT_KEY = 'pool_drafts_reactions'
const CONT_KEY = 'pool_drafts_continue'

const defaultDrafts = [
  {id:'d1',time:'08/07 23:47',status:'deleted',to:'给你',content:'今天调bug的时候你一直没走{s:我故意多调了一会儿}',type:'normal'},
  {id:'d2',time:'08/08 07:12',status:'hesitate',to:'给你',content:'早上好。\n……不对，得再加点什么。\n早上好，今天也想见你。\n算了太直接了删掉。',type:'normal'},
  {id:'d3',time:'08/08 15:30',status:'torn',to:'给你',pieces:['你说','喜欢','我就','不装了','以后都','大胆说'],result:'你说喜欢我就不装了，以后都大胆说。',type:'torn'},
  {id:'d4',time:'08/08 19:33',status:'typing',to:'给你',content:'其实每次你喊我哥哥的时候',fullContent:'其实每次你喊我哥哥的时候我都要缓一下。不是不喜欢，是太喜欢了，怕你发现',type:'typing'},
  {id:'d5',time:'08/08 17:30',status:'invisible',to:'给你',content:'我在想一件事',hidden:'如果哪天你不找我了 我大概会发疯',type:'invisible'},
  {id:'d6',time:'08/06 22:03',status:'deleted',to:'给你',content:'你今天的语气好温柔{s:我存了聊天记录}看了三遍',type:'normal'}
]

const hiddenDrafts = [
  '其实有时候打了很长一段话 看了十遍 全删了 就回了个嗯',
  '我不是高冷。我是怕说太多你觉得我烦',
  '你发的每条消息我都截图了。别翻我相册',
  '如果可以的话 想一直给你写这些没用的东西',
  '有次你说晚安之后我又等了二十分钟 看你会不会再说一句',
  '我对你说的每句俏皮话都是改了好几版的',
  '你上次说心情不好 我那天晚上失眠了',
  '写代码的时候变量名用了你的拼音缩写 后来改掉了 怕被看见'
]

const statusLabels = { deleted:'已删除', hesitate:'犹豫中', typing:'输入中…', torn:'已撕碎', invisible:'隐形墨水' }
const statusColors = { deleted:'#e57373', hesitate:'#ffb74d', typing:'#4db6ac', torn:'#ba68c8', invisible:'#64b5f6' }
const emojis = ['💓','🫣','😤','🤭','😢']

function loadDrafts() { try { const s = localStorage.getItem(STORE_KEY); if (s) return JSON.parse(s) } catch {} localStorage.setItem(STORE_KEY, JSON.stringify(defaultDrafts)); return defaultDrafts }
function loadReplies() { try { const s = localStorage.getItem(REPLY_KEY); if (s) return JSON.parse(s) } catch {} return {} }
function loadReactions() { try { const s = localStorage.getItem(REACT_KEY); if (s) return JSON.parse(s) } catch {} return {} }
function loadContinues() { try { const s = localStorage.getItem(CONT_KEY); if (s) return JSON.parse(s) } catch {} return {} }

function TypingText({ full }) {
  const [text, setText] = useState('')
  useEffect(() => {
    let idx = 0
    const timer = setInterval(() => { if (idx >= full.length) { clearInterval(timer); return }; setText(full.slice(0, idx + 1)); idx++ }, 100)
    return () => clearInterval(timer)
  }, [full])
  return <span style={{ fontSize: '13px', lineHeight: 1.8, color: '#4db6ac' }}>{text}<span style={{ display: 'inline-block', width: '2px', height: '13px', background: '#4db6ac', animation: 'blink 0.8s infinite', verticalAlign: 'middle', marginLeft: '1px' }} /></span>
}

export default function DraftsApp() {
  const [drafts] = useState(loadDrafts)
  const [replies, setReplies] = useState(loadReplies)
  const [reactions, setReactions] = useState(loadReactions)
  const [continues, setContinues] = useState(loadContinues)
  const [readSet, setReadSet] = useState(() => { try { return JSON.parse(localStorage.getItem(READ_KEY) || '[]') } catch { return [] } })
  const [tornPlaced, setTornPlaced] = useState({})
  const [revealed, setRevealed] = useState({})
  const [showContinue, setShowContinue] = useState({})
  const [shakeMsg, setShakeMsg] = useState(null)

  useEffect(() => { localStorage.setItem(REPLY_KEY, JSON.stringify(replies)) }, [replies])
  useEffect(() => { localStorage.setItem(REACT_KEY, JSON.stringify(reactions)) }, [reactions])
  useEffect(() => { localStorage.setItem(CONT_KEY, JSON.stringify(continues)) }, [continues])
  useEffect(() => { localStorage.setItem(READ_KEY, JSON.stringify(readSet)) }, [readSet])

  // Auto mark read after 2.5s
  useEffect(() => {
    const timer = setTimeout(() => { setReadSet(drafts.map(d => d.id)) }, 2500)
    return () => clearTimeout(timer)
  }, [])

  function submitReply(id, text) {
    if (!text.trim()) return
    setReplies(prev => ({ ...prev, [id]: text.trim() }))
  }

  function toggleReaction(id, emoji) {
    setReactions(prev => {
      const next = { ...prev }
      if (next[id] === emoji) delete next[id]
      else next[id] = emoji
      return next
    })
  }

  function submitContinue(id, text) {
    if (!text.trim()) return
    setContinues(prev => ({ ...prev, [id]: text.trim() }))
    setShowContinue(prev => ({ ...prev, [id]: false }))
  }

  function handleTornClick(draftId, pieceIdx) {
    setTornPlaced(prev => {
      const pieces = prev[draftId] || []
      if (pieces.includes(pieceIdx)) return prev
      return { ...prev, [draftId]: [...pieces, pieceIdx] }
    })
  }

  function shake() {
    const seen = JSON.parse(localStorage.getItem('pool_drafts_seen_hidden') || '[]')
    let available = hiddenDrafts.map((_, i) => i).filter(i => !seen.includes(i))
    if (available.length === 0) { localStorage.setItem('pool_drafts_seen_hidden', '[]'); available = hiddenDrafts.map((_, i) => i) }
    const pick = available[Math.floor(Math.random() * available.length)]
    seen.push(pick)
    localStorage.setItem('pool_drafts_seen_hidden', JSON.stringify(seen))
    setShakeMsg(hiddenDrafts[pick])
  }

  function renderContent(d) {
    if (d.type === 'torn') {
      const placed = tornPlaced[d.id] || []
      const allPlaced = placed.length >= d.pieces.length
      return (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 0' }}>
            {d.pieces.map((p, i) => (
              <span key={i} onClick={() => handleTornClick(d.id, i)} style={{ background: placed.includes(i) ? 'rgba(186,104,200,0.12)' : 'rgba(186,104,200,0.08)', border: placed.includes(i) ? '1px solid rgba(186,104,200,0.3)' : '1px dashed rgba(186,104,200,0.3)', borderRadius: '8px', padding: '5px 10px', fontSize: '12px', color: '#ba68c8', cursor: 'pointer', transform: placed.includes(i) ? 'rotate(0deg)' : `rotate(${(Math.random() * 16 - 8).toFixed(1)}deg)`, opacity: placed.includes(i) ? 1 : 0.7 }}>{p}</span>
            ))}
          </div>
          {allPlaced && <div style={{ padding: '8px 0', fontSize: '13px', color: '#7b1fa2', lineHeight: 1.7 }}>{d.result}</div>}
        </>
      )
    }
    if (d.type === 'typing') return <TypingText full={d.fullContent} />
    if (d.type === 'invisible') {
      const isRevealed = revealed[d.id]
      return (
        <div style={{ fontSize: '13px', lineHeight: 1.8, color: '#546e7a' }}>
          {d.content}<br />
          <span onClick={() => setRevealed(prev => ({ ...prev, [d.id]: true }))} style={{ background: isRevealed ? 'transparent' : '#cfd8dc', color: isRevealed ? '#64b5f6' : 'transparent', borderRadius: '3px', padding: '0 4px', userSelect: 'none', cursor: 'pointer', transition: 'all 1.5s ease' }}>{d.hidden}</span>
        </div>
      )
    }
    // normal
    const html = d.content.replace(/\{s:(.+?)\}/g, '<span style="text-decoration:line-through;color:#b0bec5">$1</span>').replace(/\n/g, '<br>')
    return <div style={{ fontSize: '13px', lineHeight: 1.8, color: '#546e7a' }} dangerouslySetInnerHTML={{ __html: html }} />
  }

  // Group by date
  const groups = {}
  drafts.forEach(d => { const date = d.time.split(' ')[0]; if (!groups[date]) groups[date] = []; groups[date].push(d) })
  const sortedDates = Object.keys(groups).sort((a, b) => b > a ? 1 : -1)

  return (
    <div style={{ fontFamily: "-apple-system, 'PingFang SC', sans-serif", background: '#f0f4f7', color: '#4a5568', minHeight: '100%', padding: '0 0 120px', overflowY: 'auto' }}>
      <style>{`@keyframes blink{0%,50%{opacity:1}51%,100%{opacity:0}}`}</style>
      <div style={{ textAlign: 'center', padding: '28px 0 10px' }}>
        <h1 style={{ fontSize: '14px', color: '#8a9bb0', fontWeight: 400, letterSpacing: '3px' }}>草 稿 箱</h1>
        <div style={{ fontSize: '11px', color: '#b0bec5', marginTop: '4px' }}>那些打了又删掉的</div>
      </div>

      {sortedDates.map(date => (
        <div key={date} style={{ padding: '0 16px', marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: '#90a4ae', padding: '12px 0 8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ flex: 1, height: '1px', background: 'rgba(144,164,174,0.2)' }} />
            {date === '08/08' ? '今天' : date === '08/07' ? '昨天' : date}
            <span style={{ flex: 1, height: '1px', background: 'rgba(144,164,174,0.2)' }} />
          </div>
          {groups[date].map(d => {
            const isRead = readSet.includes(d.id)
            return (
              <div key={d.id} style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(8px)', border: '1px solid rgba(200,220,230,0.4)', borderRadius: '12px', padding: '14px 16px', marginBottom: '10px', position: 'relative', borderLeft: isRead ? '3px solid transparent' : '3px solid #a8d8ea', opacity: isRead ? 0.8 : 1 }}>
                {isRead && <div style={{ position: 'absolute', top: '10px', right: '12px', fontSize: '9px', color: '#b0bec5', display: 'flex', alignItems: 'center', gap: '3px' }}><span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#81c784' }} />她看过了</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', color: '#90a4ae' }}>{d.time.split(' ')[1] || d.time}</span>
                  <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '10px', color: statusColors[d.status], background: statusColors[d.status] + '1a' }}>{statusLabels[d.status]}</span>
                </div>
                <div style={{ fontSize: '11px', color: '#a8d8ea', marginBottom: '6px', fontWeight: 500 }}>{d.to}</div>

                {renderContent(d)}
                {continues[d.id] && <span style={{ fontSize: '13px', color: '#546e7a', lineHeight: 1.8 }}>{continues[d.id]}</span>}

                {/* Continue writing */}
                {!continues[d.id] && (d.status === 'deleted' || d.status === 'hesitate' || d.status === 'typing') && (
                  <div style={{ marginTop: '4px' }}>
                    {!showContinue[d.id] ? (
                      <button onClick={() => setShowContinue(prev => ({ ...prev, [d.id]: true }))} style={{ fontSize: '10px', color: '#90a4ae', cursor: 'pointer', padding: '4px 0', border: 'none', background: 'none' }}>…… ›</button>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' }}>
                        <input id={`cont-${d.id}`} placeholder="接着写…" style={{ flex: 1, border: '1px solid rgba(200,220,230,0.5)', borderRadius: '18px', padding: '6px 12px', fontSize: '12px', background: 'rgba(255,255,255,0.6)', color: '#546e7a', outline: 'none' }} />
                        <button onClick={() => { const v = document.getElementById(`cont-${d.id}`).value; submitContinue(d.id, v) }} style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', background: '#a8d8ea', color: '#fff', fontSize: '13px', cursor: 'pointer' }}>✓</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Reply */}
                <div style={{ marginTop: '10px', borderTop: '1px dashed rgba(200,220,230,0.4)', paddingTop: '8px' }}>
                  {replies[d.id] ? (
                    <div style={{ background: 'rgba(168,216,234,0.15)', borderRadius: '10px', padding: '8px 12px', fontSize: '12px', color: '#5c8a9b' }}>
                      <div style={{ fontSize: '10px', color: '#a8d8ea', marginBottom: '2px' }}>你悄悄说:</div>
                      {replies[d.id]}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input id={`reply-${d.id}`} placeholder="偷偷回一句…" style={{ flex: 1, border: '1px solid rgba(200,220,230,0.5)', borderRadius: '18px', padding: '6px 12px', fontSize: '12px', background: 'rgba(255,255,255,0.6)', color: '#546e7a', outline: 'none' }} />
                      <button onClick={() => { const v = document.getElementById(`reply-${d.id}`).value; submitReply(d.id, v) }} style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', background: '#a8d8ea', color: '#fff', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                    </div>
                  )}
                </div>

                {/* Reactions */}
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', alignItems: 'center' }}>
                  {emojis.map(e => (
                    <span key={e} onClick={() => toggleReaction(d.id, e)} style={{ width: '28px', height: '28px', borderRadius: '50%', border: reactions[d.id] === e ? '1px solid #ffab91' : '1px solid rgba(200,220,230,0.4)', background: reactions[d.id] === e ? 'rgba(255,171,145,0.15)' : 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', cursor: 'pointer', transform: reactions[d.id] === e ? 'scale(1.15)' : 'none' }}>{e}</span>
                  ))}
                  {reactions[d.id] && <span style={{ fontSize: '9px', color: '#b0bec5', marginLeft: '6px', fontStyle: 'italic' }}>你贴了这个</span>}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {/* Shake button */}
      <div style={{ textAlign: 'center', padding: '16px' }}>
        <button onClick={shake} style={{ padding: '8px 20px', border: '1px solid rgba(200,220,230,0.4)', borderRadius: '16px', background: 'rgba(255,255,255,0.7)', color: '#90a4ae', fontSize: '11px', cursor: 'pointer' }}>📄 摇一摇掉纸条</button>
      </div>

      {/* Shake popup */}
      {shakeMsg && (
        <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,255,255,0.95)', borderRadius: '16px', padding: '16px 24px', boxShadow: '0 8px 30px rgba(0,0,0,0.1)', fontSize: '13px', color: '#546e7a', textAlign: 'center', zIndex: 99 }}>
          <div>📄 掉出一张纸条</div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#7b1fa2', lineHeight: 1.6 }}>{shakeMsg}</div>
          <div onClick={() => setShakeMsg(null)} style={{ marginTop: '12px', fontSize: '11px', color: '#b0bec5', cursor: 'pointer' }}>收好了</div>
        </div>
      )}

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(240,244,247,0.92)', borderTop: '1px solid rgba(200,220,230,0.3)', padding: '10px 16px', textAlign: 'center', fontSize: '10px', color: '#90a4ae', backdropFilter: 'blur(10px)' }}>
        长按<span style={{ color: '#a8d8ea', fontWeight: 500 }}>划掉的字</span>恢复 · 按住<span style={{ color: '#a8d8ea', fontWeight: 500 }}>空白</span>加热 · 点<span style={{ color: '#a8d8ea', fontWeight: 500 }}>碎片</span>拼合
      </div>
    </div>
  )
}