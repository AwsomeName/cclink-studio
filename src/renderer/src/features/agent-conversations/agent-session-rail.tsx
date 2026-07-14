import type { ReactElement } from 'react'
import type { AgentSessionSummary } from './view-model'
import { IconChevronDown, IconClose, IconHistory, IconPlus } from '../../components/common/Icons'

export function AgentSessionRail({
  activeSessions,
  closedSessions,
  activeConversationId,
  showClosed,
  onToggleClosed,
  onNewConversation,
  onSwitchConversation,
  onCloseConversation,
  onRestoreConversation,
}: {
  activeSessions: AgentSessionSummary[]
  closedSessions: AgentSessionSummary[]
  activeConversationId: string
  showClosed: boolean
  onToggleClosed: () => void
  onNewConversation: () => void
  onSwitchConversation: (conversationId: string) => void
  onCloseConversation: (conversationId: string) => void
  onRestoreConversation: (conversationId: string) => void
}): ReactElement {
  return (
    <aside className="agent-session-rail" aria-label="当前项目会话">
      <div className="agent-session-rail-head">
        <button onClick={onNewConversation} title="新建当前项目会话">
          <IconPlus size={13} />
        </button>
      </div>

      <div className="agent-session-rail-list">
        {activeSessions.length === 0 ? (
          <div className="agent-session-rail-empty">无激活会话</div>
        ) : (
          activeSessions.map((session) => (
            <RailRow
              key={session.id}
              session={session}
              active={session.id === activeConversationId}
              closed={false}
              onOpen={onSwitchConversation}
              onClose={onCloseConversation}
            />
          ))
        )}
      </div>

      <div className="agent-session-rail-closed">
        <button
          className={`agent-session-rail-closed-toggle ${showClosed ? 'active' : ''}`}
          onClick={onToggleClosed}
          disabled={closedSessions.length === 0}
          title="查看已关闭历史会话"
        >
          <IconChevronDown size={11} />
          <span>历史</span>
          <em>{closedSessions.length}</em>
        </button>
        {showClosed && closedSessions.length > 0 && (
          <div className="agent-session-rail-closed-list">
            {closedSessions.map((session) => (
              <RailRow
                key={session.id}
                session={session}
                active={false}
                closed
                onOpen={onRestoreConversation}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function RailRow({
  session,
  active,
  closed,
  onOpen,
  onClose,
}: {
  session: AgentSessionSummary
  active: boolean
  closed: boolean
  onOpen: (conversationId: string) => void
  onClose?: (conversationId: string) => void
}): ReactElement {
  return (
    <div className={`agent-session-rail-row ${active ? 'active' : ''} ${closed ? 'closed' : ''}`}>
      <button
        className="agent-session-rail-main"
        onClick={() => onOpen(session.id)}
        title={`${session.title === '新会话' ? '新会话' : session.title} · ${
          session.loading
            ? '运行中'
            : session.messageCount <= 1
              ? '空会话'
              : `${session.messageCount} 条消息`
        }`}
      >
        <span className="agent-session-rail-title">
          {closed ? <IconHistory size={12} /> : sessionRailTitle(session)}
          {session.loading && <span className="agent-session-rail-busy" />}
        </span>
      </button>
      {!closed && onClose && (
        <button
          className="agent-session-rail-close"
          onClick={() => onClose(session.id)}
          title="关闭会话"
        >
          <IconClose size={11} />
        </button>
      )}
    </div>
  )
}

function sessionRailTitle(session: AgentSessionSummary): string {
  const title = session.title === '新会话' ? '新会话' : session.title.trim()
  return title || '会话'
}
