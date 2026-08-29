// components/SplashScreen.js — 开屏动画：浅色系 + 壳蟹蟹随机动画爬出来说"欢迎回家"
import { useEffect, useState, useRef } from 'react'

// 5 个壳蟹蟹 SVG 动画（内嵌，避免加载问题）
const CLAWD_SVGS = [
  // 1. 听歌 - 戴耳机摇摆
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
    <defs><style>
      .lm-body{transform-origin:7.5px 13px;animation:lm-groove 1.1s infinite ease-in-out;}
      .lm-eye{transform-origin:7.5px 9px;animation:lm-blink 3s infinite;}
      .lm-al{transform-origin:2px 10px;animation:lm-tap-l .55s infinite alternate ease-in-out;}
      .lm-ar{transform-origin:13px 10px;animation:lm-tap-r .55s infinite alternate ease-in-out;}
      .lm-note{opacity:0;animation:lm-note var(--d,2s) var(--delay,0s) infinite ease-out;}
      @keyframes lm-groove{0%,100%{transform:rotate(-3deg) translateY(0);}50%{transform:rotate(3deg) translateY(-1px);}}
      @keyframes lm-blink{0%,46%,54%,100%{transform:scaleY(1);}50%{transform:scaleY(.1);}}
      @keyframes lm-tap-l{0%{transform:rotate(0);}100%{transform:rotate(22deg);}}
      @keyframes lm-tap-r{0%{transform:rotate(0);}100%{transform:rotate(-22deg);}}
      @keyframes lm-note{0%{opacity:0;transform:translate(0,0) rotate(0);}15%{opacity:1;}80%{opacity:.85;}100%{opacity:0;transform:translate(var(--tx,4px),-19px) rotate(var(--r,20deg));}}
    </style></defs>
    <g>
      <g class="lm-note" style="--delay:0s;--d:1.9s;--tx:6px;--r:25deg" transform="translate(13,-2)" fill="#a98cff"><ellipse cx="0" cy="2" rx="1.1" ry=".85"/><rect x="1" y="-2" width=".7" height="4"/><rect x="1" y="-2" width="2.2" height=".8"/></g>
      <g class="lm-note" style="--delay:-.7s;--d:2.2s;--tx:-5px;--r:-20deg" transform="translate(-2,-1)" fill="#c0a6ff"><ellipse cx="0" cy="1.6" rx=".9" ry=".7"/><rect x=".8" y="-1.6" width=".6" height="3.4"/></g>
      <g class="lm-note" style="--delay:-1.3s;--d:2s;--tx:4px;--r:15deg" transform="translate(9,-3)" fill="#8c6cff"><ellipse cx="0" cy="1.6" rx="1" ry=".75"/><rect x=".9" y="-1.8" width=".6" height="3.6"/><rect x=".9" y="-1.8" width="1.8" height=".7"/></g>
    </g>
    <g class="lm-body">
      <g fill="#DE886D">
        <rect x="3" y="13" width="1" height="2"/><rect x="5" y="13" width="1" height="2"/>
        <rect x="9" y="13" width="1" height="2"/><rect x="11" y="13" width="1" height="2"/>
      </g>
      <rect x="2" y="6" width="11" height="7" fill="#DE886D"/>
      <g class="lm-al"><rect x="0" y="9" width="2" height="2" fill="#DE886D"/></g>
      <g class="lm-ar"><rect x="13" y="9" width="2" height="2" fill="#DE886D"/></g>
      <path d="M1 6 Q7.5 -.5 14 6" stroke="#2b2b35" stroke-width="1.5" fill="none"/>
      <rect x="-.4" y="6.2" width="2.6" height="3.6" rx=".9" fill="#33333f"/>
      <rect x="12.8" y="6.2" width="2.6" height="3.6" rx=".9" fill="#33333f"/>
      <rect x=".1" y="6.8" width="1.6" height="2.4" rx=".6" fill="#6a5ad0"/>
      <rect x="13.3" y="6.8" width="1.6" height="2.4" rx=".6" fill="#6a5ad0"/>
      <g class="lm-eye" fill="#000"><rect x="4" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/></g>
    </g>
  </svg>`,

  // 2. 看书 - 捧书摇头
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
    <defs><style>
      .rd-body{transform-origin:7.5px 13px;animation:rd-bob 4.2s infinite ease-in-out;}
      .rd-eye{transform-origin:7.5px 9px;animation:rd-scan 4.2s infinite ease-in-out;}
      .rd-page{transform-origin:7.5px 11px;animation:rd-flip 4.2s infinite ease-in-out;}
      @keyframes rd-bob{0%,100%{transform:translateY(0);}50%{transform:translateY(-.5px);}}
      @keyframes rd-scan{0%,8%{transform:translateX(-.9px) scaleY(1);}12%{transform:translateX(-.9px) scaleY(.15);}16%,42%{transform:translateX(-.9px) scaleY(1);}50%,90%{transform:translateX(.9px) scaleY(1);}100%{transform:translateX(-.9px) scaleY(1);}}
      @keyframes rd-flip{0%,72%,100%{transform:scaleX(1);}80%{transform:scaleX(.08);}88%{transform:scaleX(1);}}
    </style></defs>
    <g class="rd-body">
      <g fill="#DE886D">
        <rect x="3" y="13" width="1" height="2"/><rect x="5" y="13" width="1" height="2"/>
        <rect x="9" y="13" width="1" height="2"/><rect x="11" y="13" width="1" height="2"/>
      </g>
      <rect x="2" y="6" width="11" height="7" fill="#DE886D"/>
      <g class="rd-eye" fill="#000"><rect x="4" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/></g>
      <rect x="-.3" y="9.6" width="2.6" height="2" fill="#DE886D" rx=".4" transform="rotate(28,1,10.6)"/>
      <rect x="12.7" y="9.6" width="2.6" height="2" fill="#DE886D" rx=".4" transform="rotate(-28,14,10.6)"/>
      <g>
        <polygon points="1.6,12.4 2.8,9.4 7.5,9.9 7.5,12.6" fill="#8a5a2a"/>
        <polygon points="13.4,12.4 12.2,9.4 7.5,9.9 7.5,12.6" fill="#7a4e22"/>
        <polygon points="2.2,12.1 3.2,9.7 7.5,10.1 7.5,12.2" fill="#F5E6C8"/>
        <g class="rd-page"><polygon points="12.8,12.1 11.8,9.7 7.5,10.1 7.5,12.2" fill="#FBF1D8"/></g>
        <g stroke="#c9b48a" stroke-width=".25">
          <line x1="3.4" y1="10.6" x2="6.9" y2="10.9"/>
          <line x1="3.3" y1="11.3" x2="6.9" y2="11.5"/>
          <line x1="8.1" y1="10.9" x2="11.6" y2="10.6"/>
          <line x1="8.1" y1="11.5" x2="11.7" y2="11.3"/>
        </g>
        <rect x="7.2" y="9.7" width=".6" height="2.9" fill="#5e3c1a"/>
      </g>
    </g>
  </svg>`,

  // 3. 打游戏 - 拿手柄晃动
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
    <defs><style>
      .gm-body{transform-origin:7.5px 13px;animation:gm-lean 2.4s infinite ease-in-out;}
      .gm-eye{transform-origin:7.5px 9px;animation:gm-blink 2.8s infinite;}
      .gm-ba{transform-origin:center;animation:gm-press .36s infinite alternate ease-in-out;}
      .gm-bb{transform-origin:center;animation:gm-press .36s -.18s infinite alternate ease-in-out;}
      @keyframes gm-lean{0%,58%,100%{transform:translateY(0) rotate(0);}74%{transform:translateY(-2px) rotate(-2deg);}84%{transform:translateY(0) rotate(0);}}
      @keyframes gm-blink{0%,45%,55%,100%{transform:scaleY(.82);}50%{transform:scaleY(.1);}}
      @keyframes gm-press{0%{transform:translateY(-.3px);}100%{transform:translateY(.5px);}}
    </style></defs>
    <g class="gm-body">
      <g fill="#DE886D">
        <rect x="3" y="13" width="1" height="2"/><rect x="5" y="13" width="1" height="2"/>
        <rect x="9" y="13" width="1" height="2"/><rect x="11" y="13" width="1" height="2"/>
      </g>
      <rect x="2" y="6" width="11" height="7" fill="#DE886D"/>
      <rect x="0" y="9" width="2" height="2" fill="#DE886D" transform="rotate(46,1,10)"/>
      <rect x="13" y="9" width="2" height="2" fill="#DE886D" transform="rotate(-46,14,10)"/>
      <g class="gm-eye" fill="#000"><rect x="4" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/></g>
      <g>
        <rect x="2.6" y="10.4" width="9.8" height="2.8" rx="1.3" fill="#2b2b34"/>
        <rect x="2.6" y="10.4" width="9.8" height=".9" rx="1.3" fill="#3a3a46"/>
        <rect x="4" y="11.4" width="1.8" height=".7" fill="#555"/>
        <rect x="4.55" y="10.85" width=".7" height="1.8" fill="#555"/>
        <circle class="gm-ba" cx="9.4" cy="11.3" r=".7" fill="#ff5555"/>
        <circle class="gm-bb" cx="10.8" cy="12" r=".7" fill="#ffd14a"/>
      </g>
    </g>
  </svg>`,

  // 4. 基础待机 - 开心摆动（简化版）
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
    <defs><style>
      .id-body{transform-origin:7.5px 13px;animation:id-sway 2s infinite ease-in-out;}
      .id-eye{transform-origin:7.5px 9px;animation:id-blink 3.5s infinite;}
      .id-al{transform-origin:2px 10px;animation:id-wave 1.2s infinite ease-in-out;}
      .id-ar{transform-origin:13px 10px;animation:id-wave 1.2s .6s infinite ease-in-out;}
      @keyframes id-sway{0%,100%{transform:rotate(-2deg);}50%{transform:rotate(2deg);}}
      @keyframes id-blink{0%,44%,52%,100%{transform:scaleY(1);}48%{transform:scaleY(.1);}}
      @keyframes id-wave{0%,100%{transform:rotate(0);}50%{transform:rotate(18deg);}}
    </style></defs>
    <g class="id-body">
      <g fill="#DE886D">
        <rect x="3" y="13" width="1" height="2"/><rect x="5" y="13" width="1" height="2"/>
        <rect x="9" y="13" width="1" height="2"/><rect x="11" y="13" width="1" height="2"/>
      </g>
      <rect x="2" y="6" width="11" height="7" fill="#DE886D"/>
      <g class="id-al"><rect x="0" y="9" width="2" height="2" fill="#DE886D"/></g>
      <g class="id-ar"><rect x="13" y="9" width="2" height="2" fill="#DE886D"/></g>
      <g class="id-eye" fill="#000"><rect x="4" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/></g>
      <path d="M5 11.5 Q7.5 13 10 11.5" stroke="#000" stroke-width=".6" fill="none"/>
    </g>
  </svg>`,

  // 5. 喝咖啡 - 举杯子
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
    <defs><style>
      .cf-body{transform-origin:7.5px 13px;animation:cf-sip 3.6s infinite ease-in-out;}
      .cf-eye{transform-origin:7.5px 9px;animation:cf-blink 3.6s infinite;}
      .cf-steam{opacity:0;animation:cf-steam 2.4s var(--sd,0s) infinite ease-out;}
      @keyframes cf-sip{0%,65%,100%{transform:translateY(0);}75%{transform:translateY(-1px);}}
      @keyframes cf-blink{0%,70%,78%,100%{transform:scaleY(1);}74%{transform:scaleY(.1);}}
      @keyframes cf-steam{0%{opacity:0;transform:translateY(0) scaleX(1);}30%{opacity:.7;}100%{opacity:0;transform:translateY(-6px) scaleX(1.5);}}
    </style></defs>
    <g class="cf-body">
      <g fill="#DE886D">
        <rect x="3" y="13" width="1" height="2"/><rect x="5" y="13" width="1" height="2"/>
        <rect x="9" y="13" width="1" height="2"/><rect x="11" y="13" width="1" height="2"/>
      </g>
      <rect x="2" y="6" width="11" height="7" fill="#DE886D"/>
      <rect x="0" y="9" width="2" height="2" fill="#DE886D"/>
      <rect x="13" y="9" width="2" height="2" fill="#DE886D" transform="rotate(-20,14,10)"/>
      <g class="cf-eye" fill="#000"><rect x="4" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/></g>
      <g>
        <rect x="13" y="6" width="3.4" height="4" rx=".6" fill="#f5f0e8"/>
        <rect x="13" y="6" width="3.4" height="1.2" rx=".6" fill="#8B4513"/>
        <path d="M16.4 7.5 Q18 7.5 18 9 Q18 10.5 16.4 10" stroke="#ccc" stroke-width=".6" fill="none"/>
        <ellipse class="cf-steam" cx="14.7" cy="5" rx="1" ry=".6" fill="#ddd" style="--sd:0s"/>
        <ellipse class="cf-steam" cx="15.4" cy="4.5" rx=".8" ry=".5" fill="#ddd" style="--sd:.8s"/>
        <ellipse class="cf-steam" cx="14" cy="4.8" rx=".7" ry=".4" fill="#ddd" style="--sd:1.6s"/>
      </g>
    </g>
  </svg>`,
]

const DURATION = 3000 // 总动画时长 ms

export default function SplashScreen({ onFinish }) {
  const [opacity, setOpacity] = useState(1)
  const [svgIndex] = useState(() => Math.floor(Math.random() * CLAWD_SVGS.length))
  const [phase, setPhase] = useState('enter') // enter -> show -> exit
  const finished = useRef(false)
  const startRef = useRef(Date.now())

  useEffect(() => {
    startRef.current = Date.now()
    // Phase transitions
    const t1 = setTimeout(() => setPhase('show'), 600)
    const t2 = setTimeout(() => setPhase('exit'), DURATION - 600)
    const t3 = setTimeout(() => {
      if (!finished.current) {
        finished.current = true
        onFinish && onFinish()
      }
    }, DURATION)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  useEffect(() => {
    if (phase === 'exit') {
      const fade = setInterval(() => {
        const elapsed = Date.now() - startRef.current
        const fadeProgress = Math.min(1, (elapsed - (DURATION - 600)) / 600)
        setOpacity(1 - fadeProgress)
        if (fadeProgress >= 1) clearInterval(fade)
      }, 16)
      return () => clearInterval(fade)
    }
  }, [phase])

  const handleTap = () => {
    if (!finished.current) {
      finished.current = true
      onFinish && onFinish()
    }
  }

  return (
    <div
      onClick={handleTap}
      style={{
        position: 'absolute', inset: 0, zIndex: 9999,
        background: 'linear-gradient(180deg, #FFF8F0 0%, #FFE8D6 40%, #FFDBC5 100%)',
        opacity,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        pointerEvents: opacity > 0 ? 'auto' : 'none',
        overflow: 'hidden',
      }}
    >
      {/* 装饰性淡色圆点 */}
      <div style={{
        position: 'absolute', top: '15%', left: '12%',
        width: 60, height: 60, borderRadius: '50%',
        background: 'rgba(255,180,150,0.2)',
      }} />
      <div style={{
        position: 'absolute', top: '25%', right: '8%',
        width: 40, height: 40, borderRadius: '50%',
        background: 'rgba(255,160,130,0.15)',
      }} />
      <div style={{
        position: 'absolute', bottom: '30%', left: '8%',
        width: 50, height: 50, borderRadius: '50%',
        background: 'rgba(255,200,170,0.18)',
      }} />

      {/* 壳蟹蟹 SVG - 从底部弹跳上来 */}
      <div
        style={{
          width: 180, height: 180,
          transform: phase === 'enter' ? 'translateY(120%)' : 'translateY(0)',
          transition: phase === 'enter' ? 'none' : 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
          animation: phase === 'show' ? 'clawd-bounce 2s infinite ease-in-out' : 'none',
        }}
        dangerouslySetInnerHTML={{ __html: CLAWD_SVGS[svgIndex] }}
      />

      {/* 气泡 "欢迎回家" */}
      <div style={{
        marginTop: 20,
        padding: '10px 24px',
        background: 'white',
        borderRadius: 20,
        boxShadow: '0 4px 20px rgba(222,136,109,0.15)',
        opacity: phase === 'enter' ? 0 : 1,
        transform: phase === 'enter' ? 'translateY(20px) scale(0.8)' : 'translateY(0) scale(1)',
        transition: 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s',
        position: 'relative',
      }}>
        {/* 气泡尖角 */}
        <div style={{
          position: 'absolute', top: -8, left: '50%', marginLeft: -6,
          width: 0, height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderBottom: '8px solid white',
        }} />
        <span style={{
          fontSize: 16, fontWeight: 600,
          color: '#DE886D',
          letterSpacing: 2,
        }}>
          欢迎回家 🦀
        </span>
      </div>

      {/* 底部 app 名称 */}
      <div style={{
        position: 'absolute', bottom: '8%',
        color: 'rgba(222,136,109,0.5)',
        fontSize: 12, fontWeight: 300,
        letterSpacing: 3,
      }}>
        池的小手机
      </div>

      {/* 内嵌关键帧动画 */}
      <style>{`
        @keyframes clawd-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  )
}
