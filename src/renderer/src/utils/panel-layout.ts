export const MIN_SIDEBAR_WIDTH = 160
export const MAX_SIDEBAR_WIDTH = 500
export const MIN_AGENT_PANEL_WIDTH = 220
export const MAX_AGENT_PANEL_WIDTH = 960

// Keep aligned with --activitybar-width; the real UI smoke checks both widths.
export const ACTIVITY_BAR_WIDTH = 140
const RESIZE_HANDLE_WIDTH = 4
const MIN_WORKBENCH_WIDTH = 320

export function getPanelLayout({
  viewportWidth,
  sidebarVisible,
  sidebarWidth,
  agentPanelWidth,
  agentInRight,
}: {
  viewportWidth: number
  sidebarVisible: boolean
  sidebarWidth: number
  agentPanelWidth: number
  agentInRight: boolean
}): {
  sidebarWidth: number
  agentPanelWidth: number
  sidebarBounds: { min: number; max: number }
  agentBounds: { min: number; max: number }
} {
  const budget =
    (Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0) -
    ACTIVITY_BAR_WIDTH -
    (Number(sidebarVisible) + Number(agentInRight)) * RESIZE_HANDLE_WIDTH -
    MIN_WORKBENCH_WIDTH
  const sidebarBounds = {
    min: MIN_SIDEBAR_WIDTH,
    max: Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, Math.floor(budget - (agentInRight ? MIN_AGENT_PANEL_WIDTH : 0))),
    ),
  }
  const effectiveSidebarWidth = sidebarVisible ? clampPanelWidth(sidebarWidth, sidebarBounds) : 0
  const agentBounds = {
    min: MIN_AGENT_PANEL_WIDTH,
    max: Math.max(
      MIN_AGENT_PANEL_WIDTH,
      Math.min(MAX_AGENT_PANEL_WIDTH, Math.floor(budget - effectiveSidebarWidth)),
    ),
  }
  return {
    sidebarWidth: effectiveSidebarWidth,
    agentPanelWidth: agentInRight ? clampPanelWidth(agentPanelWidth, agentBounds) : 0,
    sidebarBounds,
    agentBounds,
  }
}

export function clampPanelWidth(width: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(width) ? width : bounds.min))
}
