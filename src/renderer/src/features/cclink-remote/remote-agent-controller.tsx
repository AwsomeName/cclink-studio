import { useEffect, useMemo, useRef, useState } from 'react'
import type { CclinkRemoteSession } from '@shared/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { RemoteStatus } from '@shared/remote-protocol'
import type { RemoteDiagnosticReport } from '@shared/remote-protocol'
import { useCclinkStore } from '../../stores'
import { IconClipboard, IconRobot, IconSend, IconStop } from '../../components/common/Icons'
import { useToastStore } from '../../components/common/Toast'
import { APP_VERSION } from '../../app-metadata'
import { buildRemoteAgentDiagnosticMarkdown } from '../diagnostics/remote-agent-diagnostic-report'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  AgentComposer,
  AgentMessageList,
  AgentPanelSurface,
  type AgentPanelVariant,
} from '../../components/agent-panel/agent-panel-surface'
import { isWorkspaceTargetCurrent, type WorkspaceTarget } from '../../stores/workspace-store'
import { RemoteAgentMessage } from './remote-agent-message'

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

export type RemoteDraftSubmissionResult = 'submitted' | 'rejected' | 'stale-target'

export interface RemoteSubmissionLock {
  current: boolean
}

export function tryAcquireRemoteSubmissionLock(lock: RemoteSubmissionLock): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

export function resolveRemoteStopAvailability(
  sessionStatus: CclinkRemoteSession['status'] | undefined,
): { state: 'disabled'; reason: string } | { state: 'hidden' } {
  if (sessionStatus === 'active') {
    return { state: 'disabled', reason: '当前远程 Agent 不支持停止' }
  }
  return { state: 'hidden' }
}

export async function submitRemoteDraft(input: {
  target: WorkspaceTarget
  workspaceRef: RemoteWorkspaceRef
  activeSession: CclinkRemoteSession | null
  content: string
  isTargetCurrent(target: WorkspaceTarget): boolean
  createSession(
    ref: RemoteWorkspaceRef,
    name: string,
    options: { select: false },
  ): Promise<CclinkRemoteSession>
  selectSession(sessionId: string): void
  sendAgentMessage(ref: RemoteWorkspaceRef, sessionId: string, content: string): Promise<boolean>
}): Promise<RemoteDraftSubmissionResult> {
  if (!input.isTargetCurrent(input.target)) return 'stale-target'

  let session = input.activeSession
  try {
    if (!session) {
      session = await input.createSession(input.workspaceRef, '新远程会话', { select: false })
    }
    if (!input.isTargetCurrent(input.target)) return 'stale-target'

    input.selectSession(session.id)
    const sent = await input.sendAgentMessage(input.workspaceRef, session.id, input.content)
    return sent ? 'submitted' : 'rejected'
  } catch {
    return 'rejected'
  }
}

