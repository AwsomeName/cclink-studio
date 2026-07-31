import type { WorkspaceRef } from '@shared/workspace-ref'
import { workspaceRefKey } from '@shared/workspace-ref'
import type { AgentMessage } from '../../types'
import {
  DEFAULT_AGENT_PROFILE_REF,
  agentProfileRefsEqual,
  type AgentProfileRef,
} from '@shared/agent-profile'
import {
  createAgentConversationState,
  DEFAULT_CONVERSATION_ID,
  type AgentConversationState,
} from './conversation-state'

export interface AgentConversationCollection {
  conversations: Record<string, AgentConversationState>
  conversationOrder: string[]
  activeConversationId: string
}

const GLOBAL_WORKSPACE_ACTIVE_SLOT = '__global__'
const activeConversationByWorkspace = new Map<string, string>()

function workspaceActiveSlot(workspaceKey: string | null): string {
  return workspaceKey ?? GLOBAL_WORKSPACE_ACTIVE_SLOT
}

export function rememberWorkspaceActiveConversation(
  workspaceKey: string | null,
  conversationId: string,
): void {
  activeConversationByWorkspace.set(workspaceActiveSlot(workspaceKey), conversationId)
}

export function resetAgentWorkspaceActiveConversationMemoryForTests(): void {
  activeConversationByWorkspace.clear()
}

export function normalizeConversationSnapshot(
  value: unknown,
  workspaceRef?: WorkspaceRef,
): AgentConversationCollection | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as {
    conversations?: Record<string, AgentConversationState>
    conversationOrder?: string[]
    activeConversationId?: string
  }
  if (!parsed.conversations || !parsed.conversationOrder) return null
  if (parsed.conversationOrder.length === 0) {
    const fresh = createAgentConversationState(DEFAULT_CONVERSATION_ID)
    return {
      conversations: { [DEFAULT_CONVERSATION_ID]: fresh },
      conversationOrder: [DEFAULT_CONVERSATION_ID],
      activeConversationId: DEFAULT_CONVERSATION_ID,
    }
  }

  const conversations: Record<string, AgentConversationState> = {}
  for (const [index, id] of parsed.conversationOrder.entries()) {
    const conversation = parsed.conversations[id]
    if (!conversation) continue
    const persistedFingerprint = normalizeSessionCompatibilityFingerprint(
      conversation.sessionCompatibilityFingerprint,
    )
    const invalidPersistedSession =
      hasTerminalSdkSessionFailure(conversation.messages) ||
      (Boolean(conversation.sessionId) && !persistedFingerprint)
    const awaitingRuntimeReconciliation =
      conversation.runStatus === 'starting' ||
      conversation.runStatus === 'running' ||
      (conversation.loading === true &&
        Boolean(conversation.activeRunId || conversation.streamingMessageId))
    const updatedAt = Number.isFinite(conversation.updatedAt)
      ? conversation.updatedAt
      : Date.now() + index
    const createdAt = Number.isFinite(conversation.createdAt) ? conversation.createdAt : updatedAt
    conversations[id] = {
      ...conversation,
      createdAt,
      updatedAt,
      surface: conversation.surface ?? 'assistant-panel',
      runtime: conversation.runtime ?? {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
      },
      profileRef: normalizeAgentProfileRef(conversation.profileRef),
      archivedAt: conversation.archivedAt ?? null,
      mountedResources: Array.isArray(conversation.mountedResources)
        ? conversation.mountedResources
        : [],
      pendingImages: [],
      mountedSkills: Array.isArray(conversation.mountedSkills) ? conversation.mountedSkills : [],
      sessionId: invalidPersistedSession ? null : (conversation.sessionId ?? null),
      sessionCompatibilityFingerprint: invalidPersistedSession ? null : persistedFingerprint,
      contextUsage: invalidPersistedSession ? null : (conversation.contextUsage ?? null),
      contextCompaction: conversation.contextCompaction ?? {
        status: 'idle',
        trigger: null,
        preTokens: null,
        postTokens: null,
        error: null,
        updatedAt: null,
      },
      loading: awaitingRuntimeReconciliation,
      backendState: awaitingRuntimeReconciliation ? 'connecting' : 'disconnected',
      runStatus: conversation.runStatus ?? 'idle',
      activeRunId: awaitingRuntimeReconciliation ? (conversation.activeRunId ?? null) : null,
      lastRunEventAt: conversation.lastRunEventAt ?? conversation.updatedAt ?? null,
      lastRunTerminalReason: awaitingRuntimeReconciliation
        ? null
        : (conversation.lastRunTerminalReason ?? null),
      streamingMessageId: awaitingRuntimeReconciliation
        ? (conversation.streamingMessageId ?? null)
        : null,
      input: '',
      messages: Array.isArray(conversation.messages)
        ? conversation.messages.map((message) => ({
            ...message,
            isStreaming: awaitingRuntimeReconciliation && message.isStreaming === true,
          }))
        : createAgentConversationState(id).messages,
    }
    if (workspaceRef) {
      conversations[id].runtime = { ...conversations[id].runtime, workspaceRef }
    }
  }

  const order = parsed.conversationOrder
    .filter((id) => conversations[id])
    .map((id, index) => ({ id, index }))
    .sort(
      (a, b) => conversations[a.id].createdAt - conversations[b.id].createdAt || a.index - b.index,
    )
    .map(({ id }) => id)
  if (!order.length) return null
  let activeConversationId =
    parsed.activeConversationId &&
    conversations[parsed.activeConversationId] &&
    !conversations[parsed.activeConversationId].archivedAt
      ? parsed.activeConversationId
      : order.find((id) => !conversations[id].archivedAt)

  if (!activeConversationId) {
    const fresh = createAgentConversationState(undefined, { workspaceRef })
    conversations[fresh.id] = fresh
    order.push(fresh.id)
    activeConversationId = fresh.id
  }

  return { conversations, conversationOrder: order, activeConversationId }
}

