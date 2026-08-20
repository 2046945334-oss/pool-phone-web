// components/SplashScreen.js — 开屏动画：粒子汇聚成水滴 → 落下涟漪 → 淡出
import { useEffect, useRef, useState } from 'react'

const PARTICLE_COUNT = 120
const DURATION = 3200 // 总动画时长 ms
const CONVERGE_END = 0.45 // 汇聚阶段结束（占比）
const DROP_END = 0.6 // 下落阶段结束
const RIPPLE_END = 0.85 // 涟漪阶段结束
const FADE_START = 0.8 // 整体淡出开始

// 水滴形状的参数方程（极坐标）
function dropletPoint(t, scale) {
  // t: 0~1 沿轮廓的位置
  const angle = t * Math.PI * 2
  // 心形变体 → 水滴
  const r = scale * (1 - Math.sin(angle)) * 0.5
  const x = r * Math.cos(angle)
  const y = -r * Math.sin(angle) + scale * 0.15
  return { x, y }
}

// 生成水滴轮廓上均匀分布的目标点
function generateTargets(count, cx, cy, scale) {
  const targets = []
  for (let i = 0; i < count; i++) {
    const t = i / count
    const { x, y } = dropletPoint(t, scale)
    targets.push({ x: cx + x, y: cy + y })
  }
  return targets
}

export default function SplashScreen({ onFinish }) {
  const canvasRef = useRef(null)
  const [opacity, setOpacity] = useState(1)
  const startTime = useRef(null)
  const particles = useRef([])
  const targets = useRef([])
  const animRef = useRef(null)
  const finished = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width = canvas.offsetWidth * 2
    const H = canvas.height = canvas.offsetHeight * 2
    ctx.scale(1, 1)

    const cx = W / 2
    const cy = H / 2 - 40
    const scale = Math.min(W, H) * 0.28

    // 初始化粒子（随机分散）
    targets.current = generateTargets(PARTICLE_COUNT, cx, cy, scale)
    particles.current = targets.current.map((tgt) => ({
      x: Math.random() * W,
      y: Math.random() * H,
      tx: tgt.x,
      ty: tgt.y,
      size: 1.5 + Math.random() * 2,
      alpha: 0.3 + Math.random() * 0.7,
      speed: 0.6 + Math.random() * 0.4,
    }))

    startTime.current = performance.now()

    function draw(now) {
      if (finished.current) return
      const elapsed = now - startTime.current
      const progress = Math.min(elapsed / DURATION, 1)

      ctx.clearRect(0, 0, W, H)

      // 主色
      const mainColor = [199, 125, 186] // #c77dba

      if (progress < CONVERGE_END) {
        // 阶段1：粒子汇聚
        const p = progress / CONVERGE_END // 0~1
        const ease = 1 - Math.pow(1 - p, 3) // easeOutCubic
        particles.current.forEach((pt) => {
          const curX = pt.x + (pt.tx - pt.x) * ease * pt.speed
          const curY = pt.y + (pt.ty - pt.y) * ease * pt.speed
          ctx.beginPath()
          ctx.arc(curX, curY, pt.size, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${mainColor.join(',')}, ${pt.alpha * (0.4 + ease * 0.6)})`
          ctx.fill()
        })
      } else if (progress < DROP_END) {
        // 阶段2：水滴已成形，微微发光然后下落
        const p = (progress - CONVERGE_END) / (DROP_END - CONVERGE_END)
        const dropY = p * p * 80 // 加速下落
        const glowAlpha = Math.max(0, 1 - p * 1.5)

        // 发光效果
        if (glowAlpha > 0) {
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.8)
          grad.addColorStop(0, `rgba(${mainColor.join(',')}, ${0.3 * glowAlpha})`)
          grad.addColorStop(1, `rgba(${mainColor.join(',')}, 0)`)
          ctx.fillStyle = grad
          ctx.fillRect(0, 0, W, H)
        }

        // 绘制汇聚完成的水滴（整体下移）
        const shrink = 1 - p * 0.3
        particles.current.forEach((pt) => {
          const curX = pt.tx + (pt.tx - cx) * (shrink - 1)
          const curY = pt.ty + (pt.ty - cy) * (shrink - 1) + dropY
          ctx.beginPath()
          ctx.arc(curX, curY, pt.size * (1 - p * 0.5), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${mainColor.join(',')}, ${pt.alpha * (1 - p * 0.7)})`
          ctx.fill()
        })
      } else if (progress < RIPPLE_END) {
        // 阶段3：涟漪扩散
        const p = (progress - DROP_END) / (RIPPLE_END - DROP_END)
        const rippleCy = cy + 80
        const maxRadius = scale * 1.8

        // 画 3 圈涟漪
        for (let i = 0; i < 3; i++) {
          const delay = i * 0.2
          const rp = Math.max(0, Math.min(1, (p - delay) / (1 - delay)))
          if (rp <= 0) continue
          const radius = rp * maxRadius * (0.5 + i * 0.3)
          const alpha = (1 - rp) * 0.6
          ctx.beginPath()
          ctx.arc(cx, rippleCy, radius, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(${mainColor.join(',')}, ${alpha})`
          ctx.lineWidth = 2 - rp * 1.5
          ctx.stroke()
        }

        // 中心小光点渐隐
        const dotAlpha = 1 - p
        if (dotAlpha > 0) {
          ctx.beginPath()
          ctx.arc(cx, rippleCy, 4 * (1 - p), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${mainColor.join(',')}, ${dotAlpha})`
          ctx.fill()
        }
      }

      // 整体淡出
      if (progress >= FADE_START) {
        const fadeP = (progress - FADE_START) / (1 - FADE_START)
        setOpacity(1 - fadeP)
      }

      if (progress >= 1) {
        finished.current = true
        onFinish && onFinish()
        return
      }

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)
    return () => { finished.current = true; cancelAnimationFrame(animRef.current) }
  }, [])

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 9999,
      background: '#0a0a0a', opacity,
      transition: 'opacity 0.3s ease',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: opacity > 0 ? 'auto' : 'none',
    }} onClick={() => { finished.current = true; onFinish && onFinish() }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
      />
      <div style={{
        position: 'absolute', bottom: '18%', width: '100%', textAlign: 'center',
        color: 'rgba(199,125,186,0.7)', fontSize: '13px', fontWeight: 300,
        letterSpacing: '4px', opacity: Math.min(1, opacity * 2),
      }}>
        池的小手机
      </div>
    </div>
  )
}
