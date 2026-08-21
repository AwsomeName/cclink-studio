import { describe, expect, it } from 'vitest'
import { hasExceededTabDragThreshold, shouldRequestTabDetach } from './tab-detach-drag'

describe('shouldRequestTabDetach', () => {
  it('requests main-process arbitration for an unhandled Browser drag end', () => {
    expect(
      shouldRequestTabDetach({
        tabType: 'browser',
        releasedInsideTabBar: false,
        cancelled: false,
      }),
    ).toBe(true)
  })

  it('does not request arbitration after an in-bar drop', () => {
    expect(
      shouldRequestTabDetach({
        tabType: 'browser',
        releasedInsideTabBar: true,
        cancelled: false,
      }),
    ).toBe(false)
  })

  it('rejects unsupported tabs and cancelled drags without reading renderer coordinates', () => {
    expect(
      shouldRequestTabDetach({
        tabType: 'editor',
        releasedInsideTabBar: false,
        cancelled: false,
      }),
    ).toBe(false)
    expect(
      shouldRequestTabDetach({
        tabType: 'browser',
        releasedInsideTabBar: false,
        cancelled: true,
      }),
    ).toBe(false)
  })

  it('starts a custom pointer drag only after the movement threshold', () => {
    expect(hasExceededTabDragThreshold({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(true)
    expect(hasExceededTabDragThreshold({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false)
  })
})
