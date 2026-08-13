import { useEffect, useState } from 'react'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { RemoteStatus } from '@shared/remote-protocol'
import { useCclinkStore, useUIStore } from '../../stores'
import { IconPlus, IconRobot } from '../../components/common/Icons'

export function RemoteSessionsSidebar({
  workspaceRef,
}: {
  workspaceRef: RemoteWorkspaceRef
}): React.ReactElement {
  const sessions = useCclinkStore((state) => state.sessions)
  const selectedSessionId = useCclinkStore((state) => state.selectedSessionId)
  const loading = useCclinkStore((state) => state.loading)
  const error = useCclinkStore((state) => state.error)
  const realtimeState = useCclinkStore((state) => state.realtime.state)
  const loadSessions = useCclinkStore((state) => state.loadSessions)
  const createSession = useCclinkStore((state) => state.createSession)
  const selectSession = useCclinkStore((state) => state.selectSession)
  const loadMessages = useCclinkStore((state) => state.loadMessages)
  const setSessionArchived = useCclinkStore((state) => state.setSessionArchived)
  const setAgentPanelMode = useUIStore((state) => state.setAgentPanelMode)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null)
  const visible = sessions.filter(
    (session) =>
      (showArchived ? session.status === 'archived' : session.status !== 'archived') &&
      session.serverId === workspaceRef.endpointId &&
      (session.workspaceId === workspaceRef.workspaceId ||
        session.workspacePath === workspaceRef.path) &&
      session.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )

  useEffect(() => {
    void loadSessions(workspaceRef)
    void window.cclinkStudio.remote
      .getStatus(workspaceRef)
      .then(setRemoteStatus)
      .catch(() => {
        setRemoteStatus(null)
      })
  }, [
    loadSessions,
    realtimeState,
    workspaceRef.endpointId,
    workspaceRef.path,
    workspaceRef.workspaceId,
  ])

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
      <button
        type="button"
        className="project-panel-row project-panel-row-compact"
        disabled={
          loading ||
          remoteStatus?.state !== 'online' ||
          remoteStatus.capabilities.agent.session !== true
        }
        onClick={() =>
          void createSession(workspaceRef, `会话 · ${workspaceRef.label || '远程项目'}`).then(
            (session) => open(session.id),
          )
        }
      >
        <IconPlus size={14} />
        <span className="project-panel-row-main">
          <span className="project-panel-row-title">
            {loading
              ? '正在同步…'
              : remoteStatus && !remoteStatus.capabilities.agent.session
                ? '当前 Agent 不支持远程会话'
                : '新建远程 Agent 会话'}
          </span>
          <span className="project-panel-row-meta">{workspaceRef.path}</span>
        </span>
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