export function RemoteAgentController({
  workspaceRef,
  workspaceGeneration,
  variant,
}: {
  workspaceRef: RemoteWorkspaceRef
  workspaceGeneration: number
  variant: AgentPanelVariant
}): React.ReactElement {
  const sessions = useCclinkStore((state) => state.sessions)
  const messages = useCclinkStore((state) => state.messages)
  const selectedSessionId = useCclinkStore((state) => state.selectedSessionId)
  const loading = useCclinkStore((state) => state.loading)
  const error = useCclinkStore((state) => state.error)
  const realtimeState = useCclinkStore((state) => state.realtime.state)
  const initialize = useCclinkStore((state) => state.initialize)
  const createSession = useCclinkStore((state) => state.createSession)
  const selectSession = useCclinkStore((state) => state.selectSession)
  const loadMessages = useCclinkStore((state) => state.loadMessages)
  const sendAgentMessage = useCclinkStore((state) => state.sendAgentMessage)
  const pendingPermissions = useCclinkStore((state) => state.pendingPermissions)
  const respondPermission = useCclinkStore((state) => state.respondPermission)
  const showToast = useToastStore((state) => state.show)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [copyingDiagnostics, setCopyingDiagnostics] = useState(false)
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const submissionLockRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const workspaceTarget = useMemo<WorkspaceTarget>(
    () => ({ ref: workspaceRef, generation: workspaceGeneration }),
    [workspaceGeneration, workspaceRef],
  )
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
    let cancelled = false
    setStatusError(null)
    void initialize().then(() =>
      window.cclinkStudio.remote
        .getStatus(workspaceRef)
        .then((status) => {
          if (!cancelled) setRemoteStatus(status)
        })
        .catch((statusFailure: unknown) => {
          if (!cancelled) {
            setStatusError(
              statusFailure instanceof Error ? statusFailure.message : String(statusFailure),
            )
          }
        }),
    )
    return () => {
      cancelled = true
    }
  }, [
    initialize,
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
  const stopAvailability = resolveRemoteStopAvailability(activeSession?.status)

  useEffect(() => {
    if (!remoteStatus?.remoteError?.retryable) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setStatusError(null)
      void window.cclinkStudio.remote
        .getStatus(workspaceRef)
        .then((status) => {
          if (!cancelled) setRemoteStatus(status)
        })
        .catch((statusFailure: unknown) => {
          if (!cancelled) {
            setStatusError(
              statusFailure instanceof Error ? statusFailure.message : String(statusFailure),
            )
          }
        })
    }, 5_000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [remoteStatus, workspaceRef.endpointId, workspaceRef.path, workspaceRef.workspaceId])

  useEffect(() => {
    if (activeSession && activeSession.id !== selectedSessionId) selectSession(activeSession.id)
  }, [activeSession, selectSession, selectedSessionId])

  useEffect(() => {
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [activeMessages])

  const submit = async (): Promise<void> => {
    const content = draft.trim()
    if (!content || !agentAvailable || !tryAcquireRemoteSubmissionLock(submissionLockRef)) return
    setSending(true)
    try {
      const result = await submitRemoteDraft({
        target: workspaceTarget,
        workspaceRef,
        activeSession,
        content,
        isTargetCurrent: isWorkspaceTargetCurrent,
        createSession,
        selectSession,
        sendAgentMessage,
      })
      if (result === 'submitted') {
        setDraft((current) => (current.trim() === content ? '' : current))
      }
    } finally {
      submissionLockRef.current = false
      setSending(false)
    }
  }

  const copyDiagnostics = async (): Promise<void> => {
    if (!activeSession || copyingDiagnostics) return
    setCopyingDiagnostics(true)
    try {
      let collectionError: string | null = null
      let report: RemoteDiagnosticReport
      try {
        report = await window.cclinkStudio.remote.diagnose(workspaceRef, activeSession.id)
      } catch (error) {
        collectionError = error instanceof Error ? error.message : String(error)
        report = await window.cclinkStudio.remote.diagnose(workspaceRef)
        report = {
          ...report,
          agentSession: {
            session: activeSession,
            messages: activeMessages.slice(-100),
            messageLimit: 100,
            events: [],
            eventLimit: 0,
            processLocalOnly: true,
          },
        }
      }
      await copyTextToClipboard(
        buildRemoteAgentDiagnosticMarkdown({
          appVersion: APP_VERSION,
          platform: navigator.platform,
          report,
          collectionError,
        }),
      )
      showToast('远程 Agent 诊断日志已复制', 'success')
    } catch (error) {
      showToast(
        `复制远程诊断日志失败: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
    } finally {
      setCopyingDiagnostics(false)
    }
  }

  return (
    <AgentPanelSurface variant={variant} runtime="remote" className="agent-panel-remote">
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
        <button
          type="button"
          onClick={() => void copyDiagnostics()}
          disabled={!activeSession || copyingDiagnostics}
          title={activeSession ? '复制远程 Agent 诊断日志' : '当前没有远程会话'}
          aria-label="复制远程 Agent 诊断日志"
        >
          <IconClipboard size={14} />
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
      <AgentMessageList listRef={listRef} className="remote-agent-messages">
        {activeMessages.length === 0 ? (
          <div className="remote-agent-empty">
            <IconRobot size={24} />
            <strong>{loading ? '正在同步远程会话…' : '开始远程工作'}</strong>
            <span>会话会在当前设备上以当前远程目录作为工作目录运行。</span>
          </div>
        ) : (
          activeMessages.map((message) => (
            <RemoteAgentMessage
              key={message.id}
              message={message}
              workspaceRef={workspaceRef}
              sessionId={activeSession!.id}
              reload={() => loadMessages(activeSession!.id)}
            />
          ))
        )}
      </AgentMessageList>
      <AgentComposer
        containerClassName="agent-composer-wrap agent-composer-remote"
        inputContainerClassName="agent-input-card agent-input-card-remote"
        textareaClassName="agent-input agent-input-remote"
        value={draft}
        maxLength={8192}
        disabled={!agentAvailable}
        onChange={setDraft}
        onSubmit={submit}
        canSubmit={Boolean(draft.trim()) && agentAvailable && stopAvailability.state === 'hidden'}
        submitting={sending}
        placeholder="发送到当前远程工作空间，Enter 发送"
        rows={2}
        renderTrailing={({ submit: submitMessage, canSubmit }) =>
          stopAvailability.state === 'disabled' ? (
            <span className="agent-disabled-action" title={stopAvailability.reason}>
              <button
                type="button"
                className="agent-abort-btn"
                disabled
                aria-label={stopAvailability.reason}
              >
                <IconStop size={15} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="agent-send-btn"
              onClick={submitMessage}
              disabled={!canSubmit}
              title="发送"
            >
              <IconSend size={16} />
            </button>
          )
        }
      />
    </AgentPanelSurface>
  )
}
