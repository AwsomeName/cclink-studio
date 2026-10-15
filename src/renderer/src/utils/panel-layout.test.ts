import { describe, expect, it } from 'vitest'
import { clampPanelWidth, getPanelLayout } from './panel-layout'

describe('panel width budget', () => {
  it.each([
    [1400, true, true, 250, 350, 250, 350],
    [900, true, true, 250, 350, 198, 220],
    [900, true, false, 250, 350, 250, 0],
    [900, false, true, 250, 350, 0, 350],
    [900, true, false, 500, 350, 422, 0],
    [900, false, false, 250, 350, 0, 0],
    [862, true, true, 250, 350, 160, 220],
    [800, true, true, 250, 350, 160, 220],
  ])(
    'allocates viewport %s, sidebar %s, right Agent %s',
    (viewportWidth, sidebarVisible, agentInRight, sidebarWidth, agentPanelWidth, left, right) => {
      expect(
        getPanelLayout({
          viewportWidth,
          sidebarVisible,
          agentInRight,
          sidebarWidth,
          agentPanelWidth,
        }),
      ).toMatchObject({ sidebarWidth: left, agentPanelWidth: right })
    },
  )

  it('only clamps presentation; growing restores the original input targets', () => {
    const input = {
      viewportWidth: 900,
      sidebarVisible: true,
      agentInRight: true,
      sidebarWidth: 250,
      agentPanelWidth: 350,
    }
    expect(getPanelLayout(input)).toMatchObject({ sidebarWidth: 198, agentPanelWidth: 220 })
    expect(input).toMatchObject({ sidebarWidth: 250, agentPanelWidth: 350 })
    expect(getPanelLayout({ ...input, viewportWidth: 1400 })).toMatchObject({
      sidebarWidth: 250,
      agentPanelWidth: 350,
    })
  })

  it.each([NaN, Infinity, -100])('does not produce invalid widths for %s', (viewportWidth) => {
    const result = getPanelLayout({
      viewportWidth,
      sidebarVisible: true,
      agentInRight: true,
      sidebarWidth: NaN,
      agentPanelWidth: Infinity,
    })
    expect(result.sidebarWidth).toBe(160)
    expect(result.agentPanelWidth).toBe(220)
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
