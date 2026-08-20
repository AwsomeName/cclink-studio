import { describe, expect, it } from 'vitest'
import { resolveTabDetachDropPoint } from './tab-detach-drag'

const windowBounds = { x: 100, y: 80, width: 1200, height: 800 }

describe('resolveTabDetachDropPoint', () => {
  it('detaches a Browser Tab released beyond the source window, including a left display', () => {
    expect(
      resolveTabDetachDropPoint({
        tabType: 'browser',
        screenPoint: { x: -600, y: 300 },
        clientPoint: { x: -700, y: 220 },
        windowBounds,
        handledInsideTabBar: false,
        cancelled: false,
      }),
    ).toEqual({ x: -600, y: 300 })
  })

  it('keeps in-window drops and tab reorders attached', () => {
    expect(
      resolveTabDetachDropPoint({
        tabType: 'browser',
        screenPoint: { x: 500, y: 300 },
        clientPoint: { x: 400, y: 220 },
        windowBounds,
        handledInsideTabBar: false,
        cancelled: false,
      }),
    ).toBeNull()
    expect(
      resolveTabDetachDropPoint({
        tabType: 'browser',
        screenPoint: { x: 1400, y: 300 },
        clientPoint: { x: 1300, y: 220 },
        windowBounds,
        handledInsideTabBar: true,
        cancelled: false,
      }),
    ).toBeNull()
  })

  it('rejects unsupported tabs and Chromium zero-coordinate cancellation artifacts', () => {
    expect(
      resolveTabDetachDropPoint({
        tabType: 'editor',
        screenPoint: { x: 1400, y: 300 },
        clientPoint: { x: 1300, y: 220 },
        windowBounds,
        handledInsideTabBar: false,
        cancelled: false,
      }),
    ).toBeNull()
    expect(
      resolveTabDetachDropPoint({
        tabType: 'browser',
        screenPoint: { x: 0, y: 0 },
        clientPoint: { x: 0, y: 0 },
        windowBounds,
        handledInsideTabBar: false,
        cancelled: false,
      }),
    ).toBeNull()
    expect(
      resolveTabDetachDropPoint({
        tabType: 'browser',
        screenPoint: { x: 1400, y: 300 },
        clientPoint: { x: 1300, y: 220 },
        windowBounds,
        handledInsideTabBar: false,
        cancelled: true,
      }),
    ).toBeNull()
  })
})
