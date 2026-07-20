import { useEffect } from 'react'
import { useAgentStore } from '../stores/agent-store'
import type { ContentBlock, PermissionMode, ToolConfirmationRequest } from '../types'
import type { AgentContextUsageSnapshot } from '@shared/agent-protocol'

type AgentStoreSnapshot = ReturnType<typeof useAgentStore.getState>

type AgentStreamEventPayload = {
  type?: string
  subtype?: string
  session_id?: string
  conversationId?: string
  runId?: string
  operation?: 'message' | 'compact'
  message?: {
    role?: string
    content?: Array<{
      type?: string
      tool_use_id?: string
      content?: unknown
      is_error?: boolean
    }>
  }
  event?: {
    type?: string
    message?: { id?: string }
    content_block?: {
      type?: string
      text?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
    }
    delta?: {
      type?: string
      text?: string
      thinking?: string
      partial_json?: string
    }
  }
  status?: 'compacting' | 'requesting' | null
  compact_result?: 'success' | 'failed'
  compact_error?: string
  compact_metadata?: {
    trigger: 'manual' | 'auto'
    pre_tokens: number
    post_tokens?: number
  }
  contextUsage?: AgentContextUsageSnapshot
}

type AgentCompletePayload = {
  conversationId?: string
  runId?: string
  operation?: 'message' | 'compact'
  total_cost_usd?: number
}

type AgentErrorPayload = {
  conversationId?: string
  runId?: string
  operation?: 'message' | 'compact'
  code?: string
  message: string
}

function acceptsRunEvent(
  store: AgentStoreSnapshot,
  conversationId: string | undefined,
  runId: string | undefined,
): boolean {
  if (!runId) return true
  const id = conversationId ?? store.activeConversationId
  const activeRunId = store.conversations[id]?.activeRunId
  return activeRunId === runId
}

export function applyAgentStreamEventToStore(
  event: AgentStreamEventPayload,
  store: AgentStoreSnapshot = useAgentStore.getState(),
): void {
  const conversationId = event.conversationId
  if (!acceptsRunEvent(store, conversationId, event.runId)) return

  switch (event.type) {
    case 'system': {
      if (event.subtype === 'init' && event.session_id) {
        store.setSessionId(event.session_id, conversationId)
        store.setBackendState('connected', conversationId)
      }
      if (event.subtype === 'context_usage' && event.contextUsage) {
        store.setContextUsage(event.contextUsage, conversationId)
      }
      if (event.subtype === 'status' && event.status === 'compacting') {
        store.setContextCompaction(
          {
            status: 'compacting',
            trigger: event.operation === 'compact' ? 'manual' : 'auto',
            error: null,
          },
          conversationId,
        )
      }
      if (event.subtype === 'compact_boundary' && event.compact_metadata) {
        store.setContextCompaction(
          {
            status: 'completed',
            trigger: event.compact_metadata.trigger,
            preTokens: event.compact_metadata.pre_tokens,
            postTokens: event.compact_metadata.post_tokens ?? null,
            error: null,
          },
          conversationId,
        )
      }
      if (event.subtype === 'status' && event.compact_result === 'failed') {
        store.setContextCompaction(
          {
            status: 'failed',
            error: event.compact_error ?? 'Claude SDK 压缩失败',
          },
          conversationId,
        )
      }
      break
    }

    case 'stream_event': {
      if (event.operation === 'compact') break
      const innerEvent = event.event
      if (!innerEvent) break

      if (innerEvent.type === 'message_start' && innerEvent.message?.id) {
        store.startStreamingMessage(innerEvent.message.id, conversationId, event.runId)
      }

      if (innerEvent.type === 'content_block_start' && innerEvent.content_block) {
        const block = innerEvent.content_block
        if (block.type === 'text') {
          store.appendContentBlock(
            { type: 'text', text: block.text ?? '' } as ContentBlock,
            conversationId,
          )
        } else if (block.type === 'thinking') {
          store.appendContentBlock(
            { type: 'thinking', thinking: '' } as ContentBlock,
            conversationId,
          )
        } else if (block.type === 'tool_use') {
          store.appendContentBlock(
            {
              type: 'tool_use',
              id: block.id ?? '',
              name: block.name ?? '',
              input: block.input ?? {},
            } as ContentBlock,
            conversationId,
          )
        }
      }

      if (innerEvent.type === 'content_block_delta') {
        const delta = innerEvent.delta
        if (!delta) break

        if (delta.type === 'text_delta') {
          store.appendStreamDelta(delta.text ?? '', conversationId)
        } else if (delta.type === 'thinking_delta') {
          store.appendStreamDelta(delta.thinking ?? '', conversationId)
        } else if (delta.type === 'input_json_delta') {
          store.appendStreamDelta(delta.partial_json ?? '', conversationId)
        }
      }

      if (innerEvent.type === 'message_stop') {
        store.stopStreamingMessage(conversationId)
      }
      break
    }

    case 'user': {
      if (event.operation === 'compact') break
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_result' || !block.tool_use_id) continue
        store.appendContentBlock(
          {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: formatToolResultContent(block.content),
            is_error: block.is_error === true,
          },
          conversationId,
        )
      }
      break
    }

    case 'assistant':
      break
  }
}

function formatToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '')
        }
        return typeof item === 'string' ? item : JSON.stringify(item)
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

export function applyAgentCompleteToStore(
  result: AgentCompletePayload,
  store: AgentStoreSnapshot = useAgentStore.getState(),
): void {
  const conversationId = result.conversationId
  if (!acceptsRunEvent(store, conversationId, result.runId)) return
  if (result.operation === 'compact') {
    store.finishContextCompaction(true, conversationId, result.runId)
    return
  }
  store.finishStreamingMessage(conversationId, result.runId)
  if (result.total_cost_usd !== undefined) {
    store.setLastCost(result.total_cost_usd, conversationId)
  }
}

export function applyAgentErrorToStore(
  error: AgentErrorPayload,
  store: AgentStoreSnapshot = useAgentStore.getState(),
): void {
  const conversationId = error.conversationId
  if (!acceptsRunEvent(store, conversationId, error.runId)) return
  if (error.operation === 'compact') {
    store.finishContextCompaction(false, conversationId, error.runId, error.message)
    store.addSystemMessage(`上下文压缩失败: ${error.message}`, conversationId)
    return
  }
  if (error.code === 'budget_exceeded' || error.code === 'sdk_session_invalid') {
    store.setSessionId(null, conversationId)
    store.setContextUsage(null, conversationId)
  }
  store.cancelStreaming(
    conversationId,
    error.code === 'stream_ended_without_result' ? 'stream-ended' : 'error',
    error.runId,
  )
  store.addSystemMessage(`连接错误: ${error.message}`, conversationId)
}

/** 全局订阅 Agent 后端事件，并写入会话 store。 */
export function useAgentStreamEvents(): void {
  useEffect(() => {
    const offStream = window.cclinkStudio.agent.onStreamEvent((event) => {
      applyAgentStreamEventToStore(event)
    })

    const offComplete = window.cclinkStudio.agent.onComplete((result) => {
      applyAgentCompleteToStore(result)
    })

    const offError = window.cclinkStudio.agent.onError((error) => {
      applyAgentErrorToStore(error)
    })

    const offConfirmation = window.cclinkStudio.agent.onRequestConfirmation(
      (request: ToolConfirmationRequest) => {
        useAgentStore.getState().addPendingConfirmation(request)
      },
    )

    window.cclinkStudio.agent.getPermissionMode().then((mode: string) => {
      useAgentStore.getState().setPermissionMode(mode as PermissionMode)
    })

    return () => {
      offStream()
      offComplete()
      offError()
      offConfirmation()
    }
  }, [])
}
