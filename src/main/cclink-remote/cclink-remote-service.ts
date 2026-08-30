import { createHash, randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type {
  CclinkFileReadResponseMessage,
  CclinkCapabilityProbeResponseMessage,
  CclinkFileCreateRequestMessage,
  CclinkFileDeleteRequestMessage,
  CclinkFileMutationBeginRequestMessage,
  CclinkFileMutationChunkRequestMessage,
  CclinkFileMutationControlRequestMessage,
  CclinkFileTransferResponseMessage,
  CclinkFileRenameRequestMessage,
  CclinkFileTreeResponseMessage,
  CclinkFileWriteRequestMessage,
  CclinkMutationResponseMessage,
  CclinkMessageType,
  CclinkProtocolMessage,
  CclinkRemoteMessage,
  CclinkRemoteSession,
  CclinkSessionResponseMessage,
  CclinkSessionSyncResponseMessage,
  CclinkServer,
  CclinkServerMetaMessage,
  CclinkTreeNode,
  CclinkWorkspace,
  CclinkWorkspaceListResponseMessage,
} from '../../shared/cclink'
import {
  CCLINK_MIN_PROTOCOL_VERSION,
  CCLINK_PROTOCOL_VERSION,
  createCclinkEnvelope,
} from '../../shared/cclink'
import type {
  CclinkImageUploadProgress,
  CclinkRealtimeEvent,
  CclinkRealtimeStatus,
} from '../../shared/ipc/cclink'
import {
  deriveRemoteSessionTitle,
  isGenericRemoteSessionTitle,
  resolveRemoteSessionTitle,
} from '../../shared/cclink-session-title'
import type {
  RemoteAgentSessionDiagnosticEvent,
  RemoteFileReadRequest,
  RemoteFileReadResult,
  RemoteFileCreateRequest,
  RemoteFileDeleteRequest,
  RemoteFileMutationResult,
  RemoteFileRenameRequest,
  RemoteFileTreeRequest,
  RemoteFileTreeResult,
  RemoteFileWriteRequest,
  RemoteProvider,
  RemoteStatus,
  RemoteDiagnosticReport,
} from '../../shared/remote-protocol'
import { sanitizeDiagnosticText } from '../../shared/diagnostics'
import { REMOTE_ERROR_CODE, type RemoteError } from '../../shared/remote-error'
import type { RemoteWorkspaceRef } from '../../shared/workspace-ref'
import type { TransientImageAttachment } from '../../shared/image-attachment'
import { callCclinkCloud } from './cloud-function-client'
import { CclinkAuthService } from './auth-service'
import { CclinkRequestError, CclinkRequestRouter } from './request-router'
import { TencentChatAdapter } from './tencent-chat-adapter'
import { TimTransport } from './tim-transport'
import { CclinkRuntimeStateStore } from './runtime-state-store'
import {
  REMOTE_SESSION_DIAGNOSTIC_EVENT_LIMIT,
  RemoteDiagnosticLog,
} from '../remote/remote-diagnostic-log'
import { buildRemoteDiagnosticReport } from '../remote/remote-diagnostics'

interface PairedAgentResponse {
  agent_id?: string
  name?: string
  hostname?: string
  os?: string
  status?: string
  last_seen?: string | number | null
}

type StatusListener = (status: CclinkRealtimeStatus) => void
type RealtimeListener = (event: CclinkRealtimeEvent) => void
type ImageUploadListener = (progress: CclinkImageUploadProgress) => void

interface StreamBuffer {
  serverId: string
  sessionId: string
  messageId: string
  content: string
}

interface CapabilityProbeResult {
  response: CclinkCapabilityProbeResponseMessage | null
  error?: RemoteError
}

const INLINE_FILE_BYTES = 2 * 1024
const MAX_FILE_BYTES = 2 * 1024 * 1024
const FILE_CHUNK_BYTES = 4096 as const
const MAX_MUTATION_MESSAGE_BYTES = 11 * 1024
const CHUNK_SEND_CONCURRENCY = 8
const REMOTE_SESSION_DIAGNOSTIC_MESSAGE_LIMIT = 100
const REMOTE_FILE_READ_PAGE_LINES = 100
const MAX_REMOTE_FILE_READ_ATTEMPTS = 4096

export class CclinkRemoteService implements RemoteProvider {
  readonly transport = 'cclink' as const
  private readonly requestRouter = new CclinkRequestRouter()
  private timTransport: TimTransport | null = null
  private timStatusUnsubscribe: (() => void) | null = null
  private status: CclinkRealtimeStatus = { state: 'idle' }
  private readonly statusListeners = new Set<StatusListener>()
  private readonly realtimeListeners = new Set<RealtimeListener>()
  private readonly imageUploadListeners = new Set<ImageUploadListener>()
  private readonly imageUploads = new Map<string, AbortController>()
  private servers = new Map<string, CclinkServer>()
  private sessions = new Map<string, CclinkRemoteSession>()
  private messages = new Map<string, CclinkRemoteMessage[]>()
  private streams = new Map<string, StreamBuffer>()
  private capabilityProbes = new Map<string, CapabilityProbeResult & { expiresAt: number }>()
  private capabilityProbeFailures = new Map<string, CapabilityProbeResult & { expiresAt: number }>()
  private readonly openWorkspaceOperations = new Map<string, { cancelled: boolean }>()
  private readonly activeAgentRequests = new Map<string, string>()
  private readonly stoppedAgentRequestIds = new Map<string, string[]>()
  private readonly stoppedAgentSessionsWithoutRequest = new Set<string>()
  private connecting: Promise<CclinkRealtimeStatus> | null = null
  private readonly diagnosticLog = new RemoteDiagnosticLog()

  constructor(
    readonly auth: CclinkAuthService,
    private readonly baseUrl: string | null,
    private readonly runtimeStateStore?: CclinkRuntimeStateStore,
    private readonly createTimTransport: () => TimTransport = () =>
      new TimTransport(new TencentChatAdapter()),
  ) {
    this.requestRouter.onProtocolEvent((event) => {
      void this.handleProtocolMessage(event.serverId, event.message)
    })
  }

  async initialize(): Promise<void> {
    if (!this.runtimeStateStore) return
    const state = await this.runtimeStateStore.load()
    this.messages = new Map(Object.entries(state.messages))
    let stateChanged = false
    this.sessions = new Map(
      state.sessions.map((session) => {
        let nextSession = session
        if (session.status === 'active') {
          const timestamp = nowSeconds()
          const currentMessages = this.messages.get(session.id) ?? []
          const recoveryMessage: CclinkRemoteMessage = {
            type: 'system',
            id: `remote-tracking-reset-${session.id}-${timestamp}`,
            content:
              'Studio 已在重启后停止跟踪上一条远程任务；这不代表远端已取消，继续发送前请确认远端状态。',
            timestamp,
          }
          const nextMessages = [...currentMessages, recoveryMessage].slice(-2_000)
          this.messages.set(session.id, nextMessages)
          nextSession = {
            ...session,
            status: 'idle',
            updatedAt: timestamp,
            messageCount: nextMessages.length,
          }
          this.stoppedAgentSessionsWithoutRequest.add(session.id)
          stateChanged = true
        }
        if (!isGenericRemoteSessionTitle(nextSession.name)) return [session.id, nextSession]
        const firstUserMessage = this.messages
          .get(session.id)
          ?.find((message) => message.type === 'user')
        const title = firstUserMessage ? deriveRemoteSessionTitle(firstUserMessage.content) : null
        if (!title) return [session.id, nextSession]
        stateChanged = true
        return [session.id, { ...nextSession, name: title }]
      }),
    )
    if (stateChanged) await this.saveState()
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onRealtimeEvent(listener: RealtimeListener): () => void {
    this.realtimeListeners.add(listener)
    return () => this.realtimeListeners.delete(listener)
  }

  onImageUploadProgress(listener: ImageUploadListener): () => void {
    this.imageUploadListeners.add(listener)
    return () => this.imageUploadListeners.delete(listener)
  }

  cancelAgentImageUpload(uploadId: string): boolean {
    const controller = this.imageUploads.get(uploadId)
    if (!controller) return false
    controller.abort()
    return true
  }

  getRealtimeStatus(): CclinkRealtimeStatus {
    return { ...this.status }
  }

  getRequestRouter(): CclinkRequestRouter {
    return this.requestRouter
  }

  recordDiagnostic(operation: string, endpointId: string, error: unknown): void {
    const source =
      error && typeof error === 'object' && 'remoteError' in error
        ? (error as { remoteError?: RemoteError }).remoteError
        : undefined
    const normalized =
      source ??
      remoteError(
        'unknown',
        'REMOTE_OPERATION_FAILED',
        error instanceof Error ? error.message : String(error),
        true,
      )
    this.diagnosticLog.record(operation, {
      ...normalized,
      context: { ...normalized.context, endpointId },
    })
  }

  async connect(): Promise<CclinkRealtimeStatus> {
    if (this.status.state === 'online') return this.getRealtimeStatus()
    if (this.connecting) return this.connecting
    this.connecting = this.connectInternal().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  async listServers(): Promise<CclinkServer[]> {
    const identity = await this.auth.ensureIdentity()
    const response = await callCclinkCloud<{
      agents?: PairedAgentResponse[]
      data?: { agents?: PairedAgentResponse[] }
    }>(this.baseUrl, 'getPairedAgents', {
      user_id: identity.accountUserId,
      auth_token: identity.authToken,
      client_im_user_id: identity.clientImUserId,
    })
    const paired = response.agents ?? response.data?.agents ?? []
    for (const item of paired) {
      const id = text(item.agent_id)
      if (!id) continue
      const current = this.servers.get(id)
      this.servers.set(id, {
        id,
        name: text(item.name) || text(item.hostname) || id,
        hostname: text(item.hostname) || text(item.name) || id,
        os: text(item.os),
        status: item.status === 'online' || item.status === 'connecting' ? item.status : 'offline',
        agentVersion: current?.agentVersion ?? 'unknown',
        protocolVersion: current?.protocolVersion,
        minProtocolVersion: current?.minProtocolVersion,
        capabilities: current?.capabilities,
        capabilityList: current?.capabilityList,
        lastSeen: timestamp(item.last_seen),
        workspaces: current?.workspaces ?? [],
      })
    }
    if (this.status.state === 'online') await this.refreshOnlineMetadata()
    return [...this.servers.values()].sort(
      (a, b) => Number(b.status === 'online') - Number(a.status === 'online'),
    )
  }

  async browseDirectory(
    serverId: string,
    path: string,
    requestId?: string,
  ): Promise<RemoteFileTreeResult> {
    const server = this.servers.get(serverId)
    if (!server || server.status !== 'online')
      return failure('remote-agent', 'REMOTE_SERVER_OFFLINE', '远程设备不在线', true)
    return this.requestFileTree(serverId, path, 1, requestId)
  }

  async openWorkspace(
    serverId: string,
    requestedPath: string,
    requestId: string = randomUUID(),
  ): Promise<CclinkWorkspace> {
    if (this.openWorkspaceOperations.has(requestId)) throw new Error('远程打开请求标识重复')
    const operation = { cancelled: false }
    this.openWorkspaceOperations.set(requestId, operation)
    try {
      const result = await this.browseDirectory(serverId, requestedPath, requestId)
      if (operation.cancelled) throw new Error('远程请求已取消')
      if (!result.success || !result.tree || result.tree.type !== 'directory') {
        throw new Error(result.error || '远程目录无法打开')
      }
      if (!result.workspaceId) {
        throw new Error('远程 Agent 未返回规范 workspace_id，无法安全打开该工作空间')
      }
      const path = result.tree.path
      const workspace: CclinkWorkspace = {
        id: result.workspaceId,
        path,
        name: remotePathApi(path).basename(path) || path,
        serverId,
        kind: 'directory',
        exists: true,
      }
      const server = this.servers.get(serverId)
      if (server) {
        server.workspaces = [
          workspace,
          ...server.workspaces.filter(
            (item) => item.id !== workspace.id && item.path !== workspace.path,
          ),
        ]
      }
      return workspace
    } finally {
      this.openWorkspaceOperations.delete(requestId)
    }
  }

  cancelOpenWorkspace(requestId: string): boolean {
    const operation = this.openWorkspaceOperations.get(requestId)
    if (!operation) return false
    operation.cancelled = true
    this.requestRouter.cancel(requestId)
    return true
  }

  async listSessions(ref: RemoteWorkspaceRef): Promise<CclinkRemoteSession[]> {
    const status = await this.connect()
    if (status.state === 'online') {
      await this.syncSessions(ref.endpointId).catch((error: unknown) => {
        this.recordDiagnostic('session.sync', ref.endpointId, error)
      })
    }
    return [...this.sessions.values()]
      .filter(
        (session) => session.serverId === ref.endpointId && session.workspaceId === ref.workspaceId,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  setSessionArchived(sessionId: string, archived: boolean): CclinkRemoteSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('远程会话不存在')
    const next: CclinkRemoteSession = {
      ...session,
      status: archived ? 'archived' : 'idle',
      updatedAt: nowSeconds(),
    }
    this.sessions.set(sessionId, next)
    this.persistState()
    this.emitRealtime({ type: 'sessions', serverId: session.serverId, sessionId })
    return next
  }

  async createSession(ref: RemoteWorkspaceRef, name?: string): Promise<CclinkRemoteSession> {
    await this.requireOnline()
    await this.requireCapability(ref, 'agent.session')
    const validation = this.validateWorkspace(ref, ref.path)
    if (validation) throw new Error(validation.error || '远程工作空间不可用')
    const sessionId = `sess-${randomUUID()}`
    const requestId = randomUUID()
    let response: CclinkSessionResponseMessage
    try {
      response = (await this.requestRouter.request(
        ref.endpointId,
        {
          ...createCclinkEnvelope('session_create', { request_id: requestId, trace_id: requestId }),
          request_id: requestId,
          session_id: sessionId,
          workspace_id: ref.workspaceId,
          workspace_path: ref.path,
          name: name?.trim() || undefined,
          workspace_restricted: true,
          project_mode: 'remote_workspace',
        },
        ['session_response'],
        20_000,
      )) as CclinkSessionResponseMessage
    } catch (error) {
      this.recordDiagnostic('session.create', ref.endpointId, error)
      throw error
    }
    assertSessionBinding(response, ref, sessionId)
    const now = nowSeconds()
    const session: CclinkRemoteSession = {
      id: sessionId,
      name: name?.trim() || `远程会话 ${sessionId.slice(-6)}`,
      workspaceId: ref.workspaceId,
      workspacePath: ref.path,
      serverId: ref.endpointId,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      contextUsage: 0,
    }
    this.sessions.set(sessionId, session)
    this.persistState()
    this.emitRealtime({ type: 'sessions', serverId: ref.endpointId, sessionId })
    await this.syncSessions(ref.endpointId).catch(() => undefined)
    return this.sessions.get(sessionId) ?? session
  }

  listMessages(sessionId: string): CclinkRemoteMessage[] {
    return [...(this.messages.get(sessionId) ?? [])]
  }

  async sendAgentMessage(
    ref: RemoteWorkspaceRef,
    sessionId: string,
    content: string,
    images: TransientImageAttachment[] = [],
    imageUploadId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    let uploadController: AbortController | null = null
    if (images.length > 0 && imageUploadId) {
      if (this.imageUploads.has(imageUploadId)) {
        return { success: false, error: '图片上传任务 ID 正在使用' }
      }
      uploadController = new AbortController()
      this.imageUploads.set(imageUploadId, uploadController)
    }
    try {
      await this.requireOnline()
      await this.requireCapability(ref, 'agent.stream')
      const normalized = content.trim()
      if (!normalized && images.length === 0) return { success: true }
      if (Buffer.byteLength(normalized, 'utf8') > 8 * 1024) {
        return { success: false, error: '单条远程消息不能超过 8 KiB，请拆分后发送' }
      }
      const session = this.sessions.get(sessionId)
      if (
        !session ||
        session.serverId !== ref.endpointId ||
        session.workspaceId !== ref.workspaceId
      ) {
        return { success: false, error: '远程会话与当前工作空间不匹配' }
      }
      const imageUrls: string[] = []
      if (images.length > 0) {
        if (!imageUploadId) return { success: false, error: '远程图片消息缺少上传任务 ID' }
        await this.requireCapability(ref, 'agent.imageInput')
        if (!uploadController) return { success: false, error: '图片上传任务初始化失败' }
        const totalBytes = imageTotalBytes(images)
        let completedBytes = 0
        this.emitImageUploadProgress({
          uploadId: imageUploadId,
          imageIndex: 0,
          imageCount: images.length,
          loadedBytes: 0,
          totalBytes,
          percent: 0,
          phase: 'preparing',
        })
        for (const [index, image] of images.entries()) {
          uploadController.signal.throwIfAborted()
          imageUrls.push(
            await this.requestRouter.uploadImage(ref.endpointId, image, {
              signal: uploadController.signal,
              onProgress: (loaded) => {
                const aggregateLoaded = Math.min(totalBytes, completedBytes + loaded)
                this.emitImageUploadProgress({
                  uploadId: imageUploadId,
                  imageId: image.id,
                  imageIndex: index + 1,
                  imageCount: images.length,
                  loadedBytes: aggregateLoaded,
                  totalBytes,
                  percent: Math.round((aggregateLoaded / totalBytes) * 100),
                  phase: 'uploading',
                })
              },
            }),
          )
          completedBytes += image.size
        }
        uploadController.signal.throwIfAborted()
        this.emitImageUploadProgress({
          uploadId: imageUploadId,
          imageIndex: images.length,
          imageCount: images.length,
          loadedBytes: totalBytes,
          totalBytes,
          percent: 100,
          phase: 'sending',
        })
      }
      const requestId = randomUUID()
      const message = {
        ...createCclinkEnvelope('user_text', { request_id: requestId, trace_id: requestId }),
        agent_id: ref.endpointId,
        session_id: sessionId,
        workspace_id: ref.workspaceId,
        workspace_path: ref.path,
        project_mode: 'remote_workspace' as const,
        content: normalized,
        ...(imageUrls.length > 0 ? { images: imageUrls } : {}),
      }
      uploadController?.signal.throwIfAborted()
      await this.requestRouter.send(ref.endpointId, message)
      this.recordSessionProtocolEvent(ref.endpointId, message, 'outbound')
      this.activeAgentRequests.set(sessionId, requestId)
      this.stoppedAgentSessionsWithoutRequest.delete(sessionId)
      const userMessage: CclinkRemoteMessage = {
        type: 'user',
        id: `remote-user-${requestId}`,
        content: normalized || `图片消息（${imageUrls.length} 张）`,
        timestamp: nowSeconds(),
      }
      this.appendMessage(sessionId, userMessage)
      this.setSessionStatus(sessionId, 'active')
      this.emitRealtime({ type: 'sessions', serverId: ref.endpointId, sessionId })
      this.emitRealtime({
        type: 'conversation',
        serverId: ref.endpointId,
        sessionId,
        phase: 'started',
        message: userMessage,
      })
      if (imageUploadId && images.length > 0) {
        const totalBytes = imageTotalBytes(images)
        this.emitImageUploadProgress({
          uploadId: imageUploadId,
          imageIndex: images.length,
          imageCount: images.length,
          loadedBytes: totalBytes,
          totalBytes,
          percent: 100,
          phase: 'completed',
        })
      }
      return { success: true }
    } catch (error) {
      const cancelled = uploadController?.signal.aborted === true
      const errorMessage = cancelled
        ? '图片上传已取消'
        : error instanceof Error
          ? error.message
          : '远程消息发送失败'
      if (!cancelled) this.recordDiagnostic('agent.send', ref.endpointId, error)
      if (imageUploadId && images.length > 0) {
        const totalBytes = imageTotalBytes(images)
        this.emitImageUploadProgress({
          uploadId: imageUploadId,
          imageIndex: 0,
          imageCount: images.length,
          loadedBytes: 0,
          totalBytes,
          percent: 0,
          phase: cancelled ? 'cancelled' : 'failed',
          error: errorMessage,
        })
      }
      return { success: false, error: errorMessage }
    } finally {
      if (imageUploadId && this.imageUploads.get(imageUploadId) === uploadController) {
        this.imageUploads.delete(imageUploadId)
      }
    }
  }

  stopTrackingAgentRun(
    ref: RemoteWorkspaceRef,
    sessionId: string,
  ): { success: boolean; error?: string } {
    const session = this.assertSessionMatches(ref, sessionId)
    if (session.status !== 'active') return { success: true }

    const activeRequest = this.activeAgentRequests.get(sessionId)
    if (activeRequest) {
      const stopped = this.stoppedAgentRequestIds.get(sessionId) ?? []
      this.stoppedAgentRequestIds.set(
        sessionId,
        [...stopped.filter((requestId) => requestId !== activeRequest), activeRequest].slice(-16),
      )
    } else {
      this.stoppedAgentSessionsWithoutRequest.add(sessionId)
    }
    this.activeAgentRequests.delete(sessionId)
    for (const [key, stream] of this.streams) {
      if (stream.sessionId === sessionId && stream.serverId === ref.endpointId)
        this.streams.delete(key)
    }

    const systemMessage: CclinkRemoteMessage = {
      type: 'system',
      id: `remote-tracking-stopped-${activeRequest ?? randomUUID()}`,
      content: '已停止在 Studio 中跟踪这条远程任务；这不代表远端已取消，继续发送前请确认远端状态。',
      timestamp: nowSeconds(),
    }
    this.appendMessage(sessionId, systemMessage)
    this.setSessionStatus(sessionId, 'idle')
    this.emitRealtime({ type: 'sessions', serverId: ref.endpointId, sessionId })
    this.emitRealtime({
      type: 'conversation',
      serverId: ref.endpointId,
      sessionId,
      phase: 'untracked',
      message: systemMessage,
    })
    return { success: true }
  }

  async resolveToolApproval(input: {
    ref: RemoteWorkspaceRef
    sessionId: string
    requestId: string
    toolUseId: string
    approved: boolean
  }): Promise<{ success: boolean; error?: string }> {
    try {
      await this.requireOnline()
      await this.requireCapability(input.ref, 'agent.session')
      this.assertSessionMatches(input.ref, input.sessionId)
      const controlRequestId = randomUUID()
      const response = (await this.requestRouter.request(
        input.ref.endpointId,
        {
          ...createCclinkEnvelope('tool_approval_response', {
            request_id: controlRequestId,
            trace_id: input.requestId,
          }),
          request_id: controlRequestId,
          session_id: input.sessionId,
          tool_use_id: input.toolUseId,
          approved: input.approved,
          explicit_user_decision: true,
        },
        ['tool_approval_ack'],
        15_000,
      )) as {
        cc_type: 'tool_approval_ack'
        session_id?: string
        tool_use_id?: string
        approved?: boolean
        status?: string
      }
      if (
        response.status !== 'accepted' ||
        response.session_id !== input.sessionId ||
        response.tool_use_id !== input.toolUseId ||
        response.approved !== input.approved
      ) {
        throw new Error('远程 Agent 返回了不匹配的审批确认')
      }
      this.updateToolApproval(input.sessionId, input.toolUseId, input.approved)
      return { success: true }
    } catch (error) {
      this.recordDiagnostic('agent.approval', input.ref.endpointId, error)
      return { success: false, error: error instanceof Error ? error.message : '远程审批发送失败' }
    }
  }

  async answerQuestion(input: {
    ref: RemoteWorkspaceRef
    sessionId: string
    requestId: string
    toolUseId: string
    answers: Record<string, string>
  }): Promise<{ success: boolean; error?: string }> {
    try {
      await this.requireOnline()
      await this.requireCapability(input.ref, 'agent.session')
      this.assertSessionMatches(input.ref, input.sessionId)
      const question = this.findPendingQuestion(input.sessionId, input.toolUseId)
      const normalizedAnswers = Object.fromEntries(
        question.questions.map((item) => {
          const answer = input.answers[item.question] ?? input.answers[item.id]
          if (!answer?.trim()) throw new Error(`请回答：${item.question}`)
          return [item.question, answer.trim()]
        }),
      )
      const controlRequestId = randomUUID()
      const response = (await this.requestRouter.request(
        input.ref.endpointId,
        {
          ...createCclinkEnvelope('question_answer', {
            request_id: controlRequestId,
            trace_id: input.requestId,
          }),
          request_id: controlRequestId,
          session_id: input.sessionId,
          tool_use_id: input.toolUseId,
          answers: normalizedAnswers,
        },
        ['question_answer_ack'],
        15_000,
      )) as {
        cc_type: 'question_answer_ack'
        session_id?: string
        tool_use_id?: string
        status?: string
      }
      if (
        response.status !== 'accepted' ||
        response.session_id !== input.sessionId ||
        response.tool_use_id !== input.toolUseId
      ) {
        throw new Error('远程 Agent 返回了不匹配的问题确认')
      }
      this.markQuestionAnswered(input.sessionId, input.toolUseId)
      return { success: true }
    } catch (error) {
      this.recordDiagnostic('agent.question', input.ref.endpointId, error)
      return { success: false, error: error instanceof Error ? error.message : '远程问题回答失败' }
    }
  }

  async respondPermission(input: {
    serverId: string
    requestId: string
    approved: boolean
    remember?: boolean
  }): Promise<{ success: boolean; error?: string }> {
    try {
      await this.requireOnline()
      if (!this.servers.has(input.serverId)) throw new Error('远程设备不存在')
      await this.requestRouter.send(input.serverId, {
        ...createCclinkEnvelope('permission_response', {
          request_id: input.requestId,
          trace_id: input.requestId,
        }),
        request_id: input.requestId,
        approved: input.approved,
        remember: input.remember === true,
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '远程权限响应失败' }
    }
  }

  async getStatus(ref: RemoteWorkspaceRef): Promise<RemoteStatus> {
    const server = this.servers.get(ref.endpointId)
    const online = server?.status === 'online' && this.status.state === 'online'
    const probeResult = online ? await this.getLiveCapabilityProbe(ref.endpointId) : null
    const probe = probeResult?.response ?? null
    const protocolVersion = valueAsString(
      probe?.protocolVersion ??
        probe?.protocol_version ??
        probe?.sender?.protocol_version ??
        server?.protocolVersion,
    )
    const minProtocolVersion = valueAsString(
      probe?.minProtocolVersion ??
        probe?.min_protocol_version ??
        probe?.sender?.min_protocol_version ??
        server?.minProtocolVersion,
    )
    const compatibility = protocolCompatibility(protocolVersion, minProtocolVersion)
    // Live capability execution is fail-closed. Normalize every capability expression carried by
    // the correlated probe response, including the standard sender envelope retained by bounded
    // transports when optional probe diagnostics are omitted.
    const capabilitySignals = collectCapabilitySignals(probe)
    const has = (...keys: string[]): boolean => keys.some((key) => capabilitySignals.has(key))
    const fileCapability = (groupedKey: string, legacyKey: string): boolean =>
      online && has(`file.${groupedKey}`, legacyKey)
    const sessionStreaming =
      online &&
      has(
        'session.streaming',
        'session_streaming',
        'agent.stream_json_input',
        'stream_json_input',
        'agent.runtime_select',
        'runtime_select',
      )
    const imageInput = online && has('file.image_input', 'agent.image_input', 'image_input')
    const agentVersion = valueAsString(
      probe?.agentVersion ?? probe?.agent_version ?? probe?.sender?.version ?? server?.agentVersion,
    )
    const runtime = valueAsString(probe?.runtime)
    const probeState = valueAsString(probe?.runtime_probe?.refresh_state) ?? 'unknown'
    const capabilityProbeIncomplete =
      online && probe?.payload_truncated === true && capabilitySignals.size === 0
        ? remoteError(
            'remote-agent',
            REMOTE_ERROR_CODE.CAPABILITY_PROBE_INCOMPLETE,
            '能力探测响应不完整，Studio 无法判定远程能力，将自动重试',
            true,
            {
              payloadTruncated: true,
              truncationReason: probe.payload_truncation_reason ?? 'unknown',
            },
          )
        : undefined
    const capabilityUnavailable =
      online && probe && !capabilityProbeIncomplete && !sessionStreaming
        ? remoteError(
            'remote-agent',
            REMOTE_ERROR_CODE.CAPABILITY_UNAVAILABLE,
            [
              '远程 Agent 已响应能力探测，但未声明远程会话/流式消息能力',
              agentVersion ? `Agent ${agentVersion}` : '',
              runtime ? `runtime ${runtime}` : '',
              probeState !== 'unknown' ? `probe ${probeState}` : '',
            ]
              .filter(Boolean)
              .join(' · '),
            probeState === 'pending' ||
              probeState === 'refreshing' ||
              probe?.runtime_probe?.stale === true,
          )
        : undefined
    return {
      ref,
      state: online ? 'online' : (server?.status ?? 'unknown'),
      endpointName: server?.name,
      agentVersion,
      protocolVersion,
      runtime,
      ...(probe
        ? {
            capabilityProbe: {
              state: probeState,
              ...(probe.runtime_probe?.checked_at != null
                ? { checkedAt: String(probe.runtime_probe.checked_at) }
                : {}),
              stale: probe.runtime_probe?.stale === true,
              response: probe,
            },
          }
        : {}),
      compatibility,
      workspacePath: ref.path,
      capabilities: {
        file: {
          tree: fileCapability('tree', 'file_tree'),
          read: fileCapability('read', 'file_read'),
          write: fileCapability('write', 'file_write'),
          create: fileCapability('create', 'file_create'),
          rename: fileCapability('rename', 'file_rename'),
          delete: fileCapability('delete', 'file_delete'),
        },
        shell: {
          pty: online && has('shell.terminal_workspace_pty', 'terminal_workspace_pty'),
        },
        agent: { session: sessionStreaming, stream: sessionStreaming, imageInput },
      },
      ...(!online
        ? {
            remoteError: remoteError(
              'transport',
              REMOTE_ERROR_CODE.TRANSPORT_UNAVAILABLE,
              '远程设备当前不可用',
              true,
            ),
          }
        : probeResult?.error
          ? {
              remoteError: probeResult.error,
            }
          : capabilityProbeIncomplete
            ? { remoteError: capabilityProbeIncomplete }
            : capabilityUnavailable
              ? { remoteError: capabilityUnavailable }
              : {}),
    }
  }

  async diagnose(ref: RemoteWorkspaceRef, sessionId?: string): Promise<RemoteDiagnosticReport> {
    const status = await this.getStatus(ref)
    if (status.remoteError) {
      this.diagnosticLog.record('status', {
        ...status.remoteError,
        context: { ...status.remoteError.context, endpointId: ref.endpointId },
      })
    }
    const session = sessionId ? this.assertSessionMatches(ref, sessionId) : undefined
    return buildRemoteDiagnosticReport(
      status,
      this.diagnosticLog.recent(ref.endpointId),
      session
        ? {
            session: { ...session },
            messages: this.listMessages(session.id).slice(-REMOTE_SESSION_DIAGNOSTIC_MESSAGE_LIMIT),
            messageLimit: REMOTE_SESSION_DIAGNOSTIC_MESSAGE_LIMIT,
            events: this.diagnosticLog.recentSession(ref.endpointId, session.id),
            eventLimit: REMOTE_SESSION_DIAGNOSTIC_EVENT_LIMIT,
            processLocalOnly: true,
          }
        : undefined,
    )
  }

  async listFileTree(request: RemoteFileTreeRequest): Promise<RemoteFileTreeResult> {
    const validation = this.validateWorkspace(request.ref, request.path ?? request.ref.path)
    if (validation) return validation
    try {
      await this.requireCapability(request.ref, 'file.tree')
    } catch (error) {
      const result = requestFailure(error)
      this.recordDiagnostic('file.tree', request.ref.endpointId, result)
      return result
    }
    const result = await this.requestFileTree(
      request.ref.endpointId,
      request.path ?? request.ref.path,
      request.depth ?? 1,
    )
    if (!result.success) this.recordDiagnostic('file.tree', request.ref.endpointId, result)
    return result
  }

  async readFile(request: RemoteFileReadRequest): Promise<RemoteFileReadResult> {
    const validation = this.validateWorkspace(request.ref, request.path)
    if (validation) return validation
    try {
      await this.requireCapability(request.ref, 'file.read')
      const firstLine = normalizePositiveLine(request.startLine) ?? 1
      const requestedEndLine = normalizePositiveLine(request.endLine)
      if (requestedEndLine !== undefined && requestedEndLine < firstLine) {
        return this.fileReadFailure(
          request.ref.endpointId,
          REMOTE_ERROR_CODE.FILE_PROTOCOL_INVALID,
          '远程文件读取范围无效',
          false,
        )
      }

      const chunks: string[] = []
      let nextLine = firstLine
      let pageLineLimit = REMOTE_FILE_READ_PAGE_LINES
      let totalLines: number | null = null
      let sha256: string | null = null
      let accumulatedBytes = 0

      for (let attempt = 0; attempt < MAX_REMOTE_FILE_READ_ATTEMPTS; attempt += 1) {
        const endLine = Math.min(
          nextLine + pageLineLimit - 1,
          requestedEndLine ?? Number.MAX_SAFE_INTEGER,
        )
        const message = {
          ...createCclinkEnvelope('file_read_request'),
          path: request.path,
          start_line: nextLine,
          end_line: endLine,
          file_scope: 'server',
        }
        const response = (await this.requestRouter.request(request.ref.endpointId, message, [
          'file_read_response',
        ])) as CclinkFileReadResponseMessage

        if (response.error) {
          return this.fileReadFailure(
            request.ref.endpointId,
            REMOTE_ERROR_CODE.FILE_FAILED,
            response.error,
            true,
          )
        }
        if (response.is_binary === true) {
          return this.fileReadFailure(
            request.ref.endpointId,
            REMOTE_ERROR_CODE.FILE_FAILED,
            '远程文件是二进制文件，无法在文本编辑器中打开',
            false,
          )
        }
        if (response.content_truncated === true || response.payload_truncated === true) {
          if (pageLineLimit === 1) {
            return this.fileReadFailure(
              request.ref.endpointId,
              REMOTE_ERROR_CODE.FILE_READ_INCOMPLETE,
              '远程文件包含超过消息上限的单行，无法安全读取完整内容',
              false,
            )
          }
          pageLineLimit = Math.max(1, Math.floor(pageLineLimit / 2))
          continue
        }

        const responseTotalLines = normalizePositiveLine(response.total_lines)
        const responseStartLine = normalizePositiveLine(response.start_line) ?? nextLine
        const responseEndLine =
          normalizePositiveLine(response.end_line) ??
          (responseTotalLines === undefined ? undefined : Math.min(endLine, responseTotalLines))
        if (
          response.content === undefined ||
          response.path !== request.path ||
          responseTotalLines === undefined ||
          responseStartLine !== nextLine ||
          responseEndLine === undefined ||
          responseEndLine < responseStartLine ||
          responseEndLine > endLine ||
          responseEndLine > responseTotalLines
        ) {
          return this.fileReadFailure(
            request.ref.endpointId,
            REMOTE_ERROR_CODE.FILE_PROTOCOL_INVALID,
            '远程 Agent 返回了无效的文件分页响应',
            true,
          )
        }
        if (totalLines !== null && responseTotalLines !== totalLines) {
          return this.fileReadFailure(
            request.ref.endpointId,
            REMOTE_ERROR_CODE.FILE_CHANGED_DURING_READ,
            '远程文件在读取过程中发生变化，请重新读取',
            true,
          )
        }
        totalLines = responseTotalLines
        if (sha256 !== null && response.content_sha256 !== sha256) {
          return this.fileReadFailure(
            request.ref.endpointId,
            REMOTE_ERROR_CODE.FILE_CHANGED_DURING_READ,
            '远程文件在读取过程中发生变化，请重新读取',
            true,
          )
        }
        if (sha256 === null && response.content_sha256) sha256 = response.content_sha256

        const separatorBytes = chunks.length > 0 ? 1 : 0
        accumulatedBytes += separatorBytes + Buffer.byteLength(response.content, 'utf8')
        if (accumulatedBytes > MAX_FILE_BYTES) {
          return this.fileReadFailure(
            request.ref.endpointId,
            REMOTE_ERROR_CODE.FILE_TOO_LARGE,
            '远程文件超过 2 MiB 读取上限',
            false,
          )
        }
        chunks.push(response.content)

        const hasMore = response.has_more === true || responseEndLine < responseTotalLines
        const reachedRequestedEnd =
          requestedEndLine !== undefined && responseEndLine >= requestedEndLine
        if (!hasMore || reachedRequestedEnd) {
          const content = chunks.join('\n')
          const complete = firstLine === 1 && !hasMore
          if (
            complete &&
            sha256 !== null &&
            createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex') !== sha256
          ) {
            return this.fileReadFailure(
              request.ref.endpointId,
              REMOTE_ERROR_CODE.FILE_READ_INCOMPLETE,
              '远程文件内容校验失败，请重新读取',
              true,
            )
          }
          return {
            success: true,
            file: {
              path: request.path,
              content,
              totalLines,
              complete,
              ...(sha256 ? { sha256 } : {}),
            },
          }
        }

        nextLine = responseEndLine + 1
        pageLineLimit = REMOTE_FILE_READ_PAGE_LINES
      }

      return this.fileReadFailure(
        request.ref.endpointId,
        REMOTE_ERROR_CODE.FILE_READ_INCOMPLETE,
        '远程文件分页数量超过安全上限，无法读取完整内容',
        false,
      )
    } catch (error) {
      const result = requestFailure(error)
      this.recordDiagnostic('file.read', request.ref.endpointId, result)
      return result
    }
  }

  private fileReadFailure(
    endpointId: string,
    code: string,
    message: string,
    retryable: boolean,
  ): RemoteFileReadResult {
    const result = failure('file-provider', code, message, retryable)
    this.recordDiagnostic('file.read', endpointId, result)
    return result
  }

  async writeFile(request: RemoteFileWriteRequest): Promise<RemoteFileMutationResult> {
    try {
      await this.requireCapability(request.ref, 'file.write')
    } catch (error) {
      const result = mutationFailure(error instanceof Error ? error.message : String(error), true)
      this.recordDiagnostic('file.write', request.ref.endpointId, result)
      return result
    }
    const context = this.mutationContext(request, 'file_write')
    if (!context.ok) return context.result
    const content = Buffer.from(request.content, 'utf8')
    if (content.length > MAX_FILE_BYTES) return mutationFailure('远程文件超过 2 MiB 修改上限')
    if (content.length > INLINE_FILE_BYTES) {
      return this.sendChunkedMutation(
        request,
        content,
        'write',
        context.path(request.path),
        request.expectedSha256,
      )
    }
    const message: CclinkFileWriteRequestMessage = {
      ...this.mutationEnvelope('file_write_request', request),
      path: context.path(request.path),
      encoding: 'utf8',
      content_base64: content.toString('base64'),
      total_bytes: content.length,
      content_sha256: createHash('sha256').update(content).digest('hex'),
      expected_sha256: request.expectedSha256,
    }
    return this.sendMutation(request.ref.endpointId, message, 'file_write_response')
  }

  async createFile(request: RemoteFileCreateRequest): Promise<RemoteFileMutationResult> {
    try {
      await this.requireCapability(request.ref, 'file.create')
    } catch (error) {
      const result = mutationFailure(error instanceof Error ? error.message : String(error), true)
      this.recordDiagnostic('file.create', request.ref.endpointId, result)
      return result
    }
    const context = this.mutationContext(request, 'file_create')
    if (!context.ok) return context.result
    const content = Buffer.from(request.content ?? '', 'utf8')
    if (content.length > MAX_FILE_BYTES) return mutationFailure('远程文件超过 2 MiB 创建上限')
    if (request.type === 'file' && content.length > INLINE_FILE_BYTES) {
      return this.sendChunkedMutation(request, content, 'create_file', context.path(request.path))
    }
    const message: CclinkFileCreateRequestMessage = {
      ...this.mutationEnvelope('file_create_request', request),
      path: context.path(request.path),
      kind: request.type,
      overwrite: false,
      ...(request.type === 'file'
        ? {
            encoding: 'utf8' as const,
            content_base64: content.toString('base64'),
            total_bytes: content.length,
            content_sha256: createHash('sha256').update(content).digest('hex'),
          }
        : {}),
    }
    return this.sendMutation(request.ref.endpointId, message, 'file_create_response')
  }

  async renameFile(request: RemoteFileRenameRequest): Promise<RemoteFileMutationResult> {
    try {
      await this.requireCapability(request.ref, 'file.rename')
    } catch (error) {
      const result = mutationFailure(error instanceof Error ? error.message : String(error), true)
      this.recordDiagnostic('file.rename', request.ref.endpointId, result)
      return result
    }
    const context = this.mutationContext(request, 'file_rename')
    if (!context.ok) return context.result
    const message: CclinkFileRenameRequestMessage = {
      ...this.mutationEnvelope('file_rename_request', request),
      source_path: context.path(request.oldPath),
      destination_path: context.path(request.newPath),
      overwrite: false,
    }
    return this.sendMutation(request.ref.endpointId, message, 'file_rename_response')
  }

  async deleteFile(request: RemoteFileDeleteRequest): Promise<RemoteFileMutationResult> {
    try {
      await this.requireCapability(request.ref, 'file.delete')
    } catch (error) {
      const result = mutationFailure(error instanceof Error ? error.message : String(error), true)
      this.recordDiagnostic('file.delete', request.ref.endpointId, result)
      return result
    }
    const context = this.mutationContext(request, 'file_delete')
    if (!context.ok) return context.result
    const message: CclinkFileDeleteRequestMessage = {
      ...this.mutationEnvelope('file_delete_request', request),
      path: context.path(request.path),
      recursive: request.recursive === true,
      ...(request.expectedSha256 ? { expected_sha256: request.expectedSha256 } : {}),
    }
    return this.sendMutation(request.ref.endpointId, message, 'file_delete_response')
  }

  private mutationContext(
    request: { ref: RemoteWorkspaceRef; sessionId: string },
    capability: 'file_write' | 'file_create' | 'file_rename' | 'file_delete',
  ):
    | { ok: true; path: (target: string) => string }
    | { ok: false; result: RemoteFileMutationResult } {
    const validation = this.validateWorkspace(request.ref, request.ref.path)
    if (validation)
      return { ok: false, result: mutationFailure(validation.error || '远程工作空间不可用') }
    const server = this.servers.get(request.ref.endpointId)
    if (!supports(server, capability)) {
      return { ok: false, result: mutationFailure(`当前 Agent 未声明 ${capability} 能力`, true) }
    }
    const session = this.sessions.get(request.sessionId)
    if (
      !session ||
      session.serverId !== request.ref.endpointId ||
      session.workspaceId !== request.ref.workspaceId
    ) {
      return { ok: false, result: mutationFailure('文件修改必须绑定当前远程工作空间 Session') }
    }
    return { ok: true, path: (target) => relativeRemotePath(request.ref.path, target) }
  }

  private mutationEnvelope<T extends CclinkMessageType>(
    ccType: T,
    request: {
      ref: RemoteWorkspaceRef
      sessionId: string
      operationId: string
      operationCreatedAt: number
      operationExpiresAt: number
    },
  ) {
    return {
      ...createCclinkEnvelope(ccType, {
        request_id: request.operationId,
        trace_id: request.operationId,
      }),
      mutation_v: 1 as const,
      request_id: request.operationId,
      trace_id: request.operationId,
      operation_id: request.operationId,
      operation_created_at: request.operationCreatedAt,
      operation_expires_at: request.operationExpiresAt,
      agent_id: request.ref.endpointId,
      session_id: request.sessionId,
      workspace_id: request.ref.workspaceId,
      workspace_path: request.ref.path,
    }
  }

  private async sendMutation(
    serverId: string,
    message: CclinkProtocolMessage,
    expectedType:
      | 'file_write_response'
      | 'file_create_response'
      | 'file_rename_response'
      | 'file_delete_response',
  ): Promise<RemoteFileMutationResult> {
    try {
      const response = (await this.requestRouter.request(
        serverId,
        message,
        [expectedType],
        30_000,
      )) as CclinkMutationResponseMessage
      if (response.status !== 'ok') {
        const result = mutationFailure(response.message || response.code || '远程文件修改失败')
        this.recordDiagnostic(`file.${expectedType}`, serverId, result)
        return result
      }
      return {
        success: true,
        operationId: response.operation_id,
        replayed: response.replayed,
        diskState: response.disk_state,
        path: response.destination_path || response.path,
        sha256: response.sha256,
      }
    } catch (error) {
      const result = mutationFailure(error instanceof Error ? error.message : '远程文件修改失败')
      this.recordDiagnostic(`file.${expectedType}`, serverId, result)
      return result
    }
  }

  private async sendChunkedMutation(
    request: RemoteFileWriteRequest | RemoteFileCreateRequest,
    content: Buffer,
    operation: 'write' | 'create_file',
    path: string,
    expectedSha256?: string,
  ): Promise<RemoteFileMutationResult> {
    try {
      const identity = await this.auth.ensureIdentity()
      const transferId = stableTransferId(request.operationId)
      const contentSha256 = sha256(content)
      const chunkCount = Math.ceil(content.length / FILE_CHUNK_BYTES)
      const fingerprint = mutationFingerprint({
        actualSender: identity.clientImUserId,
        agentId: request.ref.endpointId,
        sessionId: request.sessionId,
        workspaceId: request.ref.workspaceId,
        operation,
        operationId: request.operationId,
        operationCreatedAt: request.operationCreatedAt,
        operationExpiresAt: request.operationExpiresAt,
        path,
        totalBytes: content.length,
        contentSha256,
        expectedSha256,
      })
      let state = await this.transferControl(
        request,
        transferId,
        fingerprint,
        'file_mutation_status_request',
        'file_mutation_status_response',
      )
      const existing = transferResult(state)
      if (existing) return existing
      if (state.status !== 'ok' && state.state !== 'unknown') return transferFailure(state)
      if (state.state === 'unknown') {
        const begin: CclinkFileMutationBeginRequestMessage = {
          ...this.transferEnvelope('file_mutation_begin_request', request, transferId),
          operation,
          path,
          encoding: 'utf8',
          total_bytes: content.length,
          content_sha256: contentSha256,
          ...(expectedSha256 ? { expected_sha256: expectedSha256 } : {}),
          ...(operation === 'create_file' ? { overwrite: false as const } : {}),
          chunk_size: FILE_CHUNK_BYTES,
          chunk_count: chunkCount,
        }
        state = await this.requestTransfer(
          request.ref.endpointId,
          begin,
          'file_mutation_begin_response',
        )
        const begun = transferResult(state)
        if (begun) return begun
        if (state.status !== 'ok') return transferFailure(state)
      }
      const missing = indexesFromRanges(state.missing_ranges, chunkCount)
      for (let offset = 0; offset < missing.length; offset += CHUNK_SEND_CONCURRENCY) {
        const batch = missing.slice(offset, offset + CHUNK_SEND_CONCURRENCY)
        const responses = await Promise.all(
          batch.map((chunkIndex) => {
            const start = chunkIndex * FILE_CHUNK_BYTES
            const chunk = content.subarray(
              start,
              Math.min(start + FILE_CHUNK_BYTES, content.length),
            )
            const chunkMessage: CclinkFileMutationChunkRequestMessage = {
              ...this.transferEnvelope('file_mutation_chunk_request', request, transferId),
              operation_fingerprint: fingerprint,
              chunk_index: chunkIndex,
              chunk_count: chunkCount,
              decoded_bytes: chunk.length,
              chunk_sha256: sha256(chunk),
              content_base64: chunk.toString('base64'),
            }
            return this.requestTransfer(
              request.ref.endpointId,
              chunkMessage,
              'file_mutation_chunk_response',
            )
          }),
        )
        const failed = responses.find((response) => response.status !== 'ok')
        if (failed) return transferFailure(failed)
      }
      const committed = await this.transferControl(
        request,
        transferId,
        fingerprint,
        'file_mutation_commit_request',
        'file_mutation_commit_response',
      )
      return transferResult(committed) ?? transferFailure(committed)
    } catch (error) {
      return mutationFailure(error instanceof Error ? error.message : '远程分块文件修改失败')
    }
  }

  private transferEnvelope<T extends CclinkMessageType>(
    ccType: T,
    request: RemoteFileWriteRequest | RemoteFileCreateRequest,
    transferId: string,
  ) {
    const requestId = randomUUID()
    return {
      ...createCclinkEnvelope(ccType, { request_id: requestId, trace_id: request.operationId }),
      mutation_v: 1 as const,
      request_id: requestId,
      trace_id: request.operationId,
      operation_id: request.operationId,
      operation_created_at: request.operationCreatedAt,
      operation_expires_at: request.operationExpiresAt,
      transfer_id: transferId,
      agent_id: request.ref.endpointId,
      session_id: request.sessionId,
      workspace_id: request.ref.workspaceId,
      workspace_path: request.ref.path,
    }
  }

  private async transferControl(
    request: RemoteFileWriteRequest | RemoteFileCreateRequest,
    transferId: string,
    fingerprint: string,
    ccType:
      | 'file_mutation_status_request'
      | 'file_mutation_commit_request'
      | 'file_mutation_abort_request',
    expectedType:
      | 'file_mutation_status_response'
      | 'file_mutation_commit_response'
      | 'file_mutation_abort_response',
  ): Promise<CclinkFileTransferResponseMessage> {
    const message: CclinkFileMutationControlRequestMessage = {
      ...this.transferEnvelope(ccType, request, transferId),
      operation_fingerprint: fingerprint,
    }
    return this.requestTransfer(request.ref.endpointId, message, expectedType)
  }

  private async requestTransfer(
    serverId: string,
    message: CclinkProtocolMessage,
    expectedType: CclinkFileTransferResponseMessage['cc_type'],
  ): Promise<CclinkFileTransferResponseMessage> {
    if (Buffer.byteLength(JSON.stringify(message), 'utf8') > MAX_MUTATION_MESSAGE_BYTES) {
      throw new Error('文件修改消息超过腾讯 IM 负载上限')
    }
    return (await this.requestRouter.request(
      serverId,
      message,
      [expectedType],
      30_000,
    )) as CclinkFileTransferResponseMessage
  }

  async destroy(): Promise<void> {
    await this.saveState()
    await this.disconnect()
    this.servers.clear()
    this.statusListeners.clear()
    this.realtimeListeners.clear()
    this.imageUploadListeners.clear()
    this.sessions.clear()
    this.messages.clear()
    this.streams.clear()
    this.capabilityProbes.clear()
    this.capabilityProbeFailures.clear()
  }

  async disconnect(): Promise<void> {
    for (const controller of this.imageUploads.values()) controller.abort()
    this.imageUploads.clear()
    this.timStatusUnsubscribe?.()
    this.timStatusUnsubscribe = null
    this.requestRouter.detach()
    if (this.timTransport) {
      await this.timTransport.dispose().catch(() => undefined)
      this.timTransport = null
    }
    this.updateStatus({ state: 'offline' })
  }

  private async connectInternal(): Promise<CclinkRealtimeStatus> {
    this.updateStatus({ state: 'connecting' })
    let transport: TimTransport | null = null
    try {
      const identity = await this.auth.ensureIdentity()
      const candidate = this.createTimTransport()
      transport = candidate
      this.timTransport = candidate
      this.timStatusUnsubscribe = candidate.onStatus((status) => {
        if (this.timTransport !== candidate) return
        if (status === 'online') {
          this.requestRouter.attach(candidate)
          const reconnected = this.status.state === 'offline' || this.status.state === 'error'
          this.updateStatus({ state: 'online' })
          if (reconnected) void this.refreshOnlineMetadata()
          return
        }
        this.requestRouter.detach()
        this.updateStatus({ state: 'offline', error: '腾讯 IM 连接已断开，等待自动恢复' })
      })
      await candidate.login(identity)
      this.requestRouter.attach(candidate)
      this.updateStatus({ state: 'online' })
    } catch (error) {
      this.timStatusUnsubscribe?.()
      this.timStatusUnsubscribe = null
      this.requestRouter.detach()
      await transport?.dispose().catch(() => undefined)
      if (this.timTransport === transport) this.timTransport = null
      this.updateStatus({
        state: 'error',
        error: thrownMessage(error, 'CCLink 连接失败'),
      })
    }
    return this.getRealtimeStatus()
  }

  private async requireOnline(): Promise<void> {
    const status = await this.connect()
    if (status.state !== 'online') throw new Error(status.error || 'CCLink 实时链路连接失败')
  }

  private async requireCapability(
    ref: RemoteWorkspaceRef,
    capability:
      | 'file.tree'
      | 'file.read'
      | 'file.write'
      | 'file.create'
      | 'file.rename'
      | 'file.delete'
      | 'agent.session'
      | 'agent.stream'
      | 'agent.imageInput'
      | 'shell.pty',
  ): Promise<void> {
    const status = await this.getStatus(ref)
    if (status.state !== 'online') throw new Error(status.remoteError?.message || '远程设备不在线')
    if (status.compatibility === 'upgrade-required') throw new Error('远程 Agent 协议版本不兼容')
    const [group, name] = capability.split('.') as [
      'file' | 'agent' | 'shell',
      (
        | 'tree'
        | 'read'
        | 'write'
        | 'create'
        | 'rename'
        | 'delete'
        | 'session'
        | 'stream'
        | 'imageInput'
        | 'pty'
      ),
    ]
    const available = (status.capabilities[group] as Record<string, boolean>)[name] === true
    if (!available) throw new Error(`远程 Agent 未通过实时能力检查：${capability}`)
  }

  private async getLiveCapabilityProbe(serverId: string): Promise<CapabilityProbeResult> {
    const cached = this.capabilityProbes.get(serverId)
    if (cached && cached.expiresAt > Date.now()) {
      return { response: cached.response }
    }
    const cachedFailure = this.capabilityProbeFailures.get(serverId)
    if (cachedFailure && cachedFailure.expiresAt > Date.now()) {
      return {
        response: cached?.response ?? null,
        ...(cachedFailure.error ? { error: cachedFailure.error } : {}),
      }
    }
    try {
      const received = (await this.requestRouter.request(
        serverId,
        createCclinkEnvelope('capability_probe_request'),
        ['capability_probe_response'],
        3_000,
      )) as CclinkCapabilityProbeResponseMessage
      const response = boundedCapabilityProbeResponse(received)
      const capabilitySignals = collectCapabilitySignals(response)
      const incomplete =
        response.capability_probe_complete === false ||
        (response.payload_truncated === true && capabilitySignals.size === 0)
      if (incomplete) {
        const error = incompleteCapabilityProbeError(response, serverId)
        const result = { response: cached?.response ?? null, error }
        this.capabilityProbeFailures.set(serverId, {
          expiresAt: Date.now() + 2_000,
          ...result,
        })
        this.diagnosticLog.record('capability.probe', error)
        return result
      }
      const server = this.servers.get(serverId)
      if (server) {
        server.agentVersion =
          valueAsString(
            response.agentVersion ?? response.agent_version ?? response.sender?.version,
          ) ?? server.agentVersion
        server.protocolVersion =
          valueAsString(
            response.protocolVersion ??
              response.protocol_version ??
              response.sender?.protocol_version,
          ) ?? server.protocolVersion
        server.minProtocolVersion =
          valueAsString(
            response.minProtocolVersion ??
              response.min_protocol_version ??
              response.sender?.min_protocol_version,
          ) ?? server.minProtocolVersion
        server.capabilities = {
          ...response.capability_map,
          ...Object.fromEntries([...capabilitySignals].map((capability) => [capability, true])),
        }
        server.capabilityList = [...capabilitySignals]
      }
      const transientProbe =
        response.runtime_probe?.refresh_state === 'pending' ||
        response.runtime_probe?.refresh_state === 'refreshing' ||
        response.runtime_probe?.stale === true ||
        (response.payload_truncated === true && collectCapabilitySignals(response).size === 0)
      const result = { response }
      this.capabilityProbes.set(serverId, {
        expiresAt: Date.now() + (transientProbe ? 2_000 : 15_000),
        ...result,
      })
      this.capabilityProbeFailures.delete(serverId)
      return result
    } catch (error) {
      const normalized = capabilityProbeError(error, serverId)
      const result = { response: cached?.response ?? null, error: normalized }
      this.capabilityProbeFailures.set(serverId, {
        expiresAt: Date.now() + 5_000,
        ...result,
      })
      this.diagnosticLog.record('capability.probe', normalized)
      return result
    }
  }

  private async syncSessions(serverId: string): Promise<void> {
    const response = (await this.requestRouter.request(
      serverId,
      createCclinkEnvelope('session_sync_request'),
      ['session_sync_response'],
      15_000,
    )) as CclinkSessionSyncResponseMessage
    this.applySessionSync(serverId, response)
  }

  private async handleProtocolMessage(
    serverId: string,
    message: CclinkProtocolMessage,
  ): Promise<void> {
    this.recordSessionProtocolEvent(serverId, message, 'inbound')
    if (this.shouldIgnoreStoppedAgentEvent(message)) return
    switch (message.cc_type) {
      case 'session_sync_response':
        this.applySessionSync(serverId, message as CclinkSessionSyncResponseMessage)
        return
      case 'session_update': {
        const update = message as unknown as { session_id: string; name?: string }
        const current = this.sessions.get(update.session_id)
        if (current) {
          this.sessions.set(update.session_id, {
            ...current,
            name: resolveRemoteSessionTitle({
              currentTitle: current.name,
              incomingTitle: update.name,
              sessionId: update.session_id,
            }),
            updatedAt: nowSeconds(),
          })
          this.persistState()
          this.emitRealtime({ type: 'sessions', serverId, sessionId: update.session_id })
        }
        return
      }
      case 'stream_start': {
        const event = message as unknown as { session_id: string; msg_id: string }
        this.streams.set(`${serverId}:${event.msg_id}`, {
          serverId,
          sessionId: event.session_id,
          messageId: event.msg_id,
          content: '',
        })
        this.setSessionStatus(event.session_id, 'active')
        this.emitRealtime({
          type: 'conversation',
          serverId,
          sessionId: event.session_id,
          phase: 'started',
        })
        return
      }
      case 'user_text': {
        const event = message as unknown as {
          session_id: string
          request_id?: string
          content: string
        }
        const remoteMessage: CclinkRemoteMessage = {
          type: 'user',
          id: `remote-user-${event.request_id || randomUUID()}`,
          content: event.content,
          timestamp: nowSeconds(),
        }
        this.appendMessage(event.session_id, remoteMessage)
        this.setSessionStatus(event.session_id, 'active')
        this.emitRealtime({
          type: 'conversation',
          serverId,
          sessionId: event.session_id,
          phase: 'started',
          message: remoteMessage,
        })
        return
      }
      case 'agent_status': {
        const event = message as unknown as {
          session_id: string
          status: string
          msg_id?: string
          code?: string
          message?: string
        }
        const active = !['idle', 'completed', 'failed', 'error'].includes(event.status)
        this.setSessionStatus(event.session_id, active ? 'active' : 'idle')
        const failed = event.status === 'failed' || event.status === 'error'
        const remoteMessage: CclinkRemoteMessage | undefined =
          failed && (event.message || event.code)
            ? {
                type: 'system',
                id: `remote-status-${event.msg_id || randomUUID()}`,
                content: event.message || event.code || '远程 Agent 执行失败',
                timestamp: nowSeconds(),
                remoteError: {
                  layer: 'remote-agent',
                  code: event.code || 'REMOTE_AGENT_FAILED',
                  message: event.message || '远程 Agent 执行失败',
                  retryable: true,
                  context: { serverId, sessionId: event.session_id },
                },
              }
            : undefined
        if (remoteMessage) this.appendMessage(event.session_id, remoteMessage)
        if (!active) this.settleAgentRequest(event.session_id, message)
        this.emitRealtime({
          type: 'conversation',
          serverId,
          sessionId: event.session_id,
          phase: active ? 'streaming' : failed ? 'error' : 'completed',
          ...(remoteMessage ? { message: remoteMessage } : {}),
        })
        return
      }
      case 'stream_chunk':
      case 'agent_text': {
        const event = message as unknown as {
          session_id: string
          msg_id: string
          delta?: string
          content?: string
        }
        const key = `${serverId}:${event.msg_id}`
        const buffer = this.streams.get(key) ?? {
          serverId,
          sessionId: event.session_id,
          messageId: event.msg_id,
          content: '',
        }
        buffer.content += event.delta ?? event.content ?? ''
        this.streams.set(key, buffer)
        const remoteMessage: CclinkRemoteMessage = {
          type: 'agentText',
          id: `remote-agent-${event.msg_id}`,
          content: buffer.content,
          timestamp: nowSeconds(),
        }
        this.appendMessage(event.session_id, remoteMessage)
        this.emitRealtime({
          type: 'conversation',
          serverId,
          sessionId: event.session_id,
          phase: 'streaming',
          message: remoteMessage,
        })
        return
      }
      case 'stream_end': {
        const event = message as unknown as {
          session_id: string
          msg_id: string
          final_text?: string
          error?: string
          code?: string
        }
        const key = `${serverId}:${event.msg_id}`
        const buffer = this.streams.get(key)
        this.streams.delete(key)
        const finalText = event.final_text ?? buffer?.content ?? ''
        let remoteMessage: CclinkRemoteMessage | undefined
        const repeatedTerminalText = finalText
          ? this.hasRepeatedTerminalText(event.session_id, event.msg_id, finalText)
          : false
        if (finalText && !repeatedTerminalText) {
          remoteMessage = {
            type: 'agentText',
            id: `remote-agent-${event.msg_id}`,
            content: finalText,
            timestamp: nowSeconds(),
          }
          this.appendMessage(event.session_id, remoteMessage)
        } else if (event.error || event.code) {
          remoteMessage = {
            type: 'system',
            id: `remote-error-${event.msg_id}`,
            content: event.error || event.code || '远程 Agent 执行失败',
            timestamp: nowSeconds(),
          }
          this.appendMessage(event.session_id, remoteMessage)
        }
        this.setSessionStatus(event.session_id, 'idle')
        this.settleAgentRequest(event.session_id, message)
        this.emitRealtime({
          type: 'conversation',
          serverId,
          sessionId: event.session_id,
          phase: event.error || event.code ? 'error' : 'completed',
          ...(remoteMessage ? { message: remoteMessage } : {}),
        })
        return
      }
      case 'agent_tool': {
        const event = message as unknown as {
          session_id: string
          msg_id: string
          tool: string
          tool_use_id: string
          state: 'pending' | 'executing' | 'completed' | 'failed' | 'denied'
          input?: Record<string, unknown>
          output?: string
          error?: string
          requires_approval?: boolean
          approval_reason?: string
          expires_at?: number
          request_id?: string
        }
        const messageId = `remote-tool-${event.tool_use_id || event.msg_id}`
        const previousMessage = (this.messages.get(event.session_id) ?? []).find(
          (item): item is Extract<CclinkRemoteMessage, { type: 'agentTool' }> =>
            item.id === messageId && item.type === 'agentTool',
        )
        const preservesPendingApproval =
          (event.state === 'pending' || event.state === 'executing') &&
          event.requires_approval !== false &&
          previousMessage?.tool.requiresApproval === true
        const remoteMessage: CclinkRemoteMessage = {
          type: 'agentTool',
          id: messageId,
          timestamp: nowSeconds(),
          tool: {
            id: event.tool_use_id,
            name: event.tool,
            state: event.state,
            input: event.input,
            output: event.output,
            error: event.error,
            requiresApproval: event.requires_approval === true || preservesPendingApproval,
            approvalReason:
              event.approval_reason ??
              (preservesPendingApproval ? previousMessage.tool.approvalReason : undefined),
            expiresAt:
              event.expires_at ??
              (preservesPendingApproval ? previousMessage.tool.expiresAt : undefined),
            requestId:
              event.request_id ??
              (preservesPendingApproval ? previousMessage.tool.requestId : undefined),
          },
        }
        this.appendMessage(event.session_id, remoteMessage)
        this.emitRealtime({
          type: 'conversation',
          serverId,
          sessionId: event.session_id,
          phase: 'message',
          message: remoteMessage,
        })
        return
      }
      case 'user_question': {
        const event = message as unknown as {
          session_id: string
          request_id: string
          msg_id: string
          tool_use_id: string
          questions?: Array<{
            id?: string
            header?: string
            question?: string
            multiSelect?: boolean
            options?: Array<{ label?: string; description?: string }>
          }>
        }
        const questions = (event.questions ?? []).flatMap((question, index) => {
          if (!question || typeof question.question !== 'string') return []
          return [
            {
              id: question.id?.trim() || `question-${index + 1}`,
              header: question.header,
              question: question.question,
              multiSelect: question.multiSelect === true,
              options: question.options?.flatMap((option) =>
                option && typeof option.label === 'string'
                  ? [{ label: option.label, description: option.description }]
                  : [],
              ),
            },
          ]
        })
        const remoteMessage: CclinkRemoteMessage = {
          type: 'userQuestion',
          id: `remote-question-${event.tool_use_id || event.msg_id}`,
          timestamp: nowSeconds(),
          requestId: event.request_id,
          toolUseId: event.tool_use_id,
          questions,
        }
        this.appendMessage(event.session_id, remoteMessage)
        this.emitRealtime({
          type: 'conversation',
          serverId,
          sessionId: event.session_id,
          phase: 'message',
          message: remoteMessage,
        })
        return
      }
      case 'permission_request': {
        const event = message as unknown as {
          request_id: string
          path: string
          operation: string
        }
        this.emitRealtime({
          type: 'permission',
          serverId,
          permission: {
            requestId: event.request_id,
            path: event.path,
            operation: event.operation,
          },
        })
        return
      }
      case 'terminal_output': {
        const event = message as unknown as {
          session_id: string
          content: string
          request_id?: string
        }
        const remoteMessage: CclinkRemoteMessage = {
          type: 'system',
          id: `remote-terminal-${event.request_id || randomUUID()}`,
          content: event.content,
          timestamp: nowSeconds(),
        }
        this.appendMessage(event.session_id, remoteMessage)
        this.emitRealtime({
          type: 'conversation',
          serverId,
          sessionId: event.session_id,
          phase: 'message',
          message: remoteMessage,
        })
        return
      }
      case 'error': {
        const event = message as unknown as {
          session_id?: string
          message: string
          code?: string
          request_id?: string
        }
        if (!event.session_id) return
        const remoteMessage: CclinkRemoteMessage = {
          type: 'system',
          id: `remote-error-${event.request_id || randomUUID()}`,
          content: event.message,
          timestamp: nowSeconds(),
          remoteError: {
            layer: 'remote-agent',
            code: event.code || 'REMOTE_AGENT_ERROR',
            message: event.message,
            retryable: true,
            context: { serverId, sessionId: event.session_id },
          },
        }
        this.appendMessage(event.session_id, remoteMessage)
        this.setSessionStatus(event.session_id, 'idle')
        this.settleAgentRequest(event.session_id, message)
        this.emitRealtime({
          type: 'conversation',
          serverId,
          sessionId: event.session_id,
          phase: 'error',
          message: remoteMessage,
        })
        return
      }
      default:
        return
    }
  }

  private shouldIgnoreStoppedAgentEvent(message: CclinkProtocolMessage): boolean {
    if (
      ![
        'stream_start',
        'stream_chunk',
        'stream_end',
        'agent_status',
        'agent_text',
        'agent_tool',
        'user_question',
        'user_text',
        'error',
      ].includes(message.cc_type)
    ) {
      return false
    }
    const payload = message as unknown as Record<string, unknown>
    const sessionId = typeof payload['session_id'] === 'string' ? payload['session_id'] : null
    if (!sessionId) return false
    const requestId = typeof payload['request_id'] === 'string' ? payload['request_id'] : null
    const traceId = typeof payload['trace_id'] === 'string' ? payload['trace_id'] : null
    const stopped = this.stoppedAgentRequestIds.get(sessionId) ?? []
    if ((requestId && stopped.includes(requestId)) || (traceId && stopped.includes(traceId))) {
      return true
    }
    return this.stoppedAgentSessionsWithoutRequest.has(sessionId)
  }

  private settleAgentRequest(sessionId: string, message: CclinkProtocolMessage): void {
    const active = this.activeAgentRequests.get(sessionId)
    if (!active) return
    const payload = message as unknown as Record<string, unknown>
    const requestId = typeof payload['request_id'] === 'string' ? payload['request_id'] : null
    const traceId = typeof payload['trace_id'] === 'string' ? payload['trace_id'] : null
    if (!requestId || requestId === active || traceId === active) {
      this.activeAgentRequests.delete(sessionId)
    }
  }

  private applySessionSync(serverId: string, response: CclinkSessionSyncResponseMessage): void {
    for (const item of response.sessions) {
      if (item.project_mode && item.project_mode !== 'remote_workspace') continue
      if (!item.workspace_id) {
        this.diagnosticLog.record(
          'session.sync',
          remoteError(
            'remote-agent',
            REMOTE_ERROR_CODE.WORKSPACE_ID_MISSING,
            '远程会话同步结果缺少规范 workspace_id，已忽略该会话',
            false,
            { endpointId: serverId, sessionId: item.session_id },
          ),
        )
        continue
      }
      const createdAt = normalizeTimestamp(item.created_at ?? item.updated_at)
      const updatedAt = normalizeTimestamp(item.last_active_at ?? item.updated_at ?? createdAt)
      const current = this.sessions.get(item.session_id)
      const session: CclinkRemoteSession = {
        id: item.session_id,
        name: resolveRemoteSessionTitle({
          currentTitle: current?.name,
          incomingTitle: item.name,
          sessionId: item.session_id,
        }),
        workspaceId: item.workspace_id,
        workspacePath: item.workspace_path,
        serverId,
        status: current?.status ?? 'idle',
        createdAt,
        updatedAt,
        messageCount: item.message_count ?? this.messages.get(item.session_id)?.length ?? 0,
        contextUsage: item.context_usage ?? 0,
      }
      this.sessions.set(session.id, session)
    }
    // A sync response is only a snapshot of sessions the current Agent still knows about.
    // Locally imported or offline-only history is retained until an explicit user deletion.
    this.persistState()
    this.emitRealtime({ type: 'sessions', serverId })
  }

  private recordSessionProtocolEvent(
    serverId: string,
    message: CclinkProtocolMessage,
    direction: RemoteAgentSessionDiagnosticEvent['direction'],
  ): void {
    const payload = message as unknown as Record<string, unknown>
    const sessionId = diagnosticString(payload['session_id'])
    if (!sessionId) return
    const event: RemoteAgentSessionDiagnosticEvent = {
      timestamp: Date.now(),
      direction,
      type: message.cc_type,
      ...diagnosticField('requestId', payload['request_id']),
      ...diagnosticField('traceId', payload['trace_id']),
      ...diagnosticField('messageId', payload['msg_id']),
      ...diagnosticField('status', payload['status']),
      ...diagnosticField('code', payload['code']),
      ...diagnosticField('tool', payload['tool'] ?? payload['tool_name']),
      ...diagnosticField('toolState', payload['state']),
      ...diagnosticField('finalState', payload['final_state']),
      ...(typeof payload['exit_code'] === 'number' ? { exitCode: payload['exit_code'] } : {}),
      ...(payload['payload_truncated'] === true ? { payloadTruncated: true } : {}),
      ...(typeof payload['error'] === 'string'
        ? { error: sanitizeDiagnosticText(payload['error'], 500) }
        : typeof payload['message'] === 'string' && message.cc_type === 'error'
          ? { error: sanitizeDiagnosticText(payload['message'], 500) }
          : {}),
    }
    this.diagnosticLog.recordSession(serverId, sessionId, event)
  }

  private hasRepeatedTerminalText(
    sessionId: string,
    streamMessageId: string,
    content: string,
  ): boolean {
    const segmentPrefix = `remote-agent-${streamMessageId}-seg`
    const messages = this.messages.get(sessionId) ?? []
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.type !== 'agentText' || message.content !== content) continue
      const segment = message.id.slice(segmentPrefix.length)
      if (message.id.startsWith(segmentPrefix) && /^\d+$/u.test(segment)) return true
    }
    return false
  }

  private appendMessage(sessionId: string, message: CclinkRemoteMessage): void {
    const current = this.messages.get(sessionId) ?? []
    const next = [...current.filter((item) => item.id !== message.id), message].slice(-2_000)
    this.messages.set(sessionId, next)
    const session = this.sessions.get(sessionId)
    if (session) {
      const derivedTitle =
        message.type === 'user' &&
        !current.some((item) => item.type === 'user') &&
        isGenericRemoteSessionTitle(session.name)
          ? deriveRemoteSessionTitle(message.content)
          : null
      this.sessions.set(sessionId, {
        ...session,
        name: derivedTitle ?? session.name,
        updatedAt: message.timestamp,
        messageCount: next.length,
      })
    }
    this.persistState()
  }

  private setSessionStatus(sessionId: string, status: CclinkRemoteSession['status']): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      this.sessions.set(sessionId, {
        ...session,
        status: session.status === 'archived' ? 'archived' : status,
        updatedAt: nowSeconds(),
      })
      this.persistState()
    }
  }

  private persistState(): void {
    void this.saveState()
  }

  private saveState(): Promise<void> {
    if (!this.runtimeStateStore) return Promise.resolve()
    return this.runtimeStateStore.save({
      version: 1,
      sessions: [...this.sessions.values()],
      messages: Object.fromEntries(this.messages),
    })
  }

  private emitRealtime(event: CclinkRealtimeEvent): void {
    const enriched =
      event.type === 'sessions' && !event.sessions
        ? {
            ...event,
            sessions: [...this.sessions.values()]
              .filter((session) => session.serverId === event.serverId)
              .sort((a, b) => b.updatedAt - a.updatedAt),
          }
        : event
    for (const listener of this.realtimeListeners) listener(enriched)
  }

  private emitImageUploadProgress(progress: CclinkImageUploadProgress): void {
    for (const listener of this.imageUploadListeners) listener(progress)
  }

  private assertSessionMatches(ref: RemoteWorkspaceRef, sessionId: string): CclinkRemoteSession {
    const session = this.sessions.get(sessionId)
    if (
      !session ||
      session.serverId !== ref.endpointId ||
      session.workspaceId !== ref.workspaceId
    ) {
      throw new Error('远程会话与当前工作空间不匹配')
    }
    return session
  }

  private updateToolApproval(sessionId: string, toolUseId: string, approved: boolean): void {
    const current = this.messages.get(sessionId) ?? []
    this.messages.set(
      sessionId,
      current.map((message) =>
        message.type === 'agentTool' && message.tool.id === toolUseId
          ? {
              ...message,
              tool: {
                ...message.tool,
                state: approved ? ('executing' as const) : ('denied' as const),
                requiresApproval: false,
              },
            }
          : message,
      ),
    )
    this.persistState()
  }

  private markQuestionAnswered(sessionId: string, toolUseId: string): void {
    const current = this.messages.get(sessionId) ?? []
    this.messages.set(
      sessionId,
      current.map((message) =>
        message.type === 'userQuestion' && message.toolUseId === toolUseId
          ? { ...message, answered: true }
          : message,
      ),
    )
    this.persistState()
  }

  private findPendingQuestion(
    sessionId: string,
    toolUseId: string,
  ): Extract<CclinkRemoteMessage, { type: 'userQuestion' }> {
    const question = (this.messages.get(sessionId) ?? []).find(
      (message): message is Extract<CclinkRemoteMessage, { type: 'userQuestion' }> =>
        message.type === 'userQuestion' && message.toolUseId === toolUseId,
    )
    if (!question || question.answered) throw new Error('该问题已经失效或已回答')
    return question
  }

  private async refreshOnlineMetadata(): Promise<void> {
    await Promise.allSettled(
      [...this.servers.values()]
        .filter((server) => server.status === 'online')
        .map(async (server) => {
          const response = (await this.requestRouter.request(
            server.id,
            createCclinkEnvelope('server_meta_request'),
            ['server_meta'],
            8_000,
          )) as CclinkServerMetaMessage
          server.hostname = response.hostname || server.hostname
          server.name = server.name || response.hostname
          server.os = response.os || server.os
          server.agentVersion = response.agent_version || 'unknown'
          server.protocolVersion =
            response.protocol_version == null ? undefined : String(response.protocol_version)
          server.minProtocolVersion =
            response.min_protocol_version == null
              ? undefined
              : String(response.min_protocol_version)
          server.capabilities = response.capabilities
          server.capabilityList = response.capability_list
          // server_meta only contains path suggestions. It must not mint a second workspace
          // identity; canonical opaque IDs come from workspace_list/file_tree responses.
          if (supports(server, 'workspace_list')) await this.refreshWorkspaceList(server)
        }),
    )
  }

  private async refreshWorkspaceList(server: CclinkServer): Promise<void> {
    const response = (await this.requestRouter.request(
      server.id,
      {
        ...createCclinkEnvelope('workspace_list_request'),
        cursor: '0',
        limit: 100,
      } as import('../../shared/cclink').CclinkProtocolMessage,
      ['workspace_list_response'],
      10_000,
    )) as CclinkWorkspaceListResponseMessage
    server.workspaces = response.workspaces
      .filter((item) => item.exists !== false && item.id.trim() && item.path.trim())
      .map((item) => ({ ...item, serverId: server.id }))
  }

  private async requestFileTree(
    serverId: string,
    path: string,
    depth: number,
    requestId?: string,
  ): Promise<RemoteFileTreeResult> {
    try {
      const response = (await this.requestRouter.request(
        serverId,
        {
          ...createCclinkEnvelope('file_tree_request'),
          ...(requestId ? { request_id: requestId, trace_id: requestId } : {}),
          path,
          depth: Math.min(Math.max(depth, 0), 3),
          file_scope: 'server',
          cursor: 0,
          limit: 500,
        } as import('../../shared/cclink').CclinkProtocolMessage,
        ['file_tree_response'],
      )) as CclinkFileTreeResponseMessage
      if (response.error)
        return failure('file-provider', REMOTE_ERROR_CODE.FILE_FAILED, response.error, true)
      const tree = response.tree ?? treeFromPage(response)
      return tree
        ? {
            success: true,
            tree,
            ...(response.workspace_id?.trim() ? { workspaceId: response.workspace_id.trim() } : {}),
          }
        : failure('file-provider', REMOTE_ERROR_CODE.FILE_FAILED, '远程 Agent 未返回目录数据', true)
    } catch (error) {
      return requestFailure(error)
    }
  }

  private validateWorkspace(ref: RemoteWorkspaceRef, path: string): RemoteFileTreeResult | null {
    if (ref.transport !== 'cclink')
      return failure('workspace', 'REMOTE_TRANSPORT_INVALID', '不支持的远程 transport', false)
    const server = this.servers.get(ref.endpointId)
    if (!server || server.status !== 'online' || this.status.state !== 'online')
      return failure('remote-agent', 'REMOTE_SERVER_OFFLINE', '远程设备不在线', true)
    const registeredWorkspace = server.workspaces.some(
      (workspace) => workspace.id === ref.workspaceId && workspace.path === ref.path,
    )
    if (!registeredWorkspace)
      return failure(
        'workspace',
        REMOTE_ERROR_CODE.WORKSPACE_NOT_FOUND,
        '远程工作空间尚未由当前设备列表或打开流程确认',
        false,
      )
    if (!isWithin(ref.path, path))
      return failure(
        'workspace',
        'REMOTE_PATH_OUTSIDE_WORKSPACE',
        '远程路径超出当前工作空间',
        false,
      )
    return null
  }

  private updateStatus(status: CclinkRealtimeStatus): void {
    this.status = status
    console.log(
      `[CCLink Studio] CCLink realtime state=${status.state}${status.error ? ' error=present' : ''}`,
    )
    for (const listener of this.statusListeners) listener({ ...status })
  }
}

function thrownMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

function treeFromPage(response: CclinkFileTreeResponseMessage): CclinkTreeNode | null {
  if (!response.path || !Array.isArray(response.items)) return null
  const pathApi = remotePathApi(response.path)
  return {
    id: response.path,
    name: pathApi.basename(response.path) || response.path,
    type: 'directory',
    path: response.path,
    modifiedByAgent: false,
    children: response.items.map((item) => {
      const path = pathApi.join(response.path!, item.name)
      return {
        id: path,
        name: item.name,
        type: item.type,
        path,
        modifiedByAgent: false,
        children: item.type === 'directory' && item.has_children === false ? [] : undefined,
      }
    }),
  }
}

function requestFailure(error: unknown): RemoteFileTreeResult & RemoteFileReadResult {
  if (error instanceof CclinkRequestError)
    return {
      success: false,
      unavailable: true,
      error: error.message,
      remoteError: error.remoteError,
    }
  return failure(
    'transport',
    REMOTE_ERROR_CODE.TRANSPORT_UNAVAILABLE,
    error instanceof Error ? error.message : '远程请求失败',
    true,
  )
}

function capabilityProbeError(error: unknown, endpointId: string): RemoteError {
  const source =
    error instanceof CclinkRequestError
      ? error.remoteError
      : remoteError(
          'remote-agent',
          'REMOTE_CAPABILITY_PROBE_FAILED',
          error instanceof Error ? error.message : '远程 Agent 能力探测失败',
          true,
        )
  return {
    ...source,
    context: { ...source.context, endpointId, operation: 'capability.probe' },
  }
}

function incompleteCapabilityProbeError(
  response: CclinkCapabilityProbeResponseMessage,
  endpointId: string,
): RemoteError {
  return remoteError(
    'remote-agent',
    REMOTE_ERROR_CODE.CAPABILITY_PROBE_INCOMPLETE,
    '能力探测响应不完整，Studio 已保留上一次有效能力状态并将自动重试',
    true,
    {
      endpointId,
      operation: 'capability.probe',
      capabilityProbeComplete: response.capability_probe_complete === true,
      payloadTruncated: response.payload_truncated === true,
      truncationReason: response.payload_truncation_reason ?? 'unknown',
    },
  )
}

function boundedCapabilityProbeResponse(
  response: CclinkCapabilityProbeResponseMessage,
): CclinkCapabilityProbeResponseMessage {
  const runtimeProbe = response.runtime_probe
  if (!runtimeProbe || typeof runtimeProbe !== 'object') return response
  return {
    ...response,
    runtime_probe: {
      ...(typeof runtimeProbe.version === 'number' ? { version: runtimeProbe.version } : {}),
      ...(typeof runtimeProbe.refresh_state === 'string'
        ? { refresh_state: runtimeProbe.refresh_state }
        : {}),
      ...(runtimeProbe.checked_at === null ||
      typeof runtimeProbe.checked_at === 'string' ||
      typeof runtimeProbe.checked_at === 'number'
        ? { checked_at: runtimeProbe.checked_at }
        : {}),
      ...(typeof runtimeProbe.stale === 'boolean' ? { stale: runtimeProbe.stale } : {}),
      ...(typeof runtimeProbe.count === 'number' ? { count: runtimeProbe.count } : {}),
    },
  }
}

function failure(
  layer: RemoteError['layer'],
  code: string,
  message: string,
  retryable: boolean,
): RemoteFileTreeResult & RemoteFileReadResult {
  return {
    success: false,
    unavailable: layer === 'transport' || layer === 'remote-agent',
    error: message,
    remoteError: remoteError(layer, code, message, retryable),
  }
}
function remoteError(
  layer: RemoteError['layer'],
  code: string,
  message: string,
  retryable: boolean,
  context?: RemoteError['context'],
): RemoteError {
  return { layer, code, message, retryable, ...(context ? { context } : {}) }
}
function remotePathApi(path: string): typeof posix | typeof win32 {
  return /^[A-Za-z]:[\\/]/u.test(path) || (path.includes('\\') && !path.includes('/'))
    ? win32
    : posix
}
function normalizePositiveLine(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}
function isWithin(root: string, path: string): boolean {
  const api = remotePathApi(root)
  const relative = api.relative(api.normalize(root), api.normalize(path))
  return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative))
}
function supports(server: CclinkServer | undefined, capability: string): boolean {
  return Boolean(
    server &&
    (server.capabilities?.[capability] === true || server.capabilityList?.includes(capability)),
  )
}
function collectCapabilitySignals(
  response: CclinkCapabilityProbeResponseMessage | null | undefined,
): Set<string> {
  const signals = new Set<string>()
  if (!response) return signals
  for (const [capability, enabled] of Object.entries(response.capability_map ?? {})) {
    if (enabled === true) signals.add(capability)
  }
  for (const capability of response.capability_list ?? []) {
    if (typeof capability === 'string' && capability.trim()) signals.add(capability.trim())
  }
  for (const capability of response.sender?.capabilities ?? []) {
    if (typeof capability === 'string' && capability.trim()) signals.add(capability.trim())
  }
  for (const [group, capabilities] of Object.entries(response.capabilities ?? {})) {
    for (const [capability, enabled] of Object.entries(capabilities ?? {})) {
      if (enabled !== true) continue
      signals.add(`${group}.${capability}`)
      const legacyCapability = GROUPED_CAPABILITY_ALIASES[`${group}.${capability}`]
      if (legacyCapability) signals.add(legacyCapability)
    }
  }
  return signals
}
const GROUPED_CAPABILITY_ALIASES: Readonly<Record<string, string>> = {
  'file.tree': 'file_tree',
  'file.read': 'file_read',
  'file.write': 'file_write',
  'file.create': 'file_create',
  'file.rename': 'file_rename',
  'file.delete': 'file_delete',
  'shell.terminal_workspace_pty': 'terminal_workspace_pty',
  'agent.stream_json_input': 'stream_json_input',
  'agent.runtime_select': 'runtime_select',
  'session.streaming': 'session_streaming',
}
function valueAsString(value: string | number | undefined): string | undefined {
  return value == null ? undefined : String(value)
}
type SessionDiagnosticStringField =
  | 'requestId'
  | 'traceId'
  | 'messageId'
  | 'status'
  | 'code'
  | 'tool'
  | 'toolState'
  | 'finalState'
