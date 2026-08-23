import { createBackend, type BackendFactoryDeps } from '../backends/backend-factory.js'
import type {
  AgentBackendStatus,
  AgentEventType,
  AgentSendOptions,
  BackendConfig,
  IAgentBackend,
} from '../backends/types.js'
import type { AgentScope } from './scope.js'

export const DEFAULT_CONVERSATION_ID = 'agent-default'

export interface AgentRuntimeEvent {
  conversationId: string
  runId: string | null
  type: AgentEventType
  data: unknown
}

interface AgentConversation {
  backend: IAgentBackend
  config: BackendConfig
  scope: AgentScope
  activeRunId: string | null
  cancellingRunId: string | null
}

export interface AgentRuntimeOptions {
  config: BackendConfig
  deps: BackendFactoryDeps
  onEvent?: (event: AgentRuntimeEvent) => void
}

export class AgentRuntime {
  private readonly conversations = new Map<string, AgentConversation>()
  private readonly deps: BackendFactoryDeps
  private readonly onEvent?: (event: AgentRuntimeEvent) => void
  private defaultConfig: BackendConfig

  constructor(options: AgentRuntimeOptions) {
    this.defaultConfig = options.config
    this.deps = options.deps
    this.onEvent = options.onEvent
    this.ensureConversation(DEFAULT_CONVERSATION_ID)
  }

  getConversationIds(): string[] {
    return Array.from(this.conversations.keys())
  }

  getBackend(conversationId = DEFAULT_CONVERSATION_ID): IAgentBackend {
    return this.ensureConversation(conversationId).backend
  }

  getBackendType(conversationId = DEFAULT_CONVERSATION_ID): BackendConfig['type'] {
    return this.ensureConversation(conversationId).config.type
  }

  bindConversationBackend(conversationId: string, config: BackendConfig): void {
    const existing = this.conversations.get(conversationId)
    if (!existing) {
      this.conversations.set(
        conversationId,
        this.createConversation(conversationId, { kind: 'all' }, config),
      )
      return
    }
    if (existing.config.type === config.type) return
    if (existing.activeRunId || existing.backend.getSessionId()) {
      throw new Error('已有消息或运行中的 Thread 不能切换 Agent runtime')
    }
    void existing.backend.destroy()
    this.conversations.set(
      conversationId,
      this.createConversation(conversationId, existing.scope, config),
    )
  }

  async sendMessage(
    message: string,
    conversationId = DEFAULT_CONVERSATION_ID,
    options?: AgentSendOptions,
  ): Promise<void> {
    const conversation = this.ensureConversation(conversationId)
    if (conversation.activeRunId || conversation.backend.getStatus().connected) {
      throw new Error('Agent 当前 Thread 已有活动任务，请等待完成或取消后重试')
    }
    const runId = options?.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    conversation.activeRunId = runId
    try {
      await conversation.backend.sendMessage(message, {
        ...options,
        conversationId,
        runId,
      })
    } catch (error) {
      if (conversation.activeRunId === runId) conversation.activeRunId = null
      throw error
    }
  }

