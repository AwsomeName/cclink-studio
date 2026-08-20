import { describe, expect, it } from 'vitest'
import { shouldRequestTabDetach } from './tab-detach-drag'

describe('shouldRequestTabDetach', () => {
  it('requests main-process arbitration for an unhandled Browser drag end', () => {
    expect(
      shouldRequestTabDetach({
        tabType: 'browser',
        handledInsideTabBar: false,
        cancelled: false,
      }),
    ).toBe(true)
  })

  it('does not request arbitration after an in-bar drop', () => {
    expect(
      shouldRequestTabDetach({
        tabType: 'browser',
        handledInsideTabBar: true,
        cancelled: false,
      }),
    ).toBe(false)
  })

  it('rejects unsupported tabs and cancelled drags without reading renderer coordinates', () => {
    expect(
      shouldRequestTabDetach({
        tabType: 'editor',
        handledInsideTabBar: false,
        cancelled: false,
      }),
    ).toBe(false)
    expect(
      shouldRequestTabDetach({
        tabType: 'browser',
        handledInsideTabBar: false,
        cancelled: true,
      }),
    ).toBe(false)
  })
})