function diagnosticString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const normalized = String(value).trim()
  return normalized ? sanitizeDiagnosticText(normalized, 500) : undefined
}
function diagnosticField(
  key: SessionDiagnosticStringField,
  value: unknown,
): Partial<Pick<RemoteAgentSessionDiagnosticEvent, SessionDiagnosticStringField>> {
  const normalized = diagnosticString(value)
  return normalized
    ? ({ [key]: normalized } as { [K in SessionDiagnosticStringField]?: string })
    : {}
}
function protocolCompatibility(
  remoteVersion: string | undefined,
  remoteMinimum: string | undefined,
): RemoteStatus['compatibility'] {
  const version = Number(remoteVersion)
  const minimum = Number(remoteMinimum)
  if (Number.isFinite(minimum) && minimum > CCLINK_PROTOCOL_VERSION) return 'upgrade-required'
  if (Number.isFinite(version) && version < CCLINK_MIN_PROTOCOL_VERSION) return 'upgrade-required'
  return Number.isFinite(version) ? 'compatible' : 'unknown'
}
function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}
function timestamp(value: unknown): number {
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value
  const time = value ? new Date(String(value)).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000)
}

function normalizeTimestamp(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return nowSeconds()
  return value > 10_000_000_000 ? Math.floor(value / 1_000) : Math.floor(value)
}

