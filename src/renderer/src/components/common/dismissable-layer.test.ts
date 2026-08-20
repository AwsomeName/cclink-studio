import { describe, expect, it, vi } from 'vitest'
import { dismissTopEscapeLayer, registerEscapeDismissLayer } from './dismissable-layer'

describe('dismissable layer stack', () => {
  it('dismisses only the topmost layer for each Escape action', () => {
    const dismissParent = vi.fn()
    const dismissChild = vi.fn()
    const unregisterParent = registerEscapeDismissLayer(dismissParent)
    const unregisterChild = registerEscapeDismissLayer(dismissChild)

    try {
      expect(dismissTopEscapeLayer()).toBe(true)
      expect(dismissChild).toHaveBeenCalledTimes(1)
      expect(dismissParent).not.toHaveBeenCalled()

      unregisterChild()
      expect(dismissTopEscapeLayer()).toBe(true)
      expect(dismissParent).toHaveBeenCalledTimes(1)
    } finally {
      unregisterChild()
      unregisterParent()
    }
  })

  it('reports when no dismissable layer is open', () => {
    expect(dismissTopEscapeLayer()).toBe(false)
  })
})
