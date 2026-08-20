import type { BrowserHistoryEntry } from '@shared/ipc/browser'
import { IconHistory } from '../common/Icons'
import { getBrowserUrlLabel } from './browser-sidebar-view-model'

interface BrowserHistorySectionProps {
  history: BrowserHistoryEntry[]
  loading: boolean
  error: string | null
  onOpen: (entry: BrowserHistoryEntry) => void
  onClear: () => void
  onRetry: () => void
}

export function BrowserHistorySection({
  history,
  loading,
  error,
  onOpen,
  onClear,
  onRetry,
}: BrowserHistorySectionProps): React.ReactElement {
  return (
    <div className="sidebar-section browser-sidebar-history-section">
      <div className="sidebar-section-header browser-sidebar-section-header">
        <span>访问历史</span>
        <span className="browser-sidebar-count">{history.length}</span>
        {history.length > 0 && (
          <button
            className="browser-sidebar-text-action"
            type="button"
            onClick={onClear}
            disabled={loading}
          >
            清空
          </button>
        )}
      </div>

      <div className="browser-sidebar-list browser-sidebar-history-list">
        {history.map((entry) => (
          <div className="browser-sidebar-row" key={entry.id}>
            <button
              className="browser-sidebar-row-main"
              type="button"
              onClick={() => onOpen(entry)}
              title={entry.url}
            >
              <span className="browser-sidebar-favicon">
                <IconHistory size={14} />
              </span>
              <span className="project-panel-row-main">
                <span className="project-panel-row-title">
                  {entry.title?.trim() || getBrowserUrlLabel(entry.url)}
                </span>
                <span className="project-panel-row-meta">{getBrowserUrlLabel(entry.url)}</span>
              </span>
            </button>
          </div>
        ))}

        {history.length === 0 && loading && (
          <div className="project-panel-empty">正在加载访问历史…</div>
        )}
        {history.length === 0 && !loading && !error && (
          <div className="project-panel-empty">暂无访问历史</div>
        )}
        {history.length === 0 && !loading && error && (
          <button className="browser-sidebar-retry" type="button" onClick={onRetry}>
            历史加载失败，点击重试
          </button>
        )}
      </div>
    </div>
  )
}