function assertSessionBinding(
  response: CclinkSessionResponseMessage,
  ref: RemoteWorkspaceRef,
  sessionId: string,
): void {
  if (response.status === 'error' || response.ok === false) {
    throw new Error(response.message || response.error || 'Agent 创建远程会话失败')
  }
  const mismatches = [
    response.session_id !== sessionId ? `session_id=${JSON.stringify(response.session_id)}` : null,
    response.agent_id !== ref.endpointId ? `agent_id=${JSON.stringify(response.agent_id)}` : null,
    response.workspace_id !== ref.workspaceId
      ? `workspace_id=${JSON.stringify(response.workspace_id)}`
      : null,
    response.workspace_path !== ref.path
      ? `workspace_path=${JSON.stringify(response.workspace_path)}`
      : null,
    response.workspace_restricted !== true
      ? `workspace_restricted=${JSON.stringify(response.workspace_restricted)}`
      : null,
    response.project_mode !== 'remote_workspace'
      ? `project_mode=${JSON.stringify(response.project_mode)}`
      : null,
  ].filter((value): value is string => Boolean(value))
  if (mismatches.length > 0) {
    throw new Error(`Agent 未确认当前远程项目绑定，已中止创建会话：${mismatches.join('；')}`)
  }
}

function relativeRemotePath(root: string, target: string): string {
  const api = remotePathApi(root)
  const relative = api.relative(api.normalize(root), api.normalize(target))
  if (!relative || relative.startsWith('..') || api.isAbsolute(relative)) {
    throw new Error('远程文件路径必须位于当前工作空间内，且不能指向工作空间根目录')
  }
  return relative.split(api.sep).join('/')
}

