import type { ReactElement } from 'react'
import type {
  AgentSessionGroup,
  AgentSessionStats,
  AgentSessionSummary,
  SessionFilter,
} from './view-model'
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconFile,
  IconHistory,
  IconPlus,
  IconRobot,
  IconSearch,
} from '../../components/common/Icons'

export function AgentSessionHistory({
  groups,
  archivedSessions,
  stats,
  searchQuery,
  filter,
  showArchived,
  selectedSessionId,
  selectedArchivedSessionId,
  resultCount,
  archivedResultCount,
  archivedTotal,
  onToggleArchived,
  onSearchChange,
  onFilterChange,
  onNewConversation,
  onSwitchConversation,
  onArchiveConversation,
  onOpenAsWorkConversation,
  onRestoreConversation,
  onDeleteArchivedConversation,
  onInspectConversation,
}: {
  groups: AgentSessionGroup[]
  archivedSessions: AgentSessionSummary[]
  stats: AgentSessionStats
  searchQuery: string
  filter: SessionFilter
  showArchived: boolean
  selectedSessionId: string | null
  selectedArchivedSessionId: string | null
  resultCount: number
  archivedResultCount: number
  archivedTotal: number
  onToggleArchived: () => void
  onSearchChange: (value: string) => void
  onFilterChange: (value: SessionFilter) => void
  onNewConversation: () => void
  onSwitchConversation: (conversationId: string) => void
  onArchiveConversation: (conversationId: string) => void
  onOpenAsWorkConversation: (conversationId: string) => void
  onRestoreConversation: (conversationId: string) => void
  onDeleteArchivedConversation: (conversationId: string) => void
  onInspectConversation: (conversationId: string) => void
}): ReactElement {
  return (
    <div className="agent-session-hub">
      <div className="agent-session-hub-head">
        <div className="agent-session-hub-title">
          <IconHistory size={13} />
          <span>历史会话</span>
          <em>{resultCount}</em>
        </div>
        <button
          className="agent-session-hub-new"
          onClick={onNewConversation}
          title="新建即时助手会话"
        >
          <IconPlus size={13} />
        </button>
      </div>

      <div className="agent-session-search">
        <IconSearch size={12} />
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索标题、摘要、工作区"
        />
      </div>

      <div className="agent-session-filters" role="tablist" aria-label="会话过滤">
        <FilterButton
          label="全部"
          count={stats.total}
          value="all"
          active={filter === 'all'}
          onChange={onFilterChange}
        />
        <FilterButton
          label="本工作区"
          count={stats.workspaceBound}
          value="workspace"
          active={filter === 'workspace'}
          onChange={onFilterChange}
        />
        <FilterButton
          label="未绑定"
          count={stats.unbound}
          value="unbound"
          active={filter === 'unbound'}
          onChange={onFilterChange}
        />
        <FilterButton
          label="运行中"
          count={stats.running}
          value="running"
          active={filter === 'running'}
          onChange={onFilterChange}
        />
      </div>

      <div className="agent-session-groups">
        {groups.length === 0 ? (
          <div className="agent-session-empty">没有匹配的会话</div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="agent-session-group">
              <div className="agent-session-group-label">{group.label}</div>
              {group.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  archived={false}
                  selected={selectedSessionId === session.id}
                  onActivate={onSwitchConversation}
                  onArchive={onArchiveConversation}
                  onOpenAsWork={onOpenAsWorkConversation}
                  onInspect={onInspectConversation}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {archivedTotal > 0 && (
        <div className="agent-archived-section">
          <button
            className={`agent-archived-toggle ${showArchived ? 'active' : ''}`}
            onClick={onToggleArchived}
            title="查看已归档会话"
          >
            <IconChevronDown size={11} />
            <span>已归档</span>
            <em>{archivedResultCount}</em>
          </button>
          {showArchived && (
            <div className="agent-archived-list">
              {archivedSessions.length === 0 ? (
                <div className="agent-session-empty">没有匹配的归档会话</div>
              ) : (
                archivedSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    archived
                    selected={selectedArchivedSessionId === session.id}
                    onActivate={onRestoreConversation}
                    onDelete={onDeleteArchivedConversation}
                    onInspect={onInspectConversation}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SessionRow({
  session,
  archived,
  selected,
  onActivate,
  onArchive,
  onOpenAsWork,
  onDelete,
  onInspect,
}: {
  session: AgentSessionSummary
  archived: boolean
  selected: boolean
  onActivate: (conversationId: string) => void
  onArchive?: (conversationId: string) => void
  onOpenAsWork?: (conversationId: string) => void
  onDelete?: (conversationId: string) => void
  onInspect: (conversationId: string) => void
}): ReactElement {
  return (
    <div
      className={`agent-session-row ${session.isActive ? 'active' : ''} ${selected ? 'selected' : ''} ${archived ? 'archived' : ''}`}
    >
      <button
        className="agent-session-row-main"
        onClick={() => onActivate(session.id)}
        title={session.sessionId ?? session.title}
      >
        <span className="agent-session-row-icon">
          {session.isWorkspaceBound ? <IconFile size={12} /> : <IconRobot size={12} />}
        </span>
        <span className="agent-session-row-body">
          <span className="agent-session-row-title">
            {session.title}
            {session.loading && <span className="agent-session-row-busy" />}
          </span>
          <span className="agent-session-row-preview">{session.preview}</span>
          <span className="agent-session-row-meta">
            <span>{session.subtitle}</span>
            <span>{session.messageCount} 条消息</span>
          </span>
        </span>
      </button>
      <div className="agent-session-row-actions">
        <button
          className="agent-session-row-action"
          onClick={() => onInspect(session.id)}
          title="查看会话详情"
        >
          <IconChevronRight size={11} />
        </button>
        {!archived && onOpenAsWork && (
          <button
            className="agent-session-row-action"
            onClick={() => onOpenAsWork(session.id)}
            title="移到当前工作空间，作为工作会话打开"
          >
            <IconFile size={11} />
          </button>
        )}
        {!archived && onArchive && (
          <button
            className="agent-session-row-action"
            onClick={() => onArchive(session.id)}
            title="归档会话"
          >
            <IconClose size={11} />
          </button>
        )}
        {archived && onDelete && (
          <button
            className="agent-session-row-action danger"
            onClick={() => onDelete(session.id)}
            title="永久删除会话"
          >
            <IconClose size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

function FilterButton({
  label,
  count,
  value,
  active,
  onChange,
}: {
  label: string
  count: number
  value: SessionFilter
  active: boolean
  onChange: (value: SessionFilter) => void
}): ReactElement {
  return (
    <button
      className={`agent-session-filter ${active ? 'active' : ''}`}
      onClick={() => onChange(value)}
      role="tab"
      aria-selected={active}
    >
      <span>{label}</span>
      <em>{count}</em>
    </button>
  )
}
