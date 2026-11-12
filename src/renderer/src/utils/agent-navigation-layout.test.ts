import { describe, expect, it } from 'vitest'
import {
  getAgentNavigationLayout,
  getExpandedAgentPanelWidth,
  getCollapsedAgentPanelWidth,
} from './agent-navigation-layout'
import { getPanelLayout } from './panel-layout'

describe('Agent navigation geometry', () => {
  it('opening both columns accounts for the outer border and the actual list width', () => {
    expect(getExpandedAgentPanelWidth(544, 220)).toBe(700)
    expect(getExpandedAgentPanelWidth(545, 220)).toBe(545)
    expect(getExpandedAgentPanelWidth(560, 240)).toBe(700)
    expect(getExpandedAgentPanelWidth(565, 240)).toBe(565)
  })
  it('only splits when both columns fit; narrow-window fallback does not change the requested mode', () => {
    expect(getAgentNavigationLayout('split', 700, 220, false)).toEqual({
      presentation: 'split',
      listWidth: 220,
    })
    expect(getAgentNavigationLayout('split', 543, 220, false).presentation).toBe('chat')
    expect(getAgentNavigationLayout('split', 543, 220, true).presentation).toBe('drawer')
    expect(getAgentNavigationLayout('split', 544, 220, true).presentation).toBe('split')
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
    expect(list.agentBounds).toEqual({ min: 180, max: 240 })
    expect(getPanelLayout(input).agentPanelWidth).toBe(700)
  })

  it('list-only resizing cannot leak an oversized list; small and invalid dimensions stay finite', () => {
    expect(getAgentNavigationLayout('split', 700, 1000, false)).toEqual({
      presentation: 'split',
      listWidth: 240,
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

  it('collapsing removes exactly the visible rail and divider, including compressed layouts', () => {
    expect(getCollapsedAgentPanelWidth(700, 200)).toBe(496)
    expect(getCollapsedAgentPanelWidth(650, 200)).toBe(446)
    expect(getCollapsedAgentPanelWidth(900, 240)).toBe(656)
    // A drawer overlays chat and has no width to release.
    expect(getCollapsedAgentPanelWidth(350, 200)).toBe(350)
  })

  it('fractional panel widths use the same rounded clientWidth as the rendered split', () => {
    expect(getAgentNavigationLayout('split', 524, 200, false).presentation).toBe('split')
    expect(getCollapsedAgentPanelWidth(524.75, 200)).toBe(320.75)
    expect(getExpandedAgentPanelWidth(524.75, 200)).toBe(524.75)
  })
})
