import { useState, useEffect } from 'react'

const K = 'pool_browser_history'
function getH() { try { return JSON.parse(localStorage.getItem(K)) || [] } catch { return [] } }
function saveH(l) { localStorage.setItem(K, JSON.stringify(l.slice(0, 30))) }

export default function BrowserApp() {
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState([])

  useEffect(() => { setHistory(getH()) }, [])

  function doSearch(q) {
    const val = q || query.trim()
    if (!val) return
    const l = getH()
    const t = new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    l.unshift({ q: val, t })
    const seen = {}
    const filtered = l.filter(h => { if (seen[h.q]) return false; seen[h.q] = 1; return true })
    saveH(filtered)
    setHistory(filtered)
    if (/^https?:\/\//i.test(val) || /^[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(val)) {
      window.open(val.indexOf('://') > -1 ? val : 'https://' + val, '_blank')
    } else {
      window.open('https://www.bing.com/search?q=' + encodeURIComponent(val), '_blank')
    }
  }

  function clearH() { localStorage.removeItem(K); setHistory([]) }

  const quickLinks = [
    { name: '百度', icon: '🔍', url: 'https://www.baidu.com' },
    { name: 'B站', icon: '📺', url: 'https://m.bilibili.com' },
    { name: '知乎', icon: '💡', url: 'https://www.zhihu.com' },
    { name: '豆瓣', icon: '📗', url: 'https://www.douban.com' },
    { name: '网易云', icon: '🎵', url: 'https://music.163.com' },
    { name: 'GitHub', icon: '🐙', url: 'https://github.com' },
    { name: '淘宝', icon: '🛒', url: 'https://www.taobao.com' },
    { name: '翻译', icon: '🌐', url: 'https://translate.google.com' },
  ]

  return (
    <div style={{ fontFamily: '-apple-system, sans-serif', background: '#f5f0f5', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px', background: '#fff', borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="搜索或输入网址..."
            style={{ flex: 1, padding: '10px 14px', borderRadius: '20px', border: '1.5px solid #e0d6e8', fontSize: '14px', outline: 'none', background: '#faf8fc' }}
          />
          <button onClick={() => doSearch()} style={{ width: '38px', height: '38px', borderRadius: '50%', border: 'none', background: '#9b6fbf', color: '#fff', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🔍</button>
        </div>
      </div>
      <div style={{ padding: '16px' }}>
        <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '10px' }}>快捷访问</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
          {quickLinks.map(l => (
            <div key={l.name} onClick={() => window.open(l.url, '_blank')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>{l.icon}</div>
              <span style={{ fontSize: '11px', color: '#666' }}>{l.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, padding: '0 16px 16px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
          <span style={{ fontSize: '12px', color: '#aaa' }}>搜索记录</span>
          <button onClick={clearH} style={{ color: '#b38fd9', cursor: 'pointer', fontSize: '11px', border: 'none', background: 'none' }}>清空</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {history.length === 0 && <div style={{ textAlign: 'center', color: '#ccc', padding: '30px 0', fontSize: '12px' }}>暂无记录</div>}
          {history.map((h, i) => (
            <div key={i} onClick={() => doSearch(h.q)} style={{ padding: '10px 12px', background: '#fff', borderRadius: '10px', fontSize: '13px', color: '#333', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.q}</span>
              <span style={{ fontSize: '10px', color: '#bbb', flexShrink: 0, marginLeft: '8px' }}>{h.t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
