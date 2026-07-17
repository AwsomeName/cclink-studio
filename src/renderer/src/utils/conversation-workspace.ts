import type { WorkspaceRef } from '@shared/workspace-ref'
import { globalWorkspaceRef, localWorkspaceRef, workspaceRefKey } from '@shared/workspace-ref'

const LEGACY_DEFAULT_CONVERSATION_ID = 'agent-default'

export function workspaceRefFromKey(workspaceKey: string | null | undefined): WorkspaceRef {
  return workspaceKey ? localWorkspaceRef(workspaceKey) : globalWorkspaceRef()
}

export function scopeLegacyConversationId(
  conversationId: string,
  workspaceRef: WorkspaceRef,
): string {
  if (conversationId !== LEGACY_DEFAULT_CONVERSATION_ID) return conversationId
  return `${LEGACY_DEFAULT_CONVERSATION_ID}-${stableWorkspaceHash(workspaceRefKey(workspaceRef))}`
}

export function scopeWorkspaceAgentSnapshot(
  value: unknown,
  workspaceRef: WorkspaceRef,
): { value: unknown; conversationIdMap: Map<string, string> } {
  const conversationIdMap = new Map<string, string>()
  if (!value || typeof value !== 'object') return { value, conversationIdMap }

  const parsed = value as {
    conversations?: Record<string, unknown>
    conversationOrder?: unknown
    activeConversationId?: unknown
  }
  if (!parsed.conversations || typeof parsed.conversations !== 'object') {
    return { value, conversationIdMap }
  }

  const conversations: Record<string, unknown> = {}
  for (const [id, rawConversation] of Object.entries(parsed.conversations)) {
    const conversation =
      rawConversation && typeof rawConversation === 'object'
        ? (rawConversation as Record<string, unknown>)
        : {}
    const runtime =
      conversation.runtime && typeof conversation.runtime === 'object'
        ? (conversation.runtime as Record<string, unknown>)
        : {}
    if (!isRuntimeCompatibleWithWorkspace(runtime, workspaceRef)) continue
    const scopedId = scopeLegacyConversationId(id, workspaceRef)
    conversationIdMap.set(id, scopedId)
    conversations[scopedId] = {
      ...conversation,
      id: scopedId,
      runtime: {
        ...runtime,
        workspaceRef,
      },
    }
  }

  const conversationOrder = Array.isArray(parsed.conversationOrder)
    ? parsed.conversationOrder
        .filter((id): id is string => typeof id === 'string')
        .flatMap((id) => {
          const scopedId = conversationIdMap.get(id)
          return scopedId ? [scopedId] : []
        })
    : []
  const activeConversationId =
    typeof parsed.activeConversationId === 'string'
      ? (conversationIdMap.get(parsed.activeConversationId) ?? null)
      : parsed.activeConversationId

  return {
    value: {
      ...parsed,
      conversations,
      conversationOrder,
      activeConversationId,
    },
    conversationIdMap,
  }
}

export function scopeWorkspaceTabSnapshot(
  value: unknown,
  conversationIdMap: ReadonlyMap<string, string>,
  workspaceRef: WorkspaceRef,
): unknown {
  if (!value || typeof value !== 'object') return value
  const parsed = value as { tabs?: unknown[]; activeTabId?: unknown }
  if (!Array.isArray(parsed.tabs)) return value

  const tabs = parsed.tabs.flatMap((rawTab) => {
    if (!rawTab || typeof rawTab !== 'object') return []
    const tab = rawTab as Record<string, unknown>
    if (!isTabCompatibleWithWorkspace(tab, workspaceRef)) return []

    const nextTab: Record<string, unknown> =
      tab.type === 'settings' ? { ...tab } : { ...tab, workspaceRef }

    if (tab.type === 'conversation' && tab.conversation && typeof tab.conversation === 'object') {
      const conversation = tab.conversation as Record<string, unknown>
      const runtime =
        conversation.runtime && typeof conversation.runtime === 'object'
          ? (conversation.runtime as Record<string, unknown>)
          : {}
      const sessionId =
        typeof conversation.sessionId === 'string'
          ? (conversationIdMap.get(conversation.sessionId) ?? conversation.sessionId)
          : conversation.sessionId
      nextTab.conversation = {
        ...conversation,
        runtime: { ...runtime, workspaceRef },
        sessionId,
      }
    }

    return [nextTab]
  })
  const activeTabId =
    typeof parsed.activeTabId === 'string' && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : ((tabs[0]?.id as string | undefined) ?? null)

  return {
    ...parsed,
    tabs,
    activeTabId,
  }
}

