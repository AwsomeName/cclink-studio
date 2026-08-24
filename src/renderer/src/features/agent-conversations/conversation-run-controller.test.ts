import { describe, expect, it, vi } from 'vitest'
import type { AgentConversationState } from '../../stores/agent-store'
import { createConversationRunController } from './conversation-run-controller'

const SESSION_COMPATIBILITY_FINGERPRINT = 'a'.repeat(64)

function createConversation(updates: Partial<AgentConversationState> = {}): AgentConversationState {
  return {
    id: 'agent-1',
    title: '测试会话',
    surface: 'assistant-panel',
    runtime: {
      location: 'local',
      transport: 'local',
      backend: 'cclink-studio-agent',
    },
    configuration: {
      schemaVersion: 1,
      roleRef: { roleId: 'default-assistant', version: 1 },
      revision: 1,
      updatedAt: 1,
    },
    configurationEvents: [],
    lastRunConfigurationReceipt: null,
    messages: [],
    input: 'hello',
    loading: false,
    backendState: 'connected',
    runStatus: 'idle',
    activeRunId: null,
    lastRunEventAt: null,
    lastRunTerminalReason: null,
    sessionId: 'session-1',
    sessionCompatibilityFingerprint: SESSION_COMPATIBILITY_FINGERPRINT,
    streamingMessageId: null,
    lastCost: null,
    contextUsage: null,
    contextCompaction: {
      status: 'idle',
      trigger: null,
      preTokens: null,
      postTokens: null,
      error: null,
      updatedAt: null,
    },
    scope: { kind: 'all' },
    mountedResources: [],
    mountedSkills: [],
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...updates,
  }
}

function createHarness(conversation = createConversation()) {
  const store = {
    conversations: { 'agent-1': conversation },
    setInput: vi.fn(),
    addUserMessage: vi.fn(),
    addSystemMessage: vi.fn(),
    beginRun: vi.fn(() => 'run-1'),
    cancelStreaming: vi.fn(),
    markRunCancelling: vi.fn(),
    applyRuntimeRunStatus: vi.fn(),
    setBackendState: vi.fn(),
    clearTransientResources: vi.fn(),
    beginContextCompaction: vi.fn(() => 'compact-1'),
    finishContextCompaction: vi.fn(),
    setRunConfigurationReceipt: vi.fn(() => true),
  }
  const agentApi = {
    sendMessage: vi.fn().mockResolvedValue({
      success: true,
      configurationReceipt: {
        conversationId: 'agent-1',
        runId: 'run-1',
        roleRef: conversation.configuration.roleRef,
        configurationRevision: conversation.configuration.revision,
        configurationFingerprint: SESSION_COMPATIBILITY_FINGERPRINT,
        runtimeSessionMode: 'resumed',
        skills: [],
      },
    }),
    abort: vi.fn().mockResolvedValue({
      accepted: true,
      run: {
        conversationId: 'agent-1',
        runId: 'run-active',
        status: 'cancelling',
        workspaceKey: null,
        startedAt: 1,
        updatedAt: 2,
        completedAt: null,
      },
    }),
    compactConversation: vi.fn().mockResolvedValue({ success: true }),
  }
  const controller = createConversationRunController({
    conversationId: 'agent-1',
    getStore: () => store,
    getTabs: () => [],
    agentApi,
  })
  return { store, agentApi, controller }
}

