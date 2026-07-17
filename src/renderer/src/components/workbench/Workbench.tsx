import { useCallback, useRef } from 'react'
import { useAgentStore, useBrowserStore, useTabStore, useWorkspaceStore } from '../../stores'
import { useTabContextMenuStore } from '../../stores/tab-context-menu-store'
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

export function Workbench(): React.ReactElement {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activateTab = useTabStore((s) => s.activateTab)
  const reorderTabs = useTabStore((s) => s.reorderTabs)
  const openTab = useTabStore((s) => s.openTab)
  const createConversation = useAgentStore((s) => s.createConversation)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const showTabMenu = useTabContextMenuStore((s) => s.show)
  const browserTabs = useBrowserStore((s) => s.tabs)
  const setBrowserUrlInput = useBrowserStore((s) => s.setUrlInput)
  const contentRef = useRef<HTMLDivElement>(null)

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const isBrowserTab = activeTab?.type === 'browser'
  const isAndroidTab = activeTab?.type === 'android'
  const activeBrowserState = activeTabId ? browserTabs[activeTabId] : undefined

  useWorkbenchBounds(contentRef)
  useBrowserEvents()
  useEditorContentUpdates()

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
    <div className="workbench">
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
        onShowMenu={showTabMenu}
      />

      {isBrowserTab && activeTabId && (
        <BrowserToolbar
          tabId={activeTabId}
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