export function scopeWorkspaceBrowserSnapshot(value: unknown, tabsSnapshot: unknown): unknown {
  if (!value || typeof value !== 'object') return { tabs: {} }
  const parsed = value as { tabs?: Record<string, unknown> }
  const tabState =
    tabsSnapshot && typeof tabsSnapshot === 'object'
      ? (tabsSnapshot as { tabs?: Array<{ id?: unknown; type?: unknown }> })
      : {}
  const allowedIds = new Set(
    Array.isArray(tabState.tabs)
      ? tabState.tabs.flatMap((tab) =>
          tab?.type === 'browser' && typeof tab.id === 'string' ? [tab.id] : [],
        )
      : [],
  )
  const tabs =
    parsed.tabs && typeof parsed.tabs === 'object'
      ? Object.fromEntries(Object.entries(parsed.tabs).filter(([tabId]) => allowedIds.has(tabId)))
      : {}
  return { ...parsed, tabs }
}

export function scopeWorkspaceEditorDraftSnapshot(
  value: unknown,
  workspaceRef: WorkspaceRef,
): unknown {
  if (!value || typeof value !== 'object') return { files: {} }
  const parsed = value as { files?: Record<string, unknown> }
  if (!parsed.files || typeof parsed.files !== 'object' || workspaceRef.kind !== 'local') {
    return value
  }
  const files = Object.fromEntries(
    Object.entries(parsed.files).filter(
      ([fileKey]) => fileKey.startsWith('virtual:') || isPathInside(fileKey, workspaceRef.path),
    ),
  )
  return { ...parsed, files }
}

function isTabCompatibleWithWorkspace(
  tab: Record<string, unknown>,
  workspaceRef: WorkspaceRef,
): boolean {
  if (tab.type === 'settings') return true
  if (tab.workspaceRef && typeof tab.workspaceRef === 'object') {
    const existingKey = workspaceRefKey(tab.workspaceRef as WorkspaceRef)
    if (existingKey !== workspaceRefKey(workspaceRef)) return false
  }
  if (workspaceRef.kind !== 'local') return true
  if (tab.type === 'browser' && !tab.workspaceRef) return false

  if (typeof tab.filePath === 'string' && !isPathInside(tab.filePath, workspaceRef.path)) {
    return false
  }
  if (tab.hardwareGerber && typeof tab.hardwareGerber === 'object') {
    const workspacePath = (tab.hardwareGerber as { workspacePath?: unknown }).workspacePath
    if (typeof workspacePath === 'string' && workspacePath !== workspaceRef.path) return false
  }
  if (tab.conversation && typeof tab.conversation === 'object') {
    const runtime = (tab.conversation as { runtime?: unknown }).runtime
    if (
      runtime &&
      typeof runtime === 'object' &&
      !isRuntimeCompatibleWithWorkspace(runtime as Record<string, unknown>, workspaceRef)
    ) {
      return false
    }
  }
  for (const key of ['terminal', 'terminalRecord'] as const) {
    const value = tab[key]
    if (!value || typeof value !== 'object') continue
    const runtime = (value as { runtime?: unknown }).runtime
    if (!runtime || typeof runtime !== 'object') continue
    const ref = (runtime as { workspaceRef?: unknown }).workspaceRef
    if (
      ref &&
      typeof ref === 'object' &&
      workspaceRefKey(ref as WorkspaceRef) !== workspaceRef.path
    ) {
      return false
    }
  }
  return true
}

function isRuntimeCompatibleWithWorkspace(
  runtime: Record<string, unknown>,
  workspaceRef: WorkspaceRef,
): boolean {
  const existingRef = runtime.workspaceRef
  return (
    !existingRef ||
    typeof existingRef !== 'object' ||
    workspaceRefKey(existingRef as WorkspaceRef) === workspaceRefKey(workspaceRef)
  )
}

function isPathInside(filePath: string, workspacePath: string): boolean {
  const root = workspacePath.replace(/\/+$/, '')
  return filePath === root || filePath.startsWith(`${root}/`)
}

function stableWorkspaceHash(workspaceKey: string | null): string {
  const value = workspaceKey ?? 'global'
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
