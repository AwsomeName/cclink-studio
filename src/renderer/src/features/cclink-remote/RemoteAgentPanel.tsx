import { useEffect, useMemo, useRef, useState } from 'react'
import type { CclinkRemoteMessage } from '@shared/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import { useCclinkStore } from '../../stores'
import { IconPlus, IconRobot, IconSend } from '../../components/common/Icons'

export function RemoteAgentPanel({
  workspaceRef,
}: {
  workspaceRef: RemoteWorkspaceRef
}): React.ReactElement {
  const sessions = useCclinkStore((state) => state.sessions)
  const messages = useCclinkStore((state) => state.messages)
  const selectedSessionId = useCclinkStore((state) => state.selectedSessionId)
  const loading = useCclinkStore((state) => state.loading)
  const error = useCclinkStore((state) => state.error)
  const initialize = useCclinkStore((state) => state.initialize)
  const loadSessions = useCclinkStore((state) => state.loadSessions)
  const createSession = useCclinkStore((state) => state.createSession)
  const selectSession = useCclinkStore((state) => state.selectSession)
  const loadMessages = useCclinkStore((state) => state.loadMessages)
  const sendAgentMessage = useCclinkStore((state) => state.sendAgentMessage)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const workspaceSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.serverId === workspaceRef.endpointId &&
          (session.workspaceId === workspaceRef.workspaceId ||
            session.workspacePath === workspaceRef.path),
      ),
    [sessions, workspaceRef.endpointId, workspaceRef.path, workspaceRef.workspaceId],
  )
  const activeSession =
    workspaceSessions.find((session) => session.id === selectedSessionId) ??
    workspaceSessions[0] ??
    null
  const activeMessages = activeSession ? (messages[activeSession.id] ?? []) : []

  useEffect(() => {
    void initialize().then(() => loadSessions(workspaceRef))
  }, [
    initialize,
    loadSessions,
    workspaceRef.endpointId,
    workspaceRef.path,
    workspaceRef.workspaceId,
  ])

  useEffect(() => {
    if (activeSession && activeSession.id !== selectedSessionId) selectSession(activeSession.id)
  }, [activeSession, selectSession, selectedSessionId])

  useEffect(() => {
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [activeMessages])

  const startSession = async (): Promise<void> => {
    const session = await createSession(
      workspaceRef,
      `会话 · ${workspaceRef.label || workspaceRef.path.split(/[\\/]/u).filter(Boolean).at(-1) || '远程项目'}`,
    )
    selectSession(session.id)
    await loadMessages(session.id)
  }

  const select = (sessionId: string): void => {
    selectSession(sessionId)
    void loadMessages(sessionId)
  }

  const submit = async (): Promise<void> => {
    const content = draft.trim()
    if (!content || sending) return
    let session = activeSession
    if (!session) session = await createSession(workspaceRef, '新远程会话')
    setSending(true)
    setDraft('')
    try {
      const sent = await sendAgentMessage(workspaceRef, session.id, content)
      if (!sent) setDraft(content)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="remote-agent-panel">
      <div className="remote-agent-panel-toolbar">
        <IconRobot size={15} />
        <div className="remote-agent-panel-heading">
          <strong>远程 Agent</strong>
          <span>{workspaceRef.endpointName || workspaceRef.endpointId}</span>
        </div>
        <select
          value={activeSession?.id ?? ''}
          onChange={(event) => select(event.target.value)}
          disabled={workspaceSessions.length === 0}
          aria-label="远程会话"
        >
          {workspaceSessions.length === 0 && <option value="">暂无会话</option>}
          {workspaceSessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void startSession()}
          disabled={loading}
          title="新建远程会话"
        >
          <IconPlus size={14} />
        </button>
      </div>

      <div className="remote-agent-context">
        <span>远程 · CCLink</span>
        <strong>{workspaceRef.path}</strong>
      </div>
      {error && <div className="cclink-inline-notice error">{error}</div>}
      <div ref={listRef} className="remote-agent-messages">
        {activeMessages.length === 0 ? (
          <div className="remote-agent-empty">
            <IconRobot size={24} />
            <strong>{loading ? '正在同步远程会话…' : '开始远程工作'}</strong>
            <span>会话会在当前设备上以当前远程目录作为工作目录运行。</span>
          </div>
        ) : (
          activeMessages.map((message) => <RemoteMessage key={message.id} message={message} />)
        )}
      </div>
      <div className="remote-agent-composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder="发送到当前远程项目，Enter 发送"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.trim() || sending}
          title="发送"
        >
          <IconSend size={16} />
        </button>
      </div>
    </div>
  )
}

function RemoteMessage({ message }: { message: CclinkRemoteMessage }): React.ReactElement {
  if (message.type === 'agentTool') {
    return (
      <div className={`remote-agent-message tool ${message.tool.state}`}>
        <strong>{message.tool.name}</strong>
        <span>{message.tool.state}</span>
        {message.tool.output && <pre>{message.tool.output}</pre>}
        {message.tool.error && <pre>{message.tool.error}</pre>}
      </div>
    )
  }
  return (
    <div className={`remote-agent-message ${message.type}`}>
      <pre>{message.content}</pre>
    </div>
  )
}
