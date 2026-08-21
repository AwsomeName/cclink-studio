import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type { Tab } from '../../types'
import { IconClose, IconFile, IconGlobe, IconPlus, IconRobot, IconTerminal } from '../common/Icons'
import { BrowserFavicon } from '../common/BrowserFavicon'
import { useBrowserStore } from '../../stores/browser-store'
import { getBrowserDisplayTitle } from '../sidebar/browser-sidebar-view-model'
import { isContextMenuKeyboardEvent } from '../../features/context-actions/context-menu-trigger'
import { hasExceededTabDragThreshold, shouldRequestTabDetach } from './tab-detach-drag'
import { useEscapeDismiss } from '../common/dismissable-layer'

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

function WorkbenchTabTitle({ tab }: { tab: Tab }): React.ReactElement {
  const pageTitle = useBrowserStore((state) =>
    tab.type === 'browser' ? state.tabs[tab.id]?.title : null,
  )
  return <>{tab.type === 'browser' ? getBrowserDisplayTitle(tab.title, pageTitle) : tab.title}</>
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
  onNewConversation: () => void
  onNewTerminal: () => void
  onShowMenu: (tabId: string, x: number, y: number, focusReturn: HTMLElement) => void
  createMenuOpen: boolean
  onCreateMenuOpenChange: (open: boolean) => void
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
  onNewConversation,
  onNewTerminal,
  onShowMenu,
  createMenuOpen,
  onCreateMenuOpenChange,
  conversationDropActive,
}: TabBarProps): React.ReactElement {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [createMenuPosition, setCreateMenuPosition] = useState({ left: 0, top: 0 })
  const createMenuRef = useRef<HTMLDivElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
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

  useEscapeDismiss(createMenuOpen, () => {
    onCreateMenuOpenChange(false)
    createButtonRef.current?.focus()
  })

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
      const releasedInsideTabBar = Boolean(dropTabId)
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
    [onDetach, onDetachDragCancel, onReorder, resetPointerDrag],
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

  useEffect(() => {
    if (!createMenuOpen) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (createMenuRef.current && !createMenuRef.current.contains(event.target as Node)) {
        onCreateMenuOpenChange(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [createMenuOpen, onCreateMenuOpenChange])

  useEffect(
    () => () => {
      onCreateMenuOpenChange(false)
    },
    [onCreateMenuOpenChange],
  )

  const runCreateAction = (action: () => void): void => {
    onCreateMenuOpenChange(false)
    action()
  }

  const toggleCreateMenu = (): void => {
    const rect = createButtonRef.current?.getBoundingClientRect()
    if (rect) {
      setCreateMenuPosition({
        left: Math.min(rect.left, window.innerWidth - 232),
        top: rect.bottom + 4,
      })
    }
    onCreateMenuOpenChange(!createMenuOpen)
  }

  return (
    <div
      ref={tabBarRef}
      className={`tab-bar ${conversationDropActive ? 'conversation-drop-target' : ''}`}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          data-workbench-tab-id={tab.id}
          className={`tab ${activeTabId === tab.id ? 'active' : ''} ${draggingId === tab.id ? 'dragging' : ''} ${dragOverId === tab.id ? 'drop-target' : ''}`}
          role="tab"
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
          <span className="tab-title">
            <WorkbenchTabTitle tab={tab} />
            {tab.dirty && <span className="tab-dirty-dot" />}
          </span>
          <span
            className="tab-close"
            onClick={(event) => {
              event.stopPropagation()
              onClose(tab.id)
            }}
          >
            <IconClose size={12} />
          </span>
        </div>
      ))}

      <div className="tab-create-menu-wrap" ref={createMenuRef}>
        <button
          ref={createButtonRef}
          className="tab-new-button"
          title="新建标签页"
          onClick={toggleCreateMenu}
        >
          <IconPlus size={13} />
        </button>
        {createMenuOpen && (
          <div className="tab-create-menu" style={createMenuPosition}>
            <button onClick={() => runCreateAction(onNewDocument)}>
              <IconFile size={13} />
              <span className="tab-create-menu-main">
                <span>Markdown 草稿</span>
                <span>所见即所得编辑</span>
              </span>
            </button>
            <button onClick={() => runCreateAction(onNewBrowser)}>
              <IconGlobe size={13} />
              <span className="tab-create-menu-main">
                <span>浏览器页</span>
                <span>网页浏览和自动化</span>
              </span>
            </button>
            <button onClick={() => runCreateAction(onNewConversation)}>
              <IconRobot size={13} />
              <span className="tab-create-menu-main">
                <span>工作会话</span>
                <span>长期任务和可恢复现场</span>
              </span>
            </button>
            <button onClick={() => runCreateAction(onNewTerminal)}>
              <IconTerminal size={13} />
              <span className="tab-create-menu-main">
                <span>Terminal</span>
                <span>本地/远程命令现场</span>
              </span>
            </button>
            <div className="tab-create-menu-separator" />
            <button disabled title="规划中">
              <IconFile size={13} />
              <span className="tab-create-menu-main">
                <span>Word 文档</span>
                <span>规划中</span>
              </span>
            </button>
            <button disabled title="规划中">
              <IconFile size={13} />
              <span className="tab-create-menu-main">
                <span>PPT 演示</span>
                <span>规划中</span>
              </span>
            </button>
          </div>
        )}
      </div>
      <button
        className="tab-new-button tab-new-browser-button"
        title="新建浏览器页"
        onClick={onNewBrowser}
      >
        <IconGlobe size={13} />
      </button>
      {conversationDropActive && (
        <div className="conversation-tab-drop-hint" aria-hidden="true">
          松开以在中间 Tab 打开会话
        </div>
      )}
    </div>
  )
}
