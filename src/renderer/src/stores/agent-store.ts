import { create } from 'zustand'
import type {
  AgentMessage,
  AgentBackendState,
  ContentBlock,
  TextContentBlock,
  PlaywrightStatus,
  ToolConfirmationRequest,
  PermissionMode,
  AgentScope,
  AgentMountedResource,
  AgentMountedSkill,
  ConversationRuntimeRef,
  ConversationSurface,
} from '../types'
import { persistWorkspaceSection } from '../utils/workspace-state'

export interface AgentConversationState {
  id: string
  title: string
  surface: ConversationSurface
  runtime: ConversationRuntimeRef
  messages: AgentMessage[]
  input: string
  loading: boolean
  backendState: AgentBackendState
  sessionId: string | null
  streamingMessageId: string | null
  lastCost: number | null
  scope: AgentScope
  mountedResources: AgentMountedResource[]
  mountedSkills: AgentMountedSkill[]
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

interface AgentState {
  /** 会话列表（按 conversationOrder 展示） */
  conversations: Record<string, AgentConversationState>
  conversationOrder: string[]
  activeConversationId: string

  /** 当前活跃会话快照（兼容旧组件/测试的 selector） */
  messages: AgentMessage[]
  input: string
  loading: boolean
  backendState: AgentBackendState
  sessionId: string | null
  streamingMessageId: string | null
  lastCost: number | null
  scope: AgentScope

  /** Playwright 连接状态 */
  playwrightStatus: PlaywrightStatus

  // --- 权限相关（第一版仍为全局确认队列） ---
  pendingConfirmations: ToolConfirmationRequest[]
  permissionMode: PermissionMode

  // --- 会话 Actions ---
  createConversation: (options?: {
    surface?: ConversationSurface
    runtime?: ConversationRuntimeRef
    activate?: boolean
  }) => string
  switchConversation: (id: string) => void
  closeConversation: (id: string) => void
  archiveConversation: (id: string) => void
  restoreArchivedConversation: (id: string) => void
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  markAsWorkConversation: (id: string, runtime: ConversationRuntimeRef) => void

  // --- 当前/指定会话 Actions ---
  setInput: (text: string, conversationId?: string) => void
  addUserMessage: (content: string, conversationId?: string) => void
  addSystemMessage: (content: string, conversationId?: string) => void
  startStreamingMessage: (messageId: string, conversationId?: string) => void
  appendStreamDelta: (delta: string, conversationId?: string) => void
  appendContentBlock: (block: ContentBlock, conversationId?: string) => void
  finishStreamingMessage: (conversationId?: string) => void
  cancelStreaming: (conversationId?: string) => void
  setBackendState: (state: AgentBackendState, conversationId?: string) => void
  setSessionId: (id: string | null, conversationId?: string) => void
  setLastCost: (cost: number, conversationId?: string) => void
  setLoading: (loading: boolean, conversationId?: string) => void
  setPlaywrightStatus: (status: PlaywrightStatus) => void
  clearMessages: (conversationId?: string) => void
  addPendingConfirmation: (req: ToolConfirmationRequest) => void
  removePendingConfirmation: (id: string) => void
  clearPendingConfirmations: () => void
  setPermissionMode: (mode: PermissionMode) => void
  setScope: (scope: AgentScope, conversationId?: string) => void
  addMountedResource: (resource: AgentMountedResource, conversationId?: string) => void
  removeMountedResource: (resourceId: string, conversationId?: string) => void
  addMountedSkill: (skill: AgentMountedSkill, conversationId?: string) => void
  removeMountedSkill: (skillId: string, conversationId?: string) => void
  hydrateFromWorkspaceState: (value: unknown) => void
}

const DEFAULT_CONVERSATION_ID = 'agent-default'
const STORAGE_KEY = 'deepink-agent-conversations'

function createWelcomeMessage(): AgentMessage {
  return {
    id: 'welcome',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '你好！我是 DeepInk AI 助手，由 Claude Code 驱动。\n\n你可以用自然语言和我对话，我会帮你完成浏览器自动化、网页信息提取等任务。\n\n试着说：「帮我打开百度搜索一下 DeepInk」',
      },
    ],
    rawText:
      '你好！我是 DeepInk AI 助手，由 Claude Code 驱动。\n\n你可以用自然语言和我对话，我会帮你完成浏览器自动化、网页信息提取等任务。\n\n试着说：「帮我打开百度搜索一下 DeepInk」',
    timestamp: Date.now(),
  }
}

