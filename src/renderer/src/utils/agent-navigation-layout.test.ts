import { describe, expect, it } from 'vitest'
import { getAgentNavigationLayout, getExpandedAgentPanelWidth } from './agent-navigation-layout'
import { getPanelLayout } from './panel-layout'

describe('Agent navigation geometry', () => {
  it('opening both columns accounts for the outer border and the actual list width', () => {
    expect(getExpandedAgentPanelWidth(584, 220)).toBe(700)
    expect(getExpandedAgentPanelWidth(585, 220)).toBe(585)
    expect(getExpandedAgentPanelWidth(620, 280)).toBe(700)
    expect(getExpandedAgentPanelWidth(645, 280)).toBe(645)
  })
  it('only splits when both columns fit; narrow-window fallback does not change the requested mode', () => {
    expect(getAgentNavigationLayout('split', 700, 220, false)).toEqual({
      presentation: 'split',
      listWidth: 220,
    })
    expect(getAgentNavigationLayout('split', 583, 220, false).presentation).toBe('chat')
    expect(getAgentNavigationLayout('split', 583, 220, true).presentation).toBe('drawer')
    expect(getAgentNavigationLayout('split', 584, 220, true).presentation).toBe('split')
    expect(getAgentNavigationLayout('split', 700, 220, false).presentation).toBe('split')
    expect(getAgentNavigationLayout('chat', 900, 220, false).presentation).toBe('chat')
  })

  it('list-only uses its own bounded outer width, while expanded width remains available for restoration', () => {
    const input = {
      viewportWidth: 1440,
      sidebarVisible: false,
      sidebarWidth: 250,
      agentInRight: true,
      agentPanelWidth: 700,
    }
    expect(getPanelLayout(input).agentPanelWidth).toBe(700)
    const list = getPanelLayout({ ...input, agentPanelWidth: 180, agentListOnly: true })
    expect(list.agentPanelWidth).toBe(180)
    expect(list.agentBounds).toEqual({ min: 180, max: 280 })
    expect(getPanelLayout(input).agentPanelWidth).toBe(700)
  })

  it('list-only resizing cannot leak an oversized list; small and invalid dimensions stay finite', () => {
    expect(getAgentNavigationLayout('split', 700, 1000, false)).toEqual({
      presentation: 'split',
      listWidth: 280,
    })
    expect(getAgentNavigationLayout('list', 220, 280, false)).toEqual({
      presentation: 'list',
      listWidth: 220,
    })
    expect(getAgentNavigationLayout('split', NaN, NaN, true)).toEqual({
      presentation: 'drawer',
      listWidth: 0,
    })
  })
})
