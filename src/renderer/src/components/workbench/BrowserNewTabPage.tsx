import { useCallback, useEffect, useState } from 'react'
import type { BrowserHistoryEntry } from '@shared/ipc/browser'
import { IconClock, IconGlobe } from '../common/Icons'
import {
  getRecentBrowserUrlLabel,
  RECENT_BROWSER_HISTORY_LIMIT,
  selectRecentBrowserHistory,
} from '../../features/browser/browser-new-tab'
import { observeBrowserHistoryChanged } from '../../features/browser/browser-history-events'

interface BrowserNewTabPageProps {
  onOpenUrl: (url: string) => void
}

export function BrowserNewTabPage({ onOpenUrl }: BrowserNewTabPageProps): React.ReactElement {
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const loadHistory = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(false)
    try {
      const entries = await window.cclinkStudio.browser.listHistory(RECENT_BROWSER_HISTORY_LIMIT)
      setHistory(selectRecentBrowserHistory(entries))
    } catch (cause) {
      console.warn(
        '[BrowserNewTabPage] 最近访问加载失败:',
        cause instanceof Error ? cause.message : String(cause),
      )
      setHistory([])
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
    const stopObservingHistory = observeBrowserHistoryChanged(() => void loadHistory())
    const stopObservingNavigation = window.cclinkStudio.browser.onUrlChanged(
      () => void loadHistory(),
    )
    return () => {
      stopObservingHistory()
      stopObservingNavigation()
    }
  }, [loadHistory])

  return (
    <BrowserNewTabContent
      history={history}
      loading={loading}
      error={error}
      onOpenUrl={onOpenUrl}
      onRetry={() => void loadHistory()}
    />
  )
}

export function BrowserNewTabContent({
  history,
  loading,
  error,
  onOpenUrl,
  onRetry,
}: {
  history: BrowserHistoryEntry[]
  loading: boolean
  error: boolean
  onOpenUrl: (url: string) => void
  onRetry: () => void
}): React.ReactElement {
  return (
    <div className="browser-new-tab">
      <div className="browser-new-tab-inner">
        <div className="browser-new-tab-heading">
          <span className="browser-new-tab-heading-icon" aria-hidden="true">
            <IconClock size={18} />
          </span>
          <div>
            <h2>最近访问</h2>
            <p>从最近打开过的网址继续浏览</p>
          </div>
        </div>

        {history.length > 0 ? (
          <div className="browser-new-tab-grid" aria-label="最近访问的网址">
            {history.map((entry) => (
              <button
                type="button"
                className="browser-new-tab-card"
                key={entry.id}
                title={entry.url}
                onClick={() => onOpenUrl(entry.url)}
              >
                <span className="browser-new-tab-card-icon" aria-hidden="true">
                  <IconGlobe size={18} />
                </span>
                <span className="browser-new-tab-card-copy">
                  <span className="browser-new-tab-card-title">
                    {entry.title?.trim() || getRecentBrowserUrlLabel(entry.url)}
                  </span>
                  <span className="browser-new-tab-card-url">
                    {getRecentBrowserUrlLabel(entry.url)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : loading ? (
          <div className="browser-new-tab-empty">正在加载最近访问…</div>
        ) : error ? (
          <button type="button" className="browser-new-tab-retry" onClick={onRetry}>
            最近访问加载失败，点击重试
          </button>
        ) : (
          <div className="browser-new-tab-empty">访问过的网址会显示在这里</div>
        )}
      </div>
    </div>
  )
}
