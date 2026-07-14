import {
  useUIStore,
  useTabStore,
  useFsStore,
  useBrowserStore,
  useAgentStore,
  useCclinkStore,
  useWorkspaceStore,
} from '../../stores'
import type { ChatccSession } from '@shared/chatcc'
import type { WorkspaceRef } from '../../../../shared/workspace-ref'
import {
  localWorkspaceRef,
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../../shared/workspace-ref'
import type { RemoteWorkspaceItem } from '../../utils/remote-workspaces'
import {
  getArchivedCclinkRemoteWorkspaceSessions,
  getCclinkRemoteWorkspaceItems,
  getCclinkRemoteWorkspaceSessions,
} from '../../utils/remote-workspaces'
import {
  IconFolder,
  IconFitWidth,
  IconGlobe,
  IconHistory,
  IconMobile,
  IconMonitor,
  IconRefresh,
  IconChevronDown,
  IconRobot,
  IconPlus,
} from '../common/Icons'
import type { ActivityPanel } from '../../types'
import { FileTree } from './FileTree'
import { RemoteFileTree } from './RemoteFileTree'
import { ProjectOperationsSection } from './ProjectOperationsSection'
import { useState, useEffect } from 'react'

function getProjectName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function getWorkspaceTitle(workspaceRef: WorkspaceRef, workspacePath: string | null): string {
  if (workspaceRef.kind === 'global') return '未归档'
  if (workspaceRef.kind === 'local') return getProjectName(workspacePath ?? workspaceRef.path)
  return workspaceRefLabel(workspaceRef)
}

export function Sidebar(): React.ReactElement {
  const activePanel = useUIStore((s) => s.activePanel)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const workspacePath = useFsStore((s) => s.workspacePath)
  const openWorkspacePicker = useFsStore((s) => s.openWorkspacePicker)
  const loading = useFsStore((s) => s.loading)
  const picking = useFsStore((s) => s.picking)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false)
  const workspaceTitle = getWorkspaceTitle(activeWorkspaceRef, workspacePath)

  return (
    <div className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      <div className="sidebar-header">
        <span className="sidebar-header-title" title={workspacePath ?? workspaceTitle}>
          {workspaceTitle}
        </span>
        <div className="sidebar-header-actions">
          <button
            className={`sidebar-header-action ${showProjectSwitcher ? 'active' : ''}`}
            onClick={() => setShowProjectSwitcher((value) => !value)}
            title="最近项目和未归档"
          >
            <IconHistory size={14} />
          </button>
          <button
            className="sidebar-header-action"
            onClick={() => openWorkspacePicker()}
            disabled={loading || picking}
            title={workspacePath ? `打开新项目（当前：${workspacePath}）` : '打开新项目'}
          >
            <IconFolder size={14} />
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        <ProjectSidebarContent
          activePanel={activePanel}
          showProjectSwitcher={showProjectSwitcher}
          onCloseProjectSwitcher={() => setShowProjectSwitcher(false)}
        />
      </div>
    </div>
  )
}

