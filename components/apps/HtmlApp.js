import { useMemo } from 'react'

/**
 * 通用HTML App容器 - 将原始HTML app嵌入React组件
 * 使用srcdoc iframe：瞬时加载（无网络请求）、CSS/JS完全隔离、共享localStorage（同源）
 */
export default function HtmlApp({ htmlContent }) {
  // Only compute once
  const srcdoc = useMemo(() => htmlContent, [htmlContent])
  return (
    <iframe
      srcDoc={srcdoc}
      style={{ width: '100%', height: '100%', border: 'none' }}
      sandbox="allow-scripts allow-same-origin allow-modals"
      title="app"
    />
  )
}