import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type { Tab } from '../../types'
import {
  IconArrowLeft,
  IconArrowRight,
  IconClose,
  IconFile,
  IconGlobe,
  IconTerminal,
} from '../common/Icons'
import { BrowserFavicon } from '../common/BrowserFavicon'
import { useBrowserStore } from '../../stores/browser-store'
import { getBrowserDisplayTitle } from '../sidebar/browser-sidebar-view-model'
import { isContextMenuKeyboardEvent } from '../../features/context-actions/context-menu-trigger'
import { hasExceededTabDragThreshold, shouldRequestTabDetach } from './tab-detach-drag'

const TAB_ICONS: Record<string, string> = {
  browser: '🌐',
  editor: '📄',
  settings: '⚙️',
  preview: '👁️',
  android: '📱',
  model: '🧊',
  conversation: '🤖',
  'remote-conversation': '☁️',
  terminal: '⌨️',
}

function getPointerDropTabId(clientX: number, clientY: number): string | null {
  if (clientX < 0 || clientY < 0 || clientX >= window.innerWidth || clientY >= window.innerHeight) {
    return null
  }
  const tab = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>('[data-workbench-tab-id]')
  return tab?.dataset.workbenchTabId ?? null
}

function WorkbenchTabIcon({ tab }: { tab: Tab }): React.ReactElement {
  const faviconUrl = useBrowserStore((state) =>
    tab.type === 'browser' ? state.tabs[tab.id]?.faviconUrl : null,
  )
  if (tab.type === 'browser') return <BrowserFavicon src={faviconUrl} size={14} />
  return <>{tab.icon || TAB_ICONS[tab.type]}</>
}

interface TabBarProps {
  tabBarRef: RefObject<HTMLDivElement | null>
  tabs: Tab[]
  activeTabId: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onReorder: (fromId: string, toId: string) => void
  onDetachDragStart: (tabId: string) => void
  onDetachDragCancel: (tabId: string) => void
  onDetach: (tabId: string) => void
  onNewDocument: () => void
  onNewBrowser: () => void
  onNewTerminal: () => void
  onShowMenu: (tabId: string, x: number, y: number, focusReturn: HTMLElement) => void
  conversationDropActive: boolean
}

