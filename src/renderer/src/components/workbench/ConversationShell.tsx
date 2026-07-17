import type { HTMLAttributes, ReactNode } from 'react'
import { IconRobot } from '../common/Icons'

export type ConversationShellBadgeKind =
  | 'idle'
  | 'busy'
  | 'error'
  | 'offline'
  | 'remote'
  | 'archived'

interface ConversationShellProps {
  title: string
  subtitle: string
  chips?: string[]
  badge: string
  badgeKind?: ConversationShellBadgeKind
  variant?: 'local' | 'remote'
  error?: ReactNode | null
  context?: ReactNode
  listRef?: React.RefObject<HTMLDivElement | null>
  listProps?: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>
  empty?: ReactNode
  children: ReactNode
  composer: ReactNode
}

export function ConversationShell({
  title,
  subtitle,
  chips = [],
  badge,
  badgeKind = 'idle',
  variant = 'local',
  error,
  context,
  listRef,
  listProps,
  empty,
  children,
  composer,
}: ConversationShellProps): React.ReactElement {
  return (
    <div className={`conversation-shell ${variant}`}>
      <div className="conversation-shell-header">
        <div className="conversation-shell-mark">
          <IconRobot size={18} />
        </div>
        <div className="conversation-shell-title-block">
          <div className="conversation-shell-title">{title}</div>
          <div className="conversation-shell-subtitle">{subtitle}</div>
          {chips.length > 0 && (
            <div className="conversation-shell-meta-row">
              {chips.map((chip) => (
                <span key={chip} className="conversation-shell-meta-chip">
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={`conversation-shell-badge ${badgeKind}`}>{badge}</div>
      </div>

      {error && <div className="conversation-shell-error">{error}</div>}
      {context}

      <div
        {...listProps}
        className="conversation-shell-list conversation-copy-surface"
        ref={listRef}
      >
        {empty}
        {children}
      </div>

      <div className="conversation-shell-composer">{composer}</div>
    </div>
  )
}
