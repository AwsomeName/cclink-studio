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
import type { WorkspaceRef } from '@shared/workspace-ref'
import type { AgentContextUsageSnapshot, AgentStatus } from '@shared/agent-protocol'
import type { AgentImageAttachment } from '@shared/ipc/agent'
import type { WorkspaceStateSetSectionOptions } from '@shared/ipc/workspace-state'
import {
  agentRoleRefsEqual,
  type AgentRoleRef,
  type AgentRunConfigurationReceipt,
} from '@shared/agent-role'
import { workspaceRefKey } from '@shared/workspace-ref'
import {
  isWorkspaceStateRestoring,
  persistWorkspaceSection,
  persistWorkspaceSectionNow,
} from '../utils/workspace-state'
import {
  createAgentConversationState,
  DEFAULT_CONVERSATION_ID,
  type AgentContextCompactionState,
  type AgentConversationState,
  type AgentRunStatus,
  type AgentRunTerminalReason,
} from '../features/agent-conversations/conversation-state'
import {
  buildAgentConversationWorkspaceSnapshot,
  conversationWorkspaceKey,
  isInitialSeedConversation,
  mergeWorkspaceConversationSnapshot,
  normalizeConversationSnapshot,
  rememberWorkspaceActiveConversation,
} from '../features/agent-conversations/conversation-workspace-state'
import { useSettingsStore } from './settings-store'
import { recordRendererDiagnosticLog } from '../features/diagnostics/renderer-diagnostic-log'

export type {
  AgentContextCompactionState,
  AgentConversationState,
  AgentRunStatus,
  AgentRunTerminalReason,
} from '../features/agent-conversations/conversation-state'
export {
  buildAgentConversationWorkspaceSnapshot,
  resetAgentWorkspaceActiveConversationMemoryForTests,
} from '../features/agent-conversations/conversation-workspace-state'

function rebaseResourcePath(
  path: string | undefined,
  oldPrefix: string,
  newPrefix: string,
): string | undefined {
  if (!path) return path
  if (path === oldPrefix) return newPrefix
  if (path.startsWith(oldPrefix + '/')) return newPrefix + path.slice(oldPrefix.length)
  return path
}

interface AgentState {
  /** 会话列表（按 conversationOrder 展示） */
  conversations: Record<string, AgentConversationState>
  conversationOrder: string[]
  activeConversationId: string

