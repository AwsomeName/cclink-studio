import { useEffect, useMemo, useRef, useState } from 'react'
import type { CclinkRemoteSession } from '@shared/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { RemoteStatus } from '@shared/remote-protocol'
import type { RemoteDiagnosticReport } from '@shared/remote-protocol'
import type { CclinkRemoteMessage } from '@shared/cclink'
import { useCclinkStore } from '../../stores'
import { useToastStore } from '../../components/common/Toast'
import { APP_VERSION } from '../../app-metadata'
import { buildRemoteAgentDiagnosticMarkdown } from '../diagnostics/remote-agent-diagnostic-report'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  AgentPanelView,
  type AgentPanelPermissionModel,
  type AgentPanelTimelineItem,
  type AgentPanelVariant,
} from '../../components/agent-panel/agent-panel-view'
import { isWorkspaceTargetCurrent, type WorkspaceTarget } from '../../stores/workspace-store'
import { workspaceRefKey } from '@shared/workspace-ref'
import type { AgentMessage } from '../../types'

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
  const [controlStates, setControlStates] = useState<
    Record<string, { submitting: boolean; error: string | null }>
  >({})
  const submissionLockRef = useRef(false)
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

  const updateControlState = (
    id: string,
    next: { submitting: boolean; error: string | null },
  ): void => setControlStates((current) => ({ ...current, [id]: next }))

  const decideToolApproval = async (
    message: Extract<CclinkRemoteMessage, { type: 'agentTool' }>,
    approved: boolean,
  ): Promise<void> => {
    if (!activeSession || !message.tool.requestId || controlStates[message.id]?.submitting) return
    updateControlState(message.id, { submitting: true, error: null })
    try {
      const result = await window.cclinkStudio.cclink.resolveToolApproval({
        ref: workspaceRef,
        sessionId: activeSession.id,
        requestId: message.tool.requestId,
        toolUseId: message.tool.id,
        approved,
      })
      if (!result.success) throw new Error(result.error || '远程审批发送失败')
      await loadMessages(activeSession.id)
      updateControlState(message.id, { submitting: false, error: null })
    } catch (failure) {
      updateControlState(message.id, {
        submitting: false,
        error: failure instanceof Error ? failure.message : String(failure),
      })
    }
  }

  const answerQuestion = async (
    message: Extract<CclinkRemoteMessage, { type: 'userQuestion' }>,
    answers: Record<string, string>,
  ): Promise<void> => {
    if (!activeSession || controlStates[message.id]?.submitting) return
    updateControlState(message.id, { submitting: true, error: null })
    try {
      const result = await window.cclinkStudio.cclink.answerQuestion({
        ref: workspaceRef,
        sessionId: activeSession.id,
        requestId: message.requestId,
        toolUseId: message.toolUseId,
        answers,
      })
      if (!result.success) throw new Error(result.error || '远程问题回答失败')
      await loadMessages(activeSession.id)
      updateControlState(message.id, { submitting: false, error: null })
    } catch (failure) {
      updateControlState(message.id, {
        submitting: false,
        error: failure instanceof Error ? failure.message : String(failure),
      })
    }
  }

  const conversationId = activeSession?.id ?? `remote:${workspaceRef.workspaceId}`
  const remoteWorkspaceKey = workspaceRefKey(workspaceRef)
  const timeline = activeMessages.flatMap((message): AgentPanelTimelineItem[] => {
    if (message.type === 'userQuestion') {
      return [
        {
          kind: 'question',
          id: message.id,
          question: {
            id: message.id,
            title: 'Agent 需要你的选择',
            answered: message.answered,
            submitting: controlStates[message.id]?.submitting,
            error: controlStates[message.id]?.error,
            questions: message.questions,
            onSubmit: (answers) => void answerQuestion(message, answers),
          },
        },
      ]
    }
    return [
      {
        kind: 'message',
        id: message.id,
        message: toUnifiedRemoteMessage(message),
        conversationId,
        workspaceKey: remoteWorkspaceKey,
      },
    ]
  })
  const toolPermissions: AgentPanelPermissionModel[] = activeMessages.flatMap((message) => {
    if (
      message.type !== 'agentTool' ||
      !message.tool.requiresApproval ||
      !message.tool.requestId ||
      (message.tool.state !== 'pending' && message.tool.state !== 'executing')
    ) {
      return []
    }
    const state = controlStates[message.id]
    return [
      {
        id: `tool:${message.id}`,
        title: 'Agent 请求执行操作',
        tone: 'warning',
        rows: [
          { label: '操作', value: message.tool.name },
          { label: '参数', value: JSON.stringify(message.tool.input ?? {}), monospace: true },
          ...(message.tool.approvalReason
            ? [{ label: '原因', value: message.tool.approvalReason }]
            : []),
          ...(state?.error ? [{ label: '错误', value: state.error, tone: 'danger' as const }] : []),
        ],
        actions: [
          {
            id: 'reject',
            label: '拒绝',
            tone: 'reject',
            disabled: state?.submitting,
            onInvoke: () => void decideToolApproval(message, false),
          },
          {
            id: 'approve',
            label: state?.submitting ? '等待 Agent 确认…' : '允许本次操作',
            tone: 'approve',
            disabled: state?.submitting,
            onInvoke: () => void decideToolApproval(message, true),
          },
        ],
      },
    ]
  })
  const filePermissions: AgentPanelPermissionModel[] = pendingPermissions
    .filter((permission) => permission.serverId === workspaceRef.endpointId)
    .map((permission) => ({
      id: `file:${permission.requestId}`,
      title: '远程设备请求文件权限',
      tone: 'warning',
      rows: [
        { label: '操作', value: permission.operation },
        { label: '路径', value: permission.path, monospace: true },
      ],
      actions: [
        {
          id: 'reject',
          label: '拒绝',
          tone: 'reject',
          onInvoke: () => void respondPermission(permission.serverId, permission.requestId, false),
        },
        {
          id: 'approve',
          label: '仅本次允许',
          tone: 'approve',
          onInvoke: () => void respondPermission(permission.serverId, permission.requestId, true),
        },
      ],
    }))

  const unsupported = (reason: string) => ({ state: 'disabled' as const, reason })

  return (
    <AgentPanelView
      model={{
        runtime: 'remote',
        variant,
        timelineKey: `remote:${remoteWorkspaceKey}:${activeSession?.id ?? 'pending'}`,
        header: {
          title: 'Agent',
          runtimeLabel: `远程 · ${workspaceRef.endpointName || workspaceRef.endpointId}`,
          status: agentVisualStatus,
          diagnostics: {
            state: activeSession && !copyingDiagnostics ? 'enabled' : 'disabled',
            reason: activeSession ? '正在复制诊断日志' : '当前没有远程会话',
            label: '复制 Agent 诊断日志',
            onInvoke: () => void copyDiagnostics(),
          },
        },
        contextChips: [
          {
            id: 'workspace',
            kind: 'workspace',
            label: workspaceRef.path,
            detail: 'CCLink 远程工作空间',
          },
          {
            id: 'scope',
            kind: 'scope',
            label: '当前远程工作空间',
            detail: '操作目标',
          },
        ],
        notices: [
          ...(error ? [{ id: 'store-error', tone: 'error' as const, title: error }] : []),
          ...(statusError || (remoteStatus && !agentAvailable)
            ? [
                {
                  id: 'remote-status',
                  tone: 'error' as const,
                  title: agentVisualStatus.label,
                  detail:
                    statusError ||
                    remoteStatus?.remoteError?.message ||
                    '当前 Agent 未声明远程会话/流式消息能力',
                },
              ]
            : []),
        ],
        activities: [],
        permissions: [...filePermissions, ...toolPermissions],
        timeline,
        empty: {
          title: loading ? '正在同步会话…' : '开始工作',
          description: 'Agent 会以当前工作空间作为操作边界。',
          suggestions: ['分析当前工作空间', '检查最近修改', '继续已有任务'],
        },
        composer: {
          value: draft,
          maxLength: 8192,
          disabled: !agentAvailable,
          onChange: setDraft,
          onSubmit: submit,
          canSubmit: Boolean(draft.trim()) && agentAvailable && stopAvailability.state === 'hidden',
          submitting: sending || activeSession?.status === 'active',
          stopCapability: stopAvailability,
          placeholder: agentAvailable
            ? '输入消息，Enter 发送，Shift+Enter 换行'
            : agentVisualStatus.detail,
          actionBar: {
            kind: 'remote',
            runtimeLabel: 'CCLink Agent',
            capabilities: {
              addContext: unsupported('远程 Agent 暂不支持添加本地资源、Skill 或图片'),
              role: unsupported('远程 Agent 暂不支持切换角色'),
              permissionMode: unsupported('远程权限由远程 Agent 和当前确认卡管理'),
              contextUsage: unsupported('远程上下文详情暂不可用'),
              runtime: unsupported('远程 Runtime 由已配对设备管理'),
            },
          },
        },
      }}
    />
  )
}

