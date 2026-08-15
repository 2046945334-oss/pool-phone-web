import { useState, useRef } from 'react'

/**
 * 单个App的美化设置面板
 * 支持：背景图(URL/上传)、背景色、模糊度、透明度
 */
export default function AppCustomizer({ appId, config, onChange, onClose }) {
  const [localCfg, setLocalCfg] = useState(config || {})
  const fileRef = useRef(null)

  function update(key, val) {
    const next = { ...localCfg, [key]: val }
    setLocalCfg(next)
    onChange(next)
  }

  function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    // Try upload to backend first, fallback to base64
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: reader.result })
        })
        const d = await res.json()
        if (d.url) { update('bgImage', d.url); return }
      } catch {}
      update('bgImage', reader.result)
    }
    reader.readAsDataURL(file)
  }

  function clear() {
    setLocalCfg({})
    onChange({})
  }

  return (
    <div className="app-customizer-overlay" onClick={onClose}>
      <div className="app-customizer-panel" onClick={e => e.stopPropagation()}>
        <div className="customizer-header">
          <span>{'🎨 App背景设置'}</span>
          <button className="customizer-close" onClick={onClose}>{'×'}</button>
        </div>

        <div className="customizer-body">
          <div className="customizer-item">
            <label>{'背景图片'}</label>
            <div className="customizer-row">
              <input
                className="customizer-input"
                value={localCfg.bgImage || ''}
                onChange={e => update('bgImage', e.target.value)}
                placeholder={'粘贴图片URL...'}
              />
              <label className="customizer-upload">
                {'📷'}
                <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} hidden />
              </label>
            </div>
            {localCfg.bgImage && (
              <div className="customizer-preview">
                <img src={localCfg.bgImage} alt="" />
                <button onClick={() => update('bgImage', '')}>{'移除'}</button>
              </div>
            )}
          </div>

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
    // Use a pseudo-element for blur on body
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
