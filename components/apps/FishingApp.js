import { useState, useEffect, useRef, useCallback } from 'react'

const SPOTS=[
  {id:"dongchong",name:"东涌沙滩",icon:"🏖️",desc:"浅海沙滩，新手友好",unlock:0},
  {id:"yangmeikeng",name:"杨梅坑",icon:"🪸",desc:"礁石多，稀有鱼出没",unlock:200},
  {id:"reservoir",name:"梧桐山水库",icon:"🏔️",desc:"淡水深潭，大鱼藏身",unlock:500},
  {id:"harbor",name:"蛇口渔港",icon:"⚓",desc:"深水港口，传说级出没",unlock:1000}
]
const FISH_DB=[
  {name:"沙丁鱼",emoji:"🐟",rarity:"common",minW:0.1,maxW:0.5,pts:10,sell:5,spots:["dongchong"],quote:"最普通但最勤快的小鱼"},
  {name:"海星",emoji:"⭐",rarity:"common",minW:0.05,maxW:0.3,pts:8,sell:4,spots:["dongchong"],quote:"不是鱼但你钓到了"},
  {name:"鲫鱼",emoji:"🐟",rarity:"common",minW:0.2,maxW:1.0,pts:10,sell:6,spots:["reservoir"],quote:"煲汤一流选手"},
  {name:"草鱼",emoji:"🐟",rarity:"common",minW:0.5,maxW:3.0,pts:15,sell:8,spots:["reservoir"],quote:"吃素的大块头"},
  {name:"章鱼",emoji:"🐙",rarity:"uncommon",minW:0.5,maxW:3.0,pts:25,sell:15,spots:["dongchong","yangmeikeng"],quote:"八只手都在忙"},
  {name:"小丑鱼",emoji:"🐠",rarity:"uncommon",minW:0.05,maxW:0.2,pts:20,sell:12,spots:["yangmeikeng"],quote:"Nemo 你怎么在深圳"},
  {name:"水母",emoji:"🪼",rarity:"uncommon",minW:0.1,maxW:0.8,pts:15,sell:8,spots:["dongchong","yangmeikeng"],quote:"透明但存在感很强"},
  {name:"鲈鱼",emoji:"🐠",rarity:"uncommon",minW:0.5,maxW:2.5,pts:20,sell:12,spots:["dongchong","harbor"],quote:"清蒸最佳"},
  {name:"海鳗",emoji:"🐍",rarity:"uncommon",minW:0.3,maxW:2.0,pts:22,sell:14,spots:["yangmeikeng","harbor"],quote:"别被它咬到"},
  {name:"河豚",emoji:"🐡",rarity:"rare",minW:0.3,maxW:1.5,pts:40,sell:25,spots:["yangmeikeng"],quote:"鼓起来了 别碰"},
  {name:"金枪鱼",emoji:"🐟",rarity:"rare",minW:2.0,maxW:10.0,pts:50,sell:35,spots:["harbor"],quote:"三文鱼的贵族亲戚"},
  {name:"海龟",emoji:"🐢",rarity:"epic",minW:5.0,maxW:20.0,pts:80,sell:0,spots:["yangmeikeng","dongchong"],quote:"放生吧 它活得比你久"},
  {name:"鲨鱼",emoji:"🦈",rarity:"epic",minW:10.0,maxW:50.0,pts:100,sell:60,spots:["harbor"],quote:"你确定要收杆？"},
  {name:"鲸鱼",emoji:"🐋",rarity:"legendary",minW:100,maxW:500,pts:200,sell:0,spots:["harbor"],quote:"深圳湾的传说 不卖"},
  {name:"月光水母",emoji:"🌙",rarity:"legendary",minW:0.01,maxW:0.05,pts:150,sell:0,spots:["yangmeikeng"],quote:"只在满月夜出现"},
  {name:"旧靴子",emoji:"👢",rarity:"junk",minW:0.5,maxW:1.0,pts:1,sell:0,spots:["dongchong","yangmeikeng","reservoir","harbor"],quote:"又是你"},
  {name:"海藻团",emoji:"🌿",rarity:"junk",minW:0.1,maxW:0.5,pts:1,sell:0,spots:["dongchong","yangmeikeng","reservoir","harbor"],quote:"大海的头发"},
  {name:"塑料袋",emoji:"🛍️",rarity:"junk",minW:0.01,maxW:0.1,pts:2,sell:0,spots:["dongchong","harbor"],quote:"深圳人 请减少垃圾"}
]
const RARITY_W={common:35,uncommon:25,rare:12,epic:4,legendary:1,junk:12}
const RARITY_C={common:"#78909c",uncommon:"#43a047",rare:"#1e88e5",epic:"#8e24aa",legendary:"#ff6f00",junk:"#9e9e9e"}
const RARITY_L={common:"普通",uncommon:"优良",rare:"稀有",epic:"史诗",legendary:"传说",junk:"垃圾"}
const BAITS=[
  {id:"basic",name:"基础鱼饵",desc:"什么都能钓 看运气",price:0,bonus:{}},
  {id:"shrimp",name:"鲜虾饵",desc:"稀有+15%概率",price:30,bonus:{rare:1.5,epic:1.3}},
  {id:"glow",name:"夜光饵",desc:"史诗+25% 传说+50%",price:80,bonus:{epic:1.5,legendary:2.0}},
  {id:"gold",name:"黄金饵",desc:"全稀有度翻倍 一次性",price:150,bonus:{uncommon:2,rare:2,epic:2,legendary:2}}
]
const RECIPES=[
  {id:"sashimi",name:"刺身",icon:"🍣",mult:2.5,cost:10,desc:"生切 卖价×2.5",canUse:["uncommon","rare","epic"]},
  {id:"grill",name:"烧烤",icon:"🍖",mult:1.8,cost:5,desc:"碳烤 卖价×1.8",canUse:["common","uncommon","rare"]},
  {id:"steam",name:"清蒸",icon:"🥘",mult:2.0,cost:8,desc:"清蒸 卖价×2.0",canUse:["common","uncommon","rare","epic"]},
  {id:"soup",name:"煲汤",icon:"🍲",mult:2.2,cost:12,desc:"慢炖 卖价×2.2",canUse:["common","uncommon","rare","epic","legendary"]}
]

