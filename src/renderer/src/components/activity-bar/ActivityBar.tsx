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
  const activeRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const companyPath = useFixedSpacesStore((state) => state.spaces?.company?.workspacePath)
  const activeTab = useTabStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId))
  const jumpsToCompany = activeRef.kind !== 'local' || activeRef.path !== companyPath
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
    setActivePanel(id)
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
        {MAIN_ICON_GROUPS.filter((group) => group.id !== 'more').map(renderGroup)}
        <details
          className="activity-more"
          open={MAIN_ICON_GROUPS[4].items.some((item) => item.id === activePanel) || undefined}
        >
          <summary title="更多工具">
            <ActivityProjectsIcon size={18} />
            <span className="activity-bar-label">更多工具</span>
          </summary>
          {renderGroup(MAIN_ICON_GROUPS[4])}
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
