import { createHash, randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type {
  CclinkFileReadResponseMessage,
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
import { createCclinkEnvelope } from '../../shared/cclink'
import type { CclinkRealtimeStatus } from '../../shared/ipc/cclink'
import type { CclinkRealtimeEvent } from '../../shared/ipc/cclink'
import type {
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
} from '../../shared/remote-protocol'
import { REMOTE_ERROR_CODE, type RemoteError } from '../../shared/remote-error'
import type { RemoteWorkspaceRef } from '../../shared/workspace-ref'
import { callCclinkCloud } from './cloud-function-client'
import { CclinkAuthService } from './auth-service'
import { CclinkRequestError, CclinkRequestRouter } from './request-router'
import { TencentChatAdapter } from './tencent-chat-adapter'
import { TimTransport } from './tim-transport'

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

interface StreamBuffer {
  serverId: string
  sessionId: string
  messageId: string
  content: string
}

const INLINE_FILE_BYTES = 2 * 1024
const MAX_FILE_BYTES = 2 * 1024 * 1024
const FILE_CHUNK_BYTES = 4096 as const
const MAX_MUTATION_MESSAGE_BYTES = 11 * 1024
const CHUNK_SEND_CONCURRENCY = 8

export class CclinkRemoteService implements RemoteProvider {
  readonly transport = 'cclink' as const
  private readonly requestRouter = new CclinkRequestRouter()
  private timTransport: TimTransport | null = null
  private status: CclinkRealtimeStatus = { state: 'idle' }
  private readonly statusListeners = new Set<StatusListener>()
  private readonly realtimeListeners = new Set<RealtimeListener>()
  private servers = new Map<string, CclinkServer>()
  private sessions = new Map<string, CclinkRemoteSession>()
  private messages = new Map<string, CclinkRemoteMessage[]>()
  private streams = new Map<string, StreamBuffer>()
  private connecting: Promise<CclinkRealtimeStatus> | null = null

  constructor(
    readonly auth: CclinkAuthService,
    private readonly baseUrl: string | null,
  ) {
    this.requestRouter.onProtocolEvent((event) => {
      void this.handleProtocolMessage(event.serverId, event.message)
    })
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onRealtimeEvent(listener: RealtimeListener): () => void {
    this.realtimeListeners.add(listener)
    return () => this.realtimeListeners.delete(listener)
  }

  getRealtimeStatus(): CclinkRealtimeStatus {
    return { ...this.status }
  }

  getRequestRouter(): CclinkRequestRouter {
    return this.requestRouter
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

  async browseDirectory(serverId: string, path: string): Promise<RemoteFileTreeResult> {
    const server = this.servers.get(serverId)
    if (!server || server.status !== 'online')
      return failure('remote-agent', 'REMOTE_SERVER_OFFLINE', '远程设备不在线', true)
    return this.requestFileTree(serverId, path, 1)
  }

  async openWorkspace(serverId: string, requestedPath: string): Promise<CclinkWorkspace> {
    const result = await this.browseDirectory(serverId, requestedPath)
    if (!result.success || !result.tree || result.tree.type !== 'directory') {
      throw new Error(result.error || '远程目录无法打开')
    }
    const path = result.tree.path
    const workspace: CclinkWorkspace = {
      id: workspaceId(serverId, path),
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
        ...server.workspaces.filter((item) => item.id !== workspace.id),
      ]
    }
    return workspace
  }

  async listSessions(ref: RemoteWorkspaceRef): Promise<CclinkRemoteSession[]> {
    await this.requireOnline()
    await this.syncSessions(ref.endpointId)
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.serverId === ref.endpointId &&
          (session.workspaceId === ref.workspaceId || session.workspacePath === ref.path),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async createSession(ref: RemoteWorkspaceRef, name?: string): Promise<CclinkRemoteSession> {
    await this.requireOnline()
    const validation = this.validateWorkspace(ref, ref.path)
    if (validation) throw new Error(validation.error || '远程工作空间不可用')
    const sessionId = `sess-${randomUUID()}`
    const requestId = randomUUID()
    const response = (await this.requestRouter.request(
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
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.requireOnline()
      const normalized = content.trim()
      if (!normalized) return { success: true }
      const session = this.sessions.get(sessionId)
      if (
        !session ||
        session.serverId !== ref.endpointId ||
        (session.workspaceId !== ref.workspaceId && session.workspacePath !== ref.path)
      ) {
        return { success: false, error: '远程会话与当前工作空间不匹配' }
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
      }
      await this.requestRouter.send(ref.endpointId, message)
      const userMessage: CclinkRemoteMessage = {
        type: 'user',
        id: `remote-user-${requestId}`,
        content: normalized,
        timestamp: nowSeconds(),
      }
      this.appendMessage(sessionId, userMessage)
      this.setSessionStatus(sessionId, 'active')
      this.emitRealtime({
        type: 'conversation',
        serverId: ref.endpointId,
        sessionId,
        phase: 'started',
        message: userMessage,
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '远程消息发送失败' }
    }
  }

  async getStatus(ref: RemoteWorkspaceRef): Promise<RemoteStatus> {
    const server = this.servers.get(ref.endpointId)
    const protocolVersion = server?.protocolVersion
    const compatibility = protocolVersion
      ? Number(protocolVersion) >= 2
        ? 'compatible'
        : 'upgrade-required'
      : 'unknown'
    const online = server?.status === 'online' && this.status.state === 'online'
    return {
      ref,
      state: online ? 'online' : (server?.status ?? 'unknown'),
      endpointName: server?.name,
      agentVersion: server?.agentVersion,
      protocolVersion,
      compatibility,
      workspacePath: ref.path,
      capabilities: {
        file: {
          tree: online && supports(server, 'file_tree'),
          read: online && supports(server, 'file_read'),
          write: online && supports(server, 'file_write'),
          create: online && supports(server, 'file_create'),
          rename: online && supports(server, 'file_rename'),
          delete: online && supports(server, 'file_delete'),
        },
        shell: { pty: online && supports(server, 'terminal_workspace_pty') },
        agent: { session: online, stream: online },
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
        : {}),
    }
  }

  async listFileTree(request: RemoteFileTreeRequest): Promise<RemoteFileTreeResult> {
    const validation = this.validateWorkspace(request.ref, request.path ?? request.ref.path)
    if (validation) return validation
    return this.requestFileTree(
      request.ref.endpointId,
      request.path ?? request.ref.path,
      request.depth ?? 1,
    )
  }

  async readFile(request: RemoteFileReadRequest): Promise<RemoteFileReadResult> {
    const validation = this.validateWorkspace(request.ref, request.path)
    if (validation) return validation
    try {
      const message = {
        ...createCclinkEnvelope('file_read_request'),
        path: request.path,
        start_line: request.startLine,
        end_line: request.endLine,
        file_scope: 'server',
      }
      const response = (await this.requestRouter.request(request.ref.endpointId, message, [
        'file_read_response',
      ])) as CclinkFileReadResponseMessage
      if (response.error)
        return failure('file-provider', REMOTE_ERROR_CODE.FILE_FAILED, response.error, true)
      if (Buffer.byteLength(response.content ?? '', 'utf8') > 4 * 1024 * 1024) {
        return failure(
          'file-provider',
          'REMOTE_FILE_TOO_LARGE',
          '远程文件超过 4 MiB 读取上限',
          false,
        )
      }
      return {
        success: true,
        file: {
          path: response.path,
          content: response.content,
          totalLines: response.total_lines,
          complete: response.has_more !== true,
          ...(response.content_sha256 ? { sha256: response.content_sha256 } : {}),
        },
      }
    } catch (error) {
      return requestFailure(error)
    }
  }

  async writeFile(request: RemoteFileWriteRequest): Promise<RemoteFileMutationResult> {
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
      (session.workspaceId !== request.ref.workspaceId &&
        session.workspacePath !== request.ref.path)
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
        return mutationFailure(response.message || response.code || '远程文件修改失败')
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
      return mutationFailure(error instanceof Error ? error.message : '远程文件修改失败')
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
    await this.disconnect()
    this.servers.clear()
    this.statusListeners.clear()
    this.realtimeListeners.clear()
    this.sessions.clear()
    this.messages.clear()
    this.streams.clear()
  }

  async disconnect(): Promise<void> {
    this.requestRouter.detach()
    if (this.timTransport) {
      await this.timTransport.logout().catch(() => undefined)
      this.timTransport.destroy()
      this.timTransport = null
    }
    this.updateStatus({ state: 'offline' })
  }

  private async connectInternal(): Promise<CclinkRealtimeStatus> {
    this.updateStatus({ state: 'connecting' })
    try {
      const identity = await this.auth.ensureIdentity()
      const transport = new TimTransport(new TencentChatAdapter())
      await transport.login(identity)
      this.timTransport = transport
      this.requestRouter.attach(transport)
      this.updateStatus({ state: 'online' })
    } catch (error) {
      this.requestRouter.detach()
      this.timTransport?.destroy()
      this.timTransport = null
      this.updateStatus({
        state: 'error',
        error: error instanceof Error ? error.message : 'CCLink 连接失败',
      })
    }
    return this.getRealtimeStatus()
  }

  private async requireOnline(): Promise<void> {
    const status = await this.connect()
    if (status.state !== 'online') throw new Error(status.error || 'CCLink 实时链路连接失败')
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
            name: update.name?.trim() || current.name,
            updatedAt: nowSeconds(),
          })
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
        if (finalText) {
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
        }
        const remoteMessage: CclinkRemoteMessage = {
          type: 'agentTool',
          id: `remote-tool-${event.tool_use_id || event.msg_id}`,
          timestamp: nowSeconds(),
          tool: {
            id: event.tool_use_id,
            name: event.tool,
            state: event.state,
            input: event.input,
            output: event.output,
            error: event.error,
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

  private applySessionSync(serverId: string, response: CclinkSessionSyncResponseMessage): void {
    const incoming = new Set<string>()
    for (const item of response.sessions) {
      if (item.project_mode && item.project_mode !== 'remote_workspace') continue
      const createdAt = normalizeTimestamp(item.created_at ?? item.updated_at)
      const updatedAt = normalizeTimestamp(item.last_active_at ?? item.updated_at ?? createdAt)
      const session: CclinkRemoteSession = {
        id: item.session_id,
        name: item.name?.trim() || `远程会话 ${item.session_id.slice(-6)}`,
        workspaceId: item.workspace_id || workspaceId(serverId, item.workspace_path),
        workspacePath: item.workspace_path,
        serverId,
        status: this.sessions.get(item.session_id)?.status ?? 'idle',
        createdAt,
        updatedAt,
        messageCount: item.message_count ?? this.messages.get(item.session_id)?.length ?? 0,
        contextUsage: item.context_usage ?? 0,
      }
      incoming.add(session.id)
      this.sessions.set(session.id, session)
    }
    for (const session of this.sessions.values()) {
      if (session.serverId === serverId && !incoming.has(session.id))
        this.sessions.delete(session.id)
    }
    this.emitRealtime({ type: 'sessions', serverId })
  }

  private appendMessage(sessionId: string, message: CclinkRemoteMessage): void {
    const current = this.messages.get(sessionId) ?? []
    const next = [...current.filter((item) => item.id !== message.id), message].slice(-2_000)
    this.messages.set(sessionId, next)
    const session = this.sessions.get(sessionId)
    if (session) {
      this.sessions.set(sessionId, {
        ...session,
        updatedAt: message.timestamp,
        messageCount: next.length,
      })
    }
  }

  private setSessionStatus(sessionId: string, status: CclinkRemoteSession['status']): void {
    const session = this.sessions.get(sessionId)
    if (session) this.sessions.set(sessionId, { ...session, status, updatedAt: nowSeconds() })
  }

  private emitRealtime(event: CclinkRealtimeEvent): void {
    for (const listener of this.realtimeListeners) listener(event)
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
          server.workspaces = (response.workspaces ?? response.suggestedWorkspaces ?? []).map(
            (workspace) => ({
              id: workspaceId(server.id, workspace.path),
              path: workspace.path,
              name:
                workspace.name ||
                remotePathApi(workspace.path).basename(workspace.path) ||
                workspace.path,
              serverId: server.id,
              kind: 'kind' in workspace ? workspace.kind : undefined,
              exists: true,
            }),
          )
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
      .filter((item) => item.exists !== false)
      .map((item) => ({ ...item, serverId: server.id }))
  }

  private async requestFileTree(
    serverId: string,
    path: string,
    depth: number,
  ): Promise<RemoteFileTreeResult> {
    try {
      const response = (await this.requestRouter.request(
        serverId,
        {
          ...createCclinkEnvelope('file_tree_request'),
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
        ? { success: true, tree }
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
    if (workspaceId(ref.endpointId, ref.path) !== ref.workspaceId)
      return failure(
        'workspace',
        REMOTE_ERROR_CODE.WORKSPACE_NOT_FOUND,
        '远程工作空间引用无效',
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
): RemoteError {
  return { layer, code, message, retryable }
}
function workspaceId(serverId: string, path: string): string {
  return createHash('sha256').update(`${serverId}\0${path}`).digest('hex').slice(0, 24)
}
function remotePathApi(path: string): typeof posix | typeof win32 {
  return /^[A-Za-z]:[\\/]/u.test(path) || (path.includes('\\') && !path.includes('/'))
    ? win32
    : posix
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
