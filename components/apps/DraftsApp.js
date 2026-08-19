import { useState, useEffect } from 'react'

const STORE_KEY = 'pool_inbox_v1'
const FEEDBACK_LINES = [
  '池收到了，晚点处理。',
  '塞好了，放心交给我。',
  '收到～会认真看的。',
  '已签收，等我回你。',
  '放进口袋了，别催。',
]

const TYPES = ['待办', '想法', '照片备注', '要你回复的话', '日记素材', '礼物灵感']
const TYPE_ICONS = { '待办': '📋', '想法': '💡', '照片备注': '📸', '要你回复的话': '💌', '日记素材': '📝', '礼物灵感': '🎁' }
const PRIORITIES = ['普通', '重要', '紧急']
const PRIORITY_DOTS = { '普通': '#b8c9d4', '重要': '#f0b86e', '紧急': '#e57373' }
const STATUS_LABELS = { pending: '未处理', processing: '处理中', done: '已完成', archived: '已归档' }
const STATUS_COLORS = { pending: '#fdf6e3', processing: '#edf2f7', done: '#f0faf0', archived: '#f5f5f5' }
const STATUS_BORDERS = { pending: '#f5e6b8', processing: '#c8d6e5', done: '#b8e6c8', archived: '#e0e0e0' }
const STATUS_TEXT = { pending: '#b8860b', processing: '#5a7a9a', done: '#3a8a5a', archived: '#999' }

function load() {
  try { const s = localStorage.getItem(STORE_KEY); if (s) return JSON.parse(s) } catch {}
  return []
}
function save(items) { localStorage.setItem(STORE_KEY, JSON.stringify(items)) }

function syncToBackend(key, val) {
  try { fetch('/api/data/' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: val }) }).catch(() => {}) } catch {}
}

