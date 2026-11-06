import { MIN_AGENT_LIST_WIDTH, MAX_AGENT_LIST_WIDTH } from './agent-navigation-layout'

export const MIN_SIDEBAR_WIDTH = 160
export const MAX_SIDEBAR_WIDTH = 500
export const MIN_AGENT_PANEL_WIDTH = 220
export const MAX_AGENT_PANEL_WIDTH = 960

// Keep aligned with the activity bar CSS; the real UI smoke checks both widths.
export const ACTIVITY_BAR_WIDTH = 140
export const COLLAPSED_ACTIVITY_BAR_WIDTH = 48
const RESIZE_HANDLE_WIDTH = 4
const MIN_WORKBENCH_WIDTH = 320

export interface PanelLayoutInput {
  viewportWidth: number
  sidebarVisible: boolean
  sidebarWidth: number
  agentPanelWidth: number
  agentInRight: boolean
  agentListOnly?: boolean
}

export interface PanelLayout {
  sidebarWidth: number
  agentPanelWidth: number
  sidebarBounds: { min: number; max: number }
  agentBounds: { min: number; max: number }
}

export function getPanelLayout(
  {
    viewportWidth,
    sidebarVisible,
    sidebarWidth,
    agentPanelWidth,
    agentInRight,
    agentListOnly,
  }: PanelLayoutInput,
  retainedAgentWidth?: number,
): PanelLayout {
  const agentMin = agentListOnly ? MIN_AGENT_LIST_WIDTH : MIN_AGENT_PANEL_WIDTH
  const agentMax = agentListOnly ? MAX_AGENT_LIST_WIDTH : MAX_AGENT_PANEL_WIDTH
  const budget =
    (Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0) -
    (sidebarVisible ? ACTIVITY_BAR_WIDTH : COLLAPSED_ACTIVITY_BAR_WIDTH) -
    (Number(sidebarVisible) + Number(agentInRight)) * RESIZE_HANDLE_WIDTH -
    MIN_WORKBENCH_WIDTH
  const sidebarBounds = {
    min: MIN_SIDEBAR_WIDTH,
    max: Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, Math.floor(budget - (agentInRight ? agentMin : 0))),
    ),
  }
  let effectiveSidebarWidth = sidebarVisible ? clampPanelWidth(sidebarWidth, sidebarBounds) : 0
  const agentBounds = {
    min: agentMin,
    max: Math.max(agentMin, Math.min(agentMax, Math.floor(budget - effectiveSidebarWidth))),
  }
  let effectiveAgentWidth = agentInRight ? clampPanelWidth(agentPanelWidth, agentBounds) : 0
  if (agentInRight && retainedAgentWidth !== undefined && Number.isFinite(retainedAgentWidth)) {
    // A left-side toggle only redistributes the left/navigation and workbench space.
    // This is a disposable presentation value, never a new persisted width preference.
    effectiveAgentWidth = clampPanelWidth(retainedAgentWidth, {
      min: agentMin,
      max: agentMax,
    })
    sidebarBounds.max = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, Math.floor(budget - effectiveAgentWidth)),
    )
    effectiveSidebarWidth = sidebarVisible ? clampPanelWidth(sidebarWidth, sidebarBounds) : 0
    agentBounds.max = Math.max(agentBounds.max, effectiveAgentWidth)
  }
  return {
    sidebarWidth: effectiveSidebarWidth,
    agentPanelWidth: effectiveAgentWidth,
    sidebarBounds,
    agentBounds,
  }
}

export function clampPanelWidth(width: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(width) ? width : bounds.min))
}
