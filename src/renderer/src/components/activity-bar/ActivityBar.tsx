import React, { useEffect, useState } from 'react'
import { useUIStore, useTabStore } from '../../stores'
import type { ActivityPanel } from '../../types'
import {
  ActivityAffairsIcon,
  ActivityArticlePublishingIcon,
  ActivityBrowserIcon,
  ActivityDataSourcesIcon,
  ActivityFilesIcon,
  ActivityProductionIcon,
  ActivityProjectsIcon,
  ActivityRemoteIcon,
  ActivityRolesIcon,
  ActivityScheduledTasksIcon,
  ActivitySessionsIcon,
  ActivitySettingsIcon,
  ActivityTerminalIcon,
  ActivityWebAccountsIcon,
} from './activity-bar-icons'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'

// 项目切换暂时统一收口到顶栏；保留 Activity/Sidebar 实现，后续可直接重新启用。
const PROJECT_ACTIVITY_ENABLED = false

interface ActivityBarItem {
  id: ActivityPanel
  Icon: React.ComponentType<{ size?: number }>
  label: string
}

const MAIN_ICON_GROUPS: Array<{
  id: string
  label: string
  items: ActivityBarItem[]
}> = [
  {
    id: 'work',
    label: '工作',
    items: [
      ...(PROJECT_ACTIVITY_ENABLED
        ? [{ id: 'projects' as const, Icon: ActivityProjectsIcon, label: '项目' }]
        : []),
      { id: 'files', Icon: ActivityFilesIcon, label: '文件' },
      { id: 'sessions', Icon: ActivitySessionsIcon, label: '会话' },
      { id: 'browser', Icon: ActivityBrowserIcon, label: '浏览器' },
      { id: 'terminal', Icon: ActivityTerminalIcon, label: 'Terminal' },
    ],
  },
  {
    id: 'resources',
    label: '资源',
    items: [
      { id: 'agent-roles', Icon: ActivityRolesIcon, label: '角色' },
      { id: 'operations', Icon: ActivityWebAccountsIcon, label: '网站与账号' },
      { id: 'data-sources', Icon: ActivityDataSourcesIcon, label: '数据源' },
      { id: 'cclink', Icon: ActivityRemoteIcon, label: 'CCLink 远程' },
    ],
  },
  {
    id: 'flows',
    label: '流程',
    items: [
      { id: 'article-publishing', Icon: ActivityArticlePublishingIcon, label: '文章发布' },
      { id: 'affairs', Icon: ActivityAffairsIcon, label: '事务' },
      { id: 'scheduled-tasks', Icon: ActivityScheduledTasksIcon, label: '定时任务' },
      { id: 'production', Icon: ActivityProductionIcon, label: '生产' },
    ],
  },
]

export function ActivityBar(): React.ReactElement {
  const activePanel = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const hideSidebar = useUIStore((s) => s.hideSidebar)
  const openTab = useTabStore((s) => s.openTab)
  const showContextMenu = useContextMenuStore((s) => s.show)
  const [scheduledRunCount, setScheduledRunCount] = useState(0)

  useEffect(() => {
    const refresh = (): void => {
      void window.cclinkStudio.scheduledTasks
        .getRuntimeStatus()
        .then((status) => setScheduledRunCount(status.queuedCount + (status.runningRunId ? 1 : 0)))
        .catch(() => setScheduledRunCount(0))
    }
    refresh()
    return window.cclinkStudio.scheduledTasks.onChanged(() => refresh())
  }, [])

  const handleClick = (id: ActivityPanel): void => {
    setActivePanel(id)
  }

  const handleOpenSettings = (): void => {
    openTab({ type: 'settings', title: '设置', icon: '⚙️' })
    hideSidebar()
  }

  return (
    <div className="activity-bar">
      <div className="activity-bar-main">
        {MAIN_ICON_GROUPS.map((group) => (
          <div key={group.id} className="activity-bar-group" role="group" aria-label={group.label}>
            {group.items.map(({ id, Icon, label }) => (
              <button
                type="button"
                key={id}
                className={`activity-bar-icon ${activePanel === id ? 'active' : ''}`}
                onClick={() => handleClick(id)}
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
                aria-label={label}
                title={label}
              >
                <Icon size={24} />
                {id === 'scheduled-tasks' && scheduledRunCount > 0 && (
                  <span
                    className="activity-bar-badge"
                    aria-label={`${scheduledRunCount} 个任务运行中`}
                  >
                    {scheduledRunCount > 99 ? '99+' : scheduledRunCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
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
          <ActivitySettingsIcon size={24} />
        </button>
      </div>
    </div>
  )
}