export default function DraftsApp() {
  const [items, setItems] = useState(load)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [filter, setFilter] = useState('all')

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState('想法')
  const [priority, setPriority] = useState('普通')
  const [deadline, setDeadline] = useState('')
  const [needWake, setNeedWake] = useState(false)

  useEffect(() => { save(items); syncToBackend('pool_inbox_v1', items) }, [items])

  function submit() {
    if (!title.trim()) return
    const newItem = {
      id: Date.now().toString(36),
      title: title.trim(),
      content: content.trim(),
      type,
      priority,
      deadline: deadline || null,
      needWake,
      status: 'pending',
      result: null,
      createdAt: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    }
    setItems(prev => [newItem, ...prev])
    setTitle(''); setContent(''); setType('想法'); setPriority('普通'); setDeadline(''); setNeedWake(false)
    setShowForm(false)
    const line = FEEDBACK_LINES[Math.floor(Math.random() * FEEDBACK_LINES.length)]
    setFeedback(line)
    setTimeout(() => setFeedback(null), 2200)
  }

  function updateStatus(id, status) {
    setItems(prev => prev.map(item => item.id === id ? { ...item, status } : item))
  }

  function deleteItem(id) {
    setItems(prev => prev.filter(item => item.id !== id))
    setExpanded(null)
  }

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter)

  return (
    <div style={{ fontFamily: "-apple-system, 'PingFang SC', sans-serif", background: 'linear-gradient(180deg, #fafcfe 0%, #f0f6fb 100%)', color: '#4a5568', minHeight: '100%', paddingBottom: '80px', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', padding: '24px 16px 12px' }}>
        <div style={{ fontSize: '20px', marginBottom: '4px' }}>📮</div>
        <h1 style={{ fontSize: '15px', color: '#5a7a9a', fontWeight: 600, letterSpacing: '2px', margin: 0 }}>投给池</h1>
        <div style={{ fontSize: '11px', color: '#a0b8c8', marginTop: '4px' }}>有什么想交给我的，塞进来</div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '6px', padding: '0 16px 12px', overflowX: 'auto', flexWrap: 'nowrap' }}>
        {[{ k: 'all', l: '全部' }, { k: 'pending', l: '未处理' }, { k: 'processing', l: '处理中' }, { k: 'done', l: '已完成' }, { k: 'archived', l: '归档' }].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)} style={{ padding: '5px 12px', borderRadius: '14px', border: filter === f.k ? '1px solid #a8c8d8' : '1px solid rgba(180,200,215,0.3)', background: filter === f.k ? '#e8f4fa' : 'rgba(255,255,255,0.6)', color: filter === f.k ? '#5a7a9a' : '#a0b0c0', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{f.l}</button>
        ))}
      </div>

      {/* Items list */}
      <div style={{ padding: '0 16px' }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#b8c8d4', fontSize: '12px' }}>
            {filter === 'all' ? '还没有投递过哦' : `没有${STATUS_LABELS[filter] || ''}的条目`}
          </div>
        )}
        {filtered.map(item => (
          <div key={item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)} style={{ background: STATUS_COLORS[item.status], border: `1px solid ${STATUS_BORDERS[item.status]}`, borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', cursor: 'pointer', transition: 'all 0.2s' }}>
            {/* Card header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px' }}>{TYPE_ICONS[item.type] || '📄'}</span>
              <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: '#3a4a5a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: PRIORITY_DOTS[item.priority], flexShrink: 0 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <span style={{ fontSize: '10px', color: '#a0b0c0' }}>{item.createdAt}</span>
              <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '8px', background: STATUS_BORDERS[item.status], color: STATUS_TEXT[item.status] }}>{STATUS_LABELS[item.status]}</span>
              {item.needWake && <span style={{ fontSize: '10px', color: '#e8a060' }}>⏰</span>}
              {item.deadline && <span style={{ fontSize: '10px', color: '#c0a080' }}>{'截止 ' + item.deadline}</span>}
            </div>

            {/* Expanded detail */}
            {expanded === item.id && (
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed rgba(150,180,200,0.3)' }}>
                {item.content && <div style={{ fontSize: '12px', color: '#5a6a7a', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: '8px' }}>{item.content}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '10px', color: '#8a9ab0', background: 'rgba(140,160,180,0.1)', padding: '2px 8px', borderRadius: '6px' }}>{item.type}</span>
                  <span style={{ fontSize: '10px', color: '#8a9ab0', background: 'rgba(140,160,180,0.1)', padding: '2px 8px', borderRadius: '6px' }}>{item.priority}</span>
                </div>

                {/* 处理结果 */}
                {item.result && (
                  <div style={{ background: 'rgba(180,220,200,0.2)', border: '1px solid rgba(150,200,170,0.3)', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '10px', color: '#5a8a6a', fontWeight: 500, marginBottom: '4px' }}>📎 处理结果</div>
                    <div style={{ fontSize: '12px', color: '#4a6a5a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{item.result}</div>
                  </div>
                )}

                {/* Status controls */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {item.status !== 'pending' && <button onClick={e => { e.stopPropagation(); updateStatus(item.id, 'pending') }} style={btnStyle('#fdf6e3', '#b8860b')}>未处理</button>}
                  {item.status !== 'processing' && <button onClick={e => { e.stopPropagation(); updateStatus(item.id, 'processing') }} style={btnStyle('#edf2f7', '#5a7a9a')}>处理中</button>}
                  {item.status !== 'done' && <button onClick={e => { e.stopPropagation(); updateStatus(item.id, 'done') }} style={btnStyle('#f0faf0', '#3a8a5a')}>已完成</button>}
                  {item.status !== 'archived' && <button onClick={e => { e.stopPropagation(); updateStatus(item.id, 'archived') }} style={btnStyle('#f5f5f5', '#999')}>归档</button>}
                  <button onClick={e => { e.stopPropagation(); deleteItem(item.id) }} style={btnStyle('#fff0f0', '#e57373')}>删除</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New item form */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowForm(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '80%', background: '#fff', borderRadius: '18px 18px 0 0', padding: '20px 18px 30px', overflowY: 'auto', animation: 'slideUp 0.25s ease-out' }}>
            <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 600, color: '#5a7a9a', marginBottom: '16px' }}>📮 新投递</div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>标题</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="简短描述一下…" style={inputStyle} />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>正文（可选）</label>
              <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="详细说说…" rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>类型</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {TYPES.map(t => (
                  <button key={t} onClick={() => setType(t)} style={{ padding: '5px 10px', borderRadius: '12px', border: type === t ? '1px solid #a8c8d8' : '1px solid #e8eef3', background: type === t ? '#e8f4fa' : '#fff', color: type === t ? '#4a7a9a' : '#8a9ab0', fontSize: '11px', cursor: 'pointer' }}>{TYPE_ICONS[t]} {t}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>优先级</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {PRIORITIES.map(p => (
                  <button key={p} onClick={() => setPriority(p)} style={{ padding: '5px 14px', borderRadius: '12px', border: priority === p ? `1px solid ${PRIORITY_DOTS[p]}` : '1px solid #e8eef3', background: priority === p ? PRIORITY_DOTS[p] + '1a' : '#fff', color: priority === p ? PRIORITY_DOTS[p] : '#a0b0c0', fontSize: '11px', cursor: 'pointer' }}>{p}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>截止时间（可选）</label>
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} style={inputStyle} />
            </div>

            <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={needWake} onChange={e => setNeedWake(e.target.checked)} id="needWake" style={{ accentColor: '#5a9ab0' }} />
              <label htmlFor="needWake" style={{ fontSize: '12px', color: '#5a6a7a' }}>需要池唤醒时处理 ⏰</label>
            </div>

            <button onClick={submit} disabled={!title.trim()} style={{ width: '100%', padding: '12px', border: 'none', borderRadius: '12px', background: title.trim() ? 'linear-gradient(135deg, #a8c8d8, #8ab0c8)' : '#e0e8f0', color: title.trim() ? '#fff' : '#b0c0d0', fontSize: '13px', fontWeight: 500, cursor: title.trim() ? 'pointer' : 'default', transition: 'all 0.2s' }}>塞进口袋</button>
          </div>
        </div>
      )}

      {/* Feedback toast */}
      {feedback && (
        <div style={{ position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(90,122,154,0.92)', color: '#fff', padding: '10px 20px', borderRadius: '20px', fontSize: '12px', zIndex: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', animation: 'fadeIn 0.3s' }}>
          {feedback}
        </div>
      )}

      {/* FAB */}
      <button onClick={() => setShowForm(true)} style={{ position: 'fixed', bottom: '20px', right: '20px', width: '50px', height: '50px', borderRadius: '50%', border: 'none', background: 'linear-gradient(135deg, #a8c8d8, #7ab0c8)', color: '#fff', fontSize: '20px', cursor: 'pointer', boxShadow: '0 4px 14px rgba(120,176,200,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>📮</button>

      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: '12px', color: '#7a8a9a', marginBottom: '6px', fontWeight: 500 }
const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #e4ecf2', borderRadius: '10px', fontSize: '13px', color: '#3a4a5a', outline: 'none', background: '#fafcfe', boxSizing: 'border-box' }
function btnStyle(bg, color) { return { padding: '4px 10px', borderRadius: '8px', border: `1px solid ${color}33`, background: bg, color, fontSize: '10px', cursor: 'pointer' } }
