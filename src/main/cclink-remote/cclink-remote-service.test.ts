import { describe, expect, it, vi } from 'vitest'
import { createCclinkEnvelope, type CclinkProtocolMessage } from '../../shared/cclink'
import type { RemoteStatus } from '../../shared/remote-protocol'
import { CclinkRemoteService } from './cclink-remote-service'

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
