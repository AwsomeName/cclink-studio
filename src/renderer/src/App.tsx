import { useCallback } from 'react'
import { useUIStore } from './stores'
import { useThemeStore } from './stores/theme-store'
import { useAuthStore } from './stores/auth-store'
import { ActivityBar } from './components/activity-bar/ActivityBar'
import { Sidebar } from './components/sidebar/Sidebar'
import { Workbench } from './components/workbench/Workbench'
import { AgentPanel } from './components/agent-panel/AgentPanel'
import { StatusBar } from './components/status-bar/StatusBar'
import { ResizeHandle } from './components/common/ResizeHandle'
import {
  IconArrowLeft,
  IconArrowRight,
  IconPanelLeft,
  IconPanelRight,
} from './components/common/Icons'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { PanelErrorFallback } from './components/common/ErrorFallback'
import { CommandPalette } from './components/command-palette/CommandPalette'
import { ContextMenu } from './components/common/ContextMenu'
import { TabContextMenu } from './components/common/TabContextMenu'
import { Toast } from './components/common/Toast'
import LoadingScreen from './components/loading/LoadingScreen'
import { useAgentWorkContext } from './bootstrap/use-agent-work-context'
import { useAgentStreamEvents } from './bootstrap/use-agent-stream-events'
import { useAppSession } from './bootstrap/use-app-session'
import { useGlobalShortcuts } from './bootstrap/use-global-shortcuts'
import { useMainProcessEvents } from './bootstrap/use-main-process-events'
import { useRegisterCommands } from './bootstrap/use-register-commands'
import { useTerminalEvents } from './bootstrap/use-terminal-events'
import { useWorkspaceBootstrap } from './bootstrap/use-workspace-bootstrap'

/** 主布局（已登录后显示） */
function MainLayout(): React.ReactElement {
  const workspaceReady = useWorkspaceBootstrap()
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const agentPanelMode = useUIStore((s) => s.agentPanelMode)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const agentPanelWidth = useUIStore((s) => s.agentPanelWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const setAgentPanelWidth = useUIStore((s) => s.setAgentPanelWidth)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setAgentPanelMode = useUIStore((s) => s.setAgentPanelMode)
  const agentInCenter = agentPanelMode === 'center'
  const agentInRight = agentPanelMode === 'right'

  // 订阅主题变化，触发 theme-store 初始化并应用 data-theme。
  useThemeStore((s) => s.resolvedTheme)

  useRegisterCommands()
  useGlobalShortcuts()
  useMainProcessEvents()
  useAgentStreamEvents()
  useTerminalEvents()
  useAgentWorkContext()

  const handleSidebarResize = useCallback(
    (delta: number) => {
      setSidebarWidth(Math.max(160, Math.min(500, sidebarWidth + delta)))
    },
    [sidebarWidth, setSidebarWidth],
  )

  const handleAgentResize = useCallback(
    (delta: number) => {
      setAgentPanelWidth(Math.max(220, Math.min(600, agentPanelWidth + delta)))
    },
    [agentPanelWidth, setAgentPanelWidth],
  )

  const toggleRightAgentPanel = useCallback(() => {
    setAgentPanelMode(agentInRight ? 'hidden' : 'right', 'user')
  }, [agentInRight, setAgentPanelMode])

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
          <button className="app-topbar-icon muted" disabled title="后退">
            <IconArrowLeft size={14} />
          </button>
          <button className="app-topbar-icon muted" disabled title="前进">
            <IconArrowRight size={14} />
          </button>
          <span className="app-topbar-title">DeepInk</span>
        </div>
        <div className="app-topbar-right">
          <button
            className={`app-topbar-icon ${agentInRight ? 'active' : ''}`}
            onClick={toggleRightAgentPanel}
            title={agentInRight ? '收起右侧 Agent 面板' : '展开右侧 Agent 面板'}
          >
            <IconPanelRight size={15} />
          </button>
        </div>
      </div>

      <div className="main-area">
        <ActivityBar />

        <div
          className={sidebarVisible ? '' : 'collapsed'}
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

        {sidebarVisible && <ResizeHandle side="left" onResize={handleSidebarResize} />}

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
            <Workbench />
          </ErrorBoundary>
        )}

        {agentInRight && <ResizeHandle side="right" onResize={handleAgentResize} />}

        <div
          className={`agent-side-shell ${agentInRight ? '' : 'collapsed'}`}
          style={{
            display: 'flex',
            overflow: 'hidden',
            transition: 'width 200ms ease-out, opacity 200ms ease-out',
            width: agentInRight ? agentPanelWidth : 0,
            minWidth: agentInRight ? agentPanelWidth : 0,
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
      <ContextMenu />
      <TabContextMenu />
      <Toast />
    </div>
  )
}

/** 根组件：认证守卫。 */
function App(): React.ReactElement {
  const checking = useAuthStore((s) => s.checking)
  const deepinkApiAvailable =
    typeof window !== 'undefined' && Boolean(window.deepink?.auth && window.deepink?.identity)

  useAppSession(deepinkApiAvailable)

  if (!deepinkApiAvailable) {
    return (
      <div className="runtime-unavailable">
        <div className="runtime-unavailable-card">
          <h1>DeepInk 需要在桌面运行时中打开</h1>
          <p>
            当前页面缺少 Electron preload API。请通过 DeepInk 桌面应用或 `pnpm dev` 启动的 Electron
            窗口访问。
          </p>
        </div>
      </div>
    )
  }

  if (checking) {
    return <LoadingScreen />
  }

  return <MainLayout />
}

export default App
