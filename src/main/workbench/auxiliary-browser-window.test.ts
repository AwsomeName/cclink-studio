import { describe, expect, it } from 'vitest'
import { resolveAuxiliaryWindowBounds } from './auxiliary-window-placement'

describe('resolveAuxiliaryWindowBounds', () => {
  it('places the window near the drop point and clamps it to the selected display', () => {
    expect(
      resolveAuxiliaryWindowBounds(
        { x: 2500, y: 400 },
        { x: 1920, y: 0, width: 1440, height: 900 },
      ),
    ).toEqual({ x: 2260, y: 140, width: 1100, height: 760 })
    expect(
      resolveAuxiliaryWindowBounds(
        { x: -1800, y: 40 },
        { x: -1920, y: 0, width: 1920, height: 1080 },
      ),
    ).toEqual({ x: -1880, y: 16, width: 1100, height: 760 })
  })

  it('fits small display work areas without creating off-screen bounds', () => {
    expect(
      resolveAuxiliaryWindowBounds({ x: 400, y: 300 }, { x: 0, y: 0, width: 800, height: 600 }),
    ).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })
})
