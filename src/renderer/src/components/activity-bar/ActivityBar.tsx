import {
  useDiaryNavigation,
  type DiaryPage,
} from '../../features/workspace-open/personal-diary-navigation'
import { showWorkspaceHome } from '../../features/workspace-open/workspace-home-navigation'
import {
  openCompanyWorkspace,
  type CompanySection,
} from '../../features/company-workspace/company-workspace-commands'
import React, { useEffect, useState } from 'react'
import {
  useUIStore,
  useTabStore,
  useCommandStore,
  useFsStore,
  useWorkspaceStore,
} from '../../stores'
import { useFixedSpacesStore } from '../../features/workspace-open/fixed-spaces-store'
import type { ActivityPanel } from '../../types'
import { useToastStore } from '../common/Toast'
import {
  ActivityAffairsIcon,
  ActivityArticlePublishingIcon,
  ActivityBrowserIcon,
  ActivityDataSourcesIcon,
  ActivityCompanyAccountsIcon,
  ActivityFilesIcon,
  ActivityProductionIcon,
  ActivityProjectsIcon,
  ActivityRemoteIcon,
  ActivityRolesIcon,
  ActivityScheduledTasksIcon,
  ActivitySessionsIcon,
  ActivitySettingsIcon,
  ActivityTerminalIcon,
  ActivityVideoCreationIcon,
  ActivityWebAccountsIcon,
} from './activity-bar-icons'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'

interface ActivityBarItem {
  id: ActivityPanel
  Icon: React.ComponentType<{ size?: number }>
  label: string
  displayLabel?: string
}
const MAIN_ICON_GROUPS: Array<{ id: string; label: string; items: ActivityBarItem[] }> = [
  {
    id: 'work',
    label: '工作',
    items: [
      { id: 'workspace-home', Icon: ActivityProjectsIcon, label: '工作台' },
      { id: 'files', Icon: ActivityFilesIcon, label: '文件' },
      { id: 'sessions', Icon: ActivitySessionsIcon, label: '会话' },
      { id: 'browser', Icon: ActivityBrowserIcon, label: '浏览器' },
      { id: 'terminal', Icon: ActivityTerminalIcon, label: 'Terminal', displayLabel: '终端' },
    ],
  },
  {
    id: 'company',
    label: '经营',
    items: [
      { id: 'company-workspace', Icon: ActivityCompanyAccountsIcon, label: '公司经营' },
      { id: 'company-accounts', Icon: ActivityCompanyAccountsIcon, label: '公司账目' },
    ],
  },
  {
    id: 'flows',
    label: '流程',
    items: [
      { id: 'article-publishing', Icon: ActivityArticlePublishingIcon, label: '文章发布' },
      { id: 'affairs', Icon: ActivityAffairsIcon, label: '事务' },
      { id: 'scheduled-tasks', Icon: ActivityScheduledTasksIcon, label: '定时任务' },
    ],
  },
  {
    id: 'resources',
    label: '资源',
    items: [
      { id: 'operations', Icon: ActivityWebAccountsIcon, label: '网站与账号' },
      { id: 'agent-roles', Icon: ActivityRolesIcon, label: '角色' },
      { id: 'data-sources', Icon: ActivityDataSourcesIcon, label: '数据源' },
    ],
  },
  {
    id: 'more',
    label: '更多工具',
    items: [
      { id: 'video-creation', Icon: ActivityVideoCreationIcon, label: '视频创作' },
      { id: 'production', Icon: ActivityProductionIcon, label: '硬件生产' },
      { id: 'cclink', Icon: ActivityRemoteIcon, label: 'CCLink 远程' },
    ],
  },
]

