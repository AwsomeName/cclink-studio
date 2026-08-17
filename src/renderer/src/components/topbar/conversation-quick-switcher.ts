import type { AgentPanelMode } from '../../stores/ui-store'
import type { CclinkRemoteSession } from '@shared/cclink'

export const QUICK_SWITCHER_TITLE_LIMIT = 10
export const QUICK_SWITCHER_THREAD_LIMIT = 5

export interface RemoteQuickSwitcherItem {
  id: string
  title: string
  statusKind: 'running' | 'idle'
  statusLabel: '响应中' | '空闲'
  isActive: boolean
}

export function buildRemoteQuickSwitcherItems(input: {
  sessions: CclinkRemoteSession[]
  selectedSessionId: string | null
  endpointId: string
  workspaceId: string
}): RemoteQuickSwitcherItem[] {
  const sessions = input.sessions
    .filter(
      (session) =>
        session.status !== 'archived' &&
        session.serverId === input.endpointId &&
        session.workspaceId === input.workspaceId,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const activeId = sessions.some((session) => session.id === input.selectedSessionId)
    ? input.selectedSessionId
    : sessions[0]?.id
  return selectQuickSwitcherThreads(
    sessions.map((session) => ({
      id: session.id,
      title: session.name,
      statusKind: session.status === 'active' ? ('running' as const) : ('idle' as const),
      statusLabel: session.status === 'active' ? ('响应中' as const) : ('空闲' as const),
      isActive: session.id === activeId,
    })),
  )
}

export function formatQuickSwitcherTitle(title: string): string {
  const normalized = title.trim() || '新会话'
  const characters = Array.from(normalized)
  if (characters.length <= QUICK_SWITCHER_TITLE_LIMIT) return normalized
  return `${characters.slice(0, QUICK_SWITCHER_TITLE_LIMIT).join('')}…`
}

export function quickSwitcherVisibleCount(panelMode: AgentPanelMode, panelWidth: number): number {
  if (panelMode !== 'right') return 1
  if (panelWidth >= 560) return 5
  if (panelWidth >= 460) return 4
  if (panelWidth >= 360) return 3
  return 2
}

export function selectQuickSwitcherThreads<T extends { id: string; isActive: boolean }>(
  conversations: T[],
  limit = QUICK_SWITCHER_THREAD_LIMIT,
): T[] {
  if (conversations.length <= limit) return conversations
  const latest = conversations.slice(0, limit)
  if (latest.some((conversation) => conversation.isActive)) return latest

  const active = conversations.find((conversation) => conversation.isActive)
  if (!active || limit <= 0) return latest
  return [...latest.slice(0, limit - 1), active]
}

export function partitionQuickSwitcherThreads<T extends { id: string; isActive: boolean }>(
  conversations: T[],
  visibleCount: number,
): { visible: T[]; overflow: T[] } {
  if (conversations.length <= visibleCount) return { visible: conversations, overflow: [] }
  const visible = conversations.slice(0, Math.max(visibleCount, 0))
  if (!visible.some((conversation) => conversation.isActive) && visibleCount > 0) {
    const active = conversations.find((conversation) => conversation.isActive)
    if (active) visible.splice(visible.length - 1, 1, active)
  }
  const visibleIds = new Set(visible.map((conversation) => conversation.id))
  return {
    visible,
    overflow: conversations.filter((conversation) => !visibleIds.has(conversation.id)),
  }
}
