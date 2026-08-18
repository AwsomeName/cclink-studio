import { useCallback, useEffect, useRef, useState } from 'react'
import type { Tab } from '../../types'
import { IconClose, IconFile, IconGlobe, IconPlus, IconRobot, IconTerminal } from '../common/Icons'
import { BrowserFavicon } from '../common/BrowserFavicon'
import { useBrowserStore } from '../../stores/browser-store'
import { getBrowserDisplayTitle } from '../sidebar/browser-sidebar-view-model'
import { isContextMenuKeyboardEvent } from '../../features/context-actions/context-menu-trigger'

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
  tabs: Tab[]
  activeTabId: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onReorder: (fromId: string, toId: string) => void
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
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onReorder,
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

  const handleDragStart = useCallback((event: React.DragEvent, id: string): void => {
    setDraggingId(id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/tab-id', id)
  }, [])

  const handleDragOver = useCallback(
    (event: React.DragEvent, id: string): void => {
      if (draggingId && draggingId !== id) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDragOverId(id)
      }
    },
    [draggingId],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent, id: string): void => {
      event.preventDefault()
      const fromId = event.dataTransfer.getData('text/tab-id') || draggingId
      setDragOverId(null)
      setDraggingId(null)
      if (fromId && fromId !== id) {
        onReorder(fromId, id)
      }
    },
    [draggingId, onReorder],
  )

  const handleDragEnd = useCallback((): void => {
    setDraggingId(null)
    setDragOverId(null)
  }, [])

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
    <div className={`tab-bar ${conversationDropActive ? 'conversation-drop-target' : ''}`}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${activeTabId === tab.id ? 'active' : ''} ${draggingId === tab.id ? 'dragging' : ''} ${dragOverId === tab.id ? 'drop-target' : ''}`}
          draggable
          role="tab"
          tabIndex={activeTabId === tab.id ? 0 : -1}
          aria-selected={activeTabId === tab.id}
          onDragStart={(event) => handleDragStart(event, tab.id)}
          onDragOver={(event) => handleDragOver(event, tab.id)}
          onDrop={(event) => handleDrop(event, tab.id)}
          onDragEnd={handleDragEnd}
          onClick={() => onActivate(tab.id)}
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
