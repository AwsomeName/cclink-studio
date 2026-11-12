export type AgentContentMode = 'chat' | 'split' | 'list'

export const DEFAULT_AGENT_LIST_WIDTH = 200
export const MIN_AGENT_LIST_WIDTH = 180
export const MAX_AGENT_LIST_WIDTH = 240
export const MIN_SPLIT_CHAT_WIDTH = 320
export const AGENT_LIST_SEPARATOR_WIDTH = 4
const DEFAULT_SPLIT_AGENT_PANEL_WIDTH = 700

/** Remove only the visible navigation column; the outer border stays with chat. */
export function getCollapsedAgentPanelWidth(panelWidth: number, listWidth: number): number {
  const layout = getAgentNavigationLayout('split', Math.round(panelWidth - 1), listWidth, false)
  return layout.presentation === 'split'
    ? panelWidth - layout.listWidth - AGENT_LIST_SEPARATOR_WIDTH
    : panelWidth
}

/** An explicit request to show both columns must also provide a usable outer width. */
export function getExpandedAgentPanelWidth(panelWidth: number, listWidth: number): number {
  // Match the workspace's integer clientWidth, including fractional drag/zoom dimensions.
  // Its 1px outer border is excluded from the measurement.
  return getAgentNavigationLayout('split', Math.round(panelWidth - 1), listWidth, false)
    .presentation === 'split'
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