function ProjectSidebarContent({
  activePanel,
  showProjectSwitcher,
  onCloseProjectSwitcher,
}: {
  activePanel: ActivityPanel
  showProjectSwitcher: boolean
  onCloseProjectSwitcher: () => void
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
  const conversationOrder = useAgentStore((s) => s.conversationOrder)
  const conversations = useAgentStore((s) => s.conversations)
  const activeConversationId = useAgentStore((s) => s.activeConversationId)
  const switchConversation = useAgentStore((s) => s.switchConversation)
  const cclinkServers = useCclinkStore((s) => s.servers)
  const cclinkSessions = useCclinkStore((s) => s.sessions)
  const archivedCclinkSessionIds = useCclinkStore((s) => s.archivedSessionIds)
  const archiveCclinkSession = useCclinkStore((s) => s.archiveSession)
  const restoreArchivedCclinkSession = useCclinkStore((s) => s.restoreArchivedSession)
  const loadCclink = useCclinkStore((s) => s.load)
  const loadCclinkMessages = useCclinkStore((s) => s.loadMessages)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const activateRemoteWorkspace = useWorkspaceStore((s) => s.activateRemoteWorkspace)
  const switchToGlobalWorkspace = useWorkspaceStore((s) => s.switchToGlobalWorkspace)
  const activatingWorkspace = useWorkspaceStore((s) => s.activating)
  const projectTabs = tabs.filter((tab) => tab.type !== 'settings')
  const workConversations = getWorkspaceWorkConversations(
    conversationOrder,
    conversations,
    activeWorkspaceRef,
  )
  const remoteWorkspaces = getCclinkRemoteWorkspaceItems(cclinkServers)
  const activeRemoteSessions =
    activeWorkspaceRef.kind === 'remote'
      ? getCclinkRemoteWorkspaceSessions(
          activeWorkspaceRef,
          cclinkSessions,
          archivedCclinkSessionIds,
        )
      : []
  const activeArchivedRemoteSessions =
    activeWorkspaceRef.kind === 'remote'
      ? getArchivedCclinkRemoteWorkspaceSessions(
          activeWorkspaceRef,
          cclinkSessions,
          archivedCclinkSessionIds,
        )
      : []

  useEffect(() => {
    void loadCclink()
  }, [loadCclink])

  return (
    <>
      {showProjectSwitcher && (
        <ProjectSwitcherSection
          workspacePath={workspacePath}
          recentWorkspacePaths={recentWorkspacePaths}
          loading={loading}
          picking={picking}
          projectTabsCount={projectTabs.length}
          remoteWorkspaces={remoteWorkspaces}
          activeWorkspaceKey={workspaceRefKey(activeWorkspaceRef)}
          activeWorkspaceKind={activeWorkspaceRef.kind}
          activatingWorkspace={activatingWorkspace}
          openWorkspacePicker={openWorkspacePicker}
          openRecentWorkspace={openRecentWorkspace}
          closeWorkspace={closeWorkspace}
          switchToGlobalWorkspace={switchToGlobalWorkspace}
          activateRemoteWorkspace={activateRemoteWorkspace}
          onPicked={onCloseProjectSwitcher}
        />
      )}

      {activePanel === 'browser' && <BrowserManagementView />}

      {activePanel === 'files' && (
        <FilesSidebarView workspaceRef={activeWorkspaceRef} workspacePath={workspacePath} />
      )}

      {activePanel === 'operations' && (
        <OperationsSidebarView workspaceRef={activeWorkspaceRef} workspacePath={workspacePath} />
      )}

      {activePanel === 'sessions' && (
        <SessionsSidebarView
          workspaceRef={activeWorkspaceRef}
          conversations={workConversations}
          activeConversationId={activeConversationId}
          switchConversation={switchConversation}
          remoteSessions={activeRemoteSessions}
          archivedRemoteSessions={activeArchivedRemoteSessions}
          openTab={openTab}
          loadMessages={loadCclinkMessages}
          archiveSession={archiveCclinkSession}
          restoreArchivedSession={restoreArchivedCclinkSession}
        />
      )}
    </>
  )
}

function BrowserManagementView(): React.ReactElement {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openTab = useTabStore((s) => s.openTab)
  const activateTab = useTabStore((s) => s.activateTab)
  const browserTabs = useBrowserStore((s) => s.tabs)
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const browserWorkbenchTabs = tabs.filter((tab) => tab.type === 'browser')
  const currentBrowserTab =
    activeTab?.type === 'browser' ? activeTab : (browserWorkbenchTabs[0] ?? null)
  const currentBrowserState = currentBrowserTab ? browserTabs[currentBrowserTab.id] : undefined

  const ensureBrowserFocus = (): string | null => {
    if (!currentBrowserTab) return null
    activateTab(currentBrowserTab.id)
    return currentBrowserTab.id
  }

  return (
    <>
      <div className="sidebar-section">
        <div className="sidebar-section-header expanded">
          <IconChevronDown size={10} />
          浏览器管理
        </div>
        <button
          className="project-panel-row"
          onClick={() => openTab({ type: 'browser', title: '浏览器', icon: '🌐', forceNew: true })}
          title="新建浏览器 Tab"
        >
          <IconPlus size={14} />
          <span className="project-panel-row-main">
            <span className="project-panel-row-title">新建浏览器</span>
            <span className="project-panel-row-meta">打开一个独立浏览器现场</span>
          </span>
        </button>
        <div className="project-panel-empty compact">
          已打开 {browserWorkbenchTabs.length} 个浏览器现场
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header expanded">
          <IconChevronDown size={10} />
          当前浏览器
        </div>
        {currentBrowserTab ? (
          <>
            <button
              className={`project-panel-row ${currentBrowserTab.id === activeTabId ? 'active' : ''}`}
              onClick={() => activateTab(currentBrowserTab.id)}
              title={currentBrowserState?.url ?? currentBrowserTab.title}
            >
              <IconGlobe size={14} />
              <span className="project-panel-row-main">
                <span className="project-panel-row-title">{currentBrowserTab.title}</span>
                <span className="project-panel-row-meta">
                  {currentBrowserState?.url ?? '等待浏览器初始化'}
                </span>
              </span>
            </button>
            <div className="project-panel-quick-actions">
              <button
                className="project-panel-quick-action"
                onClick={() => {
                  const tabId = ensureBrowserFocus()
                  if (tabId) window.deepink.browser.reload(tabId)
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
                  if (tabId) window.deepink.browser.setDeviceMode(tabId, 'desktop')
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
                  if (tabId) window.deepink.browser.setDeviceMode(tabId, 'mobile')
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
                  if (tabId) window.deepink.browser.fitWidth(tabId)
                }}
                title="适应当前侧栏/工作区宽度"
              >
                <IconFitWidth size={14} />
                适应宽度
              </button>
            </div>
          </>
        ) : (
          <div className="project-panel-empty">当前没有浏览器现场</div>
        )}
      </div>
    </>
  )
}

function FilesSidebarView({
  workspaceRef,
  workspacePath,
}: {
  workspaceRef: WorkspaceRef
  workspacePath: string | null
}): React.ReactElement {
  if (workspaceRef.kind === 'remote') {
    return (
      <div className="sidebar-section project-files-section">
        <div className="sidebar-section-header expanded">
          <IconChevronDown size={10} />
          文件
        </div>
        <RemoteFileTree
          serverId={workspaceRef.endpointId}
          workspaceId={workspaceRef.workspaceId}
          rootPath={workspaceRef.path}
        />
      </div>
    )
  }

  if (workspaceRef.kind === 'global') {
    return (
      <div className="project-panel-empty project-files-empty">
        未归档没有项目文件树，临时草稿请在会话或主工作区中打开。
      </div>
    )
  }

  return (
    <div className="sidebar-section project-files-section">
      <div className="sidebar-section-header expanded">
        <IconChevronDown size={10} />
        文件
      </div>
      {workspacePath ? <FileTree /> : <div className="project-panel-empty">尚未打开工作空间</div>}
    </div>
  )
}

function OperationsSidebarView({
  workspaceRef,
  workspacePath,
}: {
  workspaceRef: WorkspaceRef
  workspacePath: string | null
}): React.ReactElement {
  const openTab = useTabStore((s) => s.openTab)

  if (workspaceRef.kind === 'local' && workspacePath) {
    return <ProjectOperationsSection workspacePath={workspacePath} workspaceRef={workspaceRef} />
  }

  if (workspaceRef.kind === 'remote') {
    return (
      <div className="sidebar-section project-ops-entry-section">
        <div className="sidebar-section-header expanded">
          <IconChevronDown size={10} />
          运营
        </div>
        <button
          className="project-panel-row"
          onClick={() =>
            openTab({
              type: 'settings',
              title: '远程连接',
              icon: '⚙️',
              settingsSection: 'remote-connections',
            })
          }
          title="打开远程连接设置"
        >
          <IconRobot size={14} />
          <span className="project-panel-row-main">
            <span className="project-panel-row-title">远程连接设置</span>
            <span className="project-panel-row-meta">账号、通道和诊断</span>
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="project-panel-empty project-files-empty">
      未归档不启用项目运营。请选择或打开一个本地项目。
    </div>
  )
}

function SessionsSidebarView({
  workspaceRef,
  conversations,
  activeConversationId,
  switchConversation,
  remoteSessions,
  archivedRemoteSessions,
  openTab,
  loadMessages,
  archiveSession,
  restoreArchivedSession,
}: {
  workspaceRef: WorkspaceRef
  conversations: ReturnType<typeof getWorkspaceWorkConversations>
  activeConversationId: string
  switchConversation: (id: string) => void
  remoteSessions: ChatccSession[]
  archivedRemoteSessions: ChatccSession[]
  openTab: ReturnType<typeof useTabStore.getState>['openTab']
  loadMessages: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => void
  restoreArchivedSession: (sessionId: string) => void
}): React.ReactElement {
  if (workspaceRef.kind === 'remote') {
    return (
      <RemoteSessionsList
        workspaceRef={workspaceRef}
        sessions={remoteSessions}
        archivedSessions={archivedRemoteSessions}
        openTab={openTab}
        loadMessages={loadMessages}
        archiveSession={archiveSession}
        restoreArchivedSession={restoreArchivedSession}
      />
    )
  }

  const openWorkConversation = (conversation: (typeof conversations)[number]): void => {
    switchConversation(conversation.id)
    openTab({
      type: 'conversation',
      title: conversation.title === '新会话' ? '新工作会话' : conversation.title,
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: conversation.runtime,
        sessionId: conversation.id,
      },
    })
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header expanded">
        <IconChevronDown size={10} />
        会话
      </div>
      {conversations.length > 0 ? (
        conversations.map((conversation) => (
          <button
            key={conversation.id}
            className={`project-panel-row ${conversation.id === activeConversationId ? 'active' : ''}`}
            onClick={() => openWorkConversation(conversation)}
            title={conversation.title}
          >
            <IconRobot size={14} />
            <span className="project-panel-row-main">
              <span className="project-panel-row-title">{conversation.title}</span>
              <span className="project-panel-row-meta">
                {conversation.id === activeConversationId ? '已激活' : '未激活'} ·{' '}
                {conversation.messages.length} 条消息
                {conversation.loading ? ' · 执行中' : ''}
              </span>
            </span>
          </button>
        ))
      ) : (
        <div className="project-panel-empty">当前工作空间暂无会话</div>
      )}
    </div>
  )
}

function ProjectSwitcherSection({
  workspacePath,
  recentWorkspacePaths,
  loading,
  picking,
  projectTabsCount,
  remoteWorkspaces,
  activeWorkspaceKey,
  activeWorkspaceKind,
  activatingWorkspace,
  openWorkspacePicker,
  openRecentWorkspace,
  closeWorkspace,
  switchToGlobalWorkspace,
  activateRemoteWorkspace,
  onPicked,
}: {
  workspacePath: string | null
  recentWorkspacePaths: string[]
  loading: boolean
  picking: boolean
  projectTabsCount?: number
  remoteWorkspaces: RemoteWorkspaceItem[]
  activeWorkspaceKey: string | null
  activeWorkspaceKind: 'local' | 'remote' | 'global'
  activatingWorkspace: boolean
  openWorkspacePicker: () => Promise<void>
  openRecentWorkspace: (path: string) => Promise<void>
  closeWorkspace: () => Promise<void>
  switchToGlobalWorkspace: () => Promise<void>
  activateRemoteWorkspace: ReturnType<typeof useWorkspaceStore.getState>['activateRemoteWorkspace']
  onPicked: () => void
}): React.ReactElement {
  return (
    <ProjectListSection
      workspacePath={workspacePath}
      recentWorkspacePaths={recentWorkspacePaths}
      loading={loading}
      picking={picking}
      projectTabsCount={projectTabsCount}
      remoteWorkspaces={remoteWorkspaces}
      activeWorkspaceKey={activeWorkspaceKey}
      activeWorkspaceKind={activeWorkspaceKind}
      activatingWorkspace={activatingWorkspace}
      openWorkspacePicker={openWorkspacePicker}
      openRecentWorkspace={openRecentWorkspace}
      closeWorkspace={closeWorkspace}
      switchToGlobalWorkspace={switchToGlobalWorkspace}
      activateRemoteWorkspace={activateRemoteWorkspace}
      onPicked={onPicked}
    />
  )
}

function ProjectListSection({
  workspacePath,
  recentWorkspacePaths,
  loading,
  picking,
  projectTabsCount,
  remoteWorkspaces,
  activeWorkspaceKey,
  activeWorkspaceKind,
  activatingWorkspace,
  openWorkspacePicker,
  openRecentWorkspace,
  closeWorkspace,
  switchToGlobalWorkspace,
  activateRemoteWorkspace,
  onPicked,
}: {
  workspacePath: string | null
  recentWorkspacePaths: string[]
  loading: boolean
  picking: boolean
  projectTabsCount?: number
  remoteWorkspaces: RemoteWorkspaceItem[]
  activeWorkspaceKey: string | null
  activeWorkspaceKind: 'local' | 'remote' | 'global'
  activatingWorkspace: boolean
  openWorkspacePicker: () => Promise<void>
  openRecentWorkspace: (path: string) => Promise<void>
  closeWorkspace: () => Promise<void>
  switchToGlobalWorkspace: () => Promise<void>
  activateRemoteWorkspace: ReturnType<typeof useWorkspaceStore.getState>['activateRemoteWorkspace']
  onPicked: () => void
}): React.ReactElement {
  const recentProjects =
    workspacePath && !recentWorkspacePaths.includes(workspacePath)
      ? [workspacePath, ...recentWorkspacePaths]
      : recentWorkspacePaths
  const hasWorkspaces = recentProjects.length > 0 || remoteWorkspaces.length > 0

  return (
    <div className="sidebar-section project-panel-section-primary project-switcher-section">
      <div className="sidebar-section-header expanded">
        <IconChevronDown size={10} />
        切换项目
      </div>
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
                  if (active) return
                  void openRecentWorkspace(path).then(onPicked)
                }}
                disabled={loading || picking || active}
                title={active ? '当前工作空间' : path}
              >
                <IconFolder size={14} />
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
          {remoteWorkspaces.map(({ server, workspace, ref }) => {
            const active = workspaceRefKey(ref) === activeWorkspaceKey

            return (
              <button
                key={`${server.id}:${workspace.id}`}
                className={`project-panel-project-item ${active ? 'active' : ''}`}
                onClick={() => {
                  if (active) return
                  void activateRemoteWorkspace(ref).then(onPicked)
                }}
                disabled={activatingWorkspace || active}
                title={
                  active
                    ? '当前远程工作空间'
                    : `${workspaceRefSourceLabel(ref)} · ${workspace.path}`
                }
              >
                <IconFolder size={14} />
                <span className="project-panel-recent-main">
                  <span className="project-panel-recent-title">{workspaceRefLabel(ref)}</span>
                  <span className="project-panel-recent-meta">
                    {workspaceRefSourceLabel(ref)} ·{' '}
                    {active ? '已激活' : `${workspace.sessionCount} 个会话`}
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
          if (activeWorkspaceKind === 'global') return
          const action =
            activeWorkspaceKind === 'local' ? closeWorkspace() : switchToGlobalWorkspace()
          void action.then(onPicked)
        }}
        disabled={loading || picking || activeWorkspaceKind === 'global'}
        title={activeWorkspaceKind === 'global' ? '当前为未归档' : '切换到未归档'}
      >
        <IconFolder size={14} />
        <span className="project-panel-recent-main">
          <span className="project-panel-recent-title">未归档</span>
          <span className="project-panel-recent-meta">临时草稿与全局会话</span>
        </span>
      </button>
      <button
        className="project-panel-project-item add"
        onClick={() => void openWorkspacePicker().then(onPicked)}
        disabled={loading || picking}
        title="打开新项目"
      >
        <IconPlus size={14} />
        <span className="project-panel-row-main">
          <span className="project-panel-row-title">打开新项目</span>
          <span className="project-panel-row-meta">添加到工作空间列表</span>
        </span>
      </button>
    </div>
  )
}

function RemoteSessionsList({
  workspaceRef,
  sessions,
  archivedSessions,
  openTab,
  loadMessages,
  archiveSession,
  restoreArchivedSession,
}: {
  workspaceRef: Extract<WorkspaceRef, { kind: 'remote' }>
  sessions: ChatccSession[]
  archivedSessions: ChatccSession[]
  openTab: ReturnType<typeof useTabStore.getState>['openTab']
  loadMessages: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => void
  restoreArchivedSession: (sessionId: string) => void
}): React.ReactElement {
  const openRemoteSession = (session: ChatccSession): void => {
    void loadMessages(session.id)
    openTab({
      type: 'conversation',
      title: session.name,
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: {
          location: 'remote',
          transport: 'cclink',
          backend: 'deepink-agent',
          workspaceRef,
        },
        sessionId: session.id,
      },
    })
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header expanded">
        <IconChevronDown size={10} />
        会话
      </div>
      {sessions.length > 0 ? (
        sessions.map((session) => (
          <button
            key={session.id}
            className="project-panel-row"
            onClick={() => openRemoteSession(session)}
            title={session.workspacePath}
          >
            <IconRobot size={14} />
            <span className="project-panel-row-main">
              <span className="project-panel-row-title">{session.name}</span>
              <span className="project-panel-row-meta">
                {session.messageCount} 条消息 · {formatRelativeSessionTime(session.updatedAt)}
              </span>
            </span>
            <span
              className="project-panel-row-action"
              role="button"
              tabIndex={0}
              title="在 DeepInk 中归档这个远程会话；不会删除远端历史"
              onClick={(event) => {
                event.stopPropagation()
                archiveSession(session.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  archiveSession(session.id)
                }
              }}
            >
              归档
            </span>
          </button>
        ))
      ) : (
        <div className="project-panel-empty">当前工作空间暂无会话</div>
      )}
      {archivedSessions.length > 0 && (
        <div className="project-panel-archived-group">
          <div className="project-panel-archived-title">已归档远程会话</div>
          {archivedSessions.map((session) => (
            <button
              key={session.id}
              className="project-panel-row muted"
              onClick={() => {
                restoreArchivedSession(session.id)
                openRemoteSession(session)
              }}
              title="恢复并打开远程会话"
            >
              <IconRobot size={14} />
              <span className="project-panel-row-main">
                <span className="project-panel-row-title">{session.name}</span>
                <span className="project-panel-row-meta">本地归档 · 点击恢复</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatRelativeSessionTime(timestamp: number): string {
  if (!timestamp) return '未知'
  const normalized = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
  const diff = Date.now() - normalized
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`
  return `${Math.max(1, Math.floor(diff / 86_400_000))} 天前`
}

function getWorkspaceWorkConversations(
  conversationOrder: ReturnType<typeof useAgentStore.getState>['conversationOrder'],
  conversations: ReturnType<typeof useAgentStore.getState>['conversations'],
  workspaceRef: WorkspaceRef,
) {
  const activeWorkspaceKey = workspaceRefKey(workspaceRef)
  return conversationOrder
    .flatMap((id) => {
      const conversation = conversations[id]
      return conversation ? [conversation] : []
    })
    .filter((conversation) => {
      if (conversation.archivedAt) return false
      if (conversation.surface !== 'workbench-tab') return false
      const conversationWorkspaceKey = conversation.runtime.workspaceRef
        ? workspaceRefKey(conversation.runtime.workspaceRef)
        : null
      return conversationWorkspaceKey === activeWorkspaceKey
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
