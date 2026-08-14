import { describe, expect, it, vi } from 'vitest'
import {
  createCclinkEnvelope,
  type CclinkProtocolMessage,
  type CclinkServer,
} from '../../shared/cclink'
import type { RemoteStatus } from '../../shared/remote-protocol'
import { CclinkRemoteService } from './cclink-remote-service'
import { CclinkRequestError } from './request-router'

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
      runtime_probe: { refresh_state: 'refreshing', checked_at: 123, stale: false },
      capabilities: {
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
      capabilities: { agent: { session: true, stream: true } },
    })
    expect(status.remoteError).toBeUndefined()
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
