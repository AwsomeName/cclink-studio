import { useEffect } from 'react'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
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
  const loadSessions = useCclinkStore((state) => state.loadSessions)
  const createSession = useCclinkStore((state) => state.createSession)
  const selectSession = useCclinkStore((state) => state.selectSession)
  const loadMessages = useCclinkStore((state) => state.loadMessages)
  const setAgentPanelMode = useUIStore((state) => state.setAgentPanelMode)
  const visible = sessions.filter(
    (session) =>
      session.serverId === workspaceRef.endpointId &&
      (session.workspaceId === workspaceRef.workspaceId ||
        session.workspacePath === workspaceRef.path),
  )

  useEffect(() => {
    void loadSessions(workspaceRef)
  }, [loadSessions, workspaceRef.endpointId, workspaceRef.path, workspaceRef.workspaceId])

  const open = (sessionId: string): void => {
    selectSession(sessionId)
    void loadMessages(sessionId)
    setAgentPanelMode('right', 'user')
  }

  return (
    <div className="sidebar-section">
      <button
        type="button"
        className="project-panel-row project-panel-row-compact"
        disabled={loading}
        onClick={() =>
          void createSession(workspaceRef, `会话 · ${workspaceRef.label || '远程项目'}`).then(
            (session) => open(session.id),
          )
        }
      >
        <IconPlus size={14} />
        <span className="project-panel-row-main">
          <span className="project-panel-row-title">
            {loading ? '正在同步…' : '新建远程 Agent 会话'}
          </span>
          <span className="project-panel-row-meta">{workspaceRef.path}</span>
        </span>
      </button>
      {error && <div className="project-panel-empty terminal-sidebar-error">{error}</div>}
      {visible.length === 0 && !loading ? (
        <div className="project-panel-empty">当前远程项目暂无会话</div>
      ) : (
        visible.map((session) => (
          <button
            key={session.id}
            type="button"
            className={`project-panel-row ${session.id === selectedSessionId ? 'active' : ''}`}
            onClick={() => open(session.id)}
          >
            <IconRobot size={14} />
            <span className="project-panel-row-main">
              <span className="project-panel-row-title">{session.name}</span>
              <span className="project-panel-row-meta">
                {session.status === 'active' ? '响应中' : '空闲'} · {session.messageCount} 条消息
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  )
}