function loadData() {
  try { const s = localStorage.getItem("pool_fishing_v2"); if (s) return JSON.parse(s) } catch {}
  return { score:0, poolScore:0, catchCount:0, catches:[], dex:[], spot:"dongchong", bait:"basic", baitCount:{basic:99,shrimp:0,glow:0,gold:0} }
}
function saveData(gd) { localStorage.setItem("pool_fishing_v2", JSON.stringify(gd)) }

export default function FishingApp() {
  const [gd, setGd] = useState(loadData)
  const [tab, setTab] = useState(0)
  const [bagOwner, setBagOwner] = useState('user')
  const [fishing, setFishing] = useState(false)
  const [tensionActive, setTensionActive] = useState(false)
  const [needlePos, setNeedlePos] = useState(0)
  const [zone, setZone] = useState({ l: 0, r: 0 })
  const [popup, setPopup] = useState(null)
  const [cookIdx, setCookIdx] = useState(-1)
  const needleRef = useRef(0)
  const dirRef = useRef(1)
  const timerRef = useRef(null)

  useEffect(() => { saveData(gd) }, [gd])

  function pickFish() {
    const spotFish = FISH_DB.filter(f => f.spots.includes(gd.spot))
    const baitObj = BAITS.find(b => b.id === gd.bait) || BAITS[0]
    const pool = []
    spotFish.forEach(f => {
      let w = RARITY_W[f.rarity] || 10
      if (baitObj.bonus[f.rarity]) w = Math.round(w * baitObj.bonus[f.rarity])
      for (let i = 0; i < w; i++) pool.push(f)
    })
    const tmpl = pool[Math.floor(Math.random() * pool.length)]
    const weight = tmpl.minW + Math.random() * (tmpl.maxW - tmpl.minW)
    return { name: tmpl.name, emoji: tmpl.emoji, weight, rarity: tmpl.rarity, pts: tmpl.pts, sell: tmpl.sell || 0, spot: gd.spot, quote: tmpl.quote || "..." }
  }

  function startFish() {
    if (fishing || tensionActive) return
    setFishing(true)
    setTimeout(() => {
      const zoneW = 25 + Math.random() * 20
      const zoneL = 10 + Math.random() * (65 - zoneW)
      setZone({ l: zoneL, r: zoneL + zoneW })
      setTensionActive(true)
      setFishing(false)
      needleRef.current = 0
      dirRef.current = 1
      timerRef.current = setInterval(() => {
        needleRef.current += dirRef.current * 2.5
        if (needleRef.current >= 100 || needleRef.current <= 0) dirRef.current *= -1
        setNeedlePos(needleRef.current)
      }, 30)
    }, 1500 + Math.random() * 2500)
  }

  function catchAttempt() {
    clearInterval(timerRef.current)
    setTensionActive(false)
    const hit = needleRef.current >= zone.l && needleRef.current <= zone.r
    if (!hit) return
    const fish = pickFish()
    fish.owner = 'user'
    setGd(prev => {
      const next = { ...prev, score: prev.score + fish.pts, catchCount: prev.catchCount + 1, catches: [...prev.catches, { name: fish.name, emoji: fish.emoji, weight: fish.weight, rarity: fish.rarity, spot: fish.spot, time: Date.now(), owner: 'user' }], dex: fish.rarity !== 'junk' && !prev.dex.includes(fish.name) ? [...prev.dex, fish.name] : prev.dex }
      if (prev.bait !== 'basic') { next.baitCount = { ...prev.baitCount, [prev.bait]: (prev.baitCount[prev.bait] || 1) - 1 }; if (next.baitCount[prev.bait] <= 0) next.bait = 'basic' }
      return next
    })
    setPopup(fish)
  }

  function sellFromPopup() {
    if (!popup || popup.sell <= 0) { setPopup(null); return }
    setGd(prev => ({ ...prev, score: prev.score + popup.sell, catches: prev.catches.slice(0, -1) }))
    setPopup(null)
  }

  function bagSell(idx) {
    const c = gd.catches[idx]; if (!c) return
    const fishDef = FISH_DB.find(f => f.name === c.name) || {}
    let sellPrice = fishDef.sell || 0
    if (c.processed) { const r = RECIPES.find(rr => rr.id === c.processed); if (r) sellPrice = Math.round(sellPrice * r.mult) }
    if (sellPrice <= 0) return
    setGd(prev => {
      const next = { ...prev, catches: prev.catches.filter((_, i) => i !== idx) }
      if ((c.owner || 'pool') === 'pool') next.poolScore = (prev.poolScore || 0) + sellPrice
      else next.score = prev.score + sellPrice
      return next
    })
  }

  function bagRelease(idx) {
    const c = gd.catches[idx]; if (!c) return
    setGd(prev => {
      const next = { ...prev, catches: prev.catches.filter((_, i) => i !== idx) }
      if ((c.owner || 'pool') === 'pool') next.poolScore = (prev.poolScore || 0) + 20
      else next.score = prev.score + 20
      return next
    })
  }

  function doCook(recipeId) {
    if (cookIdx < 0) return
    const recipe = RECIPES.find(r => r.id === recipeId)
    if (!recipe || gd.score < recipe.cost) { setCookIdx(-1); return }
    setGd(prev => {
      const catches = [...prev.catches]
      catches[cookIdx] = { ...catches[cookIdx], processed: recipe.id }
      return { ...prev, catches, score: prev.score - recipe.cost }
    })
    setCookIdx(-1)
  }

  function buyBait(id, price) {
    if (gd.score < price) return
    setGd(prev => ({ ...prev, score: prev.score - price, baitCount: { ...prev.baitCount, [id]: (prev.baitCount[id] || 0) + 1 } }))
  }

  const sp = SPOTS.find(s => s.id === gd.spot)
  const bagFiltered = gd.catches.filter(c => (c.owner || 'pool') === bagOwner).slice(-8).reverse()

  const s = { bg: { fontFamily: '-apple-system, sans-serif', background: 'linear-gradient(180deg,#e3f2fd 0%,#bbdefb 40%,#64b5f6 100%)', minHeight: '100%', color: '#1a237e', overflowX: 'hidden', overflowY: 'auto' } }

  return (
    <div style={s.bg}>
      <div style={{ textAlign: 'center', padding: '20px 16px 8px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#1565c0' }}>🎣 池的钓鱼场</h1>
        <div style={{ fontSize: '12px', color: '#42a5f5', marginTop: '2px' }}>深圳 · {sp ? sp.name : '东涌沙滩'}</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', margin: '8px 16px', background: 'rgba(255,255,255,0.5)', borderRadius: '12px', overflow: 'hidden' }}>
        {['钓鱼', '图鉴', '商店', '钓点'].map((t, i) => (
          <div key={i} onClick={() => setTab(i)} style={{ flex: 1, textAlign: 'center', padding: '8px 0', fontSize: '13px', color: tab === i ? '#fff' : '#64b5f6', cursor: 'pointer', background: tab === i ? '#1565c0' : 'transparent', fontWeight: tab === i ? 600 : 400 }}>{t}</div>
        ))}
      </div>

      {/* 钓鱼页 */}
      {tab === 0 && <>
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '10px 16px', background: 'rgba(255,255,255,0.7)', borderRadius: '14px', margin: '8px 16px' }}>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: '20px', fontWeight: 700, color: '#1565c0' }}>{gd.score || 0}</div><div style={{ fontSize: '10px', color: '#64b5f6' }}>你的积分</div></div>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: '20px', fontWeight: 700, color: '#1565c0' }}>{gd.poolScore || 0}</div><div style={{ fontSize: '10px', color: '#64b5f6' }}>池的积分</div></div>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: '20px', fontWeight: 700, color: '#1565c0' }}>{gd.catchCount || 0}</div><div style={{ fontSize: '10px', color: '#64b5f6' }}>捕获</div></div>
          <div style={{ textAlign: 'center' }}><div style={{ fontSize: '20px', fontWeight: 700, color: '#1565c0' }}>{(gd.dex || []).length}/{FISH_DB.filter(f => f.rarity !== 'junk').length}</div><div style={{ fontSize: '10px', color: '#64b5f6' }}>图鉴</div></div>
        </div>

        {/* 池塘 */}
        <div onClick={tensionActive ? catchAttempt : startFish} style={{ position: 'relative', height: '160px', margin: '12px 16px', borderRadius: '20px', background: 'linear-gradient(180deg,#42a5f6 0%,#1565c0 100%)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', userSelect: 'none' }}>
          <div style={{ fontSize: '42px', position: 'relative', zIndex: 2 }}>🎣</div>
          <div style={{ position: 'absolute', bottom: '14px', fontSize: '12px', color: 'rgba(255,255,255,0.8)', zIndex: 2 }}>
            {fishing ? '等待咬钩...' : tensionActive ? '点击收杆!' : '点击抛竿'}
          </div>
          {tensionActive && (
            <div style={{ position: 'absolute', bottom: '50px', left: '50%', transform: 'translateX(-50%)', width: '200px', height: '24px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', zIndex: 10, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', height: '100%', background: 'rgba(76,175,80,0.6)', borderRadius: '12px', left: zone.l + '%', width: (zone.r - zone.l) + '%' }} />
              <div style={{ position: 'absolute', top: 0, width: '4px', height: '100%', background: '#fff', borderRadius: '2px', left: needlePos + '%' }} />
            </div>
          )}
        </div>

        {/* 鱼篓 */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h2 style={{ fontSize: '14px', color: '#1565c0', margin: 0 }}>🪣 鱼篓</h2>
            <div style={{ display: 'flex', background: 'rgba(21,101,192,0.1)', borderRadius: '8px', overflow: 'hidden' }}>
              {['pool', 'user'].map(who => (
                <div key={who} onClick={() => setBagOwner(who)} style={{ padding: '4px 12px', fontSize: '11px', cursor: 'pointer', color: bagOwner === who ? '#1565c0' : '#64b5f6', fontWeight: bagOwner === who ? 600 : 400, background: bagOwner === who ? 'rgba(21,101,192,0.15)' : 'transparent', borderRadius: '8px' }}>{who === 'pool' ? '池的' : '你的'}</div>
              ))}
            </div>
          </div>
          {bagFiltered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#90a4ae', fontSize: '13px' }}>{bagOwner === 'pool' ? '池还没钓到鱼~' : '你还没钓到鱼~'}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
              {bagFiltered.map((c, i) => {
                const realIdx = gd.catches.indexOf(c)
                const fishDef = FISH_DB.find(f => f.name === c.name) || {}
                let sellPrice = fishDef.sell || 0
                if (c.processed) { const r = RECIPES.find(rr => rr.id === c.processed); if (r) sellPrice = Math.round(sellPrice * r.mult) }
                const tag = c.processed ? (RECIPES.find(r => r.id === c.processed) || {}).icon || '' : ''
                return (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.8)', borderRadius: '10px', padding: '10px', textAlign: 'center', border: '1px solid rgba(21,101,192,0.1)' }}>
                    <div style={{ fontSize: '24px' }}>{c.emoji}{tag ? ' ' + tag : ''}</div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: RARITY_C[c.rarity], marginTop: '2px' }}>{c.name}</div>
                    <div style={{ fontSize: '10px', color: '#78909c', marginTop: '1px' }}>{c.weight.toFixed(2)}kg · {RARITY_L[c.rarity]}</div>
                    {sellPrice > 0 && !c.processed && <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}><button onClick={() => bagSell(realIdx)} style={{ flex: 1, border: 'none', borderRadius: '6px', background: '#43a047', color: '#fff', fontSize: '10px', padding: '3px 0', cursor: 'pointer' }}>卖 {sellPrice}分</button><button onClick={() => setCookIdx(realIdx)} style={{ flex: 1, border: 'none', borderRadius: '6px', background: '#ff8f00', color: '#fff', fontSize: '10px', padding: '3px 0', cursor: 'pointer' }}>加工</button></div>}
                    {sellPrice > 0 && c.processed && <button onClick={() => bagSell(realIdx)} style={{ width: '100%', border: 'none', borderRadius: '6px', background: '#43a047', color: '#fff', fontSize: '10px', padding: '3px 0', cursor: 'pointer', marginTop: '4px' }}>卖 {sellPrice}分</button>}
                    {sellPrice <= 0 && !c.processed && c.rarity !== 'junk' && <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}><button onClick={() => setCookIdx(realIdx)} style={{ flex: 1, border: 'none', borderRadius: '6px', background: '#ff8f00', color: '#fff', fontSize: '10px', padding: '3px 0', cursor: 'pointer' }}>加工</button><button onClick={() => bagRelease(realIdx)} style={{ flex: 1, border: 'none', borderRadius: '6px', background: '#26c6da', color: '#fff', fontSize: '10px', padding: '3px 0', cursor: 'pointer' }}>放生 +20</button></div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </>}

      {/* 图鉴 */}
      {tab === 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', padding: '12px 16px' }}>
          {FISH_DB.filter(f => f.rarity !== 'junk').map((f, i) => {
            const unlocked = (gd.dex || []).includes(f.name)
            return (
              <div key={i} style={{ background: 'rgba(255,255,255,0.8)', borderRadius: '10px', padding: '10px 4px', textAlign: 'center', border: '1px solid rgba(21,101,192,0.1)', opacity: unlocked ? 1 : 0.4 }}>
                <div style={{ fontSize: '24px' }}>{unlocked ? f.emoji : '❓'}</div>
                <div style={{ fontSize: '10px', marginTop: '2px', color: '#1565c0' }}>{unlocked ? f.name : '???'}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* 商店 */}
      {tab === 2 && (
        <div style={{ padding: '8px 16px' }}>
          {BAITS.filter(b => b.price > 0).map(b => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.8)', borderRadius: '12px', padding: '10px 12px', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1565c0' }}>{b.name} <span style={{ fontSize: '11px', color: '#78909c' }}>(x{gd.baitCount[b.id] || 0})</span></div>
                <div style={{ fontSize: '11px', color: '#78909c' }}>{b.desc}</div>
              </div>
              <button onClick={() => buyBait(b.id, b.price)} style={{ padding: '6px 14px', border: 'none', borderRadius: '8px', background: '#ff8f00', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>{b.price}分</button>
            </div>
          ))}
          <div style={{ padding: '10px', textAlign: 'center', fontSize: '12px', color: '#78909c' }}>当前: {(BAITS.find(b => b.id === gd.bait) || BAITS[0]).name}</div>
          {BAITS.filter(b => (gd.baitCount[b.id] || 0) > 0 || b.id === 'basic').map(b => (
            <div key={b.id} style={{ textAlign: 'center', marginBottom: '6px' }}>
              <button onClick={() => setGd(prev => ({ ...prev, bait: b.id }))} style={{ padding: '4px 16px', border: 'none', borderRadius: '6px', background: gd.bait === b.id ? '#1565c0' : '#ccc', color: '#fff', fontSize: '11px', cursor: 'pointer' }}>装备 {b.name}</button>
            </div>
          ))}
        </div>
      )}

      {/* 钓点 */}
      {tab === 3 && (
        <div style={{ padding: '8px 16px' }}>
          {SPOTS.map(spot => {
            const canUse = (gd.score + (gd.poolScore || 0)) >= spot.unlock || gd.spot === spot.id
            return (
              <div key={spot.id} onClick={() => canUse && setGd(prev => ({ ...prev, spot: spot.id }))} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.85)', borderRadius: '12px', padding: '10px 12px', marginBottom: '8px', cursor: canUse ? 'pointer' : 'default', border: gd.spot === spot.id ? '2px solid #1565c0' : '2px solid transparent' }}>
                <div style={{ fontSize: '28px' }}>{spot.icon}</div>
                <div><div style={{ fontSize: '13px', fontWeight: 600, color: '#1565c0' }}>{spot.name}{!canUse && ` 🔒${spot.unlock}分`}</div><div style={{ fontSize: '11px', color: '#78909c' }}>{spot.desc}</div></div>
              </div>
            )
          })}
        </div>
      )}

      {/* 钓到弹窗 */}
      {popup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 99, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPopup(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px', padding: '28px 20px', textAlign: 'center', maxWidth: '280px', width: '85%' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>{popup.emoji}</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: RARITY_C[popup.rarity] }}>{popup.name}</div>
            <div style={{ fontSize: '12px', color: '#78909c', marginTop: '6px' }}>{popup.weight.toFixed(2)}kg · {RARITY_L[popup.rarity]} · +{popup.pts}分</div>
            <div style={{ fontSize: '11px', color: '#ab47bc', marginTop: '8px', fontStyle: 'italic' }}>"{popup.quote}"</div>
            <div style={{ marginTop: '14px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button onClick={() => setPopup(null)} style={{ padding: '8px 28px', border: 'none', borderRadius: '10px', background: '#1565c0', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>收入鱼篓</button>
              {popup.sell > 0 && <button onClick={sellFromPopup} style={{ padding: '8px 28px', border: 'none', borderRadius: '10px', background: '#43a047', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>卖掉</button>}
            </div>
          </div>
        </div>
      )}

      {/* 加工弹窗 */}
      {cookIdx >= 0 && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 99, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCookIdx(-1)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px', padding: '20px', textAlign: 'center', maxWidth: '280px', width: '85%' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#1565c0', marginBottom: '12px' }}>选择加工方式</div>
            {RECIPES.filter(r => r.canUse.includes(gd.catches[cookIdx]?.rarity)).map(r => (
              <div key={r.id} onClick={() => doCook(r.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', marginBottom: '6px', background: '#f5f5f5', borderRadius: '10px', cursor: 'pointer' }}>
                <span style={{ fontSize: '20px' }}>{r.icon}</span>
                <div style={{ flex: 1, textAlign: 'left' }}><div style={{ fontSize: '12px', fontWeight: 600, color: '#1565c0' }}>{r.name}</div><div style={{ fontSize: '10px', color: '#78909c' }}>{r.desc}</div></div>
                <span style={{ fontSize: '11px', color: '#ff8f00', fontWeight: 600 }}>{r.cost}分</span>
              </div>
            ))}
            <button onClick={() => setCookIdx(-1)} style={{ marginTop: '10px', padding: '6px 20px', border: 'none', borderRadius: '8px', background: '#ccc', color: '#333', fontSize: '12px', cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      )}
    </div>
  )
}