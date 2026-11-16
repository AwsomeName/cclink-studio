import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMAND_HOLD_HINT_DELAY_MS, createCommandHoldHint } from './command-hold-hint'

afterEach(() => vi.useRealTimers())

function setup() {
  vi.useFakeTimers()
  const show = vi.fn()
  const hide = vi.fn()
  const canShow = vi.fn(() => true)
  return { show, hide, canShow, hold: createCommandHoldHint({ show, hide, canShow }) }
}

describe('Command hold hint lifecycle', () => {
  it('opens only after the hold threshold and closes on release', () => {
    const { hold, show, hide } = setup()
    hold.press()
    vi.advanceTimersByTime(COMMAND_HOLD_HINT_DELAY_MS - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledTimes(1)
    hold.release()
    expect(hide).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a quick shortcut cancels the hint for the remainder of that press', () => {
    const { hold, show } = setup()
    hold.press()
    hold.cancel()
    hold.press()
    vi.advanceTimersByTime(2_000)
    expect(show).not.toHaveBeenCalled()
    hold.release()
    hold.press()
    vi.advanceTimersByTime(COMMAND_HOLD_HINT_DELAY_MS)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('does not restart the timer on repeated Command input', () => {
    const { hold, show } = setup()
    hold.press()
    vi.advanceTimersByTime(600)
    hold.press()
    vi.advanceTimersByTime(100)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('rechecks context at the deadline instead of opening over a new dialog', () => {
    const { hold, show, canShow } = setup()
    hold.press()
    canShow.mockReturnValue(false)
    vi.advanceTimersByTime(COMMAND_HOLD_HINT_DELAY_MS)
    expect(show).not.toHaveBeenCalled()
  })

  it('release or cleanup prevents a pending hint from appearing later', () => {
    const { hold, show } = setup()
    hold.press()
    hold.release()
    vi.advanceTimersByTime(2_000)
    expect(show).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
