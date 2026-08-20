import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  WorkbenchWindowApiContract,
  WorkbenchWindowBootstrap,
  WorkbenchWindowProjection,
} from '@shared/ipc/workbench-window'
import './auxiliary-browser-layout.css'

export function AuxiliaryBrowserLayout({
  api,
}: {
  api: WorkbenchWindowApiContract
}): React.ReactElement {
  const [bootstrap, setBootstrap] = useState<WorkbenchWindowBootstrap | null>(null)
  const [projection, setProjection] = useState<WorkbenchWindowProjection | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('浏览器')
  const [error, setError] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findCount, setFindCount] = useState({ active: 0, matches: 0 })
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const browserSurfaceRef = useRef<HTMLDivElement>(null)
  const tab = projection?.tabs[0]

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [nextBootstrap, nextProjection] = await Promise.all([
          api.getBootstrap(),
          api.getProjection(),
        ])
        if (cancelled) return
        setBootstrap(nextBootstrap)
        setProjection(nextProjection)
        const initialTab = nextProjection.tabs[0]
        setUrl(initialTab?.initialUrl ?? '')
        setTitle(initialTab?.title ?? '浏览器')
        await api.auxiliaryReady({
          windowId: nextBootstrap.windowId,
          generation: nextBootstrap.generation,
        })
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    const removeProjection = api.onProjectionChanged((next) => {
      setProjection(next)
      const nextTab = next.tabs[0]
      if (nextTab?.initialUrl) setUrl(nextTab.initialUrl)
      if (nextTab?.title) setTitle(nextTab.title)
    })
    const removePlacement = api.onPlacementChanged((placement) => {
      setProjection((current) => {
        if (!current || current.tabs[0]?.tabId !== placement.tabId) return current
        return {
          ...current,
          tabs: [{ ...current.tabs[0], generation: placement.generation }],
        }
      })
    })
    const removeUrl = api.onUrlChanged((payload) => {
      if (payload.tabId === tab?.tabId) setUrl(payload.url)
    })
    const removeMeta = api.onPageMetaChanged((payload) => {
      if (payload.tabId === tab?.tabId && payload.title) setTitle(payload.title)
    })
    const removeFindShortcut = api.onFindShortcutTriggered((payload) => {
      if (payload.tabId === tab?.tabId) setFindOpen(true)
    })
    const removeFindResult = api.onFindResult((payload) => {
      if (payload.tabId === tab?.tabId) {
        setFindCount({ active: payload.activeMatchOrdinal, matches: payload.matches })
      }
    })
    const removeTask = api.onTaskChanged(({ task }) => {
      if (task.tabId === tab?.tabId) setTaskStatus(`任务：${task.status}`)
    })
    const removeDownload = api.onDownloadChanged(({ download }) => {
      if (download.tabId === tab?.tabId) {
        setDownloadStatus(`下载：${download.status} · ${download.suggestedFilename}`)
      }
    })
    const removeNativeMenu = api.onNativeContextMenuOpened(() => undefined)
    return () => {
      cancelled = true
      removeProjection()
      removePlacement()
      removeUrl()
      removeMeta()
      removeFindShortcut()
      removeFindResult()
      removeTask()
      removeDownload()
      removeNativeMenu()
    }
  }, [api, tab?.tabId])

  useLayoutEffect(() => {
    if (!bootstrap || !browserSurfaceRef.current) return
    const surface = browserSurfaceRef.current
    const report = (): void => {
      const bounds = surface.getBoundingClientRect()
      void api
        .updateBounds({
          windowId: bootstrap.windowId,
          generation: bootstrap.generation,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        })
        .catch(() => undefined)
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(surface)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [api, bootstrap])

  const runCommand = useCallback(
    async (action: 'navigate' | 'back' | 'forward' | 'reload', nextUrl?: string) => {
      if (!bootstrap || !tab || tab.generation === 0) return
      try {
        setError(null)
        await api.browserCommand({
          windowId: bootstrap.windowId,
          tabId: tab.tabId,
          generation: tab.generation,
          action,
          ...(nextUrl ? { url: nextUrl } : {}),
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [api, bootstrap, tab],
  )

  const navigate = (): void => {
    const value = url.trim()
    if (!value) return
    void runCommand('navigate', /^https?:\/\//i.test(value) ? value : `https://${value}`)
  }

  const runFind = (findNext: boolean, forward = true, query = findQuery): void => {
    if (!bootstrap || !tab || tab.generation === 0) return
    void api.browserCommand({
      windowId: bootstrap.windowId,
      tabId: tab.tabId,
      generation: tab.generation,
      action: 'find',
      query,
      requestToken: crypto.randomUUID(),
      forward,
      findNext,
    })
  }

  const closeFind = (): void => {
    if (bootstrap && tab && tab.generation > 0) {
      void api.browserCommand({
        windowId: bootstrap.windowId,
        tabId: tab.tabId,
        generation: tab.generation,
        action: 'stop-find',
      })
    }
    setFindOpen(false)
  }

  const returnToMain = (): void => {
    if (!bootstrap || !tab || tab.generation === 0) return
    void api
      .returnTabToMain({
        tabId: tab.tabId,
        sourceWindowId: bootstrap.windowId,
        expectedGeneration: tab.generation,
      })
      .then((result) => {
        if (!result.success) setError(result.error.message)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }

  return (
    <div className="auxiliary-browser-window">
      <header className="auxiliary-browser-titlebar">
        <span className="auxiliary-browser-title" title={title}>
          {title}
        </span>
        <button type="button" onClick={returnToMain} disabled={!tab || tab.generation === 0}>
          送回主窗口
        </button>
      </header>
      <nav className="auxiliary-browser-toolbar" aria-label="浏览器导航">
        <button type="button" title="后退" onClick={() => void runCommand('back')}>
          ←
        </button>
        <button type="button" title="前进" onClick={() => void runCommand('forward')}>
          →
        </button>
        <button type="button" title="刷新" onClick={() => void runCommand('reload')}>
          ↻
        </button>
        <input
          aria-label="地址"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') navigate()
          }}
        />
        <button type="button" onClick={navigate}>
          前往
        </button>
      </nav>
      <div className="auxiliary-browser-notices">
        {findOpen && (
          <div className="auxiliary-browser-find" role="search">
            <input
              autoFocus
              aria-label="在页面中查找"
              value={findQuery}
              onChange={(event) => {
                const query = event.target.value
                setFindQuery(query)
                runFind(false, true, query)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') runFind(true, !event.shiftKey)
                if (event.key === 'Escape') closeFind()
              }}
            />
            <span>{findCount.matches ? `${findCount.active}/${findCount.matches}` : '无结果'}</span>
            <button type="button" onClick={() => runFind(true, false)} title="上一个匹配项">
              ↑
            </button>
            <button type="button" onClick={() => runFind(true)} title="下一个匹配项">
              ↓
            </button>
            <button type="button" onClick={closeFind} title="关闭查找">
              ×
            </button>
          </div>
        )}
        {(taskStatus || downloadStatus) && (
          <div className="auxiliary-browser-activity" aria-live="polite">
            {taskStatus && <span>{taskStatus}</span>}
            {downloadStatus && <span>{downloadStatus}</span>}
          </div>
        )}
        {error && <div className="auxiliary-browser-error">{error}</div>}
      </div>
      <div ref={browserSurfaceRef} className="auxiliary-browser-surface" />
    </div>
  )
}