  /** 当前活跃会话快照 */
  messages: AgentMessage[]
  input: string
  loading: boolean
  backendState: AgentBackendState
  sessionId: string | null
  streamingMessageId: string | null
  lastCost: number | null
  contextUsage: AgentContextUsageSnapshot | null
  contextCompaction: AgentContextCompactionState
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
    roleRef?: AgentRoleRef
    input?: string
    mountedResources?: AgentMountedResource[]
    mountedSkills?: AgentMountedSkill[]
  }) => string
  switchConversation: (id: string) => void
  closeConversation: (id: string) => void
  archiveConversation: (id: string) => Promise<void>
  restoreArchivedConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => void
  markAsWorkConversation: (id: string, runtime: ConversationRuntimeRef) => void
  applyRoleToConversation: (roleRef: AgentRoleRef, conversationId?: string) => Promise<boolean>
  setRunConfigurationReceipt: (receipt: AgentRunConfigurationReceipt) => boolean

  // --- 当前/指定会话 Actions ---
  setInput: (text: string, conversationId?: string) => void
  addUserMessage: (
    content: string,
    conversationId?: string,
    resources?: AgentMountedResource[],
  ) => void
  addSystemMessage: (content: string, conversationId?: string) => void
  beginRun: (conversationId?: string) => string
  startStreamingMessage: (messageId: string, conversationId?: string, runId?: string) => void
  stopStreamingMessage: (conversationId?: string) => void
  appendStreamDelta: (delta: string, conversationId?: string) => void
  appendContentBlock: (block: ContentBlock, conversationId?: string) => void
  finishStreamingMessage: (conversationId?: string, runId?: string) => void
  cancelStreaming: (
    conversationId?: string,
    reason?: AgentRunTerminalReason,
    runId?: string,
  ) => void
  setBackendState: (state: AgentBackendState, conversationId?: string) => void
  setSessionId: (
    id: string | null,
    conversationId?: string,
    sessionCompatibilityFingerprint?: string | null,
  ) => void
  setLastCost: (cost: number, conversationId?: string) => void
  setContextUsage: (usage: AgentContextUsageSnapshot | null, conversationId?: string) => void
  beginContextCompaction: (conversationId?: string) => string
  setContextCompaction: (
    update: Partial<AgentContextCompactionState>,
    conversationId?: string,
  ) => void
  finishContextCompaction: (
    success: boolean,
    conversationId?: string,
    runId?: string,
    error?: string,
  ) => void
  setLoading: (loading: boolean, conversationId?: string) => void
  reconcileRuntimeStatus: (status: AgentStatus, conversationId?: string) => void
  setPlaywrightStatus: (status: PlaywrightStatus) => void
  clearMessages: (conversationId?: string) => Promise<void>
  addPendingConfirmation: (req: ToolConfirmationRequest) => void
  removePendingConfirmation: (id: string) => void
  clearPendingConfirmations: () => void
  setPermissionMode: (mode: PermissionMode) => void
  setScope: (scope: AgentScope, conversationId?: string) => void
  addMountedResource: (resource: AgentMountedResource, conversationId?: string) => void
  removeMountedResource: (resourceId: string, conversationId?: string) => void
  addPendingImages: (images: AgentImageAttachment[], conversationId?: string) => void
  removePendingImage: (imageId: string, conversationId?: string) => void
  rebaseMountedResourcePaths: (oldPrefix: string, newPrefix: string) => void
  clearTransientResources: (conversationId?: string) => void
  addMountedSkill: (skill: AgentMountedSkill, conversationId?: string) => void
  removeMountedSkill: (skillId: string, conversationId?: string) => void
  hydrateFromWorkspaceState: (
    value: unknown,
    options?: { workspaceRef?: WorkspaceRef; merge?: boolean },
  ) => void
}

function createConversation(
  id?: string,
  options: Parameters<typeof createAgentConversationState>[1] = {},
): AgentConversationState {
  return createAgentConversationState(id, {
    ...options,
    roleRef: options.roleRef ?? useSettingsStore.getState().settings.defaultAgentRoleRef,
  })
}

