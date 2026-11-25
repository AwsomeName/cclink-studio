import { useCallback, useEffect, useRef, useState } from 'react'
import { workspaceRefKey } from '../../shared/workspace-ref'
import { useCommandStore, useFsStore, useTabStore, useUIStore, useWorkspaceStore } from './stores'
import { useThemeStore } from './stores/theme-store'
import { ActivityBar } from './components/activity-bar/ActivityBar'
import { Sidebar } from './components/sidebar/Sidebar'
import { Workbench } from './components/workbench/Workbench'
import { AgentPanel } from './components/agent-panel/AgentPanel'
import { AgentWorkspace } from './components/agent-panel/agent-workspace'
import { StatusBar } from './components/status-bar/StatusBar'
import { ResizeHandle, type PanelResizeEnd } from './components/common/ResizeHandle'
import { useToastStore } from './components/common/Toast'
import {
  IconNewConversation,
  IconList,
  IconPlus,
  IconSettings,
  IconPanelLeft,
  IconPanelRight,
} from './components/common/Icons'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { PanelErrorFallback } from './components/common/ErrorFallback'
import { CommandPalette } from './components/command-palette/CommandPalette'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from './features/context-actions/context-menu-trigger'
import { ContextMenuHost } from './features/context-actions/ContextMenuHost'
import { useContextMenuStore } from './features/context-actions/context-menu-store'
import { useRegisterContextActions } from './features/context-actions/use-register-context-actions'
import { useConversationSelectionMenu } from './features/context-actions/use-conversation-selection-menu'
import LoadingScreen from './components/loading/LoadingScreen'
import { useAgentWorkContext } from './bootstrap/use-agent-work-context'
import { useAgentStreamEvents } from './bootstrap/use-agent-stream-events'
import { useAgentConversationRestore } from './bootstrap/use-agent-conversation-restore'
import { useRemoteConversationRestore } from './bootstrap/use-remote-conversation-restore'
import { useAppSession } from './bootstrap/use-app-session'
import { useShortcutRouter } from './features/shortcuts/use-shortcut-router'
import { ShortcutHelp } from './features/shortcuts/ShortcutHelp'
import { useMainProcessEvents } from './bootstrap/use-main-process-events'
import { useEditorAgentRequests } from './bootstrap/use-editor-agent-requests'
import { useRegisterCommands } from './bootstrap/use-register-commands'
import { useTerminalEvents } from './bootstrap/use-terminal-events'
import { useWorkspaceBootstrap } from './bootstrap/use-workspace-bootstrap'
import { useWorkspaceStateFlush } from './bootstrap/use-workspace-state-flush'
import { useBrowserViewLifecycle } from './components/workbench/use-browser-view-lifecycle'
import { useBrowserOpenRequests } from './bootstrap/use-browser-open-requests'
import { useAgentWebResourceLaunchRequests } from './bootstrap/use-agent-web-resource-launch-requests'
import { useComponentSetupOnboarding } from './bootstrap/use-component-setup-onboarding'
import { OwnerEntry, OwnerPanel } from './features/owner/owner-panel'
import { ProjectStrip } from './components/project-strip/ProjectStrip'
import { useAnyFloatingSurfaceOpen } from './components/common/floating-surface-registry'
import { clampPanelWidth } from './utils/panel-layout'
import { usePanelLayout } from './utils/use-panel-layout'
import { cancelActivePanelResize } from './utils/panel-layout-drag-lifecycle'
import { useBrowserFindBridge } from './features/browser/use-browser-find-bridge'
import { WorkspaceOpenSurface } from './features/workspace-open/WorkspaceOpenSurface'
import { useWorkspaceOpenStore } from './features/workspace-open/workspace-open-store'
import { useWorkbenchWindowEvents } from './bootstrap/use-workbench-window-events'
import { AuxiliaryBrowserLayout } from './components/workbench/AuxiliaryBrowserLayout'
import { startMarkdownAutosave } from './features/markdown/markdown-autosave'
import './features/workspace-open/diary-files.css'
import { EditorDraftFailureBanner } from './features/markdown/EditorPersistenceStatus'

