import { useEffect, useMemo, useRef, useState } from 'react'
import type { CclinkRemoteMessage } from '@shared/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { RemoteStatus } from '@shared/remote-protocol'
import { useCclinkStore } from '../../stores'
import { IconPlus, IconRobot, IconSend } from '../../components/common/Icons'
import { ContentBlockRenderer } from '../../components/common/ConversationMessageRenderer'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'

export interface RemoteAgentVisualStatus {
  tone: 'connecting' | 'ready' | 'working' | 'unavailable'
  label: string
  detail: string
}

export function resolveRemoteAgentVisualStatus(input: {
  statusError: string | null
  remoteStatus: RemoteStatus | null
  sessionStatus?: 'active' | 'idle' | 'archived'
}): RemoteAgentVisualStatus {
  if (input.statusError) {
    return { tone: 'unavailable', label: 'Agent 不可用', detail: input.statusError }
  }
  if (!input.remoteStatus) {
    return { tone: 'connecting', label: 'Agent 连接中', detail: '正在确认远程能力' }
  }
  if (input.remoteStatus.state !== 'online') {
    return {
      tone: 'unavailable',
      label: 'Agent 离线',
      detail: input.remoteStatus.remoteError?.message || '远程设备当前不可用',
    }
  }
  if (input.remoteStatus.compatibility === 'upgrade-required') {
    return {
      tone: 'unavailable',
      label: 'Agent 需升级',
      detail: '远程 Agent 协议版本不兼容',
    }
  }
  if (
    !input.remoteStatus.capabilities.agent.session ||
    !input.remoteStatus.capabilities.agent.stream
  ) {
    return {
      tone: 'unavailable',
      label: 'Agent 不可用',
      detail: '当前 Agent 未声明远程会话/流式消息能力',
    }
  }
  if (input.sessionStatus === 'active') {
    return { tone: 'working', label: 'Agent 正在工作', detail: '正在处理当前会话' }
  }
  return {
    tone: 'ready',
    label: 'Agent 就绪',
    detail: input.sessionStatus === 'idle' ? '等待你的消息' : '可以新建远程会话',
  }
}

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
          session.workspaceId === workspaceRef.workspaceId,
      ),
    [sessions, workspaceRef.endpointId, workspaceRef.path, workspaceRef.workspaceId],
  )
  const activeSession =
    workspaceSessions.find((session) => session.id === selectedSessionId) ??
    workspaceSessions[0] ??
    null
  const activeMessages = activeSession ? (messages[activeSession.id] ?? []) : []

  useEffect(() => {
    setStatusError(null)
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
  const agentAvailable =
    remoteStatus?.state === 'online' &&
    remoteStatus.compatibility !== 'upgrade-required' &&
    remoteStatus.capabilities.agent.session &&
    remoteStatus.capabilities.agent.stream
  const agentVisualStatus = resolveRemoteAgentVisualStatus({
    statusError,
    remoteStatus,
    sessionStatus: activeSession?.status,
  })

  useEffect(() => {
    if (!remoteStatus?.remoteError?.retryable) return
    const timer = window.setTimeout(() => {
      setStatusError(null)
      void window.cclinkStudio.remote
        .getStatus(workspaceRef)
        .then(setRemoteStatus)
        .catch((statusFailure: unknown) =>
          setStatusError(
            statusFailure instanceof Error ? statusFailure.message : String(statusFailure),
          ),
        )
    }, 5_000)
    return () => window.clearTimeout(timer)
  }, [remoteStatus, workspaceRef.endpointId, workspaceRef.path, workspaceRef.workspaceId])

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
        <div
          className={`remote-agent-status ${agentVisualStatus.tone}`}
          role="status"
          aria-live="polite"
          title={agentVisualStatus.detail}
        >
          <span className="remote-agent-status-dot" />
          <span>{agentVisualStatus.label}</span>
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
      <div ref={listRef} className="remote-agent-messages agent-messages conversation-copy-surface">
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

export function RemoteMessage({
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
    const stateLabels = {
      pending: '等待执行',
      executing: '正在执行',
      completed: '执行完成',
      failed: '执行失败',
      denied: '已拒绝',
    } as const
    const resultContent =
      message.tool.error ||
      message.tool.output ||
      (message.tool.state === 'completed' ||
      message.tool.state === 'failed' ||
      message.tool.state === 'denied'
        ? stateLabels[message.tool.state]
        : null)
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
      <div className="agent-message assistant remote-agent-tool-message">
        <ContentBlockRenderer
          block={{
            type: 'tool_use',
            id: message.tool.id,
            name: message.tool.name,
            input: message.tool.input ?? {},
          }}
        />
        {resultContent && (
          <ContentBlockRenderer
            block={{
              type: 'tool_result',
              tool_use_id: message.tool.id,
              content: resultContent,
              is_error: message.tool.state === 'failed' || message.tool.state === 'denied',
            }}
          />
        )}
        {(message.tool.state === 'pending' || message.tool.state === 'executing') && (
          <div className={`remote-tool-progress ${message.tool.state}`} role="status">
            <span />
            {stateLabels[message.tool.state]}
          </div>
        )}
        {message.tool.approvalReason && (
          <div className="remote-tool-approval-reason">{message.tool.approvalReason}</div>
        )}
        {message.tool.requiresApproval && message.tool.requestId && (
          <div className="remote-tool-actions">
            <button
              className="confirm-reject-btn"
              type="button"
              disabled={deciding}
              onClick={() => void decide(false)}
            >
              拒绝
            </button>
            <button
              className="confirm-approve-btn"
              type="button"
              disabled={deciding}
              onClick={() => void decide(true)}
            >
              {deciding ? '等待 Agent 确认…' : '允许本次操作'}
            </button>
          </div>
        )}
        {controlError && <div className="remote-tool-control-error">{controlError}</div>}
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
  if (message.type === 'agentText') {
    return (
      <div className="agent-message assistant">
        <ConversationMarkdown source={message.content} />
      </div>
    )
  }
  return (
    <div className={`agent-message ${message.type === 'user' ? 'user' : 'system'}`}>
      <div className="content-text">{message.content}</div>
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
    <div className="agent-message assistant remote-agent-question">
      <div className="remote-agent-question-card">
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
        {error && <div className="remote-tool-control-error">{error}</div>}
      </div>
    </div>
  )
}
