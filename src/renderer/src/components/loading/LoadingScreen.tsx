/**
 * LoadingScreen — 启动加载画面
 *
 * 在桌面运行时初始化期间显示，居中展示应用标识 + 加载指示器。
 */

function LoadingScreen(): React.ReactElement {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="#0078d4" />
            <path
              d="M14 24C14 18.477 18.477 14 24 14V14C29.523 14 34 18.477 34 24V34H24C18.477 34 14 29.523 14 24V24Z"
              fill="white"
              fillOpacity="0.9"
            />
            <circle cx="24" cy="24" r="4" fill="#0078d4" />
          </svg>
        </div>
        <div className="loading-title">CCLink Studio</div>
        <div className="loading-spinner">
          <div className="spinner" />
        </div>
      </div>
    </div>
  )
}

export default LoadingScreen