function createConversation(
  id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  options: {
    surface?: ConversationSurface
    runtime?: ConversationRuntimeRef
    activate?: boolean
  } = {},
): AgentConversationState {
  const now = Date.now()
  return {
    id,
    title: '新会话',
    surface: options.surface ?? 'assistant-panel',
    runtime: options.runtime ?? {
      location: 'local',
      transport: 'local',
      backend: 'deepink-agent',
    },
    messages: [createWelcomeMessage()],
    input: '',
    loading: false,
    backendState: 'disconnected',
    sessionId: null,
    streamingMessageId: null,
    lastCost: null,
    scope: { kind: 'all' },
    mountedResources: [],
    mountedSkills: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  }
}

function mirrorActive(
  state: AgentState,
  conversation: AgentConversationState,
): Partial<AgentState> {
  return {
    messages: conversation.messages,
    input: conversation.input,
    loading: conversation.loading,
    backendState: conversation.backendState,
    sessionId: conversation.sessionId,
    streamingMessageId: conversation.streamingMessageId,
    lastCost: conversation.lastCost,
    scope: conversation.scope,
  }
}

function resolveConversationId(state: AgentState, conversationId?: string): string {
  return conversationId ?? state.activeConversationId
}

function updateConversation(
  state: AgentState,
  conversationId: string | undefined,
  updater: (conversation: AgentConversationState) => AgentConversationState,
): Partial<AgentState> {
  const id = resolveConversationId(state, conversationId)
  const current = state.conversations[id]
  if (!current) return {}

  const next = updater(current)
  const conversations = {
    ...state.conversations,
    [id]: next,
  }

  return {
    conversations,
    ...(id === state.activeConversationId ? mirrorActive(state, next) : {}),
  }
}

function removeConversation(state: AgentState, id: string): Partial<AgentState> | AgentState {
  const ids = state.conversationOrder
  if (!state.conversations[id]) return state

  if (ids.length <= 1) {
    const fresh = createConversation(id)
    return {
      conversations: { [id]: fresh },
      conversationOrder: [id],
      activeConversationId: id,
      ...mirrorActive(state, fresh),
    }
  }

  const nextOrder = ids.filter((item) => item !== id)
  const { [id]: _removed, ...rest } = state.conversations
  const fallbackId =
    state.activeConversationId === id
      ? [...nextOrder].reverse().find((item) => !rest[item]?.archivedAt)
      : state.activeConversationId
  const fallback = fallbackId ? rest[fallbackId] : null

  if (!fallback || fallback.archivedAt) {
    const fresh = createConversation()
    return {
      conversations: {
        ...rest,
        [fresh.id]: fresh,
      },
      conversationOrder: [...nextOrder, fresh.id],
      activeConversationId: fresh.id,
      ...mirrorActive(state, fresh),
    }
  }

  return {
    conversations: rest,
    conversationOrder: nextOrder,
    activeConversationId: fallbackId,
    ...mirrorActive(state, fallback),
  }
}

function appendDeltaToMessage(msg: AgentMessage, delta: string): AgentMessage {
  const content = [...msg.content]
  const lastBlock = content[content.length - 1]

  if (lastBlock && lastBlock.type === 'text') {
    content[content.length - 1] = {
      ...lastBlock,
      text: lastBlock.text + delta,
    } as TextContentBlock
  } else if (lastBlock && lastBlock.type === 'thinking') {
    content[content.length - 1] = {
      ...lastBlock,
      thinking: lastBlock.thinking + delta,
    }
  } else if (lastBlock && lastBlock.type === 'tool_use') {
    const rawJson = (lastBlock as { _rawInputJson?: string })._rawInputJson ?? ''
    const combined = rawJson + delta
    try {
      const parsed = JSON.parse(combined)
      content[content.length - 1] = {
        ...lastBlock,
        input: parsed,
        _rawInputJson: combined,
      }
    } catch {
      content[content.length - 1] = {
        ...lastBlock,
        _rawInputJson: combined,
      }
    }
  } else {
    content.push({ type: 'text', text: delta })
  }

  const isToolDelta = lastBlock?.type === 'tool_use'
  return {
    ...msg,
    content,
    rawText: isToolDelta ? msg.rawText : msg.rawText + delta,
  }
}

