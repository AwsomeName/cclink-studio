import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useAgentStore, useBrowserStore, useTabStore, useWorkspaceStore } from '../../stores'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import { workspaceRefKey } from '@shared/workspace-ref'
import { AndroidToolbar } from './AndroidToolbar'
import { BrowserToolbar } from './BrowserToolbar'
import { TabBar } from './TabBar'
import { WorkbenchContent } from './WorkbenchContent'
import { useBrowserEvents } from './use-browser-events'
import { useEditorContentUpdates } from './use-editor-content-updates'
import { useWorkbenchBounds } from './use-workbench-bounds'
import { closeTabWithDraftPolicy } from '../../utils/close-tab'
import { recordTerminalLifecycleEvent } from '../../utils/terminal-lifecycle'
import { buildTerminalTabDraft } from '../../utils/terminal-tab'
import { useCommandStore } from '../../stores/command-store'
import { useToastStore } from '../common/Toast'
import {
  hasConversationDragData,
  readConversationDragData,
} from '../../features/agent-conversations/conversation-workbench'

interface WorkbenchProps {
  tabCreateMenuOpen: boolean
  onTabCreateMenuOpenChange: (open: boolean) => void
}

export function Workbench({
  tabCreateMenuOpen,
  onTabCreateMenuOpenChange,
}: WorkbenchProps): React.ReactElement {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activateTab = useTabStore((s) => s.activateTab)
  const reorderTabs = useTabStore((s) => s.reorderTabs)
  const openTab = useTabStore((s) => s.openTab)
  const createConversation = useAgentStore((s) => s.createConversation)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const showContextMenu = useContextMenuStore((s) => s.show)
  const executeCommand = useCommandStore((s) => s.executeCommand)
  const showToast = useToastStore((s) => s.show)
  const browserTabs = useBrowserStore((s) => s.tabs)
  const setBrowserUrlInput = useBrowserStore((s) => s.setUrlInput)
  const contentRef = useRef<HTMLDivElement>(null)
  const [conversationDropActive, setConversationDropActive] = useState(false)

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const isBrowserTab = activeTab?.type === 'browser'
  const isAndroidTab = activeTab?.type === 'android'
  const activeBrowserState = activeTabId ? browserTabs[activeTabId] : undefined

  useWorkbenchBounds(contentRef)
  useBrowserEvents()
  useEditorContentUpdates()

  useEffect(() => {
    const clearConversationDrop = (): void => setConversationDropActive(false)
    window.addEventListener('dragend', clearConversationDrop)
    window.addEventListener('drop', clearConversationDrop)
    return () => {
      window.removeEventListener('dragend', clearConversationDrop)
      window.removeEventListener('drop', clearConversationDrop)
    }
  }, [])

  const handleConversationDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!hasConversationDragData(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setConversationDropActive(true)
  }, [])

  const handleConversationDragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return
    setConversationDropActive(false)
  }, [])

  const handleConversationDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>): Promise<void> => {
      if (!hasConversationDragData(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      setConversationDropActive(false)
      const conversationId = readConversationDragData(event.dataTransfer)
      const conversation = conversationId
        ? useAgentStore.getState().conversations[conversationId]
        : null
      if (!conversationId || !conversation) {
        showToast('会话已不存在', 'error')
        return
      }
      const result = await executeCommand('agent.openConversationInWorkbench', {
        source: 'toolbar',
        target: {
          kind: 'thread',
          workspaceKey: conversation.runtime.workspaceRef
            ? workspaceRefKey(conversation.runtime.workspaceRef)
            : null,
          conversationId,
          activeRunId: conversation.activeRunId,
        },
      })
      if (!result.ok) showToast(result.message ?? '无法在中间 Tab 打开会话', 'error')
    },
    [executeCommand, showToast],
  )

  const handleNavigate = useCallback((): void => {
    if (!activeTabId) return
    let url = (activeBrowserState?.urlInput ?? '').trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }
    window.cclinkStudio.browser.navigate(activeTabId, url)
  }, [activeTabId, activeBrowserState])

  const openNewDocument = useCallback((): void => {
    openTab({ type: 'editor', title: '未命名.md', icon: '📄', forceNew: true })
  }, [openTab])

  const openNewBrowser = useCallback((): void => {
    openTab({ type: 'browser', title: '浏览器', icon: '🌐', forceNew: true })
  }, [openTab])

  const openNewConversation = useCallback((): void => {
    const conversationId = createConversation({
      surface: 'workbench-tab',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: activeWorkspaceRef,
      },
      activate: false,
    })
    openTab({
      type: 'conversation',
      title: '新工作会话',
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: activeWorkspaceRef,
        },
        sessionId: conversationId,
      },
    })
  }, [activeWorkspaceRef, createConversation, openTab])

  const openNewTerminal = useCallback((): void => {
    const draft = buildTerminalTabDraft(activeWorkspaceRef)
    openTab(draft)
    void recordTerminalLifecycleEvent(draft.terminal, 'created', 'Terminal Tab 已创建')
  }, [activeWorkspaceRef, openTab])

  const handleCloseTab = useCallback((tabId: string): void => {
    void closeTabWithDraftPolicy(tabId)
  }, [])

  const handleShowTabMenu = useCallback(
    async (tabId: string, x: number, y: number, focusReturn: HTMLElement): Promise<void> => {
      let browserPreviewDataUrl: string | null = null
      if (activeTabId && isBrowserTab) {
        try {
          browserPreviewDataUrl = await window.cclinkStudio.browser.capturePage(activeTabId)
        } catch (error) {
          console.warn('[Workbench] 浏览器右键菜单快照失败:', error)
        }
      }
      const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
      if (!tab) return
      showContextMenu({
        target: {
          kind: 'tab',
          workspaceKey: workspaceRefKey(tab.workspaceRef ?? activeWorkspaceRef),
          tabId,
          tabType: tab.type,
        },
        x,
        y,
        focusReturn,
        browserPreviewDataUrl,
      })
    },
    [activeTabId, activeWorkspaceRef, isBrowserTab, showContextMenu],
  )

  const openBrowserUrl = useCallback(
    (url: string): void => {
      if (activeTabId && isBrowserTab) {
        window.cclinkStudio.browser.navigate(activeTabId, url)
        return
      }
      openTab({ type: 'browser', title: '浏览器', icon: '🌐', initialUrl: url, forceNew: true })
    },
    [activeTabId, isBrowserTab, openTab],
  )

  return (
    <div
      className="workbench"
      onDragOver={handleConversationDragOver}
      onDragLeave={handleConversationDragLeave}
      onDrop={(event) => void handleConversationDrop(event)}
    >
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={handleCloseTab}
        onReorder={reorderTabs}
        onNewDocument={openNewDocument}
        onNewBrowser={openNewBrowser}
        onNewConversation={openNewConversation}
        onNewTerminal={openNewTerminal}
        onShowMenu={(tabId, x, y, focusReturn) => void handleShowTabMenu(tabId, x, y, focusReturn)}
        createMenuOpen={tabCreateMenuOpen}
        onCreateMenuOpenChange={onTabCreateMenuOpenChange}
        conversationDropActive={conversationDropActive}
      />

      {isBrowserTab && activeTabId && (
        <BrowserToolbar
          tabId={activeTabId}
          tab={activeTab}
          browserState={activeBrowserState}
          onUrlInputChange={setBrowserUrlInput}
          onNavigate={handleNavigate}
          onOpenUrl={openBrowserUrl}
        />
      )}

      {isAndroidTab && <AndroidToolbar />}

      <WorkbenchContent activeTab={activeTab} isBrowserTab={isBrowserTab} contentRef={contentRef} />
    </div>
  )
}