export function ActivityBar(): React.ReactElement {
  const workspaceType = useWorkspaceStore(
    (state) => state.settingsSnapshot?.settings.type ?? 'general',
  )
  const pinnedTools = useUIStore((state) => state.pinnedTools)
  const toolsExpanded = useUIStore((state) => state.toolsExpanded)
  const diaryPage = useDiaryNavigation((state) => state.page)
  const activeRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const companyPath = useFixedSpacesStore((state) => state.spaces?.company?.workspacePath)
  const activeTab = useTabStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId))
  const jumpsToCompany =
    workspaceType !== 'company' && (activeRef.kind !== 'local' || activeRef.path !== companyPath)
  const activePanel = useUIStore((s) => s.activePanel)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const agentPanelMode = useUIStore((s) => s.agentPanelMode)
  const agentContentMode = useUIStore((s) => s.agentContentMode)
  const sessionsActive = agentPanelMode === 'right' && agentContentMode !== 'chat'
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const setAgentPanelMode = useUIStore((s) => s.setAgentPanelMode)
  const hideSidebar = useUIStore((s) => s.hideSidebar)
  const openTab = useTabStore((s) => s.openTab)
  const showContextMenu = useContextMenuStore((s) => s.show)
  const [scheduledRunCount, setScheduledRunCount] = useState(0)

  useEffect(() => {
    let disposed = false
    let generation = 0
    const refresh = (): void => {
      const requested = ++generation
      void window.cclinkStudio.scheduledTasks
        .getRuntimeStatus()
        .then((status) => {
          if (!disposed && requested === generation)
            setScheduledRunCount(status.queuedCount + (status.runningRunId ? 1 : 0))
        })
        .catch(() => {
          if (!disposed && requested === generation) setScheduledRunCount(0)
        })
    }
    refresh()
    const unsubscribe = window.cclinkStudio.scheduledTasks.onChanged(() => refresh())
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const handleClick = (id: ActivityPanel): void => {
    if (id === 'workspace-home') {
      void useCommandStore.getState().executeCommand('workspace.home', { source: 'toolbar' })
      return
    }
    if (id === 'sessions') {
      void useCommandStore
        .getState()
        .executeCommand(sessionsActive ? 'workbench.toggleAgentPanel' : 'agent.showConversations', {
          source: 'toolbar',
        })
      return
    }
    if (id === 'company-workspace' || id === 'company-accounts') {
      if (workspaceType === 'company') {
        openCompanyWorkspace(id === 'company-accounts' ? 'finance' : 'overview')
        return
      }
      void useCommandStore
        .getState()
        .executeCommand(id === 'company-accounts' ? 'company.finance' : 'company.overview', {
          source: 'toolbar',
        })
        .then((result) => {
          if (!result.ok)
            useToastStore.getState().show(result.message ?? '公司入口暂不可用', 'error')
        })
      return
    }
    if (agentPanelMode === 'center') {
      setAgentPanelMode('right', 'user')
      useUIStore.getState().showPanel(id)
    } else setActivePanel(id)
    if (id === 'files') void useFsStore.getState().refreshWorkspace()
    if (id === 'browser') setAgentPanelMode('right', 'user')
  }

  const handleOpenSettings = (): void => {
    openTab({ type: 'settings', title: '设置', icon: '⚙️' })
    hideSidebar()
  }

  const selectedItem =
    activePanel === 'company-workspace' && activeTab?.type === 'company-accounts'
      ? 'company-accounts'
      : sessionsActive && activePanel !== 'company-workspace'
        ? 'sessions'
        : activePanel
  const isTypeEntry = (id: ActivityPanel): boolean =>
    (workspaceType === 'company' && (id === 'company-workspace' || id === 'company-accounts')) ||
    (workspaceType === 'electronics' && id === 'production')
  const visiblePinnedTools = pinnedTools.filter((id) => !isTypeEntry(id))
  const renderGroup = (group: (typeof MAIN_ICON_GROUPS)[number]): React.ReactElement => (
    <div key={group.id} className="activity-bar-group" role="group" aria-label={group.label}>
      <div className="activity-bar-group-label" aria-hidden="true">
        {group.label}
      </div>
      {group.items.map(({ id, Icon, label, displayLabel }) => (
        <button
          type="button"
          key={id}
          className={`activity-bar-icon ${selectedItem === id ? 'active' : ''}`}
          onClick={() => handleClick(id)}
          aria-label={label}
          aria-pressed={selectedItem === id}
          title={label}
          onContextMenu={(event) => {
            event.preventDefault()
            showContextMenu({
              target: { kind: 'activity', activityId: id },
              x: event.clientX,
              y: event.clientY,
              focusReturn: event.currentTarget,
            })
          }}
          onKeyDown={(event) => {
            if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
            event.preventDefault()
            showContextMenu(
              buildKeyboardContextMenuInput(
                { kind: 'activity', activityId: id },
                event.currentTarget,
              ),
            )
          }}
        >
          <Icon size={18} />
          <span className="activity-bar-label" aria-hidden="true">
            {displayLabel ?? label}
          </span>
          {jumpsToCompany && (id === 'company-workspace' || id === 'company-accounts') && (
            <span className="activity-bar-jump" title="进入我的公司" aria-hidden="true">
              ↗
            </span>
          )}
          {id === 'scheduled-tasks' && scheduledRunCount > 0 && (
            <span
              className="activity-bar-badge"
              role="status"
              aria-label={`${scheduledRunCount} 个任务排队或运行中`}
            >
              {scheduledRunCount > 99 ? '99+' : scheduledRunCount}
            </span>
          )}
        </button>
      ))}
    </div>
  )
  return (
    <div className={`activity-bar${sidebarVisible ? '' : ' activity-bar-compact'}`}>
      <div className="activity-bar-main">
        <div className="activity-bar-group" role="group" aria-label="项目功能">
          {workspaceType === 'diary' ? (
            (['今天', '日记', '计划', '定时整理', '资料接入', 'Git'] as DiaryPage[]).map((page) => (
              <button
                key={page}
                className={`activity-bar-icon ${activePanel === 'workspace-home' && diaryPage === page ? 'active' : ''}`}
                onClick={() => {
                  useDiaryNavigation.getState().setPage(page)
                  showWorkspaceHome(activeRef)
                }}
                title={page}
                aria-label={page}
              >
                <ActivityProjectsIcon size={18} />
                <span className="activity-bar-label">{page}</span>
              </button>
            ))
          ) : workspaceType === 'company' ? (
            (
              [
                ['overview', '公司概览'],
                ['projects', '业务项目'],
                ['finance', '公司账目'],
                ['operations', '运营内容'],
              ] as [CompanySection, string][]
            ).map(([section, label]) => (
              <button
                key={section}
                className={`activity-bar-icon ${activeTab?.type === 'company-accounts' ? (section === 'finance' ? 'active' : '') : (activeTab?.type === 'company-workspace' && (activeTab.companyWorkspace?.section ?? 'overview') === section) || (activeTab?.type === 'workspace-home' && section === 'overview') ? 'active' : ''}`}
                aria-pressed={
                  activeTab?.type === 'company-accounts'
                    ? section === 'finance'
                    : (activeTab?.type === 'company-workspace' &&
                        (activeTab.companyWorkspace?.section ?? 'overview') === section) ||
                      (activeTab?.type === 'workspace-home' && section === 'overview')
                }
                onClick={() => openCompanyWorkspace(section)}
                title={label}
                aria-label={label}
              >
                <ActivityCompanyAccountsIcon size={18} />
                <span className="activity-bar-label">{label}</span>
              </button>
            ))
          ) : (
            <button
              className={`activity-bar-icon ${activePanel === 'workspace-home' ? 'active' : ''}`}
              onClick={() => handleClick('workspace-home')}
              title="工作台"
              aria-label="工作台"
            >
              <ActivityProjectsIcon size={18} />
              <span className="activity-bar-label">
                {workspaceType === 'electronics' ? '工程概览' : '项目首页'}
              </span>
            </button>
          )}
          {workspaceType === 'electronics' && (
            <button
              className="activity-bar-icon"
              onClick={() => handleClick('production')}
              title="生产资料与检查"
              aria-label="生产资料与检查"
            >
              <ActivityProductionIcon size={18} />
              <span className="activity-bar-label">生产资料与检查</span>
            </button>
          )}
        </div>
        {renderGroup({
          id: 'common',
          label: '工作',
          items: MAIN_ICON_GROUPS[0].items.filter(
            (item) => item.id === 'files' || item.id === 'sessions',
          ),
        })}
        {visiblePinnedTools.length > 0 &&
          renderGroup({
            id: 'pinned',
            label: '常用工具',
            items: visiblePinnedTools.flatMap((id) =>
              MAIN_ICON_GROUPS.flatMap((group) => group.items).filter((item) => item.id === id),
            ),
          })}
        <details
          className="activity-more"
          open={toolsExpanded}
          onToggle={(event) => {
            if (event.currentTarget.open !== toolsExpanded)
              useUIStore.getState().setToolsExpanded(event.currentTarget.open)
          }}
        >
          <summary title="工具" aria-label="工具">
            <ActivityProjectsIcon size={18} />
            <span className="activity-bar-label">工具</span>
          </summary>
          {renderGroup({
            id: 'tools',
            label: '全部工具',
            items: MAIN_ICON_GROUPS.flatMap((group) => group.items).filter(
              (item) =>
                !pinnedTools.includes(item.id) &&
                !isTypeEntry(item.id) &&
                !['workspace-home', 'files', 'sessions', 'operations', 'agent-roles'].includes(
                  item.id,
                ),
            ),
          })}
        </details>
      </div>
      <div className="activity-bar-bottom">
        <button
          type="button"
          className="activity-bar-icon"
          onClick={handleOpenSettings}
          onContextMenu={(event) => {
            event.preventDefault()
            showContextMenu({
              target: { kind: 'activity', activityId: 'settings' },
              x: event.clientX,
              y: event.clientY,
              focusReturn: event.currentTarget,
            })
          }}
          onKeyDown={(event) => {
            if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
            event.preventDefault()
            showContextMenu(
              buildKeyboardContextMenuInput(
                { kind: 'activity', activityId: 'settings' },
                event.currentTarget,
              ),
            )
          }}
          aria-label="设置"
          title="设置"
        >
          <ActivitySettingsIcon size={18} />
          <span className="activity-bar-label" aria-hidden="true">
            设置
          </span>
        </button>
      </div>
    </div>
  )
}
