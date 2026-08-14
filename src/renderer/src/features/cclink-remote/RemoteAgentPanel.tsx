import { useEffect, useMemo, useRef, useState } from 'react'
import type { CclinkRemoteMessage } from '@shared/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { RemoteStatus } from '@shared/remote-protocol'
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
  const realtimeState = useCclinkStore((state) => state.realtime.state)
  const initialize = useCclinkStore((state) => state.initialize)
  const loadSessions = useCclinkStore((state) => state.loadSessions)
  const createSession = useCclinkStore((state) => state.createSession)
  const selectSession = useCclinkStore((state) => state.selectSession)
  const loadMessages = useCclinkStore((state) => state.loadMessages)
  const sendAgentMessage = useCclinkStore((state) => state.sendAgentMessage)
  const pendingPermissions = useCclinkStore((state) => state.pendingPermissions)
  const respondPermission = useCclinkStore((state) => state.respondPermission)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const workspaceSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.status !== 'archived' &&
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
    void initialize().then(async () => {
      await Promise.all([
        loadSessions(workspaceRef),
        window.cclinkStudio.remote
          .getStatus(workspaceRef)
          .then(setRemoteStatus)
          .catch((statusFailure: unknown) =>
            setStatusError(
              statusFailure instanceof Error ? statusFailure.message : String(statusFailure),
            ),
          ),
      ])
    })
  }, [
    initialize,
    loadSessions,
    workspaceRef.endpointId,
    workspaceRef.path,
    workspaceRef.workspaceId,
    realtimeState,
  ])
  const agentAvailable = remoteStatus?.state === 'online' && remoteStatus.capabilities.agent.session

  useEffect(() => {
    if (activeSession && activeSession.id !== selectedSessionId) selectSession(activeSession.id)
  }, [activeSession, selectSession, selectedSessionId])

  useEffect(() => {
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [activeMessages])

  const startSession = async (): Promise<void> => {
    if (!agentAvailable) return
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
    if (!content || sending || !agentAvailable) return
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
          disabled={loading || !agentAvailable}
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
      {(statusError || (remoteStatus && !agentAvailable)) && (
        <div className="cclink-inline-notice error">
          {statusError ||
            remoteStatus?.remoteError?.message ||
            '当前 Agent 未声明远程会话/流式消息能力'}
        </div>
      )}
      {pendingPermissions
        .filter((permission) => permission.serverId === workspaceRef.endpointId)
        .map((permission) => (
          <div key={permission.requestId} className="cclink-inline-notice warning">
            <strong>远程设备请求文件权限</strong>
            <span>
              {permission.operation} · {permission.path}
            </span>
            <button
              type="button"
              onClick={() =>
                void respondPermission(permission.serverId, permission.requestId, false)
              }
            >
              拒绝
            </button>
            <button
              type="button"
              onClick={() =>
                void respondPermission(permission.serverId, permission.requestId, true)
              }
            >
              仅本次允许
            </button>
          </div>
        ))}
      <div ref={listRef} className="remote-agent-messages">
        {activeMessages.length === 0 ? (
          <div className="remote-agent-empty">
            <IconRobot size={24} />
            <strong>{loading ? '正在同步远程会话…' : '开始远程工作'}</strong>
            <span>会话会在当前设备上以当前远程目录作为工作目录运行。</span>
          </div>
        ) : (
          activeMessages.map((message) => (
            <RemoteMessage
              key={message.id}
              message={message}
              workspaceRef={workspaceRef}
              sessionId={activeSession!.id}
              reload={() => loadMessages(activeSession!.id)}
            />
          ))
        )}
      </div>
      <div className="remote-agent-composer">
        <textarea
          value={draft}
          maxLength={8192}
          disabled={!agentAvailable}
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
          disabled={!draft.trim() || sending || !agentAvailable}
          title="发送"
        >
          <IconSend size={16} />
        </button>
      </div>
    </div>
  )
}

