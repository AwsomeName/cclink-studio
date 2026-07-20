import { useCallback, useRef, useState } from 'react'
import type { BrowserHistoryEntry } from '@shared/ipc/browser'
import { IconGlobe, IconHistory } from '../common/Icons'
import { FloatingSurface } from '../common/FloatingSurface'

interface BrowserHistoryMenuProps {
  onOpenUrl: (url: string) => void
}

export function BrowserHistoryMenu({ onOpenUrl }: BrowserHistoryMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (): Promise<void> => {
    const historyList = await window.cclinkStudio.browser.listHistory(20)
    setHistory(historyList)
  }, [])

  const toggle = useCallback((): void => {
    setOpen((next) => {
      if (!next) void load()
      return !next
    })
  }, [load])

  const clearHistory = async (): Promise<void> => {
    await window.cclinkStudio.browser.clearHistory()
    setHistory([])
  }

  return (
    <div className="browser-history-menu" ref={wrapRef}>
      <button onClick={toggle} title="浏览历史">
        <IconHistory size={16} />
      </button>
      <FloatingSurface
        anchorRef={wrapRef}
        open={open}
        placement="bottom-start"
        gap={6}
        className="browser-history-popover"
        style={{ maxHeight: 'min(420px, calc(100vh - 16px))' }}
        onRequestClose={() => setOpen(false)}
      >
        <div className="browser-history-section">
          <div className="browser-history-header">
            <span>浏览历史</span>
            {history.length > 0 && <button onClick={() => void clearHistory()}>清空</button>}
          </div>
          {history.length === 0 ? (
            <div className="browser-history-empty">暂无记录</div>
          ) : (
            history.map((item) => (
              <button
                key={item.id}
                className="browser-history-item"
                onClick={() => {
                  onOpenUrl(item.url)
                  setOpen(false)
                }}
                title={item.url}
              >
                <IconGlobe size={12} />
                <span>{item.title || formatHistoryUrl(item.url)}</span>
              </button>
            ))
          )}
        </div>
      </FloatingSurface>
    </div>
  )
}

function formatHistoryUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname)
  } catch {
    return url
  }
}
