import { describe, expect, it, vi } from 'vitest'
import {
  createCclinkEnvelope,
  type CclinkProtocolMessage,
  type CclinkServer,
} from '../../shared/cclink'
import type { RemoteStatus } from '../../shared/remote-protocol'
import { CclinkRemoteService } from './cclink-remote-service'
import {
  CclinkRequestError,
  type CclinkTransport,
  type CclinkTransportEvent,
} from './request-router'

class ReceivingTransport implements CclinkTransport {
  readonly sent: Array<{ serverId: string; message: CclinkProtocolMessage }> = []
  private readonly listeners = new Set<(event: CclinkTransportEvent) => void>()

  async sendMessage(serverId: string, message: CclinkProtocolMessage): Promise<void> {
    this.sent.push({ serverId, message })
  }

  onMessage(listener: (event: CclinkTransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  receive(serverId: string, message: CclinkProtocolMessage): void {
    for (const listener of this.listeners) listener({ serverId, message })
  }
}

const storedSession = {
  id: 'session-1',
  name: '保留的会话',
  workspaceId: 'workspace-1',
  workspacePath: '/srv/project',
  serverId: 'agent-1',
  status: 'idle' as const,
  createdAt: 1,
  updatedAt: 1,
  messageCount: 0,
  contextUsage: 0,
}

function createService() {
  const store = {
    load: vi.fn(async () => ({ version: 1 as const, sessions: [storedSession], messages: {} })),
    save: vi.fn(async () => undefined),
  }
  const service = new CclinkRemoteService({} as never, null, store as never)
  const handle = (message: CclinkProtocolMessage) =>
    (
      service as unknown as {
        handleProtocolMessage(serverId: string, message: CclinkProtocolMessage): Promise<void>
      }
    ).handleProtocolMessage('agent-1', message)
  return { service, store, handle }
}

describe('CclinkRemoteService runtime protocol', () => {
  it('uses the Agent-owned opaque workspace_id when opening and validating a workspace', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('file_tree_response'),
      workspace_id: 'ws_agent_canonical',
      path: '/srv/project',
      items: [],
    })

    await expect(service.openWorkspace('agent-1', '/srv/project')).resolves.toEqual({
      id: 'ws_agent_canonical',
      path: '/srv/project',
      name: 'project',
      serverId: 'agent-1',
      kind: 'directory',
      exists: true,
    })

    const validation = (
      service as unknown as {
        validateWorkspace(ref: typeof remoteRef, path: string): unknown
      }
    ).validateWorkspace(
      { ...remoteRef, workspaceId: 'ws_agent_canonical' },
      '/srv/project/README.md',
    )
    expect(validation).toBeNull()

    const wrongIdentity = (
      service as unknown as {
        validateWorkspace(ref: typeof remoteRef, path: string): unknown
      }
    ).validateWorkspace(
      { ...remoteRef, workspaceId: 'studio_local_hash' },
      '/srv/project/README.md',
    )
    expect(wrongIdentity).toMatchObject({
      success: false,
      remoteError: { code: 'REMOTE_WORKSPACE_NOT_FOUND' },
    })
  })

