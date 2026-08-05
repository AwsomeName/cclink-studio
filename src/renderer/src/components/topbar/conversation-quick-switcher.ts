import type { QuickThreadSummary } from '../../features/agent-conversations/view-model'
import type { AgentPanelMode } from '../../stores/ui-store'

export const QUICK_SWITCHER_TITLE_LIMIT = 10
export const QUICK_SWITCHER_THREAD_LIMIT = 5

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

export function selectQuickSwitcherThreads(
  conversations: QuickThreadSummary[],
  limit = QUICK_SWITCHER_THREAD_LIMIT,
): QuickThreadSummary[] {
  if (conversations.length <= limit) return conversations
  const latest = conversations.slice(0, limit)
  if (latest.some((conversation) => conversation.isActive)) return latest

  const active = conversations.find((conversation) => conversation.isActive)
  if (!active || limit <= 0) return latest
  return [...latest.slice(0, limit - 1), active]
}

export function partitionQuickSwitcherThreads(
  conversations: QuickThreadSummary[],
  visibleCount: number,
): { visible: QuickThreadSummary[]; overflow: QuickThreadSummary[] } {
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
