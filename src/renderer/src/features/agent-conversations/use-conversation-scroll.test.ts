import { describe, expect, it } from 'vitest'
import { isConversationNearBottom, resolveConversationScrollTop } from './use-conversation-scroll'

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
})
