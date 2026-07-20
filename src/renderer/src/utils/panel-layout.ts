export const MIN_AGENT_PANEL_WIDTH = 220
export const MAX_AGENT_PANEL_WIDTH = 960

const ACTIVITY_BAR_WIDTH = 48
const RESIZE_HANDLE_WIDTH = 4
const MIN_WORKBENCH_WIDTH = 320

export function getAgentPanelWidthBounds({
  viewportWidth,
  sidebarVisible,
  sidebarWidth,
}: {
  viewportWidth: number
  sidebarVisible: boolean
  sidebarWidth: number
}): { min: number; max: number } {
  const reservedWidth =
    ACTIVITY_BAR_WIDTH +
    (sidebarVisible ? sidebarWidth + RESIZE_HANDLE_WIDTH : 0) +
    RESIZE_HANDLE_WIDTH +
    MIN_WORKBENCH_WIDTH
  const availableWidth = viewportWidth - reservedWidth

  return {
    min: MIN_AGENT_PANEL_WIDTH,
    max: Math.max(
      MIN_AGENT_PANEL_WIDTH,
      Math.min(MAX_AGENT_PANEL_WIDTH, Math.floor(availableWidth)),
    ),
  }
}

export function clampPanelWidth(width: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, width))
}
