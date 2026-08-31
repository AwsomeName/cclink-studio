import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore } from '../stores/agent-store'
import { useUIStore } from '../stores/ui-store'
import {
  applyAgentCompleteToStore,
  applyAgentErrorToStore,
  applyAgentRunStatusToStore,
  applyAgentStreamEventToStore,
} from './use-agent-stream-events'

beforeEach(() => {
  useAgentStore.setState(useAgentStore.getInitialState(), true)
  useUIStore.setState(useUIStore.getInitialState(), true)
})

describe('applyAgentStreamEventToStore', () => {
  it('adopts a main-owned run before accepting its Agent stream', () => {
    const conversationId = useAgentStore.getState().createConversation({
      id: 'article-publishing-affair-1',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: { kind: 'local', path: '/workspace/article' },
      },
      activate: true,
    })

    applyAgentRunStatusToStore({
      conversationId,
      runId: 'run-launch-operation-1',
      status: 'running',
      workspaceKey: '/workspace/article',
      startedAt: 1,
      updatedAt: 1,
      completedAt: null,
    })
    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      runId: 'run-launch-operation-1',
      event: { type: 'message_start', message: { id: 'publishing-progress' } },
    })
    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      runId: 'run-launch-operation-1',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '正在上传并核验正文图片' },
      },
    })

    const conversation = useAgentStore.getState().conversations[conversationId]
    expect(conversation).toMatchObject({
      activeRunId: 'run-launch-operation-1',
      loading: true,
      runStatus: 'running',
    })
    expect(conversation.messages.at(-1)?.rawText).toBe('正在上传并核验正文图片')
  })

  it('does not adopt a main-owned run from another workspace', () => {
    const conversationId = useAgentStore.getState().createConversation({
      id: 'article-publishing-affair-2',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: { kind: 'local', path: '/workspace/article' },
      },
      activate: true,
    })

    applyAgentRunStatusToStore({
      conversationId,
      runId: 'run-other-workspace',
      status: 'running',
      workspaceKey: '/workspace/other',
      startedAt: 1,
      updatedAt: 1,
      completedAt: null,
    })

    expect(useAgentStore.getState().conversations[conversationId].activeRunId).toBeNull()
  })

  it('replaces an older persisted run projection when main starts a newer recovery run', () => {
    const conversationId = useAgentStore.getState().createConversation({
      id: 'article-publishing-affair-recovery',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: { kind: 'local', path: '/workspace/article' },
      },
      activate: true,
    })
    const staleRunId = useAgentStore.getState().beginRun(conversationId)
    const staleEventAt =
      useAgentStore.getState().conversations[conversationId].lastRunEventAt ?? Date.now()

    applyAgentRunStatusToStore({
      conversationId,
      runId: 'run-recovered-generation-2',
      status: 'running',
      workspaceKey: '/workspace/article',
      startedAt: staleEventAt + 1,
      updatedAt: staleEventAt + 1,
      completedAt: null,
    })

    expect(staleRunId).not.toBe('run-recovered-generation-2')
    expect(useAgentStore.getState().conversations[conversationId]).toMatchObject({
      activeRunId: 'run-recovered-generation-2',
      runStatus: 'running',
      loading: true,
    })
  })

  it('只在 Runtime 确认后把 cancelling run 收敛为已取消', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    const runId = useAgentStore.getState().beginRun(conversationId)
    useAgentStore.getState().markRunCancelling(conversationId, runId)
    useAgentStore.getState().addPendingConfirmation({
      id: 'confirmation-1',
      conversationId,
      runId,
      toolName: 'editor_write',
      params: {},
      riskLevel: 'write',
    })

    expect(useAgentStore.getState().conversations[conversationId]).toMatchObject({
      loading: true,
      runStatus: 'cancelling',
      activeRunId: runId,
    })
    applyAgentRunStatusToStore({
      conversationId,
      runId,
      status: 'cancelled',
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 2,
      completedAt: 2,
    })

    const state = useAgentStore.getState()
    expect(state.conversations[conversationId]).toMatchObject({
      loading: false,
      runStatus: 'cancelled',
      activeRunId: null,
      lastRunTerminalReason: 'cancelled',
    })
    expect(state.pendingConfirmations).toEqual([])
    expect(state.conversations[conversationId].messages.at(-1)?.rawText).toContain('Runtime 停止')
  })

  it('Agent 面板隐藏时，流式消息仍写入当前会话', () => {
    useUIStore.getState().setAgentPanelMode('hidden', 'user')
    const conversationId = useAgentStore.getState().activeConversationId

    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      event: {
        type: 'message_start',
        message: { id: 'msg-hidden-panel' },
      },
    })
    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '隐藏面板下继续响应' },
      },
    })
    applyAgentCompleteToStore({ conversationId, total_cost_usd: 0.01 })

    const state = useAgentStore.getState()
    const message = state.conversations[conversationId].messages.find(
      (item) => item.id === 'msg-hidden-panel',
    )

    expect(useUIStore.getState().agentPanelMode).toBe('hidden')
    expect(state.conversations[conversationId].backendState).toBe('connected')
    expect(state.conversations[conversationId].lastCost).toBe(0.01)
    expect(message?.rawText).toBe('隐藏面板下继续响应')
    expect(message?.isStreaming).toBe(false)
  })

  it('Agent 面板隐藏时，错误事件仍写入系统消息', () => {
    useUIStore.getState().setAgentPanelMode('hidden', 'user')
    const conversationId = useAgentStore.getState().activeConversationId

    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      event: {
        type: 'message_start',
        message: { id: 'msg-error-hidden-panel' },
      },
    })
    applyAgentErrorToStore({ conversationId, message: 'network down' })

    const conversation = useAgentStore.getState().conversations[conversationId]
    const lastMessage = conversation.messages[conversation.messages.length - 1]

    expect(useUIStore.getState().agentPanelMode).toBe('hidden')
    expect(conversation.backendState).toBe('error')
    expect(lastMessage.role).toBe('system')
    expect(lastMessage.rawText).toBe('连接错误: network down')
  })

  it('把浏览器人工接管显示为任务暂停，而不是连接错误', () => {
    const conversationId = useAgentStore.getState().activeConversationId

    applyAgentErrorToStore({
      conversationId,
      code: 'browser_task_waiting_human',
      message: '浏览器任务已暂停，等待用户处理：网页验证码需要人工处理',
    })

    const conversation = useAgentStore.getState().conversations[conversationId]
    expect(conversation.messages.at(-1)?.rawText).toBe(
      '任务暂停: 浏览器任务已暂停，等待用户处理：网页验证码需要人工处理',
    )
  })

  it('把浏览器结果待核验显示为任务待核验，而不是连接错误', () => {
    const conversationId = useAgentStore.getState().activeConversationId

    applyAgentErrorToStore({
      conversationId,
      code: 'browser_reobservation_required',
      message: '浏览器动作结果仍未知，必须重新读取页面',
    })

    const conversation = useAgentStore.getState().conversations[conversationId]
    expect(conversation.messages.at(-1)?.rawText).toBe(
      '任务待核验: 浏览器动作结果仍未知，必须重新读取页面',
    )
  })

  it('忽略已经被新运行替代的迟到完成事件', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    const oldRunId = useAgentStore.getState().beginRun(conversationId)
    const newRunId = useAgentStore.getState().beginRun(conversationId)

    applyAgentCompleteToStore({
      conversationId,
      runId: oldRunId,
      total_cost_usd: 0.01,
    })

    expect(useAgentStore.getState().conversations[conversationId]).toMatchObject({
      activeRunId: newRunId,
      loading: true,
      runStatus: 'starting',
    })
  })

  it('记录工具结果和错误，供会话与诊断日志追踪', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    useAgentStore.getState().beginRun(conversationId)
    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      event: {
        type: 'message_start',
        message: { id: 'msg-tool-result' },
      },
    })
    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      event: { type: 'message_stop' },
    })

    applyAgentStreamEventToStore({
      type: 'user',
      conversationId,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-browser-list',
            content: 'Playwright 页面未就绪',
            is_error: true,
          },
        ],
      },
    })

    expect(useAgentStore.getState().messages.at(-1)?.content.at(-1)).toEqual({
      type: 'tool_result',
      tool_use_id: 'tool-browser-list',
      content: 'Playwright 页面未就绪',
      is_error: true,
    })
    expect(useAgentStore.getState().messages.at(-1)?.isStreaming).toBe(false)
  })

  it('忽略任务完成后迟到的流事件，避免重新出现假游标', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    const runId = useAgentStore.getState().beginRun(conversationId)
    applyAgentCompleteToStore({ conversationId, runId })

    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      runId,
      event: { type: 'message_start', message: { id: 'late-message' } },
    })

    const conversation = useAgentStore.getState().conversations[conversationId]
    expect(conversation.messages.some((message) => message.id === 'late-message')).toBe(false)
    expect(conversation.streamingMessageId).toBeNull()
    expect(conversation.loading).toBe(false)
  })

  it('每个 assistant turn 结束时关闭游标，但保持任务运行直到 result', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    const runId = useAgentStore.getState().beginRun(conversationId)
    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      runId,
      event: { type: 'message_start', message: { id: 'turn-1' } },
    })
    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      runId,
      event: { type: 'message_stop' },
    })

    let conversation = useAgentStore.getState().conversations[conversationId]
    expect(conversation.messages.find((message) => message.id === 'turn-1')?.isStreaming).toBe(
      false,
    )
    expect(conversation.loading).toBe(true)
    expect(conversation.runStatus).toBe('running')

    applyAgentStreamEventToStore({
      type: 'stream_event',
      conversationId,
      runId,
      event: { type: 'message_start', message: { id: 'turn-2' } },
    })
    applyAgentCompleteToStore({ conversationId, runId, total_cost_usd: 0.02 })

    conversation = useAgentStore.getState().conversations[conversationId]
    expect(conversation.messages.filter((message) => message.isStreaming)).toHaveLength(0)
    expect(conversation.runStatus).toBe('completed')
  })

  it('按会话写入 SDK 上下文用量，不污染当前查看的其他会话', () => {
    const firstId = useAgentStore.getState().activeConversationId
    const secondId = useAgentStore.getState().createConversation()

    applyAgentStreamEventToStore({
      type: 'system',
      subtype: 'context_usage',
      conversationId: firstId,
      contextUsage: {
        categories: [{ name: 'messages', tokens: 60_000 }],
        totalTokens: 60_000,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: 30,
        model: 'claude-sonnet',
        autoCompactThreshold: 190_000,
        isAutoCompactEnabled: true,
        capturedAt: 1,
      },
    })

    const state = useAgentStore.getState()
    expect(state.activeConversationId).toBe(secondId)
    expect(state.contextUsage).toBeNull()
    expect(state.conversations[firstId].contextUsage?.percentage).toBe(30)
  })

  it('把 ACP 中性文本和工具事件写入同一条 Thread', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    const runId = useAgentStore.getState().beginRun(conversationId)

    applyAgentStreamEventToStore({
      protocol: 'studio-agent-event-v1',
      conversationId,
      runId,
      sessionCompatibilityFingerprint: 'b'.repeat(64),
      event: { type: 'session', sessionId: 'acp-session-1', state: 'created' },
    })
    applyAgentStreamEventToStore({
      protocol: 'studio-agent-event-v1',
      conversationId,
      runId,
      event: { type: 'text-delta', messageId: 'acp-message-1', text: '正在处理' },
    })
    applyAgentStreamEventToStore({
      protocol: 'studio-agent-event-v1',
      conversationId,
      runId,
      event: {
        type: 'tool',
        action: 'start',
        toolCallId: 'acp-tool-1',
        name: 'read_file',
        status: 'in_progress',
        input: { path: 'README.md' },
      },
    })
    applyAgentStreamEventToStore({
      protocol: 'studio-agent-event-v1',
      conversationId,
      runId,
      event: {
        type: 'tool',
        action: 'update',
        toolCallId: 'acp-tool-1',
        name: 'read_file',
        status: 'completed',
        output: 'ok',
      },
    })
    applyAgentCompleteToStore({ conversationId, runId })

    const conversation = useAgentStore.getState().conversations[conversationId]
    expect(conversation.sessionId).toBe('acp-session-1')
    expect(conversation.messages.at(-1)?.content).toEqual([
      { type: 'text', text: '正在处理' },
      { type: 'tool_use', id: 'acp-tool-1', name: 'read_file', input: { path: 'README.md' } },
      { type: 'tool_result', tool_use_id: 'acp-tool-1', content: 'ok', is_error: false },
    ])
    expect(conversation.loading).toBe(false)
  })

  it('手动压缩事件不创建消息，并只结束对应会话的压缩运行', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    const initialMessageCount = useAgentStore.getState().messages.length
    const runId = useAgentStore.getState().beginContextCompaction(conversationId)

    applyAgentStreamEventToStore({
      type: 'stream_event',
      operation: 'compact',
      conversationId,
      runId,
      event: { type: 'message_start', message: { id: 'compact-output' } },
    })
    applyAgentStreamEventToStore({
      type: 'system',
      subtype: 'compact_boundary',
      operation: 'compact',
      conversationId,
      runId,
      compact_metadata: {
        trigger: 'manual',
        pre_tokens: 160_000,
        post_tokens: 28_000,
      },
    })
    applyAgentCompleteToStore({ operation: 'compact', conversationId, runId })

    const conversation = useAgentStore.getState().conversations[conversationId]
    expect(conversation.messages).toHaveLength(initialMessageCount)
    expect(conversation.contextCompaction).toMatchObject({
      status: 'completed',
      trigger: 'manual',
      preTokens: 160_000,
      postTokens: 28_000,
    })
    expect(conversation.activeRunId).toBeNull()
  })

  it('预算中止后保留失效 Session 作为严格续聊边界，但清除用量', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    useAgentStore.getState().setSessionId('session-with-dangling-tools', conversationId)
    useAgentStore.getState().setContextUsage(
      {
        categories: [{ name: 'messages', tokens: 60_000 }],
        totalTokens: 60_000,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: 30,
        model: 'claude-sonnet',
        autoCompactThreshold: 190_000,
        isAutoCompactEnabled: true,
        capturedAt: 1,
      },
      conversationId,
    )

    applyAgentErrorToStore({
      conversationId,
      code: 'budget_exceeded',
      message: 'Reached maximum budget ($1)',
    })

    const conversation = useAgentStore.getState().conversations[conversationId]
    expect(conversation.sessionId).toBe('session-with-dangling-tools')
    expect(conversation.contextUsage).toBeNull()
    expect(conversation.runStatus).toBe('failed')
  })

  it('检测到原生调度状态后不静默丢弃 renderer 持有的 SDK session', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    useAgentStore.getState().setSessionId('revoked-session', conversationId, 'a'.repeat(64))

    applyAgentErrorToStore({
      conversationId,
      code: 'native_scheduling_state_detected',
      message: '检测到 Claude 原生定时任务文件',
    })

    expect(useAgentStore.getState().conversations[conversationId].sessionId).toBe('revoked-session')
    expect(
      useAgentStore.getState().conversations[conversationId].messages.at(-1)?.rawText,
    ).toContain('未自动创建新会话')
  })
})