describe('conversation-run-controller', () => {
  it('未保存的登录草稿被挂载时在启动 Agent 前给出明确保存指引', async () => {
    const conversation = createConversation({
      mountedResources: [
        {
          id: 'browser:draft-tab',
          kind: 'browser',
          label: '百度登录',
          ref: { type: 'browser', tabId: 'draft-tab' },
        },
      ],
    })
    const { store, agentApi } = createHarness(conversation)
    const controller = createConversationRunController({
      conversationId: 'agent-1',
      getStore: () => store,
      getTabs: () => [
        {
          id: 'draft-tab',
          type: 'browser',
          title: '百度登录',
          icon: 'G',
          webResourceDraftRef: { draftId: 'draft-baidu' },
        },
      ],
      agentApi,
    })

    await expect(controller.send('打开百度站长')).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('登录完成，保存账号和登录状态'),
    })
    expect(store.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining('Agent 不能操作'),
      'agent-1',
    )
    expect(store.setInput).not.toHaveBeenCalled()
    expect(store.addUserMessage).not.toHaveBeenCalled()
    expect(store.beginRun).not.toHaveBeenCalled()
    expect(agentApi.sendMessage).not.toHaveBeenCalled()
  })

  it('浏览器 scope 指向未保存登录草稿时同样拒绝启动 Agent', async () => {
    const conversation = createConversation({
      scope: { kind: 'browser', instanceId: 'draft-tab' },
    })
    const { store, agentApi } = createHarness(conversation)
    const controller = createConversationRunController({
      conversationId: 'agent-1',
      getStore: () => store,
      getTabs: () => [
        {
          id: 'draft-tab',
          type: 'browser',
          title: '百度登录',
          icon: 'G',
          webResourceDraftRef: { draftId: 'draft-baidu' },
        },
      ],
      agentApi,
    })

    await expect(controller.send('继续操作')).resolves.toMatchObject({ status: 'failed' })
    expect(agentApi.sendMessage).not.toHaveBeenCalled()
  })

  it('发送消息时原子写入投影、启动 run 并调用后端', async () => {
    const { store, agentApi, controller } = createHarness()

    await expect(controller.send('  你好  ')).resolves.toEqual({
      status: 'accepted',
      runId: 'run-1',
    })
    expect(store.setInput).toHaveBeenCalledWith('', 'agent-1')
    expect(store.addUserMessage).toHaveBeenCalledWith('你好', 'agent-1', [])
    expect(store.beginRun).toHaveBeenCalledWith('agent-1')
    expect(agentApi.sendMessage).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ message: '你好', runId: 'run-1', sessionId: 'session-1' }),
    )
    expect(store.clearTransientResources).toHaveBeenCalledWith('agent-1')
    expect(store.setRunConfigurationReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        roleRef: { roleId: 'default-assistant', version: 1 },
        configurationRevision: 1,
      }),
    )
  })

  it('同一会话连续发送时每一轮都携带并确认同一份角色配置', async () => {
    const { store, agentApi, controller } = createHarness()

    await expect(controller.send('第一轮')).resolves.toMatchObject({ status: 'accepted' })
    await expect(controller.send('第二轮')).resolves.toMatchObject({ status: 'accepted' })

    expect(agentApi.sendMessage).toHaveBeenCalledTimes(2)
    expect(agentApi.sendMessage.mock.calls.map((call) => call[1].configuration)).toEqual([
      createConversation().configuration,
      createConversation().configuration,
    ])
    expect(store.setRunConfigurationReceipt).toHaveBeenCalledTimes(2)
  })

  it('主进程没有返回角色配置回执时停止本轮运行', async () => {
    const { store, agentApi, controller } = createHarness()
    agentApi.sendMessage.mockResolvedValue({ success: true })

    await expect(controller.send('检查角色')).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('实际角色配置'),
    })
    expect(agentApi.abort).toHaveBeenCalledWith('agent-1', 'run-1')
    expect(store.clearTransientResources).not.toHaveBeenCalled()
  })

  it('allows an image-only turn and clears image data only after the backend accepts it', async () => {
    const image = {
      id: 'image-1',
      name: 'screen.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }
    const { store, agentApi, controller } = createHarness(
      createConversation({ input: '', pendingImages: [image] }),
    )

    await expect(controller.send('')).resolves.toEqual({
      status: 'accepted',
      runId: 'run-1',
    })
    expect(store.addUserMessage).toHaveBeenCalledWith('请查看我发送的图片。', 'agent-1', [
      expect.objectContaining({
        kind: 'image',
        label: 'screen.png',
        ref: { type: 'image', mediaType: 'image/png', size: 3 },
      }),
    ])
    expect(agentApi.sendMessage).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        message: '请查看我发送的图片。',
        images: [image],
      }),
    )
    expect(store.clearTransientResources).toHaveBeenCalledWith('agent-1')
  })

  it.each([
    ['空消息', '   ', createConversation(), 'empty'],
    ['归档会话', 'hello', createConversation({ archivedAt: 2 }), 'archived'],
    ['运行中会话', 'hello', createConversation({ loading: true }), 'busy'],
    [
      '压缩中会话',
      'hello',
      createConversation({
        contextCompaction: {
          status: 'compacting',
          trigger: 'manual',
          preTokens: 10,
          postTokens: null,
          error: null,
          updatedAt: 2,
        },
      }),
      'busy',
    ],
  ])('%s 不启动发送事务', async (_label, content, conversation, reason) => {
    const { store, agentApi, controller } = createHarness(conversation)

    await expect(controller.send(content)).resolves.toEqual({ status: 'ignored', reason })
    expect(store.beginRun).not.toHaveBeenCalled()
    expect(agentApi.sendMessage).not.toHaveBeenCalled()
  })

  it('后端拒绝发送命令时按 runId 收敛失败投影', async () => {
    const { store, agentApi, controller } = createHarness()
    agentApi.sendMessage.mockResolvedValue({ success: false, error: 'runtime unavailable' })

    await expect(controller.send('hello')).resolves.toEqual({
      status: 'failed',
      error: 'runtime unavailable',
      runId: 'run-1',
    })
    expect(store.cancelStreaming).toHaveBeenCalledWith('agent-1', 'error', 'run-1')
    expect(store.addSystemMessage).toHaveBeenCalledWith('发送失败: runtime unavailable', 'agent-1')
    expect(store.setBackendState).toHaveBeenCalledWith('error', 'agent-1')
    expect(store.clearTransientResources).not.toHaveBeenCalled()
  })

  it('停止请求只进入 cancelling，且允许对同一 run 再次取消', async () => {
    const { store, agentApi, controller } = createHarness(
      createConversation({ loading: true, activeRunId: 'run-active' }),
    )

    await expect(controller.abort()).resolves.toEqual({
      status: 'accepted',
      runId: 'run-active',
    })
    await expect(controller.abort()).resolves.toEqual({
      status: 'accepted',
      runId: 'run-active',
    })
    expect(agentApi.abort).toHaveBeenCalledTimes(2)
    expect(agentApi.abort).toHaveBeenNthCalledWith(1, 'agent-1', 'run-active')
    expect(store.markRunCancelling).toHaveBeenCalledWith('agent-1', 'run-active')
    expect(store.cancelStreaming).not.toHaveBeenCalled()
    expect(store.addSystemMessage).not.toHaveBeenCalled()
  })

  it('取消失败时保留运行投影并返回错误', async () => {
    const { store, agentApi, controller } = createHarness(
      createConversation({ loading: true, activeRunId: 'run-active' }),
    )
    agentApi.abort.mockRejectedValue(new Error('abort failed'))

    await expect(controller.abort()).resolves.toEqual({
      status: 'failed',
      error: 'abort failed',
      runId: 'run-active',
    })
    expect(store.cancelStreaming).not.toHaveBeenCalled()
    expect(store.addSystemMessage).toHaveBeenCalledWith('中止失败: abort failed', 'agent-1')
  })

  it('压缩命令被拒绝时统一记录失败投影和系统消息', async () => {
    const { store, agentApi, controller } = createHarness()
    agentApi.compactConversation.mockResolvedValue({ success: false, error: 'compact failed' })

    await expect(controller.compact('  保留任务  ')).resolves.toEqual({
      status: 'failed',
      error: 'compact failed',
      runId: 'compact-1',
    })
    expect(agentApi.compactConversation).toHaveBeenCalledWith('agent-1', {
      runId: 'compact-1',
      sessionId: 'session-1',
      sessionCompatibilityFingerprint: SESSION_COMPATIBILITY_FINGERPRINT,
      configuration: createConversation().configuration,
      workspaceRef: undefined,
      instructions: '保留任务',
    })
    expect(store.finishContextCompaction).toHaveBeenCalledWith(
      false,
      'agent-1',
      'compact-1',
      'compact failed',
    )
    expect(store.addSystemMessage).toHaveBeenCalledWith('上下文压缩失败: compact failed', 'agent-1')
  })

  it('没有 session 时不启动压缩事务', async () => {
    const { store, agentApi, controller } = createHarness(createConversation({ sessionId: null }))

    await expect(controller.compact('')).resolves.toEqual({
      status: 'ignored',
      reason: 'missing-session',
    })
    expect(store.beginContextCompaction).not.toHaveBeenCalled()
    expect(agentApi.compactConversation).not.toHaveBeenCalled()
  })
})
