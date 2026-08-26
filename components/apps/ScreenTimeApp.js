import React, { useState, useEffect } from 'react'

// Helper: format ms to readable string
function formatTime(ms) {
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Helper: format ms to hours (decimal)
function toHours(ms) {
  return (ms / 3600000).toFixed(1)
}

// Color palette for bars
const COLORS = ['#e8a0bf', '#a78bfa', '#6ee7b7', '#fbbf24', '#60a5fa', '#f87171', '#34d399', '#c084fc', '#fb923c', '#38bdf8', '#f472b6', '#a3e635']

export default function ScreenTimeApp() {
  const [hasPermission, setHasPermission] = useState(null)
  const [todayData, setTodayData] = useState(null)
  const [weeklyData, setWeeklyData] = useState(null)
  const [view, setView] = useState('today') // 'today' | 'weekly'
  const [loading, setLoading] = useState(true)
  const [isNative, setIsNative] = useState(false)

  useEffect(() => {
    const cap = typeof window !== 'undefined' && window.Capacitor
    if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
      setIsNative(true)
      checkAndLoad()
    } else {
      setIsNative(false)
      setLoading(false)
    }
  }, [])

  async function getPlugin() {
    if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins) {
      return window.Capacitor.Plugins.UsageStats
    }
    return null
  }

  async function checkAndLoad() {
    const plugin = await getPlugin()
    if (!plugin) { setLoading(false); return }
    try {
      const { granted } = await plugin.hasPermission()
      setHasPermission(granted)
      if (granted) {
        await loadData(plugin)
      }
    } catch (e) {
      console.error('UsageStats check error:', e)
    }
    setLoading(false)
  }

  async function requestPerm() {
    const plugin = await getPlugin()
    if (!plugin) return
    await plugin.requestPermission()
    // After returning from settings, re-check
    setTimeout(async () => {
      const { granted } = await plugin.hasPermission()
      setHasPermission(granted)
      if (granted) {
        setLoading(true)
        await loadData(plugin)
        setLoading(false)
      }
    }, 1000)
  }

  async function loadData(plugin) {
    try {
      const [today, weekly] = await Promise.all([
        plugin.query({ days: 1 }),
        plugin.queryDaily({ days: 7 })
      ])
      // Sort today by totalTimeMs desc
      if (today.apps) {
        today.apps.sort((a, b) => b.totalTimeMs - a.totalTimeMs)
      }
      setTodayData(today)
      setWeeklyData(weekly)
    } catch (e) {
      console.error('UsageStats load error:', e)
    }
  }

  if (loading) {
    return <div style={styles.container}><div style={styles.loadingText}>加载中...</div></div>
  }

  if (!isNative) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyCard}>
          <div style={{fontSize: 40, marginBottom: 12}}>📱</div>
          <div style={{color: '#999', fontSize: 14, lineHeight: 1.6}}>
            屏幕时间功能需要在 App 中使用
            <br/>
            <span style={{fontSize: 12, color: '#666'}}>（浏览器环境无法获取系统数据）</span>
          </div>
        </div>
      </div>
    )
  }

  if (hasPermission === false) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyCard}>
          <div style={{fontSize: 40, marginBottom: 12}}>🔒</div>
          <div style={{color: '#ccc', fontSize: 14, marginBottom: 16}}>需要「使用情况访问」权限</div>
          <button style={styles.permBtn} onClick={requestPerm}>
            去授权
          </button>
          <div style={{color: '#666', fontSize: 11, marginTop: 12}}>
            点击后在列表中找到「池的小手机」并开启
          </div>
        </div>
      </div>
    )
  }

  const totalToday = todayData?.apps?.reduce((s, a) => s + a.totalTimeMs, 0) || 0

  return (
    <div style={styles.container}>
      {/* Tab switcher */}
      <div style={styles.tabs}>
        <button style={{...styles.tab, ...(view === 'today' ? styles.tabActive : {})}} onClick={() => setView('today')}>今天</button>
        <button style={{...styles.tab, ...(view === 'weekly' ? styles.tabActive : {})}} onClick={() => setView('weekly')}>本周</button>
      </div>

      {view === 'today' && (
        <div style={styles.scrollArea}>
          {/* Total card */}
          <div style={styles.totalCard}>
            <div style={{color: '#999', fontSize: 12}}>今日屏幕时间</div>
            <div style={styles.totalTime}>{formatTime(totalToday)}</div>
          </div>

          {/* Bar chart */}
          {todayData?.apps && todayData.apps.length > 0 && (
            <div style={styles.chartCard}>
              {todayData.apps.slice(0, 10).map((app, i) => {
                const pct = totalToday > 0 ? (app.totalTimeMs / totalToday * 100) : 0
                return (
                  <div key={app.packageName} style={styles.barRow}>
                    <div style={styles.barLabel}>
                      <span style={{color: '#eee', fontSize: 13}}>{app.appName}</span>
                      <span style={{color: '#888', fontSize: 11}}>{formatTime(app.totalTimeMs)}</span>
                    </div>
                    <div style={styles.barTrack}>
                      <div style={{...styles.barFill, width: `${Math.max(pct, 2)}%`, background: COLORS[i % COLORS.length]}} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* App list */}
          <div style={styles.listCard}>
            {todayData?.apps?.map((app, i) => (
              <div key={app.packageName} style={styles.listItem}>
                <div style={{...styles.dot, background: COLORS[i % COLORS.length]}} />
                <div style={{flex: 1}}>
                  <div style={{color: '#eee', fontSize: 13}}>{app.appName}</div>
                  <div style={{color: '#666', fontSize: 10, marginTop: 2}}>{app.packageName}</div>
                </div>
                <div style={{color: '#ccc', fontSize: 13, fontFamily: 'monospace'}}>{formatTime(app.totalTimeMs)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'weekly' && (
        <div style={styles.scrollArea}>
          {/* Weekly total bar chart */}
          {weeklyData?.daily && weeklyData.daily.length > 0 && (
            <>
              <div style={styles.chartCard}>
                <div style={{color: '#999', fontSize: 12, marginBottom: 12}}>每日总时长</div>
                <div style={{display: 'flex', alignItems: 'flex-end', gap: 6, height: 120}}>
                  {(() => {
                    const maxMs = Math.max(...weeklyData.daily.map(d => d.totalMs), 1)
                    return weeklyData.daily.map((day, i) => (
                      <div key={day.date} style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end'}}>
                        <div style={{color: '#aaa', fontSize: 9, marginBottom: 4}}>{toHours(day.totalMs)}h</div>
                        <div style={{
                          width: '100%',
                          maxWidth: 32,
                          height: `${Math.max(day.totalMs / maxMs * 100, 4)}%`,
                          background: `linear-gradient(to top, ${COLORS[i % COLORS.length]}88, ${COLORS[i % COLORS.length]})`,
                          borderRadius: '4px 4px 0 0',
                          minHeight: 4
                        }} />
                        <div style={{color: '#888', fontSize: 9, marginTop: 4}}>{day.date.slice(5)}</div>
                      </div>
                    ))
                  })()}
                </div>
              </div>

              {/* Daily breakdown list */}
              {weeklyData.daily.slice().reverse().map(day => (
                <DayCard key={day.date} day={day} />
              ))}
            </>
          )}

          {(!weeklyData?.daily || weeklyData.daily.length === 0) && (
            <div style={styles.emptyCard}>
              <div style={{color: '#666'}}>暂无本周数据</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DayCard({ day }) {
  const [expanded, setExpanded] = useState(false)
  const apps = (day.apps || []).sort((a, b) => b.totalTimeMs - a.totalTimeMs)
  
  return (
    <div style={styles.dayCard} onClick={() => setExpanded(!expanded)}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span style={{color: '#ddd', fontSize: 13}}>{day.date}</span>
        <span style={{color: '#e8a0bf', fontSize: 13, fontFamily: 'monospace'}}>{formatTime(day.totalMs)}</span>
      </div>
      {expanded && apps.length > 0 && (
        <div style={{marginTop: 10}}>
          {apps.slice(0, 8).map((app, i) => (
            <div key={app.packageName} style={{display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.03)'}}>
              <span style={{color: '#aaa', fontSize: 12}}>{app.appName}</span>
              <span style={{color: '#888', fontSize: 12, fontFamily: 'monospace'}}>{formatTime(app.totalTimeMs)}</span>
            </div>
          ))}
        </div>
      )}
      {!expanded && apps.length > 0 && (
        <div style={{color: '#666', fontSize: 11, marginTop: 6}}>
          Top: {apps.slice(0, 3).map(a => a.appName).join('、')}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'transparent',
    color: '#eee',
  },
  tabs: {
    display: 'flex',
    gap: 0,
    padding: '0 12px',
    marginBottom: 8,
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    padding: '8px 0',
    background: 'rgba(255,255,255,0.05)',
    border: 'none',
    color: '#888',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.2s',
    borderBottom: '2px solid transparent',
  },
  tabActive: {
    color: '#e8a0bf',
    borderBottom: '2px solid #e8a0bf',
    background: 'rgba(232,160,191,0.08)',
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 12px 16px',
    WebkitOverflowScrolling: 'touch',
  },
  totalCard: {
    textAlign: 'center',
    padding: '20px 16px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    marginBottom: 12,
  },
  totalTime: {
    fontSize: 36,
    fontWeight: 700,
    color: '#e8a0bf',
    marginTop: 4,
    fontFamily: 'monospace',
  },
  chartCard: {
    padding: 16,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    marginBottom: 12,
  },
  barRow: {
    marginBottom: 10,
  },
  barLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  barTrack: {
    height: 8,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.6s ease',
  },
  listCard: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: '4px 12px',
    marginBottom: 12,
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  dayCard: {
    padding: 14,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    marginBottom: 8,
    cursor: 'pointer',
  },
  emptyCard: {
    textAlign: 'center',
    padding: '40px 20px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
  },
  permBtn: {
    padding: '10px 32px',
    background: 'linear-gradient(135deg, #e8a0bf, #a78bfa)',
    border: 'none',
    borderRadius: 20,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  loadingText: {
    textAlign: 'center',
    padding: 40,
    color: '#888',
  }
}
