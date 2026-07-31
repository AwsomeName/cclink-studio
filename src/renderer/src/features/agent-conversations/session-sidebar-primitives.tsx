import type { ReactNode } from 'react'
import { IconChevronDown } from '../../components/common/Icons'

export type SessionSidebarStatusKind = 'active' | 'running' | 'closed' | 'error' | 'idle'

export interface SessionSidebarAction {
  label: string
  title: string
  kind?: 'default' | 'danger'
  onAction: () => void
}

export function SessionSidebarGroup({
  title,
  count,
  collapsed = false,
  collapsedText,
  onToggleCollapsed,
  showTitle = true,
  children,
}: {
  title: string
  count: number
  collapsed?: boolean
  collapsedText?: string
  onToggleCollapsed?: () => void
  showTitle?: boolean
  children: ReactNode
}): React.ReactElement | null {
  if (count === 0) return null

  return (
    <div className="session-sidebar-group">
      {showTitle &&
        (onToggleCollapsed ? (
          <button
            className="session-sidebar-group-title collapsible"
            onClick={onToggleCollapsed}
            title={collapsed ? `展开${title}` : `收起${title}`}
          >
            <span>
              <IconChevronDown size={10} className={collapsed ? 'collapsed' : ''} />
              {title}
            </span>
            <span>{count}</span>
          </button>
        ) : (
          <div className="session-sidebar-group-title">
            <span>{title}</span>
            <span>{count}</span>
          </div>
        ))}
      {collapsed ? (
        <div className="project-panel-empty compact">{collapsedText ?? '点击展开历史'}</div>
      ) : (
        children
      )}
    </div>
  )
}

export function SessionSidebarRow({
  title,
  rowTitle,
  statusKind,
  active = false,
  muted = false,
  time,
  preview,
  activity,
  activityTitle,
  meta,
  actions = [],
  onOpen,
  onContextMenu,
  onKeyDown,
}: {
  title: string
  rowTitle?: string
  statusKind: SessionSidebarStatusKind
  active?: boolean
  muted?: boolean
  time: string
  preview: string
  activity?: string
  activityTitle?: string
  meta: string
  actions?: SessionSidebarAction[]
  onOpen: () => void
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
}): React.ReactElement {
  return (
    <button
      className={`session-sidebar-row ${active ? 'active' : ''} ${muted ? 'muted' : ''}`}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      title={rowTitle ?? title}
    >
      <span className={`session-sidebar-status ${statusKind}`} />
      <span className="session-sidebar-row-main">
        <span className="session-sidebar-row-head">
          <span className="session-sidebar-row-title">{title}</span>
          <span className="session-sidebar-row-time">{time}</span>
        </span>
        <span className="session-sidebar-row-preview">{preview}</span>
        <span className="session-sidebar-row-details">
          {activity && (
            <span className="session-sidebar-row-activity" title={activityTitle}>
              {activity}
            </span>
          )}
          <span className="session-sidebar-row-meta">{meta}</span>
        </span>
      </span>
      {actions.length > 0 && (
        <span className="session-sidebar-row-actions">
          {actions.map((action) => (
            <span
              key={`${action.label}:${action.title}`}
              className={`session-sidebar-row-action ${action.kind === 'danger' ? 'danger' : ''}`}
              role="button"
              tabIndex={0}
              title={action.title}
              onClick={(event) => {
                event.stopPropagation()
                action.onAction()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  action.onAction()
                }
              }}
            >
              {action.label}
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

export function formatRelativeSessionTime(timestamp: number): string {
  if (!timestamp) return '未知'
  const normalized = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
  const diff = Date.now() - normalized
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`
  return `${Math.max(1, Math.floor(diff / 86_400_000))} 天前`
}
