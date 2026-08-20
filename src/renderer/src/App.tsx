import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCommandStore, useFsStore, useTabStore, useUIStore, useWorkspaceStore } from './stores'
import { useThemeStore } from './stores/theme-store'
import { ActivityBar } from './components/activity-bar/ActivityBar'
import { Sidebar } from './components/sidebar/Sidebar'
import { Workbench } from './components/workbench/Workbench'
import { AgentPanel } from './components/agent-panel/AgentPanel'
import { StatusBar } from './components/status-bar/StatusBar'
import { ResizeHandle } from './components/common/ResizeHandle'
import { IconFolder, IconPanelLeft, IconPanelRight } from './components/common/Icons'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { PanelErrorFallback } from './components/common/ErrorFallback'
import { CommandPalette } from './components/command-palette/CommandPalette'
import { ContextMenuHost } from './features/context-actions/ContextMenuHost'
import { useContextMenuStore } from './features/context-actions/context-menu-store'
import { useRegisterContextActions } from './features/context-actions/use-register-context-actions'
import { useConversationSelectionMenu } from './features/context-actions/use-conversation-selection-menu'
import { Toast } from './components/common/Toast'
import LoadingScreen from './components/loading/LoadingScreen'
import { useAgentWorkContext } from './bootstrap/use-agent-work-context'
import { useAgentStreamEvents } from './bootstrap/use-agent-stream-events'
import { useAgentConversationRestore } from './bootstrap/use-agent-conversation-restore'
import { useAppSession } from './bootstrap/use-app-session'
import { useShortcutRouter } from './features/shortcuts/use-shortcut-router'
import { useMainProcessEvents } from './bootstrap/use-main-process-events'
import { useRegisterCommands } from './bootstrap/use-register-commands'
import { useTerminalEvents } from './bootstrap/use-terminal-events'
import { useWorkspaceBootstrap } from './bootstrap/use-workspace-bootstrap'
import { useWorkspaceStateFlush } from './bootstrap/use-workspace-state-flush'
import { useBrowserViewLifecycle } from './components/workbench/use-browser-view-lifecycle'
import { useBrowserOpenRequests } from './bootstrap/use-browser-open-requests'
import { useComponentSetupOnboarding } from './bootstrap/use-component-setup-onboarding'
import { ProjectStrip } from './components/project-strip/ProjectStrip'
import { ConversationQuickSwitcher } from './components/topbar/ConversationQuickSwitcher'
import { useAnyFloatingSurfaceOpen } from './components/common/floating-surface-registry'
import { clampPanelWidth, getAgentPanelWidthBounds } from './utils/panel-layout'
import { useBrowserFindBridge } from './features/browser/use-browser-find-bridge'
import { WorkspaceOpenSurface } from './features/workspace-open/WorkspaceOpenSurface'
import { useWorkspaceOpenStore } from './features/workspace-open/workspace-open-store'
import { useWorkbenchWindowEvents } from './bootstrap/use-workbench-window-events'
import { AuxiliaryBrowserLayout } from './components/workbench/AuxiliaryBrowserLayout'