function normalizeSessionCompatibilityFingerprint(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
}

function normalizeAgentProfileRef(value: unknown): AgentProfileRef {
  if (!value || typeof value !== 'object') return DEFAULT_AGENT_PROFILE_REF
  const candidate = value as { profileId?: unknown; version?: unknown }
  if (
    typeof candidate.profileId !== 'string' ||
    !candidate.profileId.trim() ||
    !Number.isInteger(candidate.version) ||
    Number(candidate.version) <= 0
  ) {
    return DEFAULT_AGENT_PROFILE_REF
  }
  return {
    profileId: candidate.profileId.trim(),
    version: Number(candidate.version),
  }
}

function hasTerminalSdkSessionFailure(messages: AgentMessage[] | undefined): boolean {
  if (!Array.isArray(messages)) return false
  let latestAssistantAt = -1
  let latestPoisonedSessionAt = -1

  for (const message of messages) {
    if (message.role === 'assistant') {
      latestAssistantAt = Math.max(latestAssistantAt, message.timestamp)
      continue
    }
    if (
      message.role === 'system' &&
      /reached maximum budget|invalid_request_error|api error:\s*400[\s\S]*invalid request/i.test(
        message.rawText,
      )
    ) {
      latestPoisonedSessionAt = Math.max(latestPoisonedSessionAt, message.timestamp)
    }
  }

  return latestPoisonedSessionAt > latestAssistantAt
}

export function conversationWorkspaceKey(conversation: AgentConversationState): string | null {
  return conversation.runtime.workspaceRef
    ? workspaceRefKey(conversation.runtime.workspaceRef)
    : null
}

