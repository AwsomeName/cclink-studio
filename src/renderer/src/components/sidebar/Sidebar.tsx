import {
  useUIStore,
  useTabStore,
  useFsStore,
  useBrowserStore,
  useAgentStore,
  useWorkspaceStore,
  useTabContextMenuStore,
} from '../../stores'
import type { TerminalStatus } from '@shared/terminal'
import type { TerminalSessionSnapshot } from '@shared/ipc/terminal'
import type { WorkspaceRef } from '../../../../shared/workspace-ref'
import {
  localWorkspaceRef,
  workspaceRefKey,
  workspaceRefLabel,
} from '../../../../shared/workspace-ref'
import {
  getWorkspaceConversationGroups,
  LocalSessionsList,
} from '../../features/agent-conversations/local-session-sidebar'
import {
  IconFitWidth,
  IconBookmark,
  IconMobile,
  IconMonitor,
  IconProjects,
  IconRefresh,
  IconLink,
  IconPlus,
  IconTerminal,
} from '../common/Icons'
import { BrowserFavicon } from '../common/BrowserFavicon'
import type { ActivityPanel } from '../../types'
import { FileTree } from './FileTree'
import { ProjectOperationsSection } from './ProjectOperationsSection'
import { HardwareProductionSection } from './HardwareProductionSection'
import { DataSourcesPanel } from '../data-sources/DataSourcesPanel'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildTerminalRecordTabDraft,
  buildTerminalTabDraft,
  buildTerminalTabDraftFromSession,
} from '../../utils/terminal-tab'
import { recordTerminalLifecycleEvent } from '../../utils/terminal-lifecycle'
import {
  getBrowserDisplayTitle,
  getBrowserTabsForWorkspace,
  getBrowserUrlLabel,
} from './browser-sidebar-view-model'

function getProjectName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function getWorkspaceTitle(workspaceRef: WorkspaceRef, workspacePath: string | null): string {
  if (workspaceRef.kind === 'global') return '未归档'
  if (workspaceRef.kind === 'local') return getProjectName(workspacePath ?? workspaceRef.path)
  return workspaceRefLabel(workspaceRef)
}

function getSidebarTitle(
  activePanel: ActivityPanel,
  workspaceRef: WorkspaceRef,
  workspacePath: string | null,
): string {
  switch (activePanel) {
    case 'projects':
      return '项目'
    case 'browser':
      return '浏览器'
    case 'data-sources':
      return '数据源'
    case 'production':
      return '生产'
    case 'terminal':
      return 'Terminal'
    case 'operations':
      return '运营'
    case 'sessions':
      return '会话'
    case 'files':
      return getWorkspaceTitle(workspaceRef, workspacePath)
  }
}

export function Sidebar(): React.ReactElement {
  const activePanel = useUIStore((s) => s.activePanel)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const workspacePath = useFsStore((s) => s.workspacePath)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const openTab = useTabStore((s) => s.openTab)
  const sidebarTitle = getSidebarTitle(activePanel, activeWorkspaceRef, workspacePath)

  const openNewTerminal = useCallback((): void => {
    const draft = buildTerminalTabDraft(activeWorkspaceRef)
    openTab(draft)
    void recordTerminalLifecycleEvent(draft.terminal, 'created', 'Terminal Tab 已创建')
  }, [activeWorkspaceRef, openTab])

  return (
    <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      {activePanel !== 'projects' && activePanel !== 'files' && activePanel !== 'sessions' && (
        <div className="sidebar-header">
          <span className="sidebar-header-title" title={workspacePath ?? sidebarTitle}>
            {sidebarTitle}
          </span>
          {activePanel === 'terminal' && (
            <button
              className="sidebar-header-action"
              type="button"
              onClick={openNewTerminal}
              title="新建 Terminal"
              aria-label="新建 Terminal"
            >
              <IconPlus size={14} />
            </button>
          )}
        </div>
      )}

      <div className="sidebar-content">
        <ProjectSidebarContent activePanel={activePanel} />
      </div>
    </div>
  )
}