export function toUnifiedRemoteMessage(
  message: Exclude<CclinkRemoteMessage, { type: 'userQuestion' }>,
): AgentMessage {
  if (message.type === 'agentTool') {
    const stateLabels = {
      pending: '等待执行',
      executing: '正在执行',
      completed: '执行完成',
      failed: '执行失败',
      denied: '已拒绝',
    } as const
    const result =
      message.tool.error ||
      message.tool.output ||
      (message.tool.state === 'completed' ||
      message.tool.state === 'failed' ||
      message.tool.state === 'denied'
        ? stateLabels[message.tool.state]
        : null)
    return {
      id: message.id,
      role: 'assistant',
      timestamp: message.timestamp,
      rawText: `${message.tool.name}${result ? `\n${result}` : ''}`,
      isStreaming: message.tool.state === 'pending' || message.tool.state === 'executing',
      content: [
        {
          type: 'tool_use',
          id: message.tool.id,
          name: message.tool.name,
          input: message.tool.input ?? {},
        },
        ...(result
          ? [
              {
                type: 'tool_result' as const,
                tool_use_id: message.tool.id,
                content: result,
                is_error: message.tool.state === 'failed' || message.tool.state === 'denied',
              },
            ]
          : []),
      ],
    }
  }
  return {
    id: message.id,
    role: message.type === 'agentText' ? 'assistant' : message.type,
    timestamp: message.timestamp,
    rawText: message.content,
    content: [{ type: 'text', text: message.content }],
  }
}
