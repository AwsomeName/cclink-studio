import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type {
  CclinkFileReadResponseMessage,
  CclinkFileTreeResponseMessage,
  CclinkServer,
  CclinkServerMetaMessage,
  CclinkTreeNode,
  CclinkWorkspace,
  CclinkWorkspaceListResponseMessage,
} from '../../shared/cclink'
import { createCclinkEnvelope } from '../../shared/cclink'
import type { CclinkRealtimeStatus } from '../../shared/ipc/cclink'
import type {
  RemoteFileReadRequest,
  RemoteFileReadResult,
  RemoteFileTreeRequest,
  RemoteFileTreeResult,
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

export class CclinkRemoteService implements RemoteProvider {
  readonly transport = 'cclink' as const
  private readonly requestRouter = new CclinkRequestRouter()
  private timTransport: TimTransport | null = null
  private status: CclinkRealtimeStatus = { state: 'idle' }
  private readonly statusListeners = new Set<StatusListener>()
  private servers = new Map<string, CclinkServer>()
  private connecting: Promise<CclinkRealtimeStatus> | null = null

  constructor(
    readonly auth: CclinkAuthService,
    private readonly baseUrl: string | null,
  ) {}

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  getRealtimeStatus(): CclinkRealtimeStatus {
    return { ...this.status }
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
        },
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

  async destroy(): Promise<void> {
    await this.disconnect()
    this.servers.clear()
    this.statusListeners.clear()
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
