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
  scope: AgentScope
  activeRunId: string | null
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
  private currentConfig: BackendConfig

  constructor(options: AgentRuntimeOptions) {
    this.currentConfig = options.config
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

  async sendMessage(
    message: string,
    conversationId = DEFAULT_CONVERSATION_ID,
    options?: AgentSendOptions,
  ): Promise<void> {
    const conversation = this.ensureConversation(conversationId)
    conversation.activeRunId = options?.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await conversation.backend.sendMessage(message, {
      ...options,
      conversationId,
      runId: conversation.activeRunId,
    })
  }

  async abort(conversationId = DEFAULT_CONVERSATION_ID): Promise<void> {
    const conversation = this.ensureConversation(conversationId)
    await conversation.backend.abort()
    conversation.activeRunId = null
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

  switchBackend(config: BackendConfig): void {
    this.currentConfig = config
    const existing = Array.from(this.conversations.entries()).map(
      ([conversationId, conversation]) => ({
        conversationId,
        scope: conversation.scope,
        sessionId: conversation.backend.getSessionId(),
        activeRunId: conversation.activeRunId,
        backend: conversation.backend,
      }),
    )
    this.conversations.clear()

    for (const previous of existing) {
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
      const conversation = this.createConversation(previous.conversationId, previous.scope)
      conversation.backend.setSessionId?.(previous.sessionId)
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

    const conversation = this.createConversation(conversationId, { kind: 'all' })
    this.conversations.set(conversationId, conversation)
    return conversation
  }

  private createConversation(conversationId: string, scope: AgentScope): AgentConversation {
    const backend = createBackend(this.currentConfig, this.deps)
    const conversation: AgentConversation = { backend, scope, activeRunId: null }
    backend.onEvent((type, data) => {
      const runId = conversation.activeRunId
      this.onEvent?.({ conversationId, runId, type, data })
      if (type === 'complete' || type === 'error') {
        conversation.activeRunId = null
      }
    })
    backend.setScope?.(scope)
    return conversation
  }
}