function RemoteMessage({
  message,
  workspaceRef,
  sessionId,
  reload,
}: {
  message: CclinkRemoteMessage
  workspaceRef: RemoteWorkspaceRef
  sessionId: string
  reload(): Promise<void>
}): React.ReactElement {
  const [controlError, setControlError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  if (message.type === 'agentTool') {
    const decide = async (approved: boolean): Promise<void> => {
      const requestId = message.tool.requestId
      if (!requestId || deciding) return
      setControlError(null)
      setDeciding(true)
      try {
        const result = await window.cclinkStudio.cclink.resolveToolApproval({
          ref: workspaceRef,
          sessionId,
          requestId,
          toolUseId: message.tool.id,
          approved,
        })
        if (!result.success) throw new Error(result.error || '远程审批发送失败')
        await reload()
      } catch (error) {
        setControlError(error instanceof Error ? error.message : String(error))
      } finally {
        setDeciding(false)
      }
    }
    return (
      <div className={`remote-agent-message tool ${message.tool.state}`}>
        <strong>{message.tool.name}</strong>
        <span>{message.tool.state}</span>
        {message.tool.approvalReason && <pre>{message.tool.approvalReason}</pre>}
        {message.tool.requiresApproval && message.tool.requestId && (
          <div>
            <button type="button" disabled={deciding} onClick={() => void decide(false)}>
              拒绝
            </button>
            <button type="button" disabled={deciding} onClick={() => void decide(true)}>
              {deciding ? '等待 Agent 确认…' : '允许本次操作'}
            </button>
          </div>
        )}
        {message.tool.output && <pre>{message.tool.output}</pre>}
        {message.tool.error && <pre>{message.tool.error}</pre>}
        {controlError && <pre>{controlError}</pre>}
      </div>
    )
  }
  if (message.type === 'userQuestion') {
    return (
      <RemoteQuestion
        message={message}
        workspaceRef={workspaceRef}
        sessionId={sessionId}
        reload={reload}
      />
    )
  }
  return (
    <div className={`remote-agent-message ${message.type}`}>
      <pre>{message.content}</pre>
    </div>
  )
}

function RemoteQuestion({
  message,
  workspaceRef,
  sessionId,
  reload,
}: {
  message: Extract<CclinkRemoteMessage, { type: 'userQuestion' }>
  workspaceRef: RemoteWorkspaceRef
  sessionId: string
  reload(): Promise<void>
}): React.ReactElement {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const complete = message.questions.every((question) =>
    Boolean(answers[question.question]?.trim()),
  )
  const submit = async (): Promise<void> => {
    if (!complete || message.answered || submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await window.cclinkStudio.cclink.answerQuestion({
        ref: workspaceRef,
        sessionId,
        requestId: message.requestId,
        toolUseId: message.toolUseId,
        answers,
      })
      if (!result.success) throw new Error(result.error || '远程问题回答失败')
      await reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className="remote-agent-message question">
      <strong>Agent 需要你的选择</strong>
      {message.questions.map((question) => (
        <div key={question.id} className="remote-question-item">
          <span>{question.header || question.question}</span>
          {question.header && <small>{question.question}</small>}
          {question.options?.length && question.multiSelect ? (
            <span className="remote-question-options">
              {question.options.map((option) => {
                const selected = new Set(
                  (answers[question.question] ?? '')
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
                return (
                  <label key={option.label}>
                    <input
                      type="checkbox"
                      disabled={message.answered || submitting}
                      checked={selected.has(option.label)}
                      onChange={(event) => {
                        const next = new Set(selected)
                        if (event.target.checked) next.add(option.label)
                        else next.delete(option.label)
                        setAnswers((current) => ({
                          ...current,
                          [question.question]: [...next].join(', '),
                        }))
                      }}
                    />
                    <span>{option.label}</span>
                    {option.description && <small>{option.description}</small>}
                  </label>
                )
              })}
            </span>
          ) : question.options?.length ? (
            <select
              disabled={message.answered || submitting}
              value={answers[question.question] ?? ''}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [question.question]: event.target.value,
                }))
              }
            >
              <option value="">请选择</option>
              {question.options.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                  {option.description ? ` · ${option.description}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              disabled={message.answered || submitting}
              value={answers[question.question] ?? ''}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [question.question]: event.target.value,
                }))
              }
            />
          )}
        </div>
      ))}
      <button
        type="button"
        disabled={!complete || message.answered || submitting}
        onClick={() => void submit()}
      >
        {message.answered ? '已回答' : submitting ? '等待 Agent 确认…' : '提交回答'}
      </button>
      {error && <pre>{error}</pre>}
    </div>
  )
}