const initialConversation = createConversation(DEFAULT_CONVERSATION_ID)
const loadedConversationState = loadStoredConversations() ?? {
  conversations: { [DEFAULT_CONVERSATION_ID]: initialConversation },
  conversationOrder: [DEFAULT_CONVERSATION_ID],
  activeConversationId: DEFAULT_CONVERSATION_ID,
}
const loadedActiveConversation =
  loadedConversationState.conversations[loadedConversationState.activeConversationId] ??
  Object.values(loadedConversationState.conversations)[0] ??
  initialConversation

function loadStoredConversations(): Pick<
  AgentState,
  'conversations' | 'conversationOrder' | 'activeConversationId'
> | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeConversationSnapshot(JSON.parse(raw))
  } catch {
    return null
  }
}

function normalizeConversationSnapshot(
  value: unknown,
): Pick<AgentState, 'conversations' | 'conversationOrder' | 'activeConversationId'> | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as {
    conversations?: Record<string, AgentConversationState>
    conversationOrder?: string[]
    activeConversationId?: string
  }
  if (!parsed.conversations || !parsed.conversationOrder) return null
  if (parsed.conversationOrder.length === 0) {
    const fresh = createConversation(DEFAULT_CONVERSATION_ID)
    return {
      conversations: { [DEFAULT_CONVERSATION_ID]: fresh },
      conversationOrder: [DEFAULT_CONVERSATION_ID],
      activeConversationId: DEFAULT_CONVERSATION_ID,
    }
  }

  const conversations: Record<string, AgentConversationState> = {}
  for (const id of parsed.conversationOrder) {
    const conversation = parsed.conversations[id]
    if (!conversation) continue
    conversations[id] = {
      ...conversation,
      surface: conversation.surface ?? 'assistant-panel',
      runtime: conversation.runtime ?? {
        location: 'local',
        transport: 'local',
        backend: 'deepink-agent',
      },
      archivedAt: conversation.archivedAt ?? null,
      mountedResources: Array.isArray(conversation.mountedResources)
        ? conversation.mountedResources
        : [],
      mountedSkills: Array.isArray(conversation.mountedSkills) ? conversation.mountedSkills : [],
      loading: false,
      backendState: 'disconnected',
      streamingMessageId: null,
      input: '',
      messages: Array.isArray(conversation.messages)
        ? conversation.messages.map((msg) => ({ ...msg, isStreaming: false }))
        : [createWelcomeMessage()],
    }
  }

  const order = parsed.conversationOrder.filter((id) => conversations[id])
  if (!order.length) return null
  let activeConversationId =
    parsed.activeConversationId &&
    conversations[parsed.activeConversationId] &&
    !conversations[parsed.activeConversationId].archivedAt
      ? parsed.activeConversationId
      : order.find((id) => !conversations[id].archivedAt)

  if (!activeConversationId) {
    const fresh = createConversation()
    conversations[fresh.id] = fresh
    order.push(fresh.id)
    activeConversationId = fresh.id
  }

  return { conversations, conversationOrder: order, activeConversationId }
}

