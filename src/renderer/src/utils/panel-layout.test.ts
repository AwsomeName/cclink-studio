import { describe, expect, it } from 'vitest'
import { clampPanelWidth, getAgentPanelWidthBounds } from './panel-layout'

describe('getAgentPanelWidthBounds', () => {
  it('allows a wide Agent panel when the sidebar is hidden', () => {
    expect(
      getAgentPanelWidthBounds({ viewportWidth: 1400, sidebarVisible: false, sidebarWidth: 250 }),
    ).toEqual({ min: 220, max: 960 })
  })

  it('preserves workbench room when the sidebar is visible', () => {
    expect(
      getAgentPanelWidthBounds({ viewportWidth: 1200, sidebarVisible: true, sidebarWidth: 250 }),
    ).toEqual({ min: 220, max: 574 })
  })

  it('never returns a maximum below the usable Agent minimum', () => {
    expect(
      getAgentPanelWidthBounds({ viewportWidth: 600, sidebarVisible: true, sidebarWidth: 250 }),
    ).toEqual({ min: 220, max: 220 })
  })
})

describe('clampPanelWidth', () => {
  it('clamps restored widths into the current viewport bounds', () => {
    const bounds = { min: 220, max: 760 }
    expect(clampPanelWidth(120, bounds)).toBe(220)
    expect(clampPanelWidth(520, bounds)).toBe(520)
    expect(clampPanelWidth(1200, bounds)).toBe(760)
  })
})
