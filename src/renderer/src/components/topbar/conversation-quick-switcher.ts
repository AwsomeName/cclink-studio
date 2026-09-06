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
    // Activity updates status and content, but must not move a tab under the pointer.
    .sort((a, b) => b.createdAt - a.createdAt)
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

export function selectQuickSwitcherThreads<T>(
  conversations: T[],
  limit = QUICK_SWITCHER_THREAD_LIMIT,
): T[] {
  // Keep the same prefix visible; active state is presentation, not ordering state.
  return conversations.slice(0, Math.max(limit, 0))
}

export function partitionQuickSwitcherThreads<T>(
  conversations: T[],
  visibleCount: number,
): { visible: T[]; overflow: T[] } {
  const splitIndex = Math.max(visibleCount, 0)
  return {
    visible: conversations.slice(0, splitIndex),
    overflow: conversations.slice(splitIndex),
  }
}
