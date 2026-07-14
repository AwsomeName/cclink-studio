import { useCallback, useEffect, useRef, useState } from 'react'
import type { Tab } from '../../types'
import {
  IconClose,
  IconFile,
  IconGlobe,
  IconPlus,
  IconRobot,
  IconTerminal,
} from '../common/Icons'

const TAB_ICONS: Record<string, string> = {
  browser: '🌐',
  editor: '📄',
  settings: '⚙️',
  preview: '👁️',
  android: '📱',
  model: '🧊',
  conversation: '🤖',
  cclink: '🔗',
  'remote-file': '📄',
  terminal: '⌨️',
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
  onShowMenu: (tabId: string, x: number, y: number) => void
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
}: TabBarProps): React.ReactElement {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
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
        setCreateMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [createMenuOpen])

  const runCreateAction = (action: () => void): void => {
    setCreateMenuOpen(false)
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
    setCreateMenuOpen((open) => !open)
  }

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${activeTabId === tab.id ? 'active' : ''} ${draggingId === tab.id ? 'dragging' : ''} ${dragOverId === tab.id ? 'drop-target' : ''}`}
          draggable
          onDragStart={(event) => handleDragStart(event, tab.id)}
          onDragOver={(event) => handleDragOver(event, tab.id)}
          onDrop={(event) => handleDrop(event, tab.id)}
          onDragEnd={handleDragEnd}
          onClick={() => onActivate(tab.id)}
          onContextMenu={(event) => {
            event.preventDefault()
            onShowMenu(tab.id, event.clientX, event.clientY)
          }}
        >
          <span className="tab-icon">{tab.icon || TAB_ICONS[tab.type]}</span>
          <span className="tab-title">
            {tab.title}
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
                <span>受控命令现场（尚未接 shell）</span>
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
    </div>
  )
}