function mutationFailure(message: string, unavailable = false): RemoteFileMutationResult {
  return {
    success: false,
    unavailable,
    error: message,
    remoteError: {
      layer: 'file-provider',
      code: unavailable ? 'REMOTE_FILE_CAPABILITY_UNAVAILABLE' : 'REMOTE_FILE_MUTATION_FAILED',
      message,
      retryable: unavailable,
    },
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableTransferId(operationId: string): string {
  const bytes = createHash('sha256')
    .update(`chatcc-file-transfer-v1:${operationId}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function mutationFingerprint(input: {
  actualSender: string
  agentId: string
  sessionId: string
  workspaceId: string
  operation: 'write' | 'create_file'
  operationId: string
  operationCreatedAt: number
  operationExpiresAt: number
  path: string
  totalBytes: number
  contentSha256: string
  expectedSha256?: string
}): string {
  const value = {
    authorization: {
      actual_sender: input.actualSender,
      agent_id: input.agentId,
      session_id: input.sessionId,
      workspace_id: input.workspaceId,
    },
    content_sha256: input.contentSha256,
    encoding: 'utf8',
    ...(input.expectedSha256 ? { expected_sha256: input.expectedSha256 } : {}),
    fingerprint_v: 1,
    ...(input.operation === 'create_file' ? { kind: 'file' as const } : {}),
    operation: input.operation,
    operation_created_at: input.operationCreatedAt,
    operation_expires_at: input.operationExpiresAt,
    operation_id: input.operationId,
    overwrite: false,
    path: input.path,
    recursive: false,
    total_bytes: input.totalBytes,
  }
  return createHash('sha256').update(jcsCanonicalize(value), 'utf8').digest('hex')
}

function jcsCanonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS 不允许非有限数字')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(jcsCanonicalize).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${jcsCanonicalize(record[key])}`)
      .join(',')}}`
  }
  throw new Error('JCS 不允许 undefined、function 或 symbol')
}

function indexesFromRanges(
  ranges: Array<[number, number]> | undefined,
  chunkCount: number,
): number[] {
  const source = ranges ?? [[0, chunkCount - 1]]
  const indexes: number[] = []
  for (const [start, end] of source) {
    for (let index = start; index <= end; index += 1) {
      if (index >= 0 && index < chunkCount) indexes.push(index)
    }
  }
  return [...new Set(indexes)]
}

function imageTotalBytes(images: TransientImageAttachment[]): number {
  return images.reduce((sum, image) => sum + image.size, 0)
}

function transferResult(
  response: CclinkFileTransferResponseMessage,
): RemoteFileMutationResult | null {
  if (response.status !== 'ok' || response.state !== 'committed' || !response.result) return null
  return {
    success: true,
    operationId: response.operation_id,
    replayed: response.replayed,
    diskState: response.disk_state,
    path: response.result.path,
    sha256: response.result.sha256,
  }
}

function transferFailure(response: CclinkFileTransferResponseMessage): RemoteFileMutationResult {
  return {
    success: false,
    operationId: response.operation_id,
    replayed: response.replayed,
    diskState: response.disk_state,
    error: response.message || response.code || '远程文件分块修改失败',
    remoteError: {
      layer: 'file-provider',
      code: response.code || 'REMOTE_FILE_MUTATION_FAILED',
      message: response.message || '远程文件分块修改失败',
      retryable: response.retryable === true,
    },
  }
}