export function mergeWorkspaceConversationSnapshot(
  state: AgentConversationCollection,
  incoming: AgentConversationCollection,
  workspaceRef: WorkspaceRef,
): AgentConversationCollection {
  const targetWorkspaceKey = workspaceRefKey(workspaceRef)
  const currentWorkspaceConversations = Object.values(state.conversations).filter(
    (conversation) =>
      !isInitialSeedConversation(conversation) &&
      conversationWorkspaceKey(conversation) === targetWorkspaceKey,
  )
  const mergedTargetConversations = { ...incoming.conversations }

  for (const conversation of currentWorkspaceConversations) {
    const restored = mergedTargetConversations[conversation.id]
    if (!restored || conversation.loading || conversation.updatedAt >= restored.updatedAt) {
      mergedTargetConversations[conversation.id] = conversation
    }
  }

  if (Object.keys(mergedTargetConversations).length === 0) {
    const fresh = createAgentConversationState(undefined, { workspaceRef })
    mergedTargetConversations[fresh.id] = fresh
    incoming = {
      conversations: mergedTargetConversations,
      conversationOrder: [fresh.id],
      activeConversationId: fresh.id,
    }
  }

  const otherConversations = Object.fromEntries(
    Object.entries(state.conversations).filter(
      ([, conversation]) => conversationWorkspaceKey(conversation) !== targetWorkspaceKey,
    ),
  )
  const conversations = { ...otherConversations, ...mergedTargetConversations }
  const activeConversationId =
    mergedTargetConversations[incoming.activeConversationId] &&
    !mergedTargetConversations[incoming.activeConversationId].archivedAt
      ? incoming.activeConversationId
      : (Object.values(mergedTargetConversations)
          .filter((conversation) => !conversation.archivedAt)
          .sort((a, b) => b.createdAt - a.createdAt)[0]?.id ??
        Object.values(mergedTargetConversations)[0].id)
  const conversationOrder = Object.values(conversations)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((conversation) => conversation.id)

  return { conversations, conversationOrder, activeConversationId }
}

export function isInitialSeedConversation(conversation: AgentConversationState): boolean {
  const onlyMessage = conversation.messages.length === 1 ? conversation.messages[0] : null
  return (
    conversation.id === DEFAULT_CONVERSATION_ID &&
    conversation.title === '新会话' &&
    !conversation.archivedAt &&
    !conversation.sessionId &&
    conversation.lastCost === null &&
    conversation.input === '' &&
    conversation.mountedResources.length === 0 &&
    conversation.mountedSkills.length === 0 &&
    agentProfileRefsEqual(conversation.profileRef, DEFAULT_AGENT_PROFILE_REF) &&
    onlyMessage?.id === 'welcome' &&
    onlyMessage.role === 'assistant'
  )
}

export function buildAgentConversationWorkspaceSnapshot(
  state: AgentConversationCollection,
  workspaceKey: string | null,
): {
  conversations: Record<string, AgentConversationState>
  conversationOrder: string[]
  activeConversationId: string | null
} {
  const conversations: Record<string, AgentConversationState> = {}
  const ids = state.conversationOrder.filter((id) => {
    const conversation = state.conversations[id]
    return conversation && conversationWorkspaceKey(conversation) === workspaceKey
  })

  for (const id of ids.slice(-20)) {
    const conversation = state.conversations[id]
    if (!conversation) continue
    conversations[id] = {
      ...conversation,
      loading: false,
      backendState: conversation.loading ? 'connected' : conversation.backendState,
      streamingMessageId: null,
      input: '',
      pendingImages: [],
      messages: conversation.messages.map((message) => ({ ...message, isStreaming: false })),
    }
  }

  const conversationOrder = Object.keys(conversations)
  const currentActiveConversationId =
    conversations[state.activeConversationId] &&
    !conversations[state.activeConversationId].archivedAt
      ? state.activeConversationId
      : null
  if (currentActiveConversationId) {
    rememberWorkspaceActiveConversation(workspaceKey, currentActiveConversationId)
  }
  const rememberedActiveConversationId = activeConversationByWorkspace.get(
    workspaceActiveSlot(workspaceKey),
  )
  const activeConversationId =
    currentActiveConversationId ??
    (rememberedActiveConversationId &&
    conversations[rememberedActiveConversationId] &&
    !conversations[rememberedActiveConversationId].archivedAt
      ? rememberedActiveConversationId
      : (conversationOrder.find((id) => !conversations[id].archivedAt) ??
        conversationOrder[0] ??
        null))

  return { conversations, conversationOrder, activeConversationId }
}