function resolveRuntimeSession(
  conversation: AgentConversationState,
  status: AgentStatus,
): Pick<AgentConversationState, 'sessionId' | 'sessionCompatibilityFingerprint'> {
  const statusFingerprint = status.sessionCompatibilityFingerprint
  if (status.sessionId) {
    return {
      sessionId: status.sessionId,
      sessionCompatibilityFingerprint: statusFingerprint ?? null,
    }
  }
  if (statusFingerprint === undefined) {
    return {
      sessionId: conversation.sessionId,
      sessionCompatibilityFingerprint: conversation.sessionCompatibilityFingerprint ?? null,
    }
  }
  if (
    conversation.sessionId &&
    statusFingerprint &&
    conversation.sessionCompatibilityFingerprint === statusFingerprint
  ) {
    return {
      sessionId: conversation.sessionId,
      sessionCompatibilityFingerprint: statusFingerprint,
    }
  }
  return {
    sessionId: null,
    sessionCompatibilityFingerprint: statusFingerprint ?? null,
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
    contextUsage: conversation.contextUsage,
    contextCompaction: conversation.contextCompaction,
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
  const current = state.conversations[id]
  if (!current) return state

  const nextOrder = state.conversationOrder.filter((item) => item !== id)
  const { [id]: _removed, ...rest } = state.conversations
  const fallbackId =
    state.activeConversationId === id
      ? findWorkspaceFallbackConversation(nextOrder, rest, current)
      : state.activeConversationId
  const fallback = fallbackId ? rest[fallbackId] : null

  if (!fallback || fallback.archivedAt) {
    const fresh = createConversation(undefined, {
      surface: 'assistant-panel',
      runtime: current.runtime,
    })
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

function findWorkspaceFallbackConversation(
  order: string[],
  conversations: Record<string, AgentConversationState>,
  source: AgentConversationState,
): string | undefined {
  const workspaceKey = conversationWorkspaceKey(source)
  return [...order].reverse().find((item) => {
    const candidate = conversations[item]
    if (!candidate) return false
    return (
      !candidate.archivedAt &&
      candidate.surface === 'assistant-panel' &&
      conversationWorkspaceKey(candidate) === workspaceKey
    )
  })
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
const initialConversationState = {
  conversations: { [DEFAULT_CONVERSATION_ID]: initialConversation },
  conversationOrder: [DEFAULT_CONVERSATION_ID],
  activeConversationId: DEFAULT_CONVERSATION_ID,
}
const initialActiveConversation = initialConversation
const lastTrimmedConversationCountByWorkspace = new Map<string, number>()

function saveStoredConversations(state: AgentState): void {
  try {
    if (isWorkspaceStateRestoring()) return
    const workspaceKeys = new Set(
      Object.values(state.conversations).map((conversation) =>
        conversationWorkspaceKey(conversation),
      ),
    )

    for (const workspaceKey of workspaceKeys) {
      const payload = buildAgentConversationWorkspaceSnapshot(state, workspaceKey)
      const workspaceConversationCount = state.conversationOrder.filter((id) => {
        const conversation = state.conversations[id]
        return conversation && conversationWorkspaceKey(conversation) === workspaceKey
      }).length
      if (
        workspaceConversationCount > payload.conversationOrder.length &&
        lastTrimmedConversationCountByWorkspace.get(workspaceKey ?? '__global__') !==
          workspaceConversationCount
      ) {
        lastTrimmedConversationCountByWorkspace.set(
          workspaceKey ?? '__global__',
          workspaceConversationCount,
        )
        recordRendererDiagnosticLog('warn', [
          '[ConversationPersistence] snapshot-trimmed',
          {
            workspaceKind: workspaceKey ? 'local' : 'global',
            inMemoryConversationCount: workspaceConversationCount,
            persistedConversationCount: payload.conversationOrder.length,
          },
        ])
      }
      if (
        payload.conversationOrder.length === 1 &&
        isInitialSeedConversation(payload.conversations[payload.conversationOrder[0]])
      ) {
        continue
      }
      persistWorkspaceSection('agentConversations', payload, workspaceKey)
    }
  } catch {
    // WorkspaceState 镜像失败不应影响当前会话状态。
  }
}

async function persistConversationWorkspace(conversationId: string): Promise<void> {
  const state = useAgentStore.getState()
  const conversation = state.conversations[conversationId]
  if (!conversation) return
  const workspaceKey = conversationWorkspaceKey(conversation)
  await persistWorkspaceSectionNow(
    'agentConversations',
    buildAgentConversationWorkspaceSnapshot(state, workspaceKey),
    workspaceKey,
  )
}

async function persistConversationWorkspaceByKey(
  workspaceKey: string | null,
  options?: WorkspaceStateSetSectionOptions,
): Promise<void> {
  const state = useAgentStore.getState()
  await persistWorkspaceSectionNow(
    'agentConversations',
    buildAgentConversationWorkspaceSnapshot(state, workspaceKey),
    workspaceKey,
    undefined,
    options,
  )
}

/** 退出前生成最终会话快照，并等待 renderer 写队列真正排空。 */
export async function flushAgentConversationWorkspaceState(): Promise<void> {
  if (isWorkspaceStateRestoring()) return
  const state = useAgentStore.getState()
  const workspaceKeys = new Set(
    Object.values(state.conversations).map((conversation) =>
      conversationWorkspaceKey(conversation),
    ),
  )
  await Promise.all(
    Array.from(workspaceKeys).map((workspaceKey) =>
      persistConversationWorkspaceByKey(workspaceKey),
    ),
  )
}

export const useAgentStore = create<AgentState>((set, get) => ({
  // 会话恢复以 WorkspaceState 为权威，避免全局 localStorage 把其他项目会话作为启动种子。
  conversations: initialConversationState.conversations,
  conversationOrder: initialConversationState.conversationOrder,
  activeConversationId: initialConversationState.activeConversationId,
  messages: initialActiveConversation.messages,
  input: initialActiveConversation.input,
  loading: initialActiveConversation.loading,
  backendState: initialActiveConversation.backendState,
  sessionId: initialActiveConversation.sessionId,
  streamingMessageId: initialActiveConversation.streamingMessageId,
  lastCost: initialActiveConversation.lastCost,
  contextUsage: initialActiveConversation.contextUsage,
  contextCompaction: initialActiveConversation.contextCompaction,
  scope: initialActiveConversation.scope,
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

  archiveConversation: async (id) => {
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

      const fallbackId = findWorkspaceFallbackConversation(
        state.conversationOrder,
        conversations,
        current,
      )
      const fallback = fallbackId ? conversations[fallbackId] : null

      if (fallback) {
        return {
          conversations,
          activeConversationId: fallbackId,
          ...mirrorActive(state, fallback),
        }
      }

      const fresh = createConversation(undefined, {
        surface: 'assistant-panel',
        runtime: current.runtime,
      })
      return {
        conversations: {
          ...conversations,
          [fresh.id]: fresh,
        },
        conversationOrder: [...state.conversationOrder, fresh.id],
        activeConversationId: fresh.id,
        ...mirrorActive(state, fresh),
      }
    })
    await persistConversationWorkspace(id)
  },

  restoreArchivedConversation: async (id) => {
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
    })
    await persistConversationWorkspace(id)
  },

  deleteConversation: async (id) => {
    const conversation = get().conversations[id]
    if (!conversation) return
    const workspaceKey = conversationWorkspaceKey(conversation)
    set((state) => removeConversation(state, id))
    await persistConversationWorkspaceByKey(workspaceKey, {
      conversationHistoryMutation: { type: 'delete-conversation', conversationId: id },
    })
  },

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
            !conversations[item]?.archivedAt &&
            conversationWorkspaceKey(conversations[item]) === conversationWorkspaceKey(promoted),
        )
      const fallback = fallbackId ? conversations[fallbackId] : null
      if (fallback) {
        return {
          conversations,
          activeConversationId: fallbackId,
          ...mirrorActive(state, fallback),
        }
      }

      const fresh = createConversation(undefined, {
        surface: 'assistant-panel',
        runtime: promoted.runtime,
      })
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

  applyRoleToConversation: async (roleRef, conversationId) => {
    const id = resolveConversationId(get(), conversationId)
    const previous = get().conversations[id]
    if (!previous) return false
    if (agentRoleRefsEqual(previous.configuration.roleRef, roleRef)) return true

    const now = Date.now()
    const revision = previous.configuration.revision + 1
    set((state) =>
      updateConversation(state, id, (conversation) => ({
        ...conversation,
        configuration: {
          schemaVersion: 1,
          roleRef: { ...roleRef },
          revision,
          updatedAt: now,
        },
        configurationEvents: [
          ...conversation.configurationEvents,
          {
            id: `configuration-${now}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'configuration-changed',
            fromRoleRef: conversation.configuration.roleRef,
            toRoleRef: { ...roleRef },
            configurationRevision: revision,
            timestamp: now,
          },
        ],
        lastRunConfigurationReceipt: null,
        sessionId: null,
        sessionCompatibilityFingerprint: null,
        contextUsage: null,
        updatedAt: now,
      })),
    )

    try {
      await persistConversationWorkspace(id)
      return true
    } catch {
      set((state) =>
        updateConversation(state, id, (conversation) => {
          if (conversation.configuration.revision !== revision) return conversation
          return {
            ...conversation,
            configuration: previous.configuration,
            configurationEvents: previous.configurationEvents,
            lastRunConfigurationReceipt: previous.lastRunConfigurationReceipt,
            sessionId: previous.sessionId,
            sessionCompatibilityFingerprint: previous.sessionCompatibilityFingerprint,
            contextUsage: previous.contextUsage,
            updatedAt: Date.now(),
          }
        }),
      )
      return false
    }
  },

  setRunConfigurationReceipt: (receipt) => {
    const conversation = get().conversations[receipt.conversationId]
    if (
      !conversation ||
      conversation.configuration.revision !== receipt.configurationRevision ||
      !agentRoleRefsEqual(conversation.configuration.roleRef, receipt.roleRef)
    ) {
      return false
    }
    set((state) =>
      updateConversation(state, receipt.conversationId, (current) => ({
        ...current,
        lastRunConfigurationReceipt: receipt,
        updatedAt: Date.now(),
      })),
    )
    return true
  },

  setInput: (text, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        input: text,
        updatedAt: Date.now(),
      })),
    ),

  addUserMessage: (content, conversationId, resources) =>
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
            ...(resources?.length ? { resources } : {}),
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

  beginRun: (conversationId) => {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        loading: true,
        backendState: 'connecting' as AgentBackendState,
        runStatus: 'starting',
        activeRunId: runId,
        lastRunEventAt: now,
        lastRunTerminalReason: null,
        updatedAt: now,
      })),
    )
    return runId
  },

  startStreamingMessage: (messageId, conversationId, runId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages.map((message) =>
            message.isStreaming ? { ...message, isStreaming: false } : message,
          ),
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
        runStatus: 'running',
        activeRunId: runId ?? conversation.activeRunId ?? null,
        lastRunEventAt: Date.now(),
        updatedAt: Date.now(),
      })),
    ),

  stopStreamingMessage: (conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === conversation.streamingMessageId
            ? { ...message, isStreaming: false }
            : message,
        ),
        lastRunEventAt: Date.now(),
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
          lastRunEventAt: Date.now(),
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
          lastRunEventAt: Date.now(),
          updatedAt: Date.now(),
        }
      }),
    ),

  finishStreamingMessage: (conversationId, runId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        if (runId && conversation.activeRunId && conversation.activeRunId !== runId) {
          return conversation
        }
        const now = Date.now()
        return {
          ...conversation,
          messages: conversation.messages.map((msg) =>
            msg.isStreaming ? { ...msg, isStreaming: false } : msg,
          ),
          streamingMessageId: null,
          loading: false,
          backendState: 'connected' as AgentBackendState,
          runStatus: 'completed',
          activeRunId: null,
          lastRunEventAt: now,
          lastRunTerminalReason: 'completed',
          updatedAt: now,
        }
      }),
    ),

  cancelStreaming: (conversationId, reason = 'cancelled', runId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        if (runId && conversation.activeRunId && conversation.activeRunId !== runId) {
          return conversation
        }
        const failed = reason === 'error' || reason === 'stream-ended'
        const now = Date.now()
        return {
          ...conversation,
          messages: conversation.messages.map((msg) =>
            msg.isStreaming ? { ...msg, isStreaming: false } : msg,
          ),
          streamingMessageId: null,
          loading: false,
          backendState: failed ? 'error' : ('connected' as AgentBackendState),
          runStatus: failed ? 'failed' : 'cancelled',
          activeRunId: null,
          lastRunEventAt: now,
          lastRunTerminalReason: reason,
          updatedAt: now,
        }
      }),
    ),

  setBackendState: (backendState, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        backendState,
        ...(backendState === 'error'
          ? {
              runStatus: 'failed' as AgentRunStatus,
              activeRunId: null,
              lastRunTerminalReason:
                conversation.lastRunTerminalReason ?? ('error' as AgentRunTerminalReason),
            }
          : {}),
        updatedAt: Date.now(),
      })),
    ),

  setSessionId: (sessionId, conversationId, sessionCompatibilityFingerprint) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        sessionId,
        sessionCompatibilityFingerprint: sessionId
          ? (sessionCompatibilityFingerprint ??
            conversation.sessionCompatibilityFingerprint ??
            null)
          : null,
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

  setContextUsage: (contextUsage, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        contextUsage,
        updatedAt: Date.now(),
      })),
    ),

  beginContextCompaction: (conversationId) => {
    const runId = `compact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        runStatus: 'running',
        activeRunId: runId,
        lastRunEventAt: now,
        lastRunTerminalReason: null,
        contextCompaction: {
          status: 'compacting',
          trigger: 'manual',
          preTokens: conversation.contextUsage?.totalTokens ?? null,
          postTokens: null,
          error: null,
          updatedAt: now,
        },
        updatedAt: now,
      })),
    )
    return runId
  },

  setContextCompaction: (update, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        contextCompaction: {
          ...conversation.contextCompaction,
          ...update,
          updatedAt: update.updatedAt ?? Date.now(),
        },
        updatedAt: Date.now(),
      })),
    ),

  finishContextCompaction: (success, conversationId, runId, error) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        if (runId && conversation.activeRunId && conversation.activeRunId !== runId) {
          return conversation
        }
        const now = Date.now()
        return {
          ...conversation,
          runStatus: success ? 'completed' : 'failed',
          activeRunId: null,
          lastRunEventAt: now,
          lastRunTerminalReason: success ? 'completed' : 'error',
          contextCompaction: {
            ...conversation.contextCompaction,
            status: success ? 'completed' : 'failed',
            error: error ?? null,
            updatedAt: now,
          },
          updatedAt: now,
        }
      }),
    ),

  setLoading: (loading, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        loading,
        updatedAt: Date.now(),
      })),
    ),

  reconcileRuntimeStatus: (status, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        const runtimeSession = resolveRuntimeSession(conversation, status)
        if (status.busy ?? status.connected) {
          return {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === conversation.streamingMessageId
                ? { ...message, isStreaming: true }
                : message,
            ),
            loading: true,
            backendState: 'streaming' as AgentBackendState,
            runStatus: conversation.runStatus === 'starting' ? 'starting' : 'running',
            activeRunId: status.runId ?? conversation.activeRunId ?? null,
            lastRunEventAt: Date.now(),
            lastRunTerminalReason: null,
            ...runtimeSession,
            updatedAt: Date.now(),
          }
        }
        const awaitingRuntimeReconciliation =
          conversation.loading ||
          conversation.runStatus === 'starting' ||
          conversation.runStatus === 'running' ||
          Boolean(conversation.activeRunId)
        if (!awaitingRuntimeReconciliation) {
          return runtimeSession.sessionId !== conversation.sessionId ||
            runtimeSession.sessionCompatibilityFingerprint !==
              (conversation.sessionCompatibilityFingerprint ?? null)
            ? { ...conversation, ...runtimeSession, updatedAt: Date.now() }
            : conversation
        }
        const terminalReason: AgentRunTerminalReason =
          status.ready === false ? 'runtime-unavailable' : 'runtime-lost'
        return {
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.isStreaming ? { ...message, isStreaming: false } : message,
          ),
          loading: false,
          backendState: status.ready === false ? 'disconnected' : 'connected',
          runStatus: 'interrupted',
          activeRunId: null,
          lastRunEventAt: Date.now(),
          lastRunTerminalReason: terminalReason,
          ...runtimeSession,
          streamingMessageId: null,
          updatedAt: Date.now(),
        }
      }),
    ),

  setPlaywrightStatus: (playwrightStatus) => set({ playwrightStatus }),

  clearMessages: async (conversationId) => {
    const id = conversationId ?? get().activeConversationId
    const conversation = get().conversations[id]
    if (!conversation) return
    const workspaceKey = conversationWorkspaceKey(conversation)
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        const fresh = createConversation(conversation.id, {
          surface: conversation.surface,
          runtime: conversation.runtime,
          roleRef: conversation.configuration.roleRef,
        })
        return {
          ...fresh,
          title: conversation.title,
          scope: conversation.scope,
        }
      }),
    )
    await persistConversationWorkspaceByKey(workspaceKey, {
      conversationHistoryMutation: { type: 'clear-messages', conversationId: id },
    })
  },

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

  addPendingImages: (images, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => {
        const next = [...(conversation.pendingImages ?? [])]
        for (const image of images) {
          const existingIndex = next.findIndex((item) => item.id === image.id)
          if (existingIndex >= 0) next[existingIndex] = image
          else if (next.length < 5) next.push(image)
        }
        return {
          ...conversation,
          pendingImages: next,
          updatedAt: Date.now(),
        }
      }),
    ),

  removePendingImage: (imageId, conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        pendingImages: (conversation.pendingImages ?? []).filter((image) => image.id !== imageId),
        updatedAt: Date.now(),
      })),
    ),

  rebaseMountedResourcePaths: (oldPrefix, newPrefix) => {
    if (oldPrefix === newPrefix) return
    set((state) => {
      let changed = false
      const conversations = Object.fromEntries(
        Object.entries(state.conversations).map(([conversationId, conversation]) => {
          let conversationChanged = false
          const mountedResources = conversation.mountedResources.map((resource) => {
            const path = rebaseResourcePath(resource.ref.path, oldPrefix, newPrefix)
            if (path === resource.ref.path) return resource
            changed = true
            conversationChanged = true
            return {
              ...resource,
              id: resource.id.includes(oldPrefix)
                ? resource.id.replace(oldPrefix, newPrefix)
                : resource.id,
              detail:
                resource.detail === resource.ref.path || resource.detail === oldPrefix
                  ? path
                  : resource.detail,
              ref: { ...resource.ref, path },
            }
          })
          return [
            conversationId,
            conversationChanged
              ? { ...conversation, mountedResources, updatedAt: Date.now() }
              : conversation,
          ]
        }),
      ) as Record<string, AgentConversationState>
      return changed ? { conversations } : state
    })
  },

  clearTransientResources: (conversationId) =>
    set((state) =>
      updateConversation(state, conversationId, (conversation) => ({
        ...conversation,
        mountedResources: conversation.mountedResources.filter(
          (resource) => resource.kind !== 'file-range',
        ),
        pendingImages: [],
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

  hydrateFromWorkspaceState: (value, options) => {
    const workspaceRef = options?.workspaceRef
    let next = normalizeConversationSnapshot(value, workspaceRef)
    if (!next && workspaceRef) {
      const fresh = createConversation(undefined, {
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef,
        },
      })
      next = {
        conversations: { [fresh.id]: fresh },
        conversationOrder: [fresh.id],
        activeConversationId: fresh.id,
      }
    }
    if (!next) return
    if (options?.merge && workspaceRef) {
      next = mergeWorkspaceConversationSnapshot(useAgentStore.getState(), next, workspaceRef)
    }
    const active = next.conversations[next.activeConversationId]
    if (!active) return
    rememberWorkspaceActiveConversation(
      workspaceRef ? workspaceRefKey(workspaceRef) : conversationWorkspaceKey(active),
      active.id,
    )
    set({
      ...next,
      ...mirrorActive(useAgentStore.getState(), active),
    })
  },
}))

useAgentStore.subscribe((state) => {
  saveStoredConversations(state)
})
