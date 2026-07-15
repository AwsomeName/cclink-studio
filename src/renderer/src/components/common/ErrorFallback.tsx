/**
 * ErrorFallback — 预定义的错误回退 UI 组件
 *
 * 为不同层级的 ErrorBoundary 提供风格统一的回退界面。
 * 全部使用内联样式，不依赖外部 CSS（保证即使 CSS 加载失败也能渲染）。
 */

import type { CSSProperties } from 'react'

/** 根级回退：全屏暗色页面，包含"重新加载"按钮 */
export function RootErrorFallback(
  error: Error,
  retry: () => void,
): React.ReactElement {
  // 参数已解构为 error 和 retry，直接使用
  return (
    <div style={rootStyle}>
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ marginBottom: 16 }}>
        <rect width="48" height="48" rx="12" fill="#0078d4" />
        <path
          d="M14 24C14 18.477 18.477 14 24 14V14C29.523 14 34 18.477 34 24V34H24C18.477 34 14 29.523 14 24V24Z"
          fill="white"
          fillOpacity="0.9"
        />
        <circle cx="24" cy="24" r="4" fill="#0078d4" />
      </svg>
      <h2 style={{ margin: '0 0 8px', color: '#fff', fontSize: 20, fontWeight: 600 }}>
        CCLink Studio 遇到了问题
      </h2>
      <p style={{ margin: '0 0 12px', color: '#999', fontSize: 13 }}>
        应用发生了意外错误，请尝试重新加载。
      </p>
      <pre style={preStyle}>{error.message}</pre>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={() => window.deepink.window.reload()} style={buttonPrimaryStyle}>
          重新加载
        </button>
        <button onClick={retry} style={buttonSecondaryStyle}>
          重试当前页面
        </button>
      </div>
    </div>
  )
}

/** 面板级回退：内联红色边框提示，带"重试"按钮 */
export function PanelErrorFallback({
  error,
  retry,
  title,
}: {
  error: Error
  retry: () => void
  title?: string
}): React.ReactElement {
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 20, marginBottom: 8 }}>⚠️</div>
      <div style={{ color: '#f48771', fontWeight: 600, marginBottom: 4 }}>
        {title ? `${title}遇到错误` : '此面板遇到错误'}
      </div>
      <pre style={{ ...preStyle, maxHeight: 80, margin: '4px 0 12px' }}>
        {error.message}
      </pre>
      <button onClick={retry} style={buttonSecondaryStyle}>
        重试
      </button>
    </div>
  )
}

// ─── 样式常量 ─────────────────────────────────────────

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100vw',
  height: '100vh',
  background: '#1e1e1e',
  color: '#ccc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  textAlign: 'center',
  padding: 24,
  boxSizing: 'border-box',
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  padding: 24,
  background: '#1e1e1e',
  border: '1px solid #5a1d1d',
  borderRadius: 4,
  color: '#ccc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  textAlign: 'center',
  boxSizing: 'border-box',
}

const preStyle: CSSProperties = {
  maxWidth: '100%',
  maxHeight: 120,
  overflow: 'auto',
  padding: '8px 12px',
  background: '#2d2d2d',
  borderRadius: 6,
  fontSize: 12,
  color: '#f48771',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
}

const buttonPrimaryStyle: CSSProperties = {
  padding: '8px 20px',
  border: 'none',
  borderRadius: 4,
  background: '#0078d4',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}

const buttonSecondaryStyle: CSSProperties = {
  padding: '8px 20px',
  border: '1px solid #555',
  borderRadius: 4,
  background: '#333',
  color: '#ccc',
  cursor: 'pointer',
  fontSize: 13,
}