/** 主布局。 */
function MainLayout(): React.ReactElement {
  const workspaceReady = useWorkspaceBootstrap()
  useComponentSetupOnboarding(workspaceReady)
  useWorkspaceStateFlush()
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const agentPanelMode = useUIStore((s) => s.agentPanelMode)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const agentPanelWidth = useUIStore((s) => s.agentPanelWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const setAgentPanelWidth = useUIStore((s) => s.setAgentPanelWidth)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleAgentPanel = useUIStore((s) => s.toggleAgentPanel)
  const workspaceLoading = useFsStore((s) => s.loading)
  const workspacePicking = useFsStore((s) => s.picking)
  const executeCommand = useCommandStore((s) => s.executeCommand)
  const workspaceOpen = useWorkspaceOpenStore((s) => s.open)
  const closeWorkspaceOpen = useWorkspaceOpenStore((s) => s.close)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const contextMenuOpen = useContextMenuStore((s) => s.open)
  const [tabCreateMenuOpen, setTabCreateMenuOpen] = useState(false)
  const [panelResizing, setPanelResizing] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const floatingSurfaceOpen = useAnyFloatingSurfaceOpen()
  const workspaceOpenButtonRef = useRef<HTMLButtonElement>(null)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const agentInCenter = agentPanelMode === 'center'
  const agentInRight = agentPanelMode === 'right'
  const agentPanelVisible = agentPanelMode !== 'hidden'
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const agentPanelWidthBounds = useMemo(
    () => getAgentPanelWidthBounds({ viewportWidth, sidebarVisible, sidebarWidth }),
    [sidebarVisible, sidebarWidth, viewportWidth],
  )
  const effectiveAgentPanelWidth = clampPanelWidth(agentPanelWidth, agentPanelWidthBounds)

  // 订阅主题变化，触发 theme-store 初始化并应用 data-theme。
  useThemeStore((s) => s.resolvedTheme)

  useEffect(() => {
    const handleResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useRegisterCommands()
  useWorkbenchWindowEvents()
  useRegisterContextActions()
  useConversationSelectionMenu()
  useShortcutRouter()
  useBrowserFindBridge()
  useMainProcessEvents()
  useAgentStreamEvents()
  useAgentConversationRestore(workspaceReady)
  useTerminalEvents()
  useAgentWorkContext(workspaceReady)
  useBrowserOpenRequests(workspaceReady)
  useBrowserViewLifecycle(
    agentInCenter || floatingSurfaceOpen || panelResizing || contextMenuOpen || tabCreateMenuOpen
      ? undefined
      : activeTab,
    tabs,
    activeWorkspaceRef,
    workspaceReady,
  )

  const handleSidebarResize = useCallback(
    (delta: number) => {
      setSidebarWidth(Math.max(160, Math.min(500, sidebarWidth + delta)))
    },
    [sidebarWidth, setSidebarWidth],
  )

  const handleAgentResize = useCallback(
    (delta: number) => {
      setAgentPanelWidth(clampPanelWidth(effectiveAgentPanelWidth + delta, agentPanelWidthBounds))
    },
    [agentPanelWidthBounds, effectiveAgentPanelWidth, setAgentPanelWidth],
  )

  const toggleUnifiedAgentPanel = useCallback(() => {
    // 顶栏按钮只负责展开/收起右侧面板；center 仅由无 Tab 的系统落地页使用。
    toggleAgentPanel('right')
  }, [toggleAgentPanel])

  if (!workspaceReady) {
    return <LoadingScreen />
  }

  return (
    <div className="main-window">
      <div className="app-topbar">
        <div className="app-topbar-left">
          <button
            className={`app-topbar-icon ${sidebarVisible ? 'active' : ''}`}
            onClick={toggleSidebar}
            title={sidebarVisible ? '收起左侧栏' : '展开左侧栏'}
          >
            <IconPanelLeft size={15} />
          </button>
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
            title="打开工作空间"
            aria-expanded={workspaceOpen}
          >
            <IconFolder size={14} />
            <span>打开工作空间</span>
          </button>
        </div>
        <ProjectStrip />
        <div
          className="app-topbar-right"
          style={agentInRight ? { width: effectiveAgentPanelWidth } : undefined}
        >
          <ConversationQuickSwitcher
            panelMode={agentPanelMode}
            panelWidth={effectiveAgentPanelWidth}
          />
          <button
            className={`app-topbar-icon ${agentPanelVisible ? 'active' : ''}`}
            onClick={toggleUnifiedAgentPanel}
            title={agentPanelVisible ? '收起 Agent 面板' : '展开 Agent 面板'}
          >
            <IconPanelRight size={15} />
          </button>
        </div>
      </div>

      <div className="main-area">
        <ActivityBar />

        <div
          className={`workspace-sidebar-shell ${sidebarVisible ? '' : 'collapsed'}`}
          style={{
            display: 'flex',
            overflow: 'hidden',
            transition: 'width 200ms ease-out, opacity 200ms ease-out',
            width: sidebarVisible ? sidebarWidth : 0,
            minWidth: sidebarVisible ? sidebarWidth : 0,
            opacity: sidebarVisible ? 1 : 0,
          }}
        >
          <ErrorBoundary
            fallback={(e, retry) => <PanelErrorFallback error={e} retry={retry} title="侧栏" />}
          >
            <Sidebar />
          </ErrorBoundary>
        </div>

        {sidebarVisible && (
          <ResizeHandle
            area="sidebar"
            side="left"
            onResize={handleSidebarResize}
            onResizeStart={() => setPanelResizing(true)}
            onResizeEnd={() => setPanelResizing(false)}
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
            <Workbench
              tabCreateMenuOpen={tabCreateMenuOpen}
              onTabCreateMenuOpenChange={setTabCreateMenuOpen}
            />
          </ErrorBoundary>
        )}

        {agentInRight && (
          <ResizeHandle
            area="agent"
            side="right"
            onResize={handleAgentResize}
            onResizeStart={() => setPanelResizing(true)}
            onResizeEnd={() => setPanelResizing(false)}
          />
        )}

        <div
          className={`agent-side-shell ${agentInRight ? '' : 'collapsed'}`}
          style={{
            display: 'flex',
            overflow: 'hidden',
            transition: 'width 200ms ease-out, opacity 200ms ease-out',
            width: agentInRight ? effectiveAgentPanelWidth : 0,
            minWidth: agentInRight ? effectiveAgentPanelWidth : 0,
            opacity: agentInRight ? 1 : 0,
          }}
        >
          {agentInRight && (
            <ErrorBoundary
              fallback={(e, retry) => (
                <PanelErrorFallback error={e} retry={retry} title="Agent 面板" />
              )}
            >
              <AgentPanel variant="side" />
            </ErrorBoundary>
          )}
        </div>
      </div>

      <StatusBar />
      <CommandPalette />
      <ContextMenuHost />
      <WorkspaceOpenSurface anchorRef={workspaceOpenButtonRef} />
      <Toast />
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
