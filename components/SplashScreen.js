// components/SplashScreen.js — 开屏动画：亚克力钥匙扣
// 一个金属钥匙圈挂两个小人：掉落 → 钟摆摆动（互相碰撞冒爱心）→ 反光扫过 → "our islet"
// 交互：点小人 = 拨动它；歪手机 = 重力感应偏摆；点空白处 = 跳过
import { useEffect, useRef, useState } from 'react'

const BASE_DURATION = 3600   // 无交互时的总时长（ms）
const EXIT_MS = 650          // 退场动画时长
const IDLE_AFTER_TOUCH = 1800 // 最后一次拨动后再停留多久才退场
const MAX_DURATION = 9000    // 无论怎么玩，最长停留时间

const K = 38        // 回复力系数（决定摆动周期，约 1s）
const C = 1.35      // 阻尼
const MIN_GAP = 18  // 两个挂件的最小夹角（度），小于即判定碰撞
const RESTITUTION = 0.55

const PIVOT_Y = 21  // 挂点在钥匙圈中心下方的距离（px）

// rest：静止时的外张角度（CSS rotate 正值 = 顺时针 = 底部往左）
const CHARMS = [
  { key: 'girl', src: '/splash/girl.webp', w: 134, h: 170, pivotX: -20, rest: 16, kick: -170, alt: '紫色洛丽塔女孩亚克力挂件' },
  { key: 'boy',  src: '/splash/boy.webp',  w: 118, h: 200, pivotX: 20,  rest: -16, kick: 140, alt: '黑色卫衣男孩亚克力挂件' },
]