export function TabBar({
  tabBarRef,
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onReorder,
  onDetachDragStart,
  onDetachDragCancel,
  onDetach,
  onNewDocument,
  onNewBrowser,
  onNewTerminal,
  onShowMenu,
  conversationDropActive,
}: TabBarProps): React.ReactElement {
  const browserTabs = useBrowserStore((state) => state.tabs)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ before: false, after: false })
  const tabOrderKey = JSON.stringify(tabs.map((tab) => tab.id))

  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const update = (): void => {
      const before = strip.scrollLeft > 1
      const after = strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1
      setOverflow((current) =>
        current.before === before && current.after === after ? current : { before, after },
      )
    }
    const revealActive = (): void => {
      const active = Array.from(
        strip.querySelectorAll<HTMLElement>('[data-workbench-tab-id]'),
      ).find((element) => element.dataset.workbenchTabId === activeTabId)
      if (active) {
        const tabBounds = active.getBoundingClientRect()
        const stripBounds = strip.getBoundingClientRect()
        if (tabBounds.left < stripBounds.left) strip.scrollLeft -= stripBounds.left - tabBounds.left
        else if (tabBounds.right > stripBounds.right)
          strip.scrollLeft += tabBounds.right - stripBounds.right
      }
    }
    revealActive()
    update()
    const observer = new ResizeObserver(() => {
      revealActive()
      update()
    })
    observer.observe(strip)
    for (const child of strip.children) observer.observe(child)
    strip.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      strip.removeEventListener('scroll', update)
    }
  }, [activeTabId, tabOrderKey])

  const pointerDragRef = useRef<{
    tab: Tab
    pointerId: number
    startX: number
    startY: number
    dragging: boolean
    cancelled: boolean
    captureElement: HTMLElement
  } | null>(null)
  const suppressClickTabIdRef = useRef<string | null>(null)

  const resetPointerDrag = useCallback((): void => {
    pointerDragRef.current = null
    setDraggingId(null)
    setDragOverId(null)
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, tab: Tab): void => {
      if (event.button !== 0 || (event.target as Element).closest('.tab-close')) return
      pointerDragRef.current = {
        tab,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        cancelled: false,
        captureElement: event.currentTarget,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const drag = pointerDragRef.current
      if (!drag || drag.pointerId !== event.pointerId || drag.cancelled) return
      if (
        !drag.dragging &&
        !hasExceededTabDragThreshold(
          { x: drag.startX, y: drag.startY },
          { x: event.clientX, y: event.clientY },
        )
      ) {
        return
      }
      if (!drag.dragging) {
        drag.dragging = true
        setDraggingId(drag.tab.id)
        if (drag.tab.type === 'browser') onDetachDragStart(drag.tab.id)
      }
      event.preventDefault()
      const dropTabId = getPointerDropTabId(event.clientX, event.clientY)
      setDragOverId(dropTabId && dropTabId !== drag.tab.id ? dropTabId : null)
    },
    [onDetachDragStart],
  )

  const finishPointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, pointerCancelled: boolean): void => {
      const drag = pointerDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const wasDragging = drag.dragging
      const cancelled = drag.cancelled || pointerCancelled
      const dropTabId = getPointerDropTabId(event.clientX, event.clientY)
      const barBounds = tabBarRef.current?.getBoundingClientRect()
      const releasedInsideTabBar = Boolean(
        barBounds &&
        event.clientX >= barBounds.left &&
        event.clientX <= barBounds.right &&
        event.clientY >= barBounds.top &&
        event.clientY <= barBounds.bottom,
      )
      if (wasDragging) {
        suppressClickTabIdRef.current = drag.tab.id
        if (drag.tab.type === 'browser' && (cancelled || releasedInsideTabBar)) {
          onDetachDragCancel(drag.tab.id)
        }
        if (!cancelled && dropTabId && dropTabId !== drag.tab.id) {
          onReorder(drag.tab.id, dropTabId)
        }
        if (
          shouldRequestTabDetach({
            tabType: drag.tab.type,
            releasedInsideTabBar,
            cancelled,
          })
        ) {
          onDetach(drag.tab.id)
        }
      }
      if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
        drag.captureElement.releasePointerCapture(drag.pointerId)
      }
      resetPointerDrag()
    },
    [onDetach, onDetachDragCancel, onReorder, resetPointerDrag, tabBarRef],
  )

  useEffect(() => {
    const handleDragCancel = (event: KeyboardEvent): void => {
      const drag = pointerDragRef.current
      if (event.key !== 'Escape' || !drag?.dragging) return
      drag.cancelled = true
      suppressClickTabIdRef.current = drag.tab.id
      if (drag.tab.type === 'browser') onDetachDragCancel(drag.tab.id)
      if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
        drag.captureElement.releasePointerCapture(drag.pointerId)
      }
      resetPointerDrag()
    }
    window.addEventListener('keydown', handleDragCancel, true)
    return () => window.removeEventListener('keydown', handleDragCancel, true)
  }, [onDetachDragCancel, resetPointerDrag])

  return (
    <div
      ref={tabBarRef}
      className={`tab-bar ${conversationDropActive ? 'conversation-drop-target' : ''}`}
    >
      <div className="tab-strip-shell">
        <div className="tab-strip" ref={stripRef} role="tablist" aria-label="工作台标签">
          {tabs.map((tab) => {
            const title =
              tab.type === 'browser'
                ? getBrowserDisplayTitle(tab.title, browserTabs[tab.id]?.title)
                : tab.title
            const label = `${title}${tab.pinned ? '（已固定）' : ''}${tab.dirty ? '（未保存）' : ''}`
            return (
              <div
                key={tab.id}
                data-workbench-tab-id={tab.id}
                className={`tab ${tab.pinned ? 'pinned' : ''} ${activeTabId === tab.id ? 'active' : ''} ${draggingId === tab.id ? 'dragging' : ''} ${dragOverId === tab.id ? 'drop-target' : ''}`}
                role="tab"
                title={label}
                aria-label={label}
                tabIndex={activeTabId === tab.id ? 0 : -1}
                aria-selected={activeTabId === tab.id}
                onPointerDown={(event) => handlePointerDown(event, tab)}
                onPointerMove={handlePointerMove}
                onPointerUp={(event) => finishPointerDrag(event, false)}
                onPointerCancel={(event) => finishPointerDrag(event, true)}
                onClick={(event) => {
                  if (suppressClickTabIdRef.current === tab.id) {
                    suppressClickTabIdRef.current = null
                    event.preventDefault()
                    return
                  }
                  onActivate(tab.id)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onShowMenu(tab.id, event.clientX, event.clientY, event.currentTarget)
                }}
                onKeyDown={(event) => {
                  if (
                    ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)
                  ) {
                    event.preventDefault()
                    const index = tabs.findIndex((item) => item.id === tab.id)
                    const nextIndex =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : event.key === 'ArrowLeft'
                            ? (index - 1 + tabs.length) % tabs.length
                            : event.key === 'ArrowRight'
                              ? (index + 1) % tabs.length
                              : index
                    const next = tabs[nextIndex]
                    if (next) {
                      onActivate(next.id)
                      const element = Array.from(stripRef.current?.children ?? []).find(
                        (child) => (child as HTMLElement).dataset.workbenchTabId === next.id,
                      )
                      ;(element as HTMLElement | undefined)?.focus({ preventScroll: true })
                    }
                    return
                  }
                  if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  onShowMenu(
                    tab.id,
                    rect.left + Math.min(24, rect.width / 2),
                    rect.top + Math.min(24, rect.height),
                    event.currentTarget,
                  )
                }}
              >
                <span className="tab-icon">
                  <WorkbenchTabIcon tab={tab} />
                </span>
                {!tab.pinned && <span className="tab-title">{title}</span>}
                {tab.dirty && <span className="tab-dirty-dot" aria-hidden="true" />}
                {!tab.pinned && (
                  <span
                    className="tab-close"
                    onClick={(event) => {
                      event.stopPropagation()
                      onClose(tab.id)
                    }}
                  >
                    <IconClose size={12} />
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {(overflow.before || overflow.after) && (
          <div className="tab-scroll-actions" aria-label="滚动标签">
            <button
              type="button"
              aria-label="向前滚动标签"
              title="向前滚动标签"
              disabled={!overflow.before}
              onClick={() => stripRef.current?.scrollBy({ left: -240, behavior: 'smooth' })}
            >
              <IconArrowLeft size={13} />
            </button>
            <button
              type="button"
              aria-label="向后滚动标签"
              title="向后滚动标签"
              disabled={!overflow.after}
              onClick={() => stripRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}
            >
              <IconArrowRight size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="tab-create-actions" role="group" aria-label="新建">
        <span className="tab-create-caption" aria-hidden="true">
          新建
        </span>
        <button
          type="button"
          className="tab-create-button tab-new-browser-button"
          title="新建浏览器页"
          aria-label="新建浏览器页"
          onClick={onNewBrowser}
        >
          <IconGlobe size={15} />
          <span>浏览器</span>
        </button>
        <button
          type="button"
          className="tab-create-button"
          title="新建 Markdown 草稿"
          aria-label="新建 Markdown 草稿"
          onClick={onNewDocument}
        >
          <IconFile size={15} />
          <span>MD</span>
        </button>
        <button
          type="button"
          className="tab-create-button"
          title="新建 Terminal"
          aria-label="新建 Terminal"
          onClick={onNewTerminal}
        >
          <IconTerminal size={15} />
          <span>Terminal</span>
        </button>
      </div>
      {conversationDropActive && (
        <div className="conversation-tab-drop-hint" aria-hidden="true">
          松开以在中间 Tab 打开会话
        </div>
      )}
    </div>
  )
}
