export type AgentContentMode = 'chat' | 'split' | 'list'

export const DEFAULT_AGENT_LIST_WIDTH = 220
export const MIN_AGENT_LIST_WIDTH = 180
export const MAX_AGENT_LIST_WIDTH = 280
export const MIN_SPLIT_CHAT_WIDTH = 360
export const AGENT_LIST_SEPARATOR_WIDTH = 4
const DEFAULT_SPLIT_AGENT_PANEL_WIDTH = 700

/** An explicit request to show both columns must also provide a usable outer width. */
export function getExpandedAgentPanelWidth(panelWidth: number, listWidth: number): number {
  // The Agent workspace has a 1px outer border; its measured client width excludes it.
  return getAgentNavigationLayout('split', panelWidth - 1, listWidth, false).presentation ===
    'split'
    ? panelWidth
    : DEFAULT_SPLIT_AGENT_PANEL_WIDTH
}

/** User preference and effective geometry are separate; resizing never rewrites the preference. */
export function getAgentNavigationLayout(
  mode: AgentContentMode,
  width: number,
  listWidth: number,
  drawerOpen: boolean,
): { presentation: 'chat' | 'split' | 'list' | 'drawer'; listWidth: number } {
  const safeWidth = Math.max(0, Number.isFinite(width) ? width : 0)
  const preferred = Math.max(
    MIN_AGENT_LIST_WIDTH,
    Math.min(
      MAX_AGENT_LIST_WIDTH,
      Number.isFinite(listWidth) ? listWidth : DEFAULT_AGENT_LIST_WIDTH,
    ),
  )
  if (mode === 'list') return { presentation: 'list', listWidth: safeWidth }
  if (
    mode === 'split' &&
    safeWidth >= preferred + AGENT_LIST_SEPARATOR_WIDTH + MIN_SPLIT_CHAT_WIDTH
  )
    return { presentation: 'split', listWidth: preferred }
  return {
    presentation: drawerOpen ? 'drawer' : 'chat',
    listWidth: safeWidth,
  }
}
