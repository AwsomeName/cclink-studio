import { useState } from 'react'
import { getPanelLayout, type PanelLayout, type PanelLayoutInput } from './panel-layout'

interface LayoutPresentation {
  workspaceKey: string | null
  input: PanelLayoutInput
  retainedAgentWidth?: number
  layout: PanelLayout
}

export function usePanelLayout(
  workspaceKey: string | null,
  input: PanelLayoutInput,
  preview: { area: 'sidebar' | 'agent'; target: number; effectiveWidth: number } | null,
): PanelLayout {
  const [previous, setPrevious] = useState<LayoutPresentation>(() => ({
    workspaceKey,
    input,
    layout: getPanelLayout(input),
  }))
  let current = previous
  if (
    previous.workspaceKey !== workspaceKey ||
    (Object.keys(input) as Array<keyof PanelLayoutInput>).some(
      (key) => !Object.is(input[key], previous.input[key]),
    )
  ) {
    let retainedAgentWidth: number | undefined
    if (
      previous.workspaceKey === workspaceKey &&
      previous.input.viewportWidth === input.viewportWidth &&
      previous.input.agentInRight === input.agentInRight &&
      previous.input.agentListOnly === input.agentListOnly &&
      previous.input.sidebarWidth === input.sidebarWidth
    ) {
      if (previous.input.agentPanelWidth !== input.agentPanelWidth) {
        // A deliberate Agent resize replaces the retained display width.
        if (previous.retainedAgentWidth !== undefined) retainedAgentWidth = input.agentPanelWidth
      } else if (previous.input.sidebarVisible !== input.sidebarVisible) {
        retainedAgentWidth = previous.layout.agentPanelWidth
      } else {
        retainedAgentWidth = previous.retainedAgentWidth
      }
    }
    current = {
      workspaceKey,
      input,
      retainedAgentWidth,
      layout: getPanelLayout(input, retainedAgentWidth),
    }
    // Adjust this component's derived presentation before children commit. There is
    // no effect-driven intermediate frame and no write to UIStore/WorkspaceState.
    setPrevious(current)
  }
  if (!preview) return current.layout
  if (
    preview.effectiveWidth ===
    (preview.area === 'sidebar' ? current.layout.sidebarWidth : current.layout.agentPanelWidth)
  )
    return current.layout
  return getPanelLayout(
    {
      ...input,
      ...(preview.area === 'sidebar'
        ? { sidebarWidth: preview.target }
        : { agentPanelWidth: preview.target }),
    },
    current.retainedAgentWidth !== undefined && preview.area === 'agent'
      ? preview.effectiveWidth
      : undefined,
  )
}