/** 主布局。 */
function MainLayout(): React.ReactElement {
  const [ownerOpen, setOwnerOpen] = useState(false)
  const workspaceReady = useWorkspaceBootstrap()
  useComponentSetupOnboarding(workspaceReady)
  useWorkspaceStateFlush()
  const activePanel = useUIStore((s) => s.activePanel)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const agentPanelMode = useUIStore((s) => s.agentPanelMode)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const agentPanelWidth = useUIStore((s) => s.agentPanelWidth)
  const agentContentMode = useUIStore((s) => s.agentContentMode)
  const agentListWidth = useUIStore((s) => s.agentListWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const setAgentPanelWidth = useUIStore((s) => s.setAgentPanelWidth)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const workspaceLoading = useFsStore((s) => s.loading)
  const workspacePicking = useFsStore((s) => s.picking)
  const workspaceError = useFsStore((s) => s.error)
  // The relocation dialog explains a moved personal folder; skip the raw path error behind it.
  const executeCommand = useCommandStore((s) => s.executeCommand)
  const workspaceOpen = useWorkspaceOpenStore((s) => s.open)
  const closeWorkspaceOpen = useWorkspaceOpenStore((s) => s.close)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const sidebarContentVisible = sidebarVisible
  const diaryWorkspaceType = useWorkspaceStore((s) => s.settingsSnapshot?.settings.type)
  const showNavigation = activePanel === 'workspace-home' || activePanel === 'company-workspace'
  const inlineDiaryFiles = activePanel === 'files' && diaryWorkspaceType === 'diary'
  useEffect(() => {
    if (workspaceReady) return startMarkdownAutosave()
  }, [workspaceReady, activeWorkspaceRef])
  const contextMenuOpen = useContextMenuStore((s) => s.open)
  const [panelResizing, setPanelResizing] = useState(false)
  const [resizePreview, setResizePreview] = useState<{
    area: 'sidebar' | 'agent'
    target: number
    effectiveWidth: number
  } | null>(null)
  const resizeStartRef = useRef<{
    area: 'sidebar' | 'agent'
    effective: number
    saved: number
    bounds: { min: number; max: number }
    viewport: { width: number; height: number; dpr: number }
    budget: Pick<
      ReturnType<typeof useUIStore.getState>,
      | 'sidebarVisible'
      | 'agentPanelMode'
      | 'sidebarWidth'
      | 'agentPanelWidth'
      | 'agentContentMode'
      | 'agentListWidth'
    >
  } | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const floatingSurfaceOpen = useAnyFloatingSurfaceOpen()
  const workspaceOpenButtonRef = useRef<HTMLButtonElement>(null)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const agentInCenter = agentPanelMode === 'center'
  const agentInRight = agentPanelMode === 'right'
  const agentPanelVisible = agentPanelMode !== 'hidden'
  const listVisible = agentInRight && agentContentMode === 'list'
  function revealChatLayout(): void {
    const { tabs, activeTabId, setTabLayout } = useTabStore.getState()
    if (activeTabId && tabs.find((tab) => tab.id === activeTabId)?.workbenchLayout === 'focus')
      setTabLayout(activeTabId, 'standard')
  }
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const panelLayout = usePanelLayout(
    workspaceRefKey(activeWorkspaceRef),
    {
      viewportWidth,
      sidebarVisible,
      sidebarContentVisible,
      sidebarWidth,
      agentPanelWidth,
      agentInRight,
    },
    resizePreview,
  )

  // 订阅主题变化，触发 theme-store 初始化并应用 data-theme。
  useThemeStore((s) => s.resolvedTheme)

  useEffect(() => {
    const handleResize = (): void => {
      cancelActivePanelResize()
      setViewportWidth(window.innerWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(
    () =>
      useUIStore.subscribe((state, previous) => {
        // 同步取消，避免 React 重绘前或预算切回原值后继续提交旧手势。
        if (
          resizeStartRef.current &&
          (state.sidebarVisible !== previous.sidebarVisible ||
            state.activePanel !== previous.activePanel ||
            state.agentPanelMode !== previous.agentPanelMode ||
            state.sidebarWidth !== previous.sidebarWidth ||
            state.agentPanelWidth !== previous.agentPanelWidth ||
            state.agentContentMode !== previous.agentContentMode ||
            state.agentListWidth !== previous.agentListWidth)
        ) {
          cancelActivePanelResize()
        }
      }),
    [],
  )

  useRegisterCommands()
  const workbenchWindowReady = useWorkbenchWindowEvents()
  useRegisterContextActions()
  useConversationSelectionMenu()
  const shortcutHelp = useShortcutRouter()
  const inlineShortcutHelp = activeTab?.type === 'browser' && !agentInCenter
  useBrowserFindBridge()
  useMainProcessEvents()
  useEditorAgentRequests()
  useAgentStreamEvents()
  useAgentConversationRestore(workspaceReady)
  useRemoteConversationRestore(workspaceReady)
  useTerminalEvents()
  useAgentWorkContext(workspaceReady)
  useBrowserOpenRequests(workspaceReady)
  useAgentWebResourceLaunchRequests(workspaceReady)
  useBrowserViewLifecycle(
    agentInCenter || floatingSurfaceOpen || panelResizing || contextMenuOpen
      ? undefined
      : activeTab,
    tabs,
    activeWorkspaceRef,
    workspaceReady && workbenchWindowReady,
  )

  const beginPanelResize = (area: 'sidebar' | 'agent'): void => {
    resizeStartRef.current = {
      area,
      effective: area === 'sidebar' ? panelLayout.sidebarWidth : panelLayout.agentPanelWidth,
      saved: area === 'sidebar' ? sidebarWidth : agentPanelWidth,
      bounds: area === 'sidebar' ? panelLayout.sidebarBounds : panelLayout.agentBounds,
      viewport: { width: viewportWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      budget: {
        sidebarVisible,
        agentPanelMode,
        sidebarWidth,
        agentPanelWidth,
        agentContentMode,
        agentListWidth,
      },
    }
    setPanelResizing(true)
  }
  const previewPanelResize = useCallback((delta: number): void => {
    const start = resizeStartRef.current
    if (!start) return
    const candidate = clampPanelWidth(start.effective + delta, start.bounds)
    setResizePreview({
      area: start.area,
      target: candidate === start.effective ? start.saved : candidate,
      effectiveWidth: candidate,
    })
  }, [])
  const finishPanelResize = useCallback(
    ({ reason, delta }: PanelResizeEnd): void => {
      const start = resizeStartRef.current
      resizeStartRef.current = null
      setResizePreview(null)
      setPanelResizing(false)
      const current = useUIStore.getState()
      if (
        !start ||
        reason !== 'commit' ||
        start.viewport.width !== window.innerWidth ||
        start.viewport.height !== window.innerHeight ||
        start.viewport.dpr !== window.devicePixelRatio ||
        start.budget.sidebarVisible !== current.sidebarVisible ||
        start.budget.agentPanelMode !== current.agentPanelMode ||
        start.budget.sidebarWidth !== current.sidebarWidth ||
        start.budget.agentPanelWidth !== current.agentPanelWidth ||
        start.budget.agentContentMode !== current.agentContentMode ||
        start.budget.agentListWidth !== current.agentListWidth
      )
        return
      const candidate = clampPanelWidth(start.effective + delta, start.bounds)
      if (candidate === start.effective) return
      if (start.area === 'sidebar') setSidebarWidth(candidate)
      else setAgentPanelWidth(candidate)
    },
    [setSidebarWidth, setAgentPanelWidth],
  )

  if (!workspaceReady || !workbenchWindowReady) {
    return <LoadingScreen />
  }

  return (
    <div className="main-window">
      <div
        className="app-topbar"
        onClickCapture={(e) => {
          if (
            ownerOpen &&
            e.target instanceof Element &&
            e.target.closest('button') &&
            !e.target.closest('[aria-controls="owner-board"]')
          )
            setOwnerOpen(false)
        }}
      >
        <div className="app-topbar-left">
          <button
            className={`app-topbar-icon ${sidebarVisible ? 'active' : ''}`}
            onClick={toggleSidebar}
            title={sidebarVisible ? '收起左侧栏' : '展开左侧栏'}
            aria-label={sidebarVisible ? '收起左侧导航与内容栏' : '展开左侧导航与内容栏'}
            aria-expanded={sidebarVisible}
            aria-controls="workspace-sidebar"
          >
            <IconPanelLeft size={15} />
          </button>
        </div>
        <ProjectStrip
          openButton={
            <button
              ref={workspaceOpenButtonRef}
              className="app-topbar-open-project"
              type="button"
              onClick={() => {
                if (workspaceOpen) {
                  closeWorkspaceOpen()
                  return
                }
                void executeCommand('workspace.open', { source: 'toolbar' })
              }}
              disabled={workspaceLoading || workspacePicking}
              title="新建或打开项目"
              aria-label="新建或打开项目"
              aria-expanded={workspaceOpen}
            >
              <IconPlus size={14} />
              <span>新建／打开</span>
            </button>
          }
        />
        <div className="app-topbar-right">
          <button
            className="app-topbar-open-project"
            title="Studio 设置"
            aria-label="Studio 设置"
            onContextMenu={(event) => {
              event.preventDefault()
              useContextMenuStore.getState().show({
                target: { kind: 'activity', activityId: 'settings' },
                x: event.clientX,
                y: event.clientY,
                focusReturn: event.currentTarget,
              })
            }}
            onKeyDown={(event) => {
              if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
              event.preventDefault()
              useContextMenuStore
                .getState()
                .show(
                  buildKeyboardContextMenuInput(
                    { kind: 'activity', activityId: 'settings' },
                    event.currentTarget,
                  ),
                )
            }}
            onClick={() => void executeCommand('settings.open', { source: 'toolbar' })}
          >
            <IconSettings size={15} />
            <span>Studio 设置</span>
          </button>
          <OwnerEntry open={ownerOpen} toggle={() => setOwnerOpen((v) => !v)} />
          <div className="app-topbar-agent-actions" role="group" aria-label="会话操作">
            <button
              type="button"
              className="app-topbar-icon"
              title="新建会话"
              aria-label="新建会话"
              onClick={async () => {
                revealChatLayout()
                const result = await executeCommand('agent.newConversation', {
                  source: 'toolbar',
                  target: {
                    kind: 'layout',
                    workspaceKey: workspaceRefKey(activeWorkspaceRef),
                    area: 'agent',
                  },
                })
                if (!result.ok)
                  useToastStore.getState().show(result.message ?? '新建会话失败', 'error')
              }}
            >
              <IconNewConversation size={16} />
            </button>
            <button
              type="button"
              className="app-topbar-icon app-topbar-conversation-list"
              aria-pressed={listVisible}
              title={listVisible ? '返回会话' : '会话列表'}
              onClick={() => {
                revealChatLayout()
                if (listVisible) useUIStore.getState().showAgentChat()
                else useUIStore.getState().showAgentSessions()
              }}
            >
              <IconList size={16} />
            </button>
            <button
              className={`app-topbar-icon ${agentPanelVisible ? 'active' : ''}`}
              aria-pressed={agentPanelVisible}
              onClick={() =>
                void executeCommand('workbench.toggleAgentPanel', { source: 'toolbar' })
              }
              title={agentPanelVisible ? '收起 Agent 面板' : '展开 Agent 面板'}
            >
              <IconPanelRight size={15} />
            </button>
          </div>
        </div>
      </div>

      <EditorDraftFailureBanner />
      {workspaceError && activeWorkspaceRef.kind === 'global' && (
        <div className="workspace-recovery-notice" role="alert">
          <span>{workspaceError}</span>
          <button
            type="button"
            onClick={() => void executeCommand('workspace.open', { source: 'toolbar' })}
          >
            定位或选择工作空间
          </button>
          <button type="button" onClick={() => useFsStore.setState({ error: null })}>
            关闭提示
          </button>
        </div>
      )}
      <OwnerPanel open={ownerOpen} close={() => setOwnerOpen(false)} />
      <div className="main-area" style={ownerOpen ? { display: 'none' } : undefined}>
        <div
          id="workspace-sidebar"
          className={`workspace-sidebar-shell ${sidebarContentVisible ? '' : 'collapsed'}`}
          inert={!sidebarContentVisible}
          style={{
            display: 'flex',
            overflow: 'hidden',
            transition: 'width 200ms ease-out, opacity 200ms ease-out',
            width: panelLayout.sidebarWidth,
            minWidth: panelLayout.sidebarWidth,
            opacity: sidebarContentVisible ? 1 : 0,
          }}
        >
          <ErrorBoundary
            fallback={(e, retry) => <PanelErrorFallback error={e} retry={retry} title="侧栏" />}
          >
            {showNavigation ? (
              <ActivityBar />
            ) : inlineDiaryFiles ? (
              // My Space: navigation stays; the file tree opens below it (file-view.md).
              <div className="diary-inline-files">
                <ActivityBar />
                <div className="diary-inline-files-body">
                  <Sidebar />
                </div>
              </div>
            ) : (
              <>
                <button
                  className="sidebar-back"
                  onClick={() => useUIStore.getState().showPanel('workspace-home')}
                >
                  ‹　项目导航
                </button>
                <Sidebar />
              </>
            )}
          </ErrorBoundary>
        </div>

        {sidebarContentVisible && (
          <ResizeHandle
            area="sidebar"
            side="left"
            onResize={previewPanelResize}
            onResizeStart={() => beginPanelResize('sidebar')}
            onResizeEnd={finishPanelResize}
          />
        )}

        {agentInCenter ? (
          <div className="agent-panel-center-shell">
            <ErrorBoundary
              fallback={(e, retry) => (
                <PanelErrorFallback error={e} retry={retry} title="Agent 面板" />
              )}
            >
              <AgentPanel variant="center" />
            </ErrorBoundary>
          </div>
        ) : (
          <ErrorBoundary
            fallback={(e, retry) => <PanelErrorFallback error={e} retry={retry} title="主区域" />}
          >
            <Workbench shortcutHelp={inlineShortcutHelp ? shortcutHelp : null} />
          </ErrorBoundary>
        )}

        {agentInRight && (
          <ResizeHandle
            area="agent"
            side="right"
            onResize={previewPanelResize}
            onResizeStart={() => beginPanelResize('agent')}
            onResizeEnd={finishPanelResize}
          />
        )}

        <div
          className={`agent-side-shell ${agentInRight ? '' : 'collapsed'}`}
          inert={!agentInRight}
          style={{
            display: 'flex',
            overflow: 'hidden',
            transition: 'opacity 200ms ease-out',
            width: panelLayout.agentPanelWidth,
            minWidth: panelLayout.agentPanelWidth,
            opacity: agentInRight ? 1 : 0,
          }}
        >
          {agentInRight && (
            <ErrorBoundary
              fallback={(e, retry) => (
                <PanelErrorFallback error={e} retry={retry} title="Agent 面板" />
              )}
            >
              <AgentWorkspace />
            </ErrorBoundary>
          )}
        </div>
      </div>

      <StatusBar />
      <CommandPalette />
      <ShortcutHelp context={inlineShortcutHelp ? null : shortcutHelp} />
      <ContextMenuHost />
      <WorkspaceOpenSurface anchorRef={workspaceOpenButtonRef} />
    </div>
  )
}

/** 根组件：开源壳只要求桌面 preload 可用，不要求 CCLink 登录态。 */
function MainApp(): React.ReactElement {
  const cclinkStudioApiAvailable =
    typeof window !== 'undefined' &&
    Boolean(window.cclinkStudio?.identity && window.cclinkStudio?.settings)

  const appSessionReady = useAppSession(cclinkStudioApiAvailable)

  if (!cclinkStudioApiAvailable) {
    return (
      <div className="runtime-unavailable">
        <div className="runtime-unavailable-card">
          <h1>CCLink Studio 需要在桌面运行时中打开</h1>
          <p>
            当前页面缺少 Electron preload API。请通过 CCLink Studio 桌面应用或 `pnpm dev` 启动的
            Electron 窗口访问。
          </p>
        </div>
      </div>
    )
  }

  if (!appSessionReady) {
    return <LoadingScreen />
  }

  return <MainLayout />
}

function App(): React.ReactElement {
  if (typeof window !== 'undefined' && window.cclinkAuxiliary) {
    return <AuxiliaryBrowserLayout api={window.cclinkAuxiliary} />
  }
  return <MainApp />
}

export default App
