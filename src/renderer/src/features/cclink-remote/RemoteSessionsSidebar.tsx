import { useState } from 'react'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import { useCclinkStore, useUIStore } from '../../stores'
import { IconRobot } from '../../components/common/Icons'

export function RemoteSessionsSidebar({
  workspaceRef,
}: {
  workspaceRef: RemoteWorkspaceRef
}): React.ReactElement {
  const sessions = useCclinkStore((state) => state.sessions)
  const selectedSessionId = useCclinkStore((state) => state.selectedSessionId)
  const loading = useCclinkStore((state) => state.loading)
  const error = useCclinkStore((state) => state.error)
  const selectSession = useCclinkStore((state) => state.selectSession)
  const loadMessages = useCclinkStore((state) => state.loadMessages)
  const setSessionArchived = useCclinkStore((state) => state.setSessionArchived)
  const setAgentPanelMode = useUIStore((state) => state.setAgentPanelMode)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = sessions.filter((session) => {
    const searchable = [
      session.name,
      session.workspacePath,
      session.serverId,
      session.status === 'active'
        ? '响应中 active'
        : session.status === 'archived'
          ? '已归档 archived'
          : '空闲 idle',
      workspaceRef.endpointName ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase()
    return (
      (showArchived ? session.status === 'archived' : session.status !== 'archived') &&
      session.serverId === workspaceRef.endpointId &&
      session.workspaceId === workspaceRef.workspaceId &&
      searchable.includes(normalizedQuery)
    )
  })

  const open = (sessionId: string): void => {
    selectSession(sessionId)
    void loadMessages(sessionId)
    setAgentPanelMode('right', 'user')
  }

  return (
    <div className="sidebar-section">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索远程会话"
        aria-label="搜索远程会话"
      />
      <button type="button" onClick={() => setShowArchived((value) => !value)}>
        {showArchived ? '返回当前会话' : '查看已归档会话'}
      </button>
      {error && <div className="project-panel-empty terminal-sidebar-error">{error}</div>}
      {visible.length === 0 && !loading ? (
        <div className="project-panel-empty">当前远程项目暂无会话</div>
      ) : (
        visible.map((session) => (
          <div key={session.id} className="project-panel-row">
            <button
              type="button"
              className={session.id === selectedSessionId ? 'active' : ''}
              onClick={() => open(session.id)}
            >
              <IconRobot size={14} />
              <span className="project-panel-row-main">
                <span className="project-panel-row-title">{session.name}</span>
                <span className="project-panel-row-meta">
                  {session.status === 'active'
                    ? '响应中'
                    : session.status === 'archived'
                      ? '已归档'
                      : '空闲'}{' '}
                  · {session.messageCount} 条消息
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void setSessionArchived(session.id, session.status !== 'archived')}
            >
              {session.status === 'archived' ? '恢复' : '归档'}
            </button>
          </div>
        ))
      )}
    </div>
  )
}
