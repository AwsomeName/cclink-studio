import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CclinkRemoteSession } from '@shared/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { RemoteStatus } from '@shared/remote-protocol'
import type { RemoteDiagnosticReport } from '@shared/remote-protocol'
import type { CclinkRemoteMessage } from '@shared/cclink'
import { useCclinkStore } from '../../stores'
import { useToastStore } from '../../components/common/Toast'
import { APP_VERSION } from '../../app-metadata'
import { buildRemoteAgentDiagnosticMarkdown } from '../diagnostics/remote-agent-diagnostic-report'
import { collectUnifiedDiagnosticReport } from '../diagnostics/unified-diagnostic-report'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  AgentPanelView,
  type AgentPanelPermissionModel,
  type AgentPanelTimelineItem,
  type AgentPanelVariant,
} from '../../components/agent-panel/agent-panel-view'
import { isWorkspaceTargetCurrent, type WorkspaceTarget } from '../../stores/workspace-store'
import type { AgentMessage } from '../../types'
import { importAgentImageFiles, MAX_AGENT_IMAGES } from '../agent-conversations/image-attachments'
import type { TransientImageAttachment } from '@shared/image-attachment'
import { openRemoteFileFromConversation } from './remote-file-navigation'
import { remoteAgentComposerKey } from './remote-message-queue-state'
import { AGENT_FOLLOW_UP } from '../agent-conversations/follow-up-actions'
import { useSettingsStore } from '../../stores/settings-store'
import type { PermissionMode } from '../../types'

const EMPTY_REMOTE_AGENT_IMAGES: TransientImageAttachment[] = []

export function selectRemoteAgentImages(
  images: Record<string, TransientImageAttachment[]>,
  workspaceKey: string,
): TransientImageAttachment[] {
  return images[workspaceKey] ?? EMPTY_REMOTE_AGENT_IMAGES
}

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

export function resolveRemoteStopAvailability(
  sessionStatus: CclinkRemoteSession['status'] | undefined,
): { state: 'enabled' } | { state: 'hidden' } {
  if (sessionStatus === 'active') {
    return { state: 'enabled' }
  }
  return { state: 'hidden' }
}

