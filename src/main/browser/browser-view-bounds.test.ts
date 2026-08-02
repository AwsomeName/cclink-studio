import { describe, expect, it } from 'vitest'
import { rendererBoundsToWindowDip } from './browser-view-bounds'

describe('rendererBoundsToWindowDip', () => {
  it('converts renderer CSS coordinates with the main window zoom factor', () => {
    expect(
      rendererBoundsToWindowDip({ x: 453, y: 204, width: 909, height: 1043 }, 1 / 1.1, {
        width: 1969,
        height: 1280,
      }),
    ).toEqual({ x: 412, y: 185, width: 826, height: 948 })
  })

  it('falls back to 100% for an invalid zoom factor', () => {
    expect(rendererBoundsToWindowDip({ x: 10, y: 20, width: 300, height: 200 }, 0)).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    })
  })

  it('clips the native view to the BrowserWindow content area', () => {
    expect(
      rendererBoundsToWindowDip({ x: -10, y: 90, width: 800, height: 300 }, 1, {
        width: 640,
        height: 240,
      }),
    ).toEqual({ x: 0, y: 90, width: 640, height: 150 })
  })
})