export default function SplashScreen({ onFinish }) {
  const [phase, setPhase] = useState('drop') // drop -> hang -> exit
  const [showText, setShowText] = useState(false)
  const [hearts, setHearts] = useState([])

  const charmEls = useRef([])
  const sim = useRef(CHARMS.map(c => ({ theta: c.rest, omega: 0 })))
  const tilt = useRef({ target: 0, value: 0 })
  const finished = useRef(false)
  const exiting = useRef(false)
  const startTs = useRef(0)
  const lastTouch = useRef(0)
  const lastHeart = useRef(0)
  const heartId = useRef(0)
  const askedPermission = useRef(false)

  const finish = () => {
    if (finished.current) return
    finished.current = true
    onFinish && onFinish()
  }

  const startExit = () => {
    if (exiting.current) return
    exiting.current = true
    setPhase('exit')
    setTimeout(finish, EXIT_MS)
  }

  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    startTs.current = performance.now()
    const timers = []

    // 掉落：下一帧切到 hang 触发 CSS 弹簧过渡；落地瞬间给挂件一个向内的初速度
    timers.push(setTimeout(() => setPhase('hang'), reduced ? 0 : 30))
    if (!reduced) {
      timers.push(setTimeout(() => {
        sim.current.forEach((s, i) => { s.omega += CHARMS[i].kick })
      }, 480))
    }
    timers.push(setTimeout(() => setShowText(true), reduced ? 100 : 1000))

    // 重力感应：用重力在屏幕平面上的投影算真实的"下"方向。
    // 安卓竖握时 y≈+9.8；手机顺时针歪 φ 度 → x=-9.8·sinφ，atan2(x,y) = -φ，
    // 正好是挂件应偏的 CSS 角度（真实钥匙扣永远指向地面，所以相对屏幕反向偏）。
    // iOS 的符号与安卓相反，需要取反。
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const onMotion = (e) => {
      const g = e.accelerationIncludingGravity
      if (!g || typeof g.x !== 'number' || typeof g.y !== 'number') return
      const x = isIOS ? -g.x : g.x
      const y = isIOS ? -g.y : g.y
      const mag = Math.hypot(x, y)
      // 手机接近平放时屏幕内没有明确的"下"，逐渐减弱偏摆，避免乱抖
      if (mag < 3) { tilt.current.target = 0; return }
      const weight = Math.min(1, (mag - 3) / 4)
      const deg = Math.atan2(x, y) * 180 / Math.PI
      tilt.current.target = Math.max(-40, Math.min(40, deg * weight))
    }
    window.addEventListener('devicemotion', onMotion)

    let raf = 0
    let prev = performance.now()
    const loop = (now) => {
      const dt = Math.min(0.033, (now - prev) / 1000)
      prev = now
      const t = tilt.current
      t.value += (t.target - t.value) * Math.min(1, dt * 6)

      if (!reduced) {
        const s = sim.current
        s.forEach((st, i) => {
          const eq = CHARMS[i].rest + t.value
          const alpha = -K * (st.theta - eq) - C * st.omega
          st.omega += alpha * dt
          st.theta += st.omega * dt
        })
        // 碰撞：girl 在左、boy 在右，夹角过小则分开并交换部分速度
        const a = s[0], b = s[1]
        const gap = a.theta - b.theta
        if (gap < MIN_GAP) {
          const push = (MIN_GAP - gap) / 2
          a.theta += push; b.theta -= push
          const rel = a.omega - b.omega
          if (rel < 0) {
            const mid = (a.omega + b.omega) / 2
            const half = (a.omega - b.omega) / 2
            a.omega = mid - RESTITUTION * half
            b.omega = mid + RESTITUTION * half
            if (-rel > 60 && now - lastHeart.current > 350) {
              lastHeart.current = now
              const id = ++heartId.current
              setHearts(h => [...h, { id, dx: (Math.random() - 0.5) * 16 }])
              setTimeout(() => setHearts(h => h.filter(x => x.id !== id)), 1100)
            }
          }
        }
      }

      sim.current.forEach((st, i) => {
        const el = charmEls.current[i]
        if (el) el.style.transform = `rotate(${st.theta.toFixed(2)}deg)`
      })

      const elapsed = now - startTs.current
      const idle = now - lastTouch.current > IDLE_AFTER_TOUCH
      const base = reduced ? 1600 : BASE_DURATION
      if (!exiting.current && ((elapsed > base - EXIT_MS && idle) || elapsed > MAX_DURATION)) {
        startExit()
      }
      if (!finished.current) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      window.removeEventListener('devicemotion', onMotion)
    }
  }, [])

  // 点小人：点左半边往右拨，点右半边往左拨
  const flick = (i) => (e) => {
    e.stopPropagation()
    if (exiting.current) return
    lastTouch.current = performance.now()
    // iOS 需要在用户手势内申请陀螺仪权限；安卓不需要
    if (!askedPermission.current && typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      askedPermission.current = true
      DeviceMotionEvent.requestPermission().catch(() => {})
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const dir = e.clientX < rect.left + rect.width / 2 ? -1 : 1
    sim.current[i].omega += dir * 220
  }

  const hangerTransform =
    phase === 'drop' ? 'translateY(-70vh)' :
    phase === 'exit' ? 'translateY(-80vh)' : 'translateY(0)'
  const hangerTransition =
    phase === 'hang' ? 'transform 0.72s cubic-bezier(0.3, 1.45, 0.55, 1)' :
    phase === 'exit' ? `transform ${EXIT_MS}ms cubic-bezier(0.55, 0, 0.8, 0.3)` : 'none'

  return (
    <div
      className="ki-root"
      onClick={finish}
      role="button"
      aria-label="our islet 开屏动画，点击空白处跳过"
      style={{
        position: 'absolute', inset: 0, zIndex: 9999, overflow: 'hidden',
        background: 'linear-gradient(180deg, #FCFAFF 0%, #F1E9FB 55%, #E7DDF6 100%)',
        opacity: phase === 'exit' ? 0 : 1,
        transition: phase === 'exit' ? `opacity ${EXIT_MS}ms ease-in ${EXIT_MS * 0.25}ms` : 'none',
        pointerEvents: phase === 'exit' ? 'none' : 'auto',
        touchAction: 'manipulation',
        userSelect: 'none', WebkitUserSelect: 'none',
      }}
    >
      {/* 背景小星星 */}
      {[['12%', '18%', 0], ['80%', '26%', 0.8], ['20%', '72%', 1.5], ['86%', '64%', 0.4], ['62%', '10%', 1.1]].map(([l, t, d], i) => (
        <span key={i} aria-hidden="true" className="ki-star" style={{ left: l, top: t, animationDelay: d + 's' }}>✦</span>
      ))}

      {/* 挂件整体：链子 + 钥匙圈 + 两个小人 */}
      <div
        style={{
          position: 'absolute', left: '50%', top: '14%', width: 0, height: 0,
          transform: hangerTransform, transition: hangerTransition,
        }}
      >
        {/* 链子：从钥匙圈顶部一直延伸到屏幕外 */}
        <svg aria-hidden="true" width="10" height="700" style={{ position: 'absolute', left: -5, bottom: 24 }}>
          <defs>
            <linearGradient id="ki-chain-metal" x1="0" x2="1">
              <stop offset="0" stopColor="#9d97ad" /><stop offset=".5" stopColor="#f4f2f8" /><stop offset="1" stopColor="#8f89a0" />
            </linearGradient>
            <pattern id="ki-chain" width="10" height="16" patternUnits="userSpaceOnUse" y="0">
              <ellipse cx="5" cy="6" rx="2.7" ry="5.4" fill="none" stroke="url(#ki-chain-metal)" strokeWidth="1.6" />
              <rect x="4.2" y="10.5" width="1.6" height="6" rx=".8" fill="#b7b1c4" />
            </pattern>
          </defs>
          <rect width="10" height="700" fill="url(#ki-chain)" />
        </svg>

        {/* 金属钥匙圈 */}
        <svg aria-hidden="true" width="70" height="70" viewBox="-35 -35 70 70" style={{ position: 'absolute', left: -35, top: -35, zIndex: 3 }}>
          <defs>
            <linearGradient id="ki-ring-metal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fbfaff" /><stop offset=".35" stopColor="#b9b3c9" />
              <stop offset=".6" stopColor="#eeeaf5" /><stop offset="1" stopColor="#8d869f" />
            </linearGradient>
          </defs>
          <circle r="26" fill="none" stroke="rgba(90,70,130,.18)" strokeWidth="6" transform="translate(1,2)" />
          <circle r="26" fill="none" stroke="url(#ki-ring-metal)" strokeWidth="5" />
          <circle r="23.3" fill="none" stroke="#a49db6" strokeWidth=".9" opacity=".6" strokeDasharray="120 30" />
          <path d="M -20 -16 A 26 26 0 0 1 4 -25.7" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity=".85" />
        </svg>

        {/* 两个挂件 */}
        {CHARMS.map((c, i) => (
          <div
            key={c.key}
            ref={el => { charmEls.current[i] = el }}
            onClick={flick(i)}
            style={{
              position: 'absolute', left: c.pivotX - c.w / 2, top: PIVOT_Y,
              width: c.w, height: c.h + 8,
              transformOrigin: `${c.w / 2}px 0px`,
              transform: `rotate(${c.rest}deg)`,
              zIndex: i === 0 ? 2 : 1,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {/* 小扣环 */}
            <span aria-hidden="true" style={{
              position: 'absolute', left: c.w / 2 - 7, top: -7, width: 14, height: 14, borderRadius: '50%',
              border: '2.5px solid #c9c3d6', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.7), 0 1px 2px rgba(80,60,120,.25)',
              boxSizing: 'border-box', zIndex: 2,
            }} />
            <img
              src={c.src} alt={c.alt} width={c.w} height={c.h} draggable={false}
              style={{
                position: 'absolute', left: 0, top: 4, width: c.w, height: c.h,
                pointerEvents: 'none',
                filter: 'drop-shadow(0 6px 10px rgba(95,70,140,.22))',
              }}
            />
            {/* 亚克力反光：用图片本身做遮罩，只在挂件上扫过 */}
            <div aria-hidden="true" className="ki-shine" style={{
              position: 'absolute', left: 0, top: 4, width: c.w, height: c.h, pointerEvents: 'none',
              WebkitMaskImage: `url(${c.src})`, maskImage: `url(${c.src})`,
              WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
              animationDelay: (1.7 + i * 0.12) + 's',
            }} />
          </div>
        ))}

        {/* 碰撞时冒出的爱心 */}
        {hearts.map(h => (
          <span key={h.id} aria-hidden="true" className="ki-heart" style={{ left: h.dx - 9, top: PIVOT_Y + 88 }}>♥</span>
        ))}
      </div>

      {/* 文字 */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 'calc(14% + 300px)', textAlign: 'center',
        fontFamily: "'Georgia', 'Times New Roman', serif", fontStyle: 'italic',
        fontSize: 30, letterSpacing: 3, color: '#8E79C4',
        textShadow: '0 2px 12px rgba(160,130,210,.25)',
        opacity: showText ? 1 : 0,
        transform: showText ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity .8s ease, transform .8s ease',
        pointerEvents: 'none',
      }}>
        our islet
      </div>

      <style>{`
        .ki-star { position:absolute; color:#c9b6ec; font-size:12px; opacity:.35; animation: ki-twinkle 2.4s infinite ease-in-out; pointer-events:none; }
        @keyframes ki-twinkle { 0%,100% { opacity:.15; transform:scale(.8); } 50% { opacity:.6; transform:scale(1.15); } }
        .ki-shine {
          background: linear-gradient(105deg, transparent 38%, rgba(255,255,255,.8) 50%, transparent 62%);
          background-size: 300% 100%; background-position: 150% 0; background-repeat: no-repeat;
          animation: ki-shine 1s ease-in-out 1 both;
        }
        @keyframes ki-shine { from { background-position: 150% 0; } to { background-position: -50% 0; } }
        .ki-heart { position:absolute; width:18px; text-align:center; color:#D9A3E8; font-size:18px; pointer-events:none;
          animation: ki-heart 1.1s ease-out forwards; text-shadow: 0 1px 4px rgba(200,140,220,.5); }
        @keyframes ki-heart { 0% { opacity:0; transform:translateY(0) scale(.4); } 20% { opacity:1; transform:translateY(-6px) scale(1.15); } 100% { opacity:0; transform:translateY(-46px) scale(.9); } }
        @media (prefers-reduced-motion: reduce) { .ki-shine, .ki-star { animation: none; } }
      `}</style>
    </div>
  )
}
