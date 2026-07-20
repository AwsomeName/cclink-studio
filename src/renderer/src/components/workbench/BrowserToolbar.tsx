import type { BrowserTabState } from '../../stores/browser-store'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  IconArrowLeft,
  IconArrowRight,
  IconFitWidth,
  IconMobile,
  IconMonitor,
  IconRefresh,
  IconZoomIn,
  IconZoomOut,
} from '../common/Icons'
import { BrowserHistoryMenu } from './BrowserHistoryMenu'

interface BrowserToolbarProps {
  tabId: string
  browserState: BrowserTabState | undefined
  onUrlInputChange: (tabId: string, value: string) => void
  onNavigate: () => void
  onOpenUrl: (url: string) => void
}

export function BrowserToolbar({
  tabId,
  browserState,
  onUrlInputChange,
  onNavigate,
  onOpenUrl,
}: BrowserToolbarProps): React.ReactElement {
  return (
    <div className="browser-toolbar">
      <button onClick={() => window.cclinkStudio.browser.goBack(tabId)} title="后退">
        <IconArrowLeft size={16} />
      </button>
      <button onClick={() => window.cclinkStudio.browser.goForward(tabId)} title="前进">
        <IconArrowRight size={16} />
      </button>
      <button onClick={() => window.cclinkStudio.browser.reload(tabId)} title="刷新">
        <IconRefresh size={16} />
      </button>
      <BrowserHistoryMenu onOpenUrl={onOpenUrl} />
      <input
        className="url-input"
        value={browserState?.urlInput ?? ''}
        onChange={(event) => onUrlInputChange(tabId, event.target.value)}
        onFocus={() => {
          void window.cclinkStudio.window.focusRenderer()
        }}
        onKeyDown={(event) => {
          const primaryModifier = event.metaKey || event.ctrlKey
          const key = event.key.toLowerCase()

          if (primaryModifier && !event.altKey && !event.shiftKey && key === 'a') {
            event.preventDefault()
            event.currentTarget.select()
            return
          }

          if (primaryModifier && !event.altKey && !event.shiftKey && key === 'c') {
            const input = event.currentTarget
            const start = input.selectionStart ?? 0
            const end = input.selectionEnd ?? start
            if (end > start) {
              event.preventDefault()
              const selectedText = input.value.slice(start, end)
              void copyTextToClipboard(selectedText).catch((error) => {
                console.error('[BrowserToolbar] 地址复制失败:', error)
              })
            }
            return
          }

          if (event.key === 'Enter') onNavigate()
        }}
        placeholder="输入 URL..."
      />

      <div className="browser-zoom-group">
        <button onClick={() => window.cclinkStudio.browser.zoomOut(tabId)} title="缩小">
          <IconZoomOut size={16} />
        </button>
        <button
          className="zoom-label"
          onClick={() => window.cclinkStudio.browser.resetZoom(tabId)}
          title="点击重置为 100%"
        >
          {Math.round((browserState?.zoomFactor ?? 1) * 100)}%
        </button>
        <button onClick={() => window.cclinkStudio.browser.zoomIn(tabId)} title="放大">
          <IconZoomIn size={16} />
        </button>
        <button
          className={
            browserState?.zoomMode === 'fit' && browserState?.viewMode === 'desktop' ? 'active' : ''
          }
          onClick={() => window.cclinkStudio.browser.fitWidth(tabId)}
          title="适应宽度（自动缩放以显示整页）"
        >
          <IconFitWidth size={16} />
        </button>
      </div>

      <div className="browser-device-group">
        <button
          className={browserState?.viewMode === 'desktop' ? 'active' : ''}
          onClick={() => window.cclinkStudio.browser.setDeviceMode(tabId, 'desktop')}
          title="桌面版"
        >
          <IconMonitor size={16} />
        </button>
        <button
          className={browserState?.viewMode === 'mobile' ? 'active' : ''}
          onClick={() => window.cclinkStudio.browser.setDeviceMode(tabId, 'mobile')}
          title="移动版"
        >
          <IconMobile size={16} />
        </button>
      </div>
    </div>
  )
}
