import { useDiaryNavigation } from '../../features/workspace-open/personal-diary-navigation'
import { showWorkspaceHome } from '../../features/workspace-open/workspace-home-navigation'
import { openCompanyWorkspace } from '../../features/company-workspace/company-workspace-commands'
import React, { useEffect, useState } from 'react'
import {
  useUIStore,
  useTabStore,
  useCommandStore,
  useFsStore,
  useWorkspaceStore,
} from '../../stores'
import {
  IconRefresh,
  IconPencil,
  IconClipboard,
  IconClock,
  IconDollar,
  IconHeart,
  IconHistory,
  IconNewspaper,
  IconTool,
  IconList,
  IconUser,
  IconSend,
} from '../common/Icons'
import type { ActivityPanel } from '../../types'
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
  ActivityTerminalIcon,
  ActivityVideoCreationIcon,
  ActivityWebAccountsIcon,
} from './activity-bar-icons'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import { DiaryCalendar } from '../../features/workspace-open/DiaryCalendar'
import { useFixedSpacesStore } from '../../features/workspace-open/fixed-spaces-store'
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
      { id: 'workspace-home', Icon: ActivityProjectsIcon, label: '项目首页' },
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
  const personalPath = useFixedSpacesStore((state) => state.spaces?.personal?.workspacePath)
  const isPersonal = activeRef.kind === 'local' && activeRef.path === personalPath
  const activeTab = useTabStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId))
  const activePanel = useUIStore((s) => s.activePanel)
  const sidebarVisible = useUIStore((s) => s.sidebarVisible)
  const agentPanelMode = useUIStore((s) => s.agentPanelMode)
  const agentContentMode = useUIStore((s) => s.agentContentMode)
  const sessionsActive = agentPanelMode === 'right' && agentContentMode !== 'chat'
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const setAgentPanelMode = useUIStore((s) => s.setAgentPanelMode)
  const showContextMenu = useContextMenuStore((s) => s.show)
  const [scheduledRunCount, setScheduledRunCount] = useState(0)

  useEffect(() => {
    setScheduledRunCount(0)
    if (activeRef.kind !== 'local') return
    let disposed = false
    let generation = 0
    const refresh = (): void => {
      const requested = ++generation
      void window.cclinkStudio.scheduledTasks
        .inspect(activeRef.path)
        .then((status) => {
          if (!disposed && requested === generation)
            setScheduledRunCount(
              status.tasks.filter(
                (t) => t.latestRun?.status === 'queued' || t.latestRun?.status === 'running',
              ).length,
            )
        })
        .catch(() => {
          if (!disposed && requested === generation) setScheduledRunCount(0)
        })
    }
    refresh()
    const unsubscribe = window.cclinkStudio.scheduledTasks.onChanged((path) => {
      if (path === activeRef.path) refresh()
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [activeRef])

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
    // Diary spaces show the file tree inline below the navigation, so clicking 文件 again
    // folds only the tree and keeps the left column (instead of collapsing the whole sidebar).
    if (id === 'files' && workspaceType === 'diary' && activePanel === 'files' && sidebarVisible) {
      useUIStore.getState().showPanel('workspace-home')
      return
    }
    if (agentPanelMode === 'center') {
      setAgentPanelMode('right', 'user')
      useUIStore.getState().showPanel(id)
    } else setActivePanel(id)
    if (id === 'files') void useFsStore.getState().refreshWorkspace()
    if (id === 'browser') setAgentPanelMode('right', 'user')
  }

  const inSettings = activeTab?.type === 'settings'
  const selectedItem = inSettings
    ? null
    : activePanel === 'company-workspace' && activeTab?.type === 'company-accounts'
      ? 'company-accounts'
      : sessionsActive && activePanel !== 'company-workspace'
        ? 'sessions'
        : activePanel
  const isTypeEntry = (id: ActivityPanel): boolean =>
    ['company-workspace', 'company-accounts', 'cclink', 'operations', 'agent-roles'].includes(id) ||
    (workspaceType === 'electronics' && id === 'production') ||
    (workspaceType === 'diary' && id === 'scheduled-tasks')
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
          {id === 'files' && (
            <span aria-hidden="true" className="activity-bar-jump">
              ›
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
            <>
              {/* Product logic §4 / mockup 19: 今天 is the diary home, then 日记、计划、事务、定时整理、财务、健康、同步. */}
              <div className="activity-bar-group-label">
                {isPersonal ? '我的空间' : '日记与计划'}
              </div>
              {(
                [
                  ['今天', ActivityProjectsIcon],
                  ['日记', IconPencil],
                  // 科技日报 is a My Space feature (docs/features/personal-techdaily.md §2).
                  ...(isPersonal ? ([['科技日报', IconNewspaper]] as const) : []),
                  ['计划', IconClipboard],
                  // 事务 reads My Space's 「项目进度与计划」 diary section.
                  ...(isPersonal ? ([['事务', IconHistory]] as const) : []),
                  ['定时整理', IconClock],
                  // 财务、健康 gather My Space's diary header lines; sync is its own Git address
                  // (other diary projects use the Git panel).
                  ...(isPersonal
                    ? ([
                        ['财务', IconDollar],
                        ['健康', IconHeart],
                        ['Git', IconRefresh],
                      ] as const)
                    : []),
                ] as const
              ).map(([page, Icon]) => {
                const selected =
                  activePanel !== 'files' &&
                  activeTab?.type === 'workspace-home' &&
                  !activeTab.settingsSection &&
                  diaryPage === page
                return (
                  <button
                    key={page}
                    aria-current={selected ? 'page' : undefined}
                    className={`activity-bar-icon ${selected ? 'active' : ''}`}
                    onClick={() => {
                      useDiaryNavigation.getState().setPage(page)
                      if (page === '今天') handleClick('workspace-home')
                      else showWorkspaceHome(activeRef)
                    }}
                  >
                    <Icon size={18} />
                    {page === 'Git' ? '同步' : page}
                  </button>
                )
              })}
            </>
          ) : (
            <button
              className={`activity-bar-icon ${activePanel !== 'files' && activeTab?.type === 'workspace-home' && !activeTab.settingsSection ? 'active' : ''}`}
              onClick={() => handleClick('workspace-home')}
            >
              <ActivityProjectsIcon size={18} />
              项目首页
            </button>
          )}
          {workspaceType === 'company' && (
            <>
              <div className="activity-bar-group-label">公司经营</div>
              {(
                [
                  ['projects', '业务项目', IconList],
                  ['promote', '推广', IconSend],
                  ['customers', '客户与售后', IconUser],
                  ['finance', '公司账目', IconDollar],
                ] as const
              ).map(([section, label, Icon]) => {
                const current = activeTab?.companyWorkspace?.section
                const selected =
                  activeTab?.type === 'company-accounts'
                    ? section === 'finance'
                    : activeTab?.type === 'article-publishing'
                      ? section === 'promote'
                      : activeTab?.type === 'company-workspace' &&
                        (current === 'operations' ? 'promote' : current) === section
                return (
                  <button
                    key={section}
                    aria-label={label}
                    aria-pressed={selected}
                    className={`activity-bar-icon ${selected ? 'active' : ''}`}
                    onClick={() => openCompanyWorkspace(section)}
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                )
              })}
            </>
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
            <IconTool size={18} />
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
      {workspaceType === 'diary' && sidebarVisible && <DiaryCalendar />}
    </div>
  )
}