export function RemoteAgentController({
  workspaceRef,
  workspaceGeneration,
  variant,
  sessionId,
}: {
  workspaceRef: RemoteWorkspaceRef
  workspaceGeneration: number
  variant: AgentPanelVariant
  /** Workbench Tab 可锁定一个远程会话，不改写右侧 Agent 面板的全局选中态。 */
  sessionId?: string
}): React.ReactElement {
  const sessions = useCclinkStore((state) => state.sessions)
  const messages = useCclinkStore((state) => state.messages)
  const selectedSessionId = useCclinkStore((state) => state.selectedSessionId)
  const loading = useCclinkStore((state) => state.loading)
  const error = useCclinkStore((state) => state.error)
  const realtimeState = useCclinkStore((state) => state.realtime.state)
  const connectRealtime = useCclinkStore((state) => state.connectRealtime)
  const selectSession = useCclinkStore((state) => state.selectSession)
  const loadMessages = useCclinkStore((state) => state.loadMessages)
  const stopTrackingAgentRun = useCclinkStore((state) => state.stopTrackingAgentRun)
  const pendingPermissions = useCclinkStore((state) => state.pendingPermissions)
  const respondPermission = useCclinkStore((state) => state.respondPermission)
  const setRemoteAgentDraft = useCclinkStore((state) => state.setRemoteAgentDraft)
  const addRemoteAgentImages = useCclinkStore((state) => state.addRemoteAgentImages)
  const removeRemoteAgentImage = useCclinkStore((state) => state.removeRemoteAgentImage)
  const showToast = useToastStore((state) => state.show)
  const permissionMode = useSettingsStore((state) => state.settings.permissionMode)
  const settingsLoading = useSettingsStore((state) => state.loading)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const [savingPermission, setSavingPermission] = useState(false)
  const changePermissionMode = async (mode: PermissionMode): Promise<void> => {
    if (savingPermission || mode === permissionMode) return
    setSavingPermission(true)
    try {
      if (!(await updateSettings({ permissionMode: mode }))) {
        showToast(useSettingsStore.getState().error || '权限模式保存失败，已保持原模式', 'error')
      }
    } finally {
      setSavingPermission(false)
    }
  }
  const [stopping, setStopping] = useState(false)
  const [copyingDiagnostics, setCopyingDiagnostics] = useState(false)
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [controlStates, setControlStates] = useState<
    Record<string, { submitting: boolean; error: string | null }>
  >({})
  const inputRef = useRef<HTMLTextAreaElement>(null)
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
  const activeSession = sessionId
    ? (workspaceSessions.find((session) => session.id === sessionId) ?? null)
    : (workspaceSessions.find((session) => session.id === selectedSessionId) ??
      workspaceSessions[0] ??
      null)
  const activeMessages = activeSession ? (messages[activeSession.id] ?? []) : []
  const activeSessionId = activeSession?.id ?? null

  const remoteWorkspaceKey = remoteAgentComposerKey(workspaceRef, activeSessionId)
  const draft = useCclinkStore((state) => state.remoteAgentDrafts[remoteWorkspaceKey] ?? '')
  const pendingImages = useCclinkStore((state) =>
    selectRemoteAgentImages(state.remoteAgentImages, remoteWorkspaceKey),
  )
  const queue = useCclinkStore((state) => state.remoteMessageQueues[remoteWorkspaceKey])
  const sending = Boolean(queue?.dispatchId)
  const imageUploadProgress = queue?.uploadProgress ?? null
  const imageUploadId =
    queue?.dispatchId &&
    queue.items.find((item) => item.id === queue.dispatchId)?.pendingImages.length
      ? queue.dispatchId
      : null

  useEffect(() => {
    let cancelled = false
    setStatusError(null)
    void (async () => {
      try {
        const connected = await connectRealtime()
        if (!connected) {
          throw new Error(useCclinkStore.getState().error || 'CCLink 远程连接失败')
        }
        const status = await window.cclinkStudio.remote.getStatus(workspaceRef)
        if (!cancelled) setRemoteStatus(status)
      } catch (statusFailure) {
        if (!cancelled) {
          setStatusError(
            statusFailure instanceof Error ? statusFailure.message : String(statusFailure),
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    connectRealtime,
    workspaceRef.endpointId,
    workspaceRef.path,
    workspaceRef.workspaceId,
    realtimeState,
  ])
  const agentAvailable =
    remoteStatus?.state === 'online' &&
    remoteStatus.compatibility !== 'upgrade-required' &&
    remoteStatus.capabilities.agent.session &&
    remoteStatus.capabilities.agent.stream &&
    (!sessionId || Boolean(activeSession))
  const imageInputAvailable = agentAvailable && remoteStatus?.capabilities.agent.imageInput === true
  const agentVisualStatus =
    sessionId && !activeSession
      ? {
          tone: 'unavailable' as const,
          label: '会话不可用',
          detail: loading ? '正在加载远程会话' : '远程会话已不存在或已归档',
        }
      : resolveRemoteAgentVisualStatus({
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
    if (!activeSessionId) return
    if (sessionId) {
      void loadMessages(activeSessionId)
      return
    }
    if (activeSessionId !== selectedSessionId) selectSession(activeSessionId)
  }, [activeSessionId, loadMessages, selectSession, selectedSessionId, sessionId])

  const submit = (): void => {
    if (
      !agentAvailable ||
      !isWorkspaceTargetCurrent(workspaceTarget) ||
      (pendingImages.length > 0 && !imageInputAvailable)
    )
      return
    if (!useCclinkStore.getState().enqueueRemoteAgentDraft(workspaceRef, activeSessionId)) {
      showToast(useCclinkStore.getState().error || '当前会话无法加入队列', 'error')
    }
  }

  const cancelImageUpload = async (): Promise<void> => {
    if (!imageUploadId || imageUploadProgress?.phase === 'sending') return
    useCclinkStore
      .getState()
      .pauseRemoteMessageQueue(remoteWorkspaceKey, '图片上传已取消，请检查后继续队列')
    await window.cclinkStudio.cclink.cancelAgentImageUpload({ uploadId: imageUploadId })
  }

  const addImages = useCallback(
    async (files: File[]) => {
      if (!imageInputAvailable) {
        showToast('当前远程 Agent 未声明图片输入能力', 'error')
        return
      }
      const result = await importAgentImageFiles(files, MAX_AGENT_IMAGES - pendingImages.length)
      if (result.attachments.length > 0) {
        addRemoteAgentImages(remoteWorkspaceKey, result.attachments)
      }
      if (result.errors.length > 0) showToast(result.errors.join('\n'), 'error')
    },
    [
      addRemoteAgentImages,
      imageInputAvailable,
      pendingImages.length,
      remoteWorkspaceKey,
      showToast,
    ],
  )

  const stopTracking = async (): Promise<void> => {
    if (!activeSession || activeSession.status !== 'active' || stopping) return
    setStopping(true)
    try {
      const stopped = await stopTrackingAgentRun(workspaceRef, activeSession.id)
      showToast(
        stopped
          ? '已停止在 Studio 中跟踪；这不代表远端已取消'
          : useCclinkStore.getState().error || '停止跟踪远程任务失败',
        stopped ? 'success' : 'error',
      )
    } finally {
      setStopping(false)
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
      const agentReport = buildRemoteAgentDiagnosticMarkdown({
        appVersion: APP_VERSION,
        platform: navigator.platform,
        report,
        collectionError,
      })
      const diagnosticReport = await collectUnifiedDiagnosticReport({ agentReport })
      await copyTextToClipboard(diagnosticReport)
      showToast('完整诊断日志已复制', 'success')
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
            status: message.status,
            resolution: message.resolution,
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
          ...(message.tool.policyReason
            ? [{ label: 'Studio 策略', value: message.tool.policyReason }]
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
          title: activeSession?.name ?? 'Agent',
          runtimeLabel: `远程 · ${workspaceRef.endpointName || workspaceRef.endpointId}`,
          status: agentVisualStatus,
          diagnostics: {
            state: activeSession && !copyingDiagnostics ? 'enabled' : 'disabled',
            reason: activeSession ? '正在复制诊断日志' : '当前没有远程会话',
            label: '复制完整诊断日志',
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
        onOpenFilePath: (path) => {
          if (!openRemoteFileFromConversation(workspaceRef, path)) {
            showToast('文件路径不在当前远程工作空间内', 'error')
          }
        },
        empty: {
          title: loading ? '正在同步会话…' : '开始工作',
          description: 'Agent 会以当前工作空间作为操作边界。',
          suggestions: ['分析当前工作空间', '检查最近修改', '继续已有任务'],
        },
        composer: {
          allowQueueWhileRunning: true,
          followUps: [
            {
              ...AGENT_FOLLOW_UP.supplement,
              description: '',
              capability: { state: 'disabled', reason: '此远程会话暂不支持补充当前任务' },
              onExecute: () => {},
            },
            {
              ...AGENT_FOLLOW_UP.replace,
              description: '',
              capability: { state: 'disabled', reason: '此远程会话无法确认取消，暂不可用' },
              onExecute: () => {},
            },
          ],
          textareaRef: inputRef,
          submitLabel:
            sending ||
            activeSession?.status === 'active' ||
            queue?.items.length ||
            queue?.pauseReason
              ? '加入队列'
              : '发送',
          queue: {
            items: queue?.items ?? [],
            pauseReason: queue?.pauseReason,
            dispatchId: queue?.dispatchId,
            canEdit: !draft.trim() && !pendingImages.length,
            onEdit: (id) => {
              if (useCclinkStore.getState().editRemoteQueuedMessage(remoteWorkspaceKey, id))
                inputRef.current?.focus()
            },
            onRemove: (id) =>
              useCclinkStore.getState().removeRemoteQueuedMessage(remoteWorkspaceKey, id),
            onPause: () =>
              useCclinkStore
                .getState()
                .pauseRemoteMessageQueue(remoteWorkspaceKey, '已手动暂停队列'),
            onResume: () =>
              useCclinkStore.getState().pauseRemoteMessageQueue(remoteWorkspaceKey, null),
          },
          value: draft,
          maxLength: 8192,
          disabled: !agentAvailable,
          onChange: (content) => setRemoteAgentDraft(remoteWorkspaceKey, content),
          onSubmit: submit,
          onStop: imageUploadId ? cancelImageUpload : stopTracking,
          stopLabel: imageUploadId ? '取消图片上传' : '停止等待',
          canSubmit:
            (Boolean(draft.trim()) || pendingImages.length > 0) &&
            agentAvailable &&
            (pendingImages.length === 0 || imageInputAvailable) &&
            (queue?.items.length ?? 0) < 20,
          submitting: sending || activeSession?.status === 'active',
          stopCapability: imageUploadId
            ? imageUploadProgress?.phase === 'sending'
              ? { state: 'disabled', reason: '图片已上传，正在发送消息' }
              : { state: 'enabled' }
            : stopping && stopAvailability.state === 'enabled'
              ? { state: 'disabled', reason: '正在停止跟踪' }
              : stopAvailability,
          uploadProgress: imageUploadProgress
            ? {
                label:
                  imageUploadProgress.phase === 'sending'
                    ? '图片已上传，正在发送消息…'
                    : `正在上传第 ${Math.max(1, imageUploadProgress.imageIndex)}/${imageUploadProgress.imageCount} 张图片`,
                percent: imageUploadProgress.percent,
              }
            : undefined,
          placeholder: agentAvailable
            ? sending || activeSession?.status === 'active'
              ? '继续输入，Enter 加入队列；Shift+Enter 换行'
              : imageInputAvailable
                ? '输入消息或粘贴图片，Enter 发送，Shift+Enter 换行'
                : '输入消息，Enter 发送，Shift+Enter 换行'
            : agentVisualStatus.detail,
          onPaste: (event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith('image/'),
            )
            if (files.length === 0) return
            event.preventDefault()
            void addImages(files)
          },
          onDragOver: (event) => {
            if (Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) {
              event.preventDefault()
            }
          },
          onDrop: (event) => {
            const files = Array.from(event.dataTransfer.files).filter((file) =>
              file.type.startsWith('image/'),
            )
            if (files.length === 0) return
            event.preventDefault()
            void addImages(files)
          },
          enhancements: {
            images: {
              items: pendingImages,
              onRemove: (imageId) => removeRemoteAgentImage(remoteWorkspaceKey, imageId),
            },
          },
          actionBar: {
            kind: 'remote',
            runtimeLabel: 'CCLink Agent',
            permissionMode,
            onPermissionModeChange: (mode) => void changePermissionMode(mode),
            onAddImages: (files) => void addImages(files),
            capabilities: {
              addContext: imageInputAvailable
                ? { state: 'enabled' }
                : unsupported('当前远程 Agent 未声明图片输入能力'),
              role: unsupported('远程 Agent 暂不支持切换角色'),
              permissionMode:
                settingsLoading || savingPermission
                  ? unsupported('正在同步 Studio 权限模式')
                  : { state: 'enabled' },
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
    ...(message.type === 'user' && message.images?.length
      ? {
          resources: message.images.map((sourceUrl, index) => ({
            id: `${message.id}:image:${index + 1}`,
            kind: 'image' as const,
            label: `图片 ${index + 1}`,
            detail: sourceUrl,
            ref: { type: 'image' as const, sourceUrl },
          })),
        }
      : {}),
  }
}