  it('fails closed when file_tree_response omits the canonical workspace_id', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('file_tree_response'),
      path: '/srv/project',
      items: [],
    })

    await expect(service.openWorkspace('agent-1', '/srv/project')).rejects.toThrow(
      '远程 Agent 未返回规范 workspace_id',
    )
  })

  it('maps the latest Agent capability response and preserves probe diagnostics', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      agentVersion: '0.8.41',
      protocolVersion: 2,
      runtime: 'claude_code',
      runtime_probe: {
        version: 1,
        refresh_state: 'refreshing',
        checked_at: 123,
        stale: false,
        count: 2,
        env_source: 'legacy-capability-payload',
        env_file: '/private/runtime.env',
      } as never,
      capabilities: {
        file: { write: true },
        agent: { runtime_select: true, stream_json_input: true },
        session: { streaming: false },
      },
      capability_map: { runtime_select: true, stream_json_input: true },
      capability_list: ['runtime_select', 'stream_json_input'],
    })

    const status = await service.getStatus(remoteRef)
    expect(status).toMatchObject({
      state: 'online',
      agentVersion: '0.8.41',
      protocolVersion: '2',
      runtime: 'claude_code',
      capabilityProbe: {
        state: 'refreshing',
        checkedAt: '123',
        stale: false,
        response: expect.objectContaining({
          cc_type: 'capability_probe_response',
          agentVersion: '0.8.41',
          capability_list: ['runtime_select', 'stream_json_input'],
        }),
      },
      capabilities: {
        file: { write: true },
        agent: { session: true, stream: true },
      },
    })
    expect(status.remoteError).toBeUndefined()
    expect(status.capabilityProbe?.response.runtime_probe).toEqual({
      version: 1,
      refresh_state: 'refreshing',
      checked_at: 123,
      stale: false,
      count: 2,
    })
    expect(
      (
        service as unknown as {
          servers: Map<string, CclinkServer>
        }
      ).servers.get('agent-1')?.capabilities?.file_write,
    ).toBe(true)
  })

  it('preserves the capability probe transport failure instead of reporting missing capability', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockRejectedValue(
      new CclinkRequestError('发送能力探测失败', {
        layer: 'transport',
        code: 'REMOTE_TRANSPORT_SEND_FAILED',
        message: '发送能力探测失败',
        retryable: true,
      }),
    )

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      state: 'online',
      remoteError: {
        layer: 'transport',
        code: 'REMOTE_TRANSPORT_SEND_FAILED',
        message: '发送能力探测失败',
        retryable: true,
        context: { endpointId: 'agent-1', operation: 'capability.probe' },
      },
    })
  })

  it('accepts a namespaced capability_map streaming signal', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      agent_version: '0.8.41',
      capability_map: { 'agent.stream_json_input': true },
      capability_list: [],
    })

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      capabilities: { agent: { session: true, stream: true } },
    })
  })

  it('uses capability signals and version metadata retained in the sender envelope', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      sender: {
        kind: 'agent',
        version: '0.8.41',
        protocol_version: 2,
        min_protocol_version: 2,
        capabilities: ['file_tree', 'file_read', 'stream_json_input', 'runtime_select'],
      },
      payload_truncated: true,
    })

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      state: 'online',
      agentVersion: '0.8.41',
      protocolVersion: '2',
      compatibility: 'compatible',
      capabilities: {
        file: { tree: true, read: true },
        agent: { session: true, stream: true },
      },
      capabilityProbe: {
        response: expect.objectContaining({
          sender: expect.objectContaining({
            version: '0.8.41',
            capabilities: expect.arrayContaining(['file_tree', 'stream_json_input']),
          }),
        }),
      },
    })
    expect((await service.getStatus(remoteRef)).remoteError).toBeUndefined()
  })

  it('opens the remote file tree when file_tree survives only in sender capabilities', async () => {
    const { service } = createService()
    installOnlineServer(service, [
      {
        id: remoteRef.workspaceId,
        path: remoteRef.path,
        name: 'project',
        serverId: remoteRef.endpointId,
        kind: 'directory',
        exists: true,
      },
    ])
    vi.spyOn(service.getRequestRouter(), 'request')
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('capability_probe_response'),
        sender: {
          kind: 'agent',
          version: '0.8.41',
          capabilities: ['file_tree', 'stream_json_input'],
        },
        payload_truncated: true,
      })
      .mockResolvedValueOnce({
        ...createCclinkEnvelope('file_tree_response'),
        workspace_id: remoteRef.workspaceId,
        path: remoteRef.path,
        items: [{ name: 'README.md', type: 'file' }],
      })

    await expect(
      service.listFileTree({ ref: remoteRef, path: remoteRef.path, depth: 1 }),
    ).resolves.toMatchObject({
      success: true,
      workspaceId: remoteRef.workspaceId,
      tree: {
        path: remoteRef.path,
        children: [expect.objectContaining({ name: 'README.md', type: 'file' })],
      },
    })
  })

  it('only reports missing Agent capability after a clean probe response has no supported signal', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      agent_version: '0.8.41',
      runtime: 'claude_code',
      runtime_probe: { refresh_state: 'ready', checked_at: 456, stale: false },
      capabilities: { agent: {}, session: { streaming: false } },
      capability_map: {},
      capability_list: [],
    })

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      state: 'online',
      remoteError: {
        layer: 'remote-agent',
        code: 'REMOTE_CAPABILITY_UNAVAILABLE',
        retryable: false,
      },
    })
  })

  it('does not turn a truncated probe with no capability evidence into an unsupported verdict', async () => {
    const { service } = createService()
    installOnlineServer(service)
    vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('capability_probe_response'),
      payload_truncated: true,
      payload_truncation_reason: 'emergency_minimal',
    })

    await expect(service.getStatus(remoteRef)).resolves.toMatchObject({
      state: 'online',
      remoteError: {
        layer: 'remote-agent',
        code: 'REMOTE_CAPABILITY_PROBE_INCOMPLETE',
        retryable: true,
        context: {
          payloadTruncated: true,
          truncationReason: 'emergency_minimal',
        },
      },
    })
  })

  it('correlates a capability response at the real transport receiver', async () => {
    const { service } = createService()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)

    const pending = service.getStatus(remoteRef)
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const requestId = transport.sent[0]?.message.request_id

    transport.receive('agent-1', {
      ...createCclinkEnvelope('capability_probe_response'),
      request_id: 'unrelated-request',
      capability_probe_complete: true,
      capability_map: { file_read: false },
    })
    transport.receive('agent-1', {
      ...createCclinkEnvelope('capability_probe_response'),
      request_id: requestId,
      capability_probe_complete: true,
      capability_map: { file_read: true, stream_json_input: true },
    })

    await expect(pending).resolves.toMatchObject({
      capabilities: {
        file: { read: true },
        agent: { session: true, stream: true },
      },
      capabilityProbe: {
        response: { request_id: requestId },
      },
    })
    service.getRequestRouter().detach()
  })

  it('preserves a correlated Agent failure response at the real transport receiver', async () => {
    const { service } = createService()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)

    const pending = service.getStatus(remoteRef)
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const requestId = transport.sent[0]?.message.request_id
    transport.receive('agent-1', {
      ...createCclinkEnvelope('error'),
      request_id: requestId,
      code: 'RUNTIME_PROBE_FAILED',
      message: 'runtime probe failed',
      retryable: false,
    })

    await expect(pending).resolves.toMatchObject({
      remoteError: {
        layer: 'remote-agent',
        code: 'RUNTIME_PROBE_FAILED',
        message: 'runtime probe failed',
        retryable: false,
        context: { endpointId: 'agent-1', operation: 'capability.probe' },
      },
    })
    service.getRequestRouter().detach()
  })

  it('does not overwrite PTY, file, or Markdown capability caches with an incomplete response', async () => {
    const { service } = createService()
    installOnlineServer(service)
    const transport = new ReceivingTransport()
    service.getRequestRouter().attach(transport)

    const initial = service.getStatus(remoteRef)
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const initialRequestId = transport.sent[0]?.message.request_id
    transport.receive('agent-1', {
      ...createCclinkEnvelope('capability_probe_response'),
      request_id: initialRequestId,
      capability_probe_complete: true,
      capability_map: {
        file_read: true,
        file_write: true,
        file_markdown_open_v3: true,
        file_markdown_save_v3: true,
        terminal_workspace_pty: true,
        stream_json_input: true,
      },
      capability_list: [
        'file_read',
        'file_write',
        'file_markdown_open_v3',
        'file_markdown_save_v3',
        'terminal_workspace_pty',
        'stream_json_input',
      ],
    })
    await expect(initial).resolves.toMatchObject({
      capabilities: {
        file: { read: true, write: true },
        shell: { pty: true },
      },
    })

    const internals = service as unknown as {
      capabilityProbes: Map<string, { response: CclinkProtocolMessage | null; expiresAt: number }>
      servers: Map<string, CclinkServer>
    }
    const validCache = internals.capabilityProbes.get('agent-1')
    expect(validCache?.response?.request_id).toBe(initialRequestId)
    if (validCache) validCache.expiresAt = 0

    const refresh = service.getStatus(remoteRef)
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
    const refreshRequestId = transport.sent[1]?.message.request_id
    transport.receive('agent-1', {
      ...createCclinkEnvelope('capability_probe_response'),
      request_id: refreshRequestId,
      capability_probe_complete: false,
      status: 'error',
      code: 'CAPABILITY_PROBE_INCOMPLETE',
    })

    await expect(refresh).resolves.toMatchObject({
      capabilities: {
        file: { read: true, write: true },
        shell: { pty: true },
        agent: { session: true, stream: true },
      },
      capabilityProbe: { response: { request_id: initialRequestId } },
      remoteError: {
        code: 'REMOTE_CAPABILITY_PROBE_INCOMPLETE',
        retryable: true,
        context: { capabilityProbeComplete: false },
      },
    })
    expect(internals.capabilityProbes.get('agent-1')).toBe(validCache)
    expect(internals.capabilityProbes.get('agent-1')?.response?.request_id).toBe(initialRequestId)
    expect(internals.servers.get('agent-1')?.capabilities).toMatchObject({
      file_read: true,
      file_write: true,
      file_markdown_open_v3: true,
      file_markdown_save_v3: true,
      terminal_workspace_pty: true,
    })
    service.getRequestRouter().detach()
  })

  it('保留 Agent 审批字段并把主动问题送到会话 UI', async () => {
    const { service, handle } = createService()
    await service.initialize()

    await handle({
      ...createCclinkEnvelope('agent_tool', { request_id: 'request-1' }),
      session_id: 'session-1',
      msg_id: 'message-1',
      tool: 'Bash',
      tool_use_id: 'tool-1',
      state: 'pending',
      requires_approval: true,
      approval_reason: '将修改项目文件',
    })
    await handle({
      ...createCclinkEnvelope('user_question', { request_id: 'request-2' }),
      session_id: 'session-1',
      msg_id: 'message-2',
      tool_use_id: 'tool-2',
      questions: [{ id: 'choice', question: '选择部署环境', options: [{ label: '测试' }] }],
    })

    expect(service.listMessages('session-1')).toEqual([
      expect.objectContaining({
        type: 'agentTool',
        tool: expect.objectContaining({
          id: 'tool-1',
          requiresApproval: true,
          requestId: 'request-1',
        }),
      }),
      expect.objectContaining({
        type: 'userQuestion',
        requestId: 'request-2',
        toolUseId: 'tool-2',
      }),
    ])
  })

  it('为远程会话保留有界协议终态诊断并合并到诊断报告', async () => {
    const { service, handle } = createService()
    await service.initialize()
    vi.spyOn(service, 'getStatus').mockResolvedValue(onlineStatus)

    await handle({
      ...createCclinkEnvelope('stream_start', {
        request_id: 'request-1',
        trace_id: 'trace-1',
      }),
      session_id: 'session-1',
      msg_id: 'message-1',
    })
    await handle({
      ...createCclinkEnvelope('stream_chunk'),
      session_id: 'session-1',
      msg_id: 'message-1',
      delta: '第一段',
    })
    await handle({
      ...createCclinkEnvelope('stream_chunk'),
      session_id: 'session-1',
      msg_id: 'message-1',
      delta: '第二段',
    })
    await handle({
      ...createCclinkEnvelope('stream_end', { request_id: 'request-1', trace_id: 'trace-1' }),
      session_id: 'session-1',
      msg_id: 'message-1',
      exit_code: 0,
      final_state: 'missing_final_diagnostic',
    })

    await expect(service.diagnose(remoteRef, 'session-1')).resolves.toMatchObject({
      agentSession: {
        session: { id: 'session-1', status: 'idle' },
        messageLimit: 100,
        eventLimit: 100,
        processLocalOnly: true,
        events: [
          expect.objectContaining({
            direction: 'inbound',
            type: 'stream_start',
            requestId: 'request-1',
            traceId: 'trace-1',
          }),
          expect.objectContaining({ type: 'stream_chunk', count: 2 }),
          expect.objectContaining({
            type: 'stream_end',
            exitCode: 0,
            finalState: 'missing_final_diagnostic',
          }),
        ],
      },
    })
  })

  it('只在 Agent ACK 后提交审批状态，并保留被拒绝的待审批操作', async () => {
    const { service, handle } = createService()
    await service.initialize()
    await handle({
      ...createCclinkEnvelope('agent_tool', { request_id: 'approval-request' }),
      session_id: 'session-1',
      msg_id: 'message-approval',
      tool: 'Bash',
      tool_use_id: 'tool-approval',
      state: 'pending',
      requires_approval: true,
    })
    vi.spyOn(service, 'connect').mockResolvedValue({ state: 'online' })
    vi.spyOn(service, 'getStatus').mockResolvedValue(onlineStatus)
    const request = vi.spyOn(service.getRequestRouter(), 'request')
    request.mockRejectedValueOnce(new Error('CONTROL_NOT_PENDING'))

    await expect(
      service.resolveToolApproval({
        ref: remoteRef,
        sessionId: 'session-1',
        requestId: 'approval-request',
        toolUseId: 'tool-approval',
        approved: true,
      }),
    ).resolves.toMatchObject({ success: false })
    expect(service.listMessages('session-1')[0]).toMatchObject({
      type: 'agentTool',
      tool: { state: 'pending', requiresApproval: true },
    })

    request.mockResolvedValueOnce({
      ...createCclinkEnvelope('tool_approval_ack'),
      request_id: 'approval-request',
      session_id: 'session-1',
      tool_use_id: 'tool-approval',
      approved: true,
      status: 'accepted',
    })
    await expect(
      service.resolveToolApproval({
        ref: remoteRef,
        sessionId: 'session-1',
        requestId: 'approval-request',
        toolUseId: 'tool-approval',
        approved: true,
      }),
    ).resolves.toEqual({ success: true })
    expect(service.listMessages('session-1')[0]).toMatchObject({
      type: 'agentTool',
      tool: { state: 'executing', requiresApproval: false },
    })
  })

  it('按问题文本发送多选答案且只在 ACK 后标记已回答', async () => {
    const { service, handle } = createService()
    await service.initialize()
    await handle({
      ...createCclinkEnvelope('user_question', { request_id: 'question-request' }),
      session_id: 'session-1',
      msg_id: 'message-question',
      tool_use_id: 'tool-question',
      questions: [
        {
          id: 'features',
          question: '启用哪些功能？',
          multiSelect: true,
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    })
    vi.spyOn(service, 'connect').mockResolvedValue({ state: 'online' })
    vi.spyOn(service, 'getStatus').mockResolvedValue(onlineStatus)
    const request = vi.spyOn(service.getRequestRouter(), 'request').mockResolvedValue({
      ...createCclinkEnvelope('question_answer_ack'),
      request_id: 'question-request',
      session_id: 'session-1',
      tool_use_id: 'tool-question',
      status: 'accepted',
    })

    await expect(
      service.answerQuestion({
        ref: remoteRef,
        sessionId: 'session-1',
        requestId: 'question-request',
        toolUseId: 'tool-question',
        answers: { features: 'A, B' },
      }),
    ).resolves.toEqual({ success: true })
    expect(request).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ answers: { '启用哪些功能？': 'A, B' } }),
      ['question_answer_ack'],
      15_000,
    )
    expect(service.listMessages('session-1')[0]).toMatchObject({
      type: 'userQuestion',
      answered: true,
      questions: [expect.objectContaining({ multiSelect: true })],
    })
  })

  it('远端同步快照缺项时不删除本地导入历史', async () => {
    const { service, handle, store } = createService()
    await service.initialize()
    await handle({
      ...createCclinkEnvelope('session_sync_response'),
      sessions: [],
    })

    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ sessions: [expect.objectContaining({ id: 'session-1' })] }),
    )
  })
})

function installOnlineServer(
  service: CclinkRemoteService,
  workspaces: CclinkServer['workspaces'] = [],
): void {
  const internals = service as unknown as {
    status: { state: 'online' }
    servers: Map<string, CclinkServer>
  }
  internals.status = { state: 'online' }
  internals.servers.set('agent-1', {
    id: 'agent-1',
    name: 'Agent 1',
    hostname: 'agent-1',
    os: 'Linux',
    status: 'online',
    agentVersion: '0.8.41',
    lastSeen: Date.now(),
    workspaces,
  })
}

const remoteRef = {
  kind: 'remote' as const,
  transport: 'cclink' as const,
  endpointId: 'agent-1',
  workspaceId: 'workspace-1',
  path: '/srv/project',
}

const onlineStatus: RemoteStatus = {
  ref: remoteRef,
  state: 'online',
  compatibility: 'compatible',
  workspacePath: '/srv/project',
  capabilities: {
    file: { tree: true, read: true, write: true, create: true, rename: true, delete: true },
    agent: { session: true, stream: true },
    shell: { pty: true },
  },
}
