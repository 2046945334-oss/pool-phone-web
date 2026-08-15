import { useState, useRef } from 'react'

/**
 * 单个App的美化设置面板
 * 支持：背景图(URL/上传)、背景色、模糊度、透明度
 * 对于情侣空间额外支持：头像、口袋图片、房间背景
 */
export default function AppCustomizer({ appId, config, onChange, onClose }) {
  const [localCfg, setLocalCfg] = useState(config || {})
  const fileRef = useRef(null)

  function update(key, val) {
    const next = { ...localCfg, [key]: val }
    setLocalCfg(next)
    onChange(next)
  }

  async function uploadImage(file) {
    // Always try to upload and get URL back
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: reader.result })
          })
          const d = await res.json()
          if (d.url) { resolve(d.url); return }
        } catch {}
        resolve(reader.result)
      }
      reader.readAsDataURL(file)
    })
  }

  function handleUpload(key) {
    return async (e) => {
      const file = e.target.files[0]
      if (!file) return
      const url = await uploadImage(file)
      update(key, url)
    }
  }

  function clear() {
    setLocalCfg({})
    onChange({})
  }

  // Image field component
  function ImageField({ label, fieldKey }) {
    return (
      <div className="customizer-item">
        <label>{label}</label>
        <div className="customizer-row">
          <input
            className="customizer-input"
            value={localCfg[fieldKey] || ''}
            onChange={e => update(fieldKey, e.target.value)}
            placeholder={'粘贴图片URL...'}
          />
          <label className="customizer-upload">
            {'📷'}
            <input type="file" accept="image/*" onChange={handleUpload(fieldKey)} hidden />
          </label>
        </div>
        {localCfg[fieldKey] && (
          <div className="customizer-preview">
            <img src={localCfg[fieldKey]} alt="" />
            <button onClick={() => update(fieldKey, '')}>{'移除'}</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app-customizer-overlay" onClick={onClose}>
      <div className="app-customizer-panel" onClick={e => e.stopPropagation()}>
        <div className="customizer-header">
          <span>{'🎨 App美化设置'}</span>
          <button className="customizer-close" onClick={onClose}>{'×'}</button>
        </div>

        <div className="customizer-body">
          {/* 情侣空间专属设置 */}
          {appId === 'couple' && (
            <>
              <div className="customizer-section-title">{'💕 情侣空间'}</div>
              <ImageField label="她的头像" fieldKey="coupleAvatarHer" />
              <ImageField label="他的头像" fieldKey="coupleAvatarHim" />
              <ImageField label="口袋图片" fieldKey="couplePocketImg" />
              <ImageField label="房间背景图" fieldKey="coupleRoomBg" />
            </>
          )}

          <div className="customizer-section-title">{'🖼️ 页面背景'}</div>
          <ImageField label="背景图片" fieldKey="bgImage" />

          <div className="customizer-item">
            <label>{'背景颜色'}</label>
            <div className="customizer-row">
              <input
                type="color"
                value={localCfg.bgColor || '#f5f0f5'}
                onChange={e => update('bgColor', e.target.value)}
              />
              <span className="customizer-color-label">{localCfg.bgColor || '默认'}</span>
              {localCfg.bgColor && <button className="customizer-clear-btn" onClick={() => update('bgColor', '')}>{'重置'}</button>}
            </div>
          </div>

          <div className="customizer-item">
            <label>{'背景模糊 ' + (localCfg.bgBlur || 0) + 'px'}</label>
            <input
              type="range"
              min="0" max="20" step="1"
              value={localCfg.bgBlur || 0}
              onChange={e => update('bgBlur', Number(e.target.value))}
            />
          </div>

          <div className="customizer-item">
            <label>{'内容区透明度 ' + Math.round((localCfg.contentOpacity ?? 1) * 100) + '%'}</label>
            <input
              type="range"
              min="0" max="1" step="0.05"
              value={localCfg.contentOpacity ?? 1}
              onChange={e => update('contentOpacity', Number(e.target.value))}
            />
          </div>

          <div className="customizer-item">
            <label>{'背景填充方式'}</label>
            <select
              value={localCfg.bgSize || 'cover'}
              onChange={e => update('bgSize', e.target.value)}
              className="customizer-select"
            >
              <option value="cover">{'铺满 (cover)'}</option>
              <option value="contain">{'适应 (contain)'}</option>
              <option value="repeat">{'平铺 (repeat)'}</option>
            </select>
          </div>
        </div>

        <div className="customizer-footer">
          <button className="customizer-btn-clear" onClick={clear}>{'清除所有'}</button>
          <button className="customizer-btn-done" onClick={onClose}>{'完成'}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * 根据app配置生成背景样式对象
 */
export function getAppBgStyle(config) {
  if (!config) return {}
  const style = {}
  if (config.bgImage) {
    style.backgroundImage = `url(${config.bgImage})`
    style.backgroundPosition = 'center'
    style.backgroundSize = config.bgSize === 'repeat' ? 'auto' : (config.bgSize || 'cover')
    style.backgroundRepeat = config.bgSize === 'repeat' ? 'repeat' : 'no-repeat'
  }
  if (config.bgColor && !config.bgImage) {
    style.background = config.bgColor
  }
  return style
}

/**
 * 生成注入到HTML app的CSS字符串
 */
export function getAppBgCss(config) {
  if (!config) return ''
  let css = ''
  if (config.bgImage) {
    css += `background-image: url(${config.bgImage}) !important;`
    css += `background-position: center !important;`
    css += `background-size: ${config.bgSize === 'repeat' ? 'auto' : (config.bgSize || 'cover')} !important;`
    css += `background-repeat: ${config.bgSize === 'repeat' ? 'repeat' : 'no-repeat'} !important;`
  } else if (config.bgColor) {
    css += `background: ${config.bgColor} !important;`
  }
  if (config.bgBlur && config.bgImage) {
    return `
      body { position: relative !important; }
      body::before {
        content: ''; position: fixed; inset: 0; z-index: -1;
        background-image: url(${config.bgImage});
        background-position: center;
        background-size: ${config.bgSize === 'repeat' ? 'auto' : (config.bgSize || 'cover')};
        background-repeat: ${config.bgSize === 'repeat' ? 'repeat' : 'no-repeat'};
        filter: blur(${config.bgBlur}px);
        transform: scale(1.1);
      }
    `
  }
  return css ? `body { ${css} }` : ''
}

/**
 * 生成情侣空间专属的图片替换JS
 */
export function getCoupleInjectJs(config) {
  if (!config) return ''
  const parts = []
  if (config.coupleAvatarHer) {
    parts.push(`document.querySelectorAll('.b-avatar img')[0] && (document.querySelectorAll('.b-avatar img')[0].src = '${config.coupleAvatarHer}');`)
  }
  if (config.coupleAvatarHim) {
    parts.push(`document.querySelectorAll('.b-avatar img')[1] && (document.querySelectorAll('.b-avatar img')[1].src = '${config.coupleAvatarHim}');`)
  }
  if (config.couplePocketImg) {
    parts.push(`document.querySelector('.pocket-right img') && (document.querySelector('.pocket-right img').src = '${config.couplePocketImg}');`)
  }
  if (config.coupleRoomBg) {
    parts.push(`document.querySelector('.room-floor') && (document.querySelector('.room-floor').style.background = 'url(${config.coupleRoomBg}) center/cover');`)
  }
  return parts.length ? `<script>window.addEventListener('DOMContentLoaded', function(){${parts.join('\n')}});</script>` : ''
}
