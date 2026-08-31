import { describe, expect, it } from 'vitest'
import {
  isConversationNearBottom,
  normalizeConversationWheelDelta,
  resolveConversationScrollTop,
  resolveConversationWheelFallbackScrollTop,
} from './use-conversation-scroll'

describe('conversation scroll policy', () => {
  it('considers only a small bottom zone eligible for output following', () => {
    expect(
      isConversationNearBottom({ scrollTop: 1455, scrollHeight: 2000, clientHeight: 500 }),
    ).toBe(true)
    expect(
      isConversationNearBottom({ scrollTop: 1200, scrollHeight: 2000, clientHeight: 500 }),
    ).toBe(false)
  })

  it('opens unseen or bottom-following conversations at the latest content without animation', () => {
    const dimensions = { scrollHeight: 2000, clientHeight: 500 }
    expect(resolveConversationScrollTop(undefined, dimensions)).toBe(1500)
    expect(resolveConversationScrollTop({ scrollTop: 900, atBottom: true }, dimensions)).toBe(1500)
  })

  it('restores a manual reading position and clamps it after content shrinks', () => {
    expect(
      resolveConversationScrollTop(
        { scrollTop: 720, atBottom: false },
        { scrollHeight: 2000, clientHeight: 500 },
      ),
    ).toBe(720)
    expect(
      resolveConversationScrollTop(
        { scrollTop: 720, atBottom: false },
        { scrollHeight: 900, clientHeight: 500 },
      ),
    ).toBe(400)
  })

  it('normalizes line and page wheel input before applying a fallback', () => {
    expect(normalizeConversationWheelDelta(2, 0, 500)).toBe(2)
    expect(normalizeConversationWheelDelta(2, 1, 500)).toBe(32)
    expect(normalizeConversationWheelDelta(2, 2, 500)).toBe(1000)
    expect(normalizeConversationWheelDelta(Number.NaN, 0, 500)).toBe(0)
  })

  it('clamps fallback wheel scrolling to the conversation bounds', () => {
    const dimensions = { scrollHeight: 2000, clientHeight: 500 }
    expect(resolveConversationWheelFallbackScrollTop(0, 640, dimensions)).toBe(640)
    expect(resolveConversationWheelFallbackScrollTop(1400, 640, dimensions)).toBe(1500)
    expect(resolveConversationWheelFallbackScrollTop(100, -640, dimensions)).toBe(0)
  })
})