function saveStoredConversations(state: AgentState): void {
  try {
    if (typeof localStorage === 'undefined') return
    const conversations: Record<string, AgentConversationState> = {}
    for (const id of state.conversationOrder.slice(-20)) {
      const conversation = state.conversations[id]
      if (!conversation) continue
      conversations[id] = {
        ...conversation,
        loading: false,
        backendState: conversation.loading ? 'connected' : conversation.backendState,
        streamingMessageId: null,
        input: '',
        messages: conversation.messages.map((msg) => ({ ...msg, isStreaming: false })),
      }
    }
    const payload = {
      conversations,
      conversationOrder: Object.keys(conversations),
      activeConversationId:
        conversations[state.activeConversationId] &&
        !conversations[state.activeConversationId].archivedAt
          ? state.activeConversationId
          : (Object.keys(conversations).find((id) => !conversations[id].archivedAt) ??
            Object.keys(conversations)[0]),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    persistWorkspaceSection('agentConversations', payload)
  } catch {
    // localStorage 可能不可用，忽略持久化失败。
  }
}

export const useAgentStore = create<AgentState>((set) => ({
  conversations: loadedConversationState.conversations,
  conversationOrder: loadedConversationState.conversationOrder,
  activeConversationId: loadedConversationState.activeConversationId,
  messages: loadedActiveConversation.messages,
  input: loadedActiveConversation.input,
  loading: loadedActiveConversation.loading,
  backendState: loadedActiveConversation.backendState,
  sessionId: loadedActiveConversation.sessionId,
  streamingMessageId: loadedActiveConversation.streamingMessageId,
  lastCost: loadedActiveConversation.lastCost,
  scope: loadedActiveConversation.scope,
  playwrightStatus: { connected: false, pageUrl: null },
  pendingConfirmations: [] as ToolConfirmationRequest[],
  permissionMode: 'auto' as PermissionMode,

  createConversation: (options) => {
    const conversation = createConversation(undefined, options)
    set((state) => {
      const shouldActivate = options?.activate ?? true
      return {
        conversations: {
          ...state.conversations,
          [conversation.id]: conversation,
        },
        conversationOrder: [...state.conversationOrder, conversation.id],
        ...(shouldActivate
          ? {
              activeConversationId: conversation.id,
              ...mirrorActive(state, conversation),
            }
          : {}),
      }
    })
    return conversation.id
  },

  switchConversation: (id) =>
    set((state) => {
      const conversation = state.conversations[id]
      if (!conversation) return state
      return {
        activeConversationId: id,
        ...mirrorActive(state, conversation),
      }
    }),

  closeConversation: (id) => set((state) => removeConversation(state, id)),

  archiveConversation: (id) =>
    set((state) => {
      const current = state.conversations[id]
      if (!current) return state

      const now = Date.now()
      const archived = {
        ...current,
        archivedAt: now,
        updatedAt: now,
      }
      const conversations = {
        ...state.conversations,
        [id]: archived,
      }

      if (state.activeConversationId !== id) {
        return { conversations }
      }

      const fallbackId = [...state.conversationOrder]
        .reverse()
        .find((item) => item !== id && !conversations[item]?.archivedAt)
      const fallback = fallbackId ? conversations[fallbackId] : null

      if (fallback) {
        return {
          conversations,
          activeConversationId: fallbackId,
          ...mirrorActive(state, fallback),
        }
      }

      const fresh = createConversation()
      return {
        conversations: {
          ...conversations,
          [fresh.id]: fresh,
        },
        conversationOrder: [...state.conversationOrder, fresh.id],
        activeConversationId: fresh.id,
        ...mirrorActive(state, fresh),
      }
    }),

  restoreArchivedConversation: (id) =>
    set((state) => {
      const current = state.conversations[id]
      if (!current) return state

      const restored = {
        ...current,
        archivedAt: null,
        updatedAt: Date.now(),
      }

      return {
        conversations: {
          ...state.conversations,
          [id]: restored,
        },
        activeConversationId: id,
        ...mirrorActive(state, restored),
      }
    }),

  deleteConversation: (id) => set((state) => removeConversation(state, id)),

  renameConversation: (id, title) =>
    set((state) =>
      updateConversation(state, id, (conversation) => ({
        ...conversation,
        title: title.trim() || '新会话',
        updatedAt: Date.now(),
      })),
    ),

  markAsWorkConversation: (id, runtime) =>
    set((state) => {
      const current = state.conversations[id]
      if (!current) return state

      const promoted: AgentConversationState = {
        ...current,
        surface: 'workbench-tab',
        runtime,
        updatedAt: Date.now(),
      }
      const conversations = {
        ...state.conversations,
        [id]: promoted,
      }

      if (state.activeConversationId !== id) {
        return { conversations }
      }

      const fallbackId = [...state.conversationOrder]
        .reverse()
        .find(
          (item) =>
            item !== id &&
            conversations[item]?.surface === 'assistant-panel' &&
            !conversations[item]?.archivedAt,
        )
      const fallback = fallbackId ? conversations[fallbackId] : null
      if (fallback) {
        return {
          conversations,
          activeConversationId: fallbackId,
          ...mirrorActive(state, fallback),
        }
      }

      const fresh = createConversation()
      return {
        conversations: {
          ...conversations,
          [fresh.id]: fresh,
        },
        conversationOrder: [...state.conversationOrder, fresh.id],
        activeConversationId: fresh.id,
        ...mirrorActive(state, fresh),
      }
    }),

  setInput: (text, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        input: text,
        updatedAt: Date.now(),
      })),
    ),

  addUserMessage: (content, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        const messages = [
          ...conversation.messages,
          {
            id: `user-${Date.now()}`,
            role: 'user' as const,
            content: [{ type: 'text' as const, text: content }],
            rawText: content,
            timestamp: Date.now(),
          },
        ]
        return {
          ...conversation,
          title:
            conversation.title === '新会话'
              ? content.slice(0, 24) || conversation.title
              : conversation.title,
          messages,
          updatedAt: Date.now(),
        }
      }),
    ),

  addSystemMessage: (content, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: `system-${Date.now()}`,
            role: 'system' as const,
            content: [{ type: 'text' as const, text: content }],
            rawText: content,
            timestamp: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      })),
    ),

  startStreamingMessage: (messageId, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: messageId,
            role: 'assistant' as const,
            content: [],
            rawText: '',
            timestamp: Date.now(),
            isStreaming: true,
          },
        ],
        streamingMessageId: messageId,
        loading: true,
        backendState: 'streaming' as AgentBackendState,
        updatedAt: Date.now(),
      })),
    ),

  appendStreamDelta: (delta, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        if (!conversation.streamingMessageId) return conversation
        return {
          ...conversation,
          messages: conversation.messages.map((msg) =>
            msg.id === conversation.streamingMessageId ? appendDeltaToMessage(msg, delta) : msg,
          ),
          updatedAt: Date.now(),
        }
      }),
    ),

  appendContentBlock: (block, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        if (!conversation.streamingMessageId) return conversation
        return {
          ...conversation,
          messages: conversation.messages.map((msg) =>
            msg.id === conversation.streamingMessageId
              ? { ...msg, content: [...msg.content, block] }
              : msg,
          ),
          updatedAt: Date.now(),
        }
      }),
    ),

  finishStreamingMessage: (conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((msg) =>
          msg.id === conversation.streamingMessageId ? { ...msg, isStreaming: false } : msg,
        ),
        streamingMessageId: null,
        loading: false,
        backendState: 'connected' as AgentBackendState,
        updatedAt: Date.now(),
      })),
    ),

  cancelStreaming: (conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((msg) =>
          msg.id === conversation.streamingMessageId ? { ...msg, isStreaming: false } : msg,
        ),
        streamingMessageId: null,
        loading: false,
        backendState: 'connected' as AgentBackendState,
        updatedAt: Date.now(),
      })),
    ),

  setBackendState: (backendState, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        backendState,
        updatedAt: Date.now(),
      })),
    ),

  setSessionId: (sessionId, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        sessionId,
        updatedAt: Date.now(),
      })),
    ),

  setLastCost: (lastCost, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        lastCost,
        updatedAt: Date.now(),
      })),
    ),

  setLoading: (loading, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        loading,
        updatedAt: Date.now(),
      })),
    ),

  setPlaywrightStatus: (playwrightStatus) => set({ playwrightStatus }),

  clearMessages: (conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        const fresh = createConversation(conversation.id)
        return {
          ...fresh,
          title: conversation.title,
          scope: conversation.scope,
        }
      }),
    ),

  addPendingConfirmation: (req) =>
    set((state) => ({
      pendingConfirmations: [...state.pendingConfirmations, req],
    })),

  removePendingConfirmation: (id) =>
    set((state) => ({
      pendingConfirmations: state.pendingConfirmations.filter((r) => r.id !== id),
    })),

  clearPendingConfirmations: () => set({ pendingConfirmations: [] }),
  setPermissionMode: (permissionMode) => set({ permissionMode }),

  setScope: (scope, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        scope,
        updatedAt: Date.now(),
      })),
    ),

  addMountedResource: (resource, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        const existing = conversation.mountedResources.some((item) => item.id === resource.id)
        return {
          ...conversation,
          mountedResources: existing
            ? conversation.mountedResources.map((item) =>
                item.id === resource.id ? resource : item,
              )
            : [...conversation.mountedResources, resource],
          updatedAt: Date.now(),
        }
      }),
    ),

  removeMountedResource: (resourceId, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        mountedResources: conversation.mountedResources.filter((item) => item.id !== resourceId),
        updatedAt: Date.now(),
      })),
    ),

  addMountedSkill: (skill, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        const existing = conversation.mountedSkills.some((item) => item.id === skill.id)
        return {
          ...conversation,
          mountedSkills: existing
            ? conversation.mountedSkills.map((item) => (item.id === skill.id ? skill : item))
            : [...conversation.mountedSkills, skill],
          updatedAt: Date.now(),
        }
      }),
    ),

  removeMountedSkill: (skillId, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        mountedSkills: conversation.mountedSkills.filter((item) => item.id !== skillId),
        updatedAt: Date.now(),
      })),
    ),

  hydrateFromWorkspaceState: (value) => {
    const next = normalizeConversationSnapshot(value)
    if (!next) return
    const active = next.conversations[next.activeConversationId]
    if (!active) return
    set({
      ...next,
      ...mirrorActive(useAgentStore.getState(), active),
    })
  },
}))

useAgentStore.subscribe((state) => {
  saveStoredConversations(state)
})