  async compactConversation(
    conversationId = DEFAULT_CONVERSATION_ID,
    instructions?: string,
    options?: AgentSendOptions,
  ): Promise<void> {
    const conversation = this.ensureConversation(conversationId)
    if (!conversation.backend.compact) {
      throw new Error('当前 Agent 后端不支持手动压缩上下文')
    }
    if (conversation.activeRunId || conversation.backend.getStatus().connected) {
      throw new Error('Agent 当前 Thread 已有活动任务，请等待完成或取消后重试')
    }
    conversation.activeRunId =
      options?.runId ?? `compact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      await conversation.backend.compact(instructions, {
        ...options,
        conversationId,
        runId: conversation.activeRunId,
      })
    } catch (error) {
      conversation.activeRunId = null
      throw error
    }
  }

  async getContextUsage(
    conversationId = DEFAULT_CONVERSATION_ID,
  ): Promise<import('../../../shared/agent-protocol').AgentContextUsageSnapshot | null> {
    return (await this.ensureConversation(conversationId).backend.getContextUsage?.()) ?? null
  }

  /** 在取消状态持久化期间保留 run 所有权，防止尾部终态事件提前释放它。 */
  reserveCancellation(conversationId: string, runId: string): void {
    const conversation = this.ensureConversation(conversationId)
    if (conversation.activeRunId !== runId) {
      throw new Error(`目标 run 当前不在执行: ${runId}`)
    }
    if (conversation.cancellingRunId && conversation.cancellingRunId !== runId) {
      throw new Error(`另一个 run 正在取消: ${conversation.cancellingRunId}`)
    }
    conversation.cancellingRunId = runId
  }

  releaseCancellationReservation(conversationId: string, runId: string): void {
    const conversation = this.ensureConversation(conversationId)
    if (conversation.cancellingRunId === runId) conversation.cancellingRunId = null
  }

  async abort(conversationId = DEFAULT_CONVERSATION_ID, runId?: string): Promise<void> {
    const conversation = this.ensureConversation(conversationId)
    if (!runId) throw new Error('取消任务必须提供 runId')
    if (conversation.activeRunId !== runId) {
      throw new Error(`目标 run 当前不在执行: ${runId}`)
    }
    this.reserveCancellation(conversationId, runId)
    try {
      await conversation.backend.abort()
    } catch (error) {
      if (conversation.cancellingRunId === runId) conversation.cancellingRunId = null
      throw error
    }
    if (conversation.activeRunId === runId) conversation.activeRunId = null
    if (conversation.cancellingRunId === runId) conversation.cancellingRunId = null
  }

  getStatus(
    conversationId = DEFAULT_CONVERSATION_ID,
  ): AgentBackendStatus & { runId: string | null } {
    const conversation = this.ensureConversation(conversationId)
    return {
      ...conversation.backend.getStatus(),
      runId: conversation.activeRunId,
    }
  }

  isBusy(conversationId = DEFAULT_CONVERSATION_ID): boolean {
    return this.getStatus(conversationId).connected
  }

  resetSession(conversationId = DEFAULT_CONVERSATION_ID): void {
    this.ensureConversation(conversationId).backend.resetSession()
  }

  restoreConversation(conversationId: string, sessionId: string | null): void {
    this.ensureConversation(conversationId).backend.setSessionId?.(sessionId)
  }

  async closeConversation(conversationId = DEFAULT_CONVERSATION_ID): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) return
    await conversation.backend.destroy()
    this.conversations.delete(conversationId)
    if (this.conversations.size === 0) {
      this.ensureConversation(DEFAULT_CONVERSATION_ID)
    }
  }

  setScope(scope: AgentScope, conversationId = DEFAULT_CONVERSATION_ID): void {
    const conversation = this.ensureConversation(conversationId)
    conversation.scope = scope
    conversation.backend.setScope?.(scope)
  }

  getScope(conversationId = DEFAULT_CONVERSATION_ID): AgentScope {
    return this.ensureConversation(conversationId).scope
  }

  switchBackend(config: BackendConfig, preserveSessions = true): void {
    const previousDefaultType = this.defaultConfig.type
    this.defaultConfig = config
    this.reconfigureBackendType(previousDefaultType, config, preserveSessions)
  }

  reconfigureBackendType(
    backendType: BackendConfig['type'],
    config: BackendConfig,
    preserveSessions = true,
  ): void {
    const existing = Array.from(this.conversations.entries()).map(
      ([conversationId, conversation]) => ({
        conversationId,
        scope: conversation.scope,
        sessionId: conversation.backend.getSessionId(),
        activeRunId: conversation.activeRunId,
        backend: conversation.backend,
        config: conversation.config,
      }),
    )

    for (const previous of existing) {
      if (previous.config.type !== backendType) continue
      if (previous.activeRunId) {
        this.onEvent?.({
          conversationId: previous.conversationId,
          runId: previous.activeRunId,
          type: 'error',
          data: {
            type: 'error',
            code: 'backend_reconfigured',
            message: 'Agent 后端配置已变更，当前任务已中断',
          },
        })
      }
      void previous.backend.destroy()
      const conversation = this.createConversation(previous.conversationId, previous.scope, config)
      conversation.backend.setSessionId?.(preserveSessions ? previous.sessionId : null)
      conversation.activeRunId = null
      const { conversationId } = previous
      this.conversations.set(conversationId, conversation)
    }
  }

  async destroy(): Promise<void> {
    await Promise.all(
      Array.from(this.conversations.values()).map((conversation) => conversation.backend.destroy()),
    )
    this.conversations.clear()
  }

  private ensureConversation(conversationId = DEFAULT_CONVERSATION_ID): AgentConversation {
    const existing = this.conversations.get(conversationId)
    if (existing) return existing

    const conversation = this.createConversation(
      conversationId,
      { kind: 'all' },
      this.defaultConfig,
    )
    this.conversations.set(conversationId, conversation)
    return conversation
  }

  private createConversation(
    conversationId: string,
    scope: AgentScope,
    config: BackendConfig,
  ): AgentConversation {
    const backend = createBackend(config, this.deps)
    const conversation: AgentConversation = {
      backend,
      config,
      scope,
      activeRunId: null,
      cancellingRunId: null,
    }
    backend.onEvent((type, data) => {
      const runId = conversation.activeRunId
      // 后端取消/终止后可能仍收到传输层尾部事件。没有活动 run 的事件没有状态所有权，
      // 不能以 runId=null 转给 renderer；否则兼容旧协议的 UI 会把已终止会话重新置为运行中。
      if (!runId) return
      this.onEvent?.({ conversationId, runId, type, data })
      if (
        (type === 'complete' || type === 'error') &&
        conversation.activeRunId === runId &&
        conversation.cancellingRunId !== runId
      ) {
        conversation.activeRunId = null
      }
    })
    backend.setScope?.(scope)
    return conversation
  }
}