function ProjectSidebarContent({
  activePanel,
}: {
  activePanel: ActivityPanel
}): React.ReactElement {
  const workspacePath = useFsStore((s) => s.workspacePath)
  const openWorkspacePicker = useFsStore((s) => s.openWorkspacePicker)
  const openRecentWorkspace = useFsStore((s) => s.openRecentWorkspace)
  const closeWorkspace = useFsStore((s) => s.closeWorkspace)
  const recentWorkspacePaths = useFsStore((s) => s.recentWorkspacePaths)
  const loading = useFsStore((s) => s.loading)
  const picking = useFsStore((s) => s.picking)
  const tabs = useTabStore((s) => s.tabs)
  const openTab = useTabStore((s) => s.openTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const conversationOrder = useAgentStore((s) => s.conversationOrder)
  const conversations = useAgentStore((s) => s.conversations)
  const activeConversationId = useAgentStore((s) => s.activeConversationId)
  const switchConversation = useAgentStore((s) => s.switchConversation)
  const archiveConversation = useAgentStore((s) => s.archiveConversation)
  const restoreArchivedConversation = useAgentStore((s) => s.restoreArchivedConversation)
  const deleteConversation = useAgentStore((s) => s.deleteConversation)
  const renameConversation = useAgentStore((s) => s.renameConversation)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const switchToGlobalWorkspace = useWorkspaceStore((s) => s.switchToGlobalWorkspace)
  const activatingWorkspace = useWorkspaceStore((s) => s.activating)
  const projectTabs = tabs.filter((tab) => tab.type !== 'settings')
  const sessionGroups = getWorkspaceConversationGroups(
    conversationOrder,
    conversations,
    activeWorkspaceRef,
  )
  return (
    <>
      {activePanel === 'projects' && (
        <ProjectsSidebarView
          workspacePath={workspacePath}
          recentWorkspacePaths={recentWorkspacePaths}
          loading={loading}
          picking={picking}
          projectTabsCount={projectTabs.length}
          activeWorkspaceKey={workspaceRefKey(activeWorkspaceRef)}
          activeWorkspaceKind={activeWorkspaceRef.kind}
          activatingWorkspace={activatingWorkspace}
          openWorkspacePicker={openWorkspacePicker}
          openRecentWorkspace={openRecentWorkspace}
          closeWorkspace={closeWorkspace}
          switchToGlobalWorkspace={switchToGlobalWorkspace}
        />
      )}

      {activePanel === 'browser' && <BrowserManagementView />}

      {activePanel === 'data-sources' && <DataSourcesPanel />}

      {activePanel === 'files' && (
        <FilesSidebarView workspaceRef={activeWorkspaceRef} workspacePath={workspacePath} />
      )}

      {activePanel === 'production' && (
        <ProductionSidebarView workspaceRef={activeWorkspaceRef} workspacePath={workspacePath} />
      )}

      {activePanel === 'terminal' && <TerminalSidebarView workspaceRef={activeWorkspaceRef} />}

      {activePanel === 'operations' && (
        <OperationsSidebarView workspaceRef={activeWorkspaceRef} workspacePath={workspacePath} />
      )}

      {activePanel === 'sessions' && (
        <SessionsSidebarView
          workspaceRef={activeWorkspaceRef}
          sessionGroups={sessionGroups}
          activeConversationId={activeConversationId}
          switchConversation={switchConversation}
          archiveConversation={archiveConversation}
          restoreArchivedConversation={restoreArchivedConversation}
          deleteConversation={deleteConversation}
          renameConversation={renameConversation}
          tabs={tabs}
          openTab={openTab}
          closeTab={closeTab}
        />
      )}
    </>
  )
}

function ProjectsSidebarView({
  workspacePath,
  recentWorkspacePaths,
  loading,
  picking,
  projectTabsCount,
  activeWorkspaceKey,
  activeWorkspaceKind,
  openWorkspacePicker,
  openRecentWorkspace,
  closeWorkspace,
  switchToGlobalWorkspace,
}: {
  workspacePath: string | null
  recentWorkspacePaths: string[]
  loading: boolean
  picking: boolean
  projectTabsCount: number
  activeWorkspaceKey: string | null
  activeWorkspaceKind: 'local' | 'remote' | 'global'
  activatingWorkspace: boolean
  openWorkspacePicker: () => Promise<void>
  openRecentWorkspace: (path: string) => Promise<boolean>
  closeWorkspace: () => Promise<void>
  switchToGlobalWorkspace: () => Promise<void>
}): React.ReactElement {
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const activateFilesPanel = (): void => {
    if (useUIStore.getState().activePanel !== 'files') {
      setActivePanel('files')
    }
  }

  return (
    <>
      <div className="project-panel-header">
        <span className="project-panel-header-title">项目</span>
        <button
          className="project-panel-open-button"
          onClick={() => {
            void openWorkspacePicker().then(() => {
              if (useWorkspaceStore.getState().activeWorkspaceRef.kind === 'local') {
                activateFilesPanel()
              }
            })
          }}
          disabled={loading || picking}
          title="打开项目"
        >
          打开项目
        </button>
      </div>
      <div className="sidebar-section project-panel-list-section">
        <ProjectListSection
          workspacePath={workspacePath}
          recentWorkspacePaths={recentWorkspacePaths}
          loading={loading}
          picking={picking}
          projectTabsCount={projectTabsCount}
          activeWorkspaceKey={activeWorkspaceKey}
          activeWorkspaceKind={activeWorkspaceKind}
          openWorkspacePicker={openWorkspacePicker}
          openRecentWorkspace={openRecentWorkspace}
          closeWorkspace={closeWorkspace}
          switchToGlobalWorkspace={switchToGlobalWorkspace}
          onPicked={activateFilesPanel}
          showAddButton={false}
        />
      </div>
    </>
  )
}

function BrowserManagementView(): React.ReactElement {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activateTab = useTabStore((s) => s.activateTab)
  const openTab = useTabStore((s) => s.openTab)
  const browserTabs = useBrowserStore((s) => s.tabs)
  const bookmarks = useBrowserStore((s) => s.bookmarks)
  const addBookmark = useBrowserStore((s) => s.addBookmark)
  const removeBookmark = useBrowserStore((s) => s.removeBookmark)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const browserWorkbenchTabs = useMemo(
    () => getBrowserTabsForWorkspace(tabs, activeWorkspaceRef),
    [activeWorkspaceRef, tabs],
  )
  const currentBrowserTab =
    activeTab && browserWorkbenchTabs.some((tab) => tab.id === activeTab.id)
      ? activeTab
      : (browserWorkbenchTabs[0] ?? null)
  const ensureBrowserFocus = (): string | null => {
    if (!currentBrowserTab) return null
    activateTab(currentBrowserTab.id)
    return currentBrowserTab.id
  }

  const openNewBrowser = (): void => {
    openTab({
      type: 'browser',
      title: '浏览器',
      icon: '🌐',
      forceNew: true,
      workspaceRef: activeWorkspaceRef,
    })
  }

  const openBookmark = (bookmark: (typeof bookmarks)[number]): void => {
    const existing = browserWorkbenchTabs.find((tab) => browserTabs[tab.id]?.url === bookmark.url)
    if (existing) {
      activateTab(existing.id)
      return
    }
    openTab({
      type: 'browser',
      title: bookmark.title,
      icon: '🌐',
      initialUrl: bookmark.url,
      forceNew: true,
      workspaceRef: activeWorkspaceRef,
    })
  }

  return (
    <div className="browser-sidebar">
      <div
        className="browser-sidebar-scope"
        title={workspaceRefKey(activeWorkspaceRef) ?? '未归档'}
      >
        <IconLink size={12} />
        <span>{workspaceRefLabel(activeWorkspaceRef)}</span>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header browser-sidebar-section-header">
          <span>已打开</span>
          <span className="browser-sidebar-count">{browserWorkbenchTabs.length}</span>
          <button
            className="browser-sidebar-add"
            type="button"
            onClick={openNewBrowser}
            title="在当前项目新建浏览器"
            aria-label="在当前项目新建浏览器"
          >
            <IconPlus size={14} />
          </button>
        </div>

        <div className="browser-sidebar-list">
          {browserWorkbenchTabs.map((tab) => {
            const state = browserTabs[tab.id]
            const title = getBrowserDisplayTitle(tab.title, state?.title)
            const url = state?.url ?? tab.initialUrl ?? ''
            const bookmark = bookmarks.find((item) => item.url === url)
            return (
              <div
                className={`browser-sidebar-row ${tab.id === activeTabId ? 'active' : ''}`}
                key={tab.id}
              >
                <button
                  className="browser-sidebar-row-main"
                  type="button"
                  onClick={() => activateTab(tab.id)}
                  title={url || title}
                >
                  <span className="browser-sidebar-favicon">
                    <BrowserFavicon src={state?.faviconUrl} size={18} />
                  </span>
                  <span className="project-panel-row-main">
                    <span className="project-panel-row-title">{title}</span>
                    <span className="project-panel-row-meta">
                      {url ? getBrowserUrlLabel(url) : '等待浏览器初始化'}
                    </span>
                  </span>
                  {tab.id === activeTabId && <span className="browser-sidebar-current">当前</span>}
                </button>
                <button
                  className={`browser-sidebar-bookmark ${bookmark ? 'active' : ''}`}
                  type="button"
                  disabled={!url}
                  aria-pressed={Boolean(bookmark)}
                  aria-label={bookmark ? '从当前项目收藏移除' : '收藏到当前项目'}
                  title={bookmark ? '从当前项目收藏移除' : '收藏到当前项目'}
                  onClick={() => {
                    if (!url) return
                    if (bookmark) {
                      removeBookmark(bookmark.id)
                    } else {
                      addBookmark({
                        url,
                        title,
                        faviconUrl: state?.faviconUrl ?? null,
                      })
                    }
                  }}
                >
                  <IconBookmark size={14} />
                </button>
              </div>
            )
          })}
          {browserWorkbenchTabs.length === 0 && (
            <div className="project-panel-empty">当前项目没有浏览器现场</div>
          )}
        </div>

        {currentBrowserTab && (
          <>
            <div className="project-panel-quick-actions">
              <button
                className="project-panel-quick-action"
                onClick={() => {
                  const tabId = ensureBrowserFocus()
                  if (tabId) window.cclinkStudio.browser.reload(tabId)
                }}
                title="刷新当前浏览器"
              >
                <IconRefresh size={14} />
                刷新
              </button>
              <button
                className="project-panel-quick-action"
                onClick={() => {
                  const tabId = ensureBrowserFocus()
                  if (tabId) window.cclinkStudio.browser.setDeviceMode(tabId, 'desktop')
                }}
                title="切换桌面视图"
              >
                <IconMonitor size={14} />
                桌面
              </button>
              <button
                className="project-panel-quick-action"
                onClick={() => {
                  const tabId = ensureBrowserFocus()
                  if (tabId) window.cclinkStudio.browser.setDeviceMode(tabId, 'mobile')
                }}
                title="切换手机视图"
              >
                <IconMobile size={14} />
                手机
              </button>
            </div>
            <div className="project-panel-quick-actions project-panel-quick-actions-single">
              <button
                className="project-panel-quick-action"
                onClick={() => {
                  const tabId = ensureBrowserFocus()
                  if (tabId) window.cclinkStudio.browser.fitWidth(tabId)
                }}
                title="适应当前侧栏/工作区宽度"
              >
                <IconFitWidth size={14} />
                适应宽度
              </button>
            </div>
          </>
        )}
      </div>

      <div className="sidebar-section browser-sidebar-bookmarks-section">
        <div className="sidebar-section-header browser-sidebar-section-header">
          <span>项目收藏</span>
          <span className="browser-sidebar-count">{bookmarks.length}</span>
        </div>
        <div className="browser-sidebar-list">
          {bookmarks.map((bookmark) => (
            <div className="browser-sidebar-row" key={bookmark.id}>
              <button
                className="browser-sidebar-row-main"
                type="button"
                onClick={() => openBookmark(bookmark)}
                title={bookmark.url}
              >
                <span className="browser-sidebar-favicon">
                  <BrowserFavicon src={bookmark.faviconUrl} size={18} />
                </span>
                <span className="project-panel-row-main">
                  <span className="project-panel-row-title">{bookmark.title}</span>
                  <span className="project-panel-row-meta">{getBrowserUrlLabel(bookmark.url)}</span>
                </span>
              </button>
              <button
                className="browser-sidebar-bookmark active"
                type="button"
                onClick={() => removeBookmark(bookmark.id)}
                title="从当前项目收藏移除"
                aria-label="从当前项目收藏移除"
              >
                <IconBookmark size={14} />
              </button>
            </div>
          ))}
          {bookmarks.length === 0 && <div className="project-panel-empty">暂无项目收藏</div>}
        </div>
      </div>
    </div>
  )
}

function FilesSidebarView({
  workspaceRef,
  workspacePath,
}: {
  workspaceRef: WorkspaceRef
  workspacePath: string | null
}): React.ReactElement {
  if (workspaceRef.kind === 'global') {
    return (
      <div className="project-panel-empty project-files-empty">
        未归档没有项目文件树，临时草稿请在会话或主工作区中打开。
      </div>
    )
  }

  return (
    <div className="sidebar-section project-files-section">
      {workspacePath ? <FileTree /> : <div className="project-panel-empty">尚未打开工作空间</div>}
    </div>
  )
}

function ProductionSidebarView({
  workspaceRef,
  workspacePath,
}: {
  workspaceRef: WorkspaceRef
  workspacePath: string | null
}): React.ReactElement {
  if (workspaceRef.kind === 'local' && workspacePath) {
    return (
      <HardwareProductionSection
        workspacePath={workspacePath}
        workspaceRef={workspaceRef}
        alwaysVisible
        defaultExpanded
      />
    )
  }

  return (
    <div className="project-panel-empty project-files-empty">
      未归档不启用生产检测。请选择或打开一个本地项目。
    </div>
  )
}

const TERMINAL_STATUS_LABEL: Record<TerminalStatus, string> = {
  idle: '未启动',
  starting: '启动中',
  running: '运行中',
  blocked: '等待确认',
  exited: '已退出',
  error: '异常',
}

function formatTerminalTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '未知时间'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getTerminalTabWorkspaceKey(
  tab: ReturnType<typeof useTabStore.getState>['tabs'][number],
): string | null {
  return workspaceRefKey(tab.terminal?.runtime.workspaceRef ?? { kind: 'global' })
}

function TerminalSidebarView({ workspaceRef }: { workspaceRef: WorkspaceRef }): React.ReactElement {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openTab = useTabStore((s) => s.openTab)
  const activateTab = useTabStore((s) => s.activateTab)
  const showTabMenu = useTabContextMenuStore((s) => s.show)
  const [sessions, setSessions] = useState<TerminalSessionSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const workspaceKey = workspaceRefKey(workspaceRef)

  const terminalTabs = useMemo(
    () =>
      tabs.filter(
        (tab) =>
          tab.type === 'terminal' &&
          tab.terminal &&
          getTerminalTabWorkspaceKey(tab) === workspaceKey,
      ),
    [tabs, workspaceKey],
  )

  const terminalSessionIds = useMemo(
    () => new Set(terminalTabs.map((tab) => tab.terminal?.sessionId).filter(Boolean)),
    [terminalTabs],
  )

  const sessionsById = useMemo(() => {
    const map = new Map<string, TerminalSessionSnapshot>()
    sessions.forEach((session) => map.set(session.sessionId, session))
    return map
  }, [sessions])

  const recoverableSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          workspaceRefKey(session.runtime.workspaceRef) === workspaceKey &&
          session.attachable &&
          !terminalSessionIds.has(session.sessionId),
      ),
    [sessions, terminalSessionIds, workspaceKey],
  )

  const recordSessions = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            workspaceRefKey(session.runtime.workspaceRef) === workspaceKey &&
            !session.attachable &&
            !terminalSessionIds.has(session.sessionId),
        )
        .slice(0, 12),
    [sessions, terminalSessionIds, workspaceKey],
  )

  const refreshTerminalInfo = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const nextSessions = await window.cclinkStudio.terminal.listSessions()
      setSessions(nextSessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Terminal 信息失败')
    } finally {
      setLoading(false)
    }
  }, [workspaceKey])

  useEffect(() => {
    void refreshTerminalInfo()
  }, [refreshTerminalInfo, terminalTabs.length])

  const openRecoverableSession = (session: TerminalSessionSnapshot): void => {
    const existing = tabs.find((tab) => tab.terminal?.sessionId === session.sessionId)
    if (existing) {
      activateTab(existing.id)
      return
    }
    openTab(buildTerminalTabDraftFromSession(session))
  }

  const openRecordSession = (session: TerminalSessionSnapshot): void => {
    openTab(buildTerminalRecordTabDraft(session))
  }

  return (
    <>
      {terminalTabs.length > 0 && (
        <div className="sidebar-section">
          {terminalTabs.map((tab) => {
            const sessionId = tab.terminal?.sessionId
            const session = sessionId ? sessionsById.get(sessionId) : undefined
            const status = session?.status ?? tab.terminal?.status ?? 'idle'
            return (
              <button
                key={tab.id}
                className={`project-panel-row ${tab.id === activeTabId ? 'active' : ''}`}
                onClick={() => activateTab(tab.id)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  showTabMenu(tab.id, event.clientX, event.clientY)
                }}
                title={sessionId ?? tab.title}
              >
                <IconTerminal size={14} />
                <span className="project-panel-row-main">
                  <span className="project-panel-row-title">{tab.title}</span>
                  <span className="project-panel-row-meta">
                    {TERMINAL_STATUS_LABEL[status]} · {tab.terminal?.runtime.cwd ?? '默认目录'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {recoverableSessions.length > 0 && (
        <div className="sidebar-section">
          {recoverableSessions.map((session) => (
            <button
              key={session.sessionId}
              className={`project-panel-row terminal-sidebar-session status-${session.status}`}
              onClick={() => openRecoverableSession(session)}
              title="恢复这个 Terminal session"
            >
              <IconTerminal size={14} />
              <span className="project-panel-row-main">
                <span className="project-panel-row-title">
                  恢复 · {TERMINAL_STATUS_LABEL[session.status]}
                </span>
                <span className="project-panel-row-meta">
                  {session.runtime.cwd ?? '默认目录'} · {formatTerminalTime(session.updatedAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-section">
        {error ? (
          <div className="project-panel-empty terminal-sidebar-error">{error}</div>
        ) : loading && sessions.length === 0 ? (
          <div className="project-panel-empty">正在加载 Terminal 记录…</div>
        ) : recordSessions.length === 0 ? (
          <div className="project-panel-empty">暂无历史 Terminal 记录</div>
        ) : (
          recordSessions.map((session) => (
            <button
              key={session.sessionId}
              className="project-panel-row muted terminal-sidebar-history"
              onClick={() => openRecordSession(session)}
              title="查看 Terminal 只读记录"
            >
              <IconTerminal size={14} />
              <span className="project-panel-row-main">
                <span className="project-panel-row-title">
                  {TERMINAL_STATUS_LABEL[session.status]} · 查看记录
                </span>
                <span className="project-panel-row-meta">
                  {session.lastCommand ??
                    session.errorMessage ??
                    session.runtime.cwd ??
                    session.sessionId}{' '}
                  · {formatTerminalTime(session.updatedAt)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </>
  )
}

function OperationsSidebarView({
  workspaceRef,
  workspacePath,
}: {
  workspaceRef: WorkspaceRef
  workspacePath: string | null
}): React.ReactElement | null {
  if (workspaceRef.kind === 'local' && workspacePath) {
    return <ProjectOperationsSection workspacePath={workspacePath} workspaceRef={workspaceRef} />
  }

  return null
}

function SessionsSidebarView({
  workspaceRef,
  sessionGroups,
  activeConversationId,
  switchConversation,
  archiveConversation,
  restoreArchivedConversation,
  deleteConversation,
  renameConversation,
  tabs,
  openTab,
  closeTab,
}: {
  workspaceRef: WorkspaceRef
  sessionGroups: ReturnType<typeof getWorkspaceConversationGroups>
  activeConversationId: string
  switchConversation: (id: string) => void
  archiveConversation: ReturnType<typeof useAgentStore.getState>['archiveConversation']
  restoreArchivedConversation: ReturnType<
    typeof useAgentStore.getState
  >['restoreArchivedConversation']
  deleteConversation: ReturnType<typeof useAgentStore.getState>['deleteConversation']
  renameConversation: ReturnType<typeof useAgentStore.getState>['renameConversation']
  tabs: ReturnType<typeof useTabStore.getState>['tabs']
  openTab: ReturnType<typeof useTabStore.getState>['openTab']
  closeTab: ReturnType<typeof useTabStore.getState>['closeTab']
}): React.ReactElement {
  return (
    <LocalSessionsList
      workspaceRef={workspaceRef}
      sessionGroups={sessionGroups}
      activeConversationId={activeConversationId}
      switchConversation={switchConversation}
      archiveConversation={archiveConversation}
      restoreArchivedConversation={restoreArchivedConversation}
      deleteConversation={deleteConversation}
      renameConversation={renameConversation}
      tabs={tabs}
      openTab={openTab}
      closeTab={closeTab}
    />
  )
}

function ProjectListSection({
  workspacePath,
  recentWorkspacePaths,
  loading,
  picking,
  projectTabsCount,
  activeWorkspaceKey,
  activeWorkspaceKind,
  openWorkspacePicker,
  openRecentWorkspace,
  closeWorkspace,
  switchToGlobalWorkspace,
  onPicked,
  showAddButton = true,
}: {
  workspacePath: string | null
  recentWorkspacePaths: string[]
  loading: boolean
  picking: boolean
  projectTabsCount?: number
  activeWorkspaceKey: string | null
  activeWorkspaceKind: 'local' | 'remote' | 'global'
  openWorkspacePicker: () => Promise<void>
  openRecentWorkspace: (path: string) => Promise<boolean>
  closeWorkspace: () => Promise<void>
  switchToGlobalWorkspace: () => Promise<void>
  onPicked: () => void
  showAddButton?: boolean
}): React.ReactElement {
  const recentProjects =
    workspacePath && !recentWorkspacePaths.includes(workspacePath)
      ? [workspacePath, ...recentWorkspacePaths]
      : recentWorkspacePaths
  const hasWorkspaces = recentProjects.length > 0

  return (
    <div className="project-switcher-list">
      {hasWorkspaces ? (
        <>
          {recentProjects.map((path) => {
            const ref = localWorkspaceRef(path)
            const active = workspaceRefKey(ref) === activeWorkspaceKey
            return (
              <button
                key={path}
                className={`project-panel-project-item ${active ? 'active' : ''}`}
                onClick={() => {
                  if (active) {
                    onPicked()
                    return
                  }
                  void openRecentWorkspace(path).then((success) => {
                    if (success) onPicked()
                  })
                }}
                disabled={loading || picking}
                title={active ? '当前工作空间' : path}
              >
                <IconProjects size={14} />
                <span className="project-panel-recent-main">
                  <span className="project-panel-recent-title">{getProjectName(path)}</span>
                  <span className="project-panel-recent-meta">
                    {active
                      ? `本地 · ${projectTabsCount ?? 0} 个标签页 · 已激活`
                      : `本地 · ${path}`}
                  </span>
                </span>
              </button>
            )
          })}
        </>
      ) : (
        <div className="project-panel-empty">暂无最近工作空间</div>
      )}
      <button
        className={`project-panel-project-item system ${activeWorkspaceKind === 'global' ? 'active' : ''}`}
        onClick={() => {
          if (activeWorkspaceKind === 'global') {
            onPicked()
            return
          }
          const action =
            activeWorkspaceKind === 'local' ? closeWorkspace() : switchToGlobalWorkspace()
          void action.then(() => {
            if (useWorkspaceStore.getState().activeWorkspaceRef.kind === 'global') {
              onPicked()
            }
          })
        }}
        disabled={loading || picking}
        title={activeWorkspaceKind === 'global' ? '当前为未归档' : '切换到未归档'}
      >
        <IconBookmark size={14} />
        <span className="project-panel-recent-main">
          <span className="project-panel-recent-title">未归档</span>
          <span className="project-panel-recent-meta">临时草稿与全局会话</span>
        </span>
      </button>
      {showAddButton && (
        <button
          className="project-panel-project-item add"
          onClick={() => {
            void openWorkspacePicker().then(() => {
              if (useWorkspaceStore.getState().activeWorkspaceRef.kind === 'local') {
                onPicked()
              }
            })
          }}
          disabled={loading || picking}
          title="打开项目"
        >
          <IconPlus size={14} />
          <span className="project-panel-row-main">
            <span className="project-panel-row-title">打开项目</span>
            <span className="project-panel-row-meta">选择一个本地项目文件夹</span>
          </span>
        </button>
      )}
    </div>
  )
}
