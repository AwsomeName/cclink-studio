import { describe, expect, it, vi } from 'vitest'
import { createBoundsStabilizer, resolveSafeWorkbenchBounds } from './use-workbench-bounds'

describe('createBoundsStabilizer', () => {
  it('rechecks bounds across renderer frames and delayed native-window settling', () => {
    const report = vi.fn()
    const frames = new Map<number, FrameRequestCallback>()
    const timers = new Map<number, () => void>()
    let nextHandle = 1
    const stabilizer = createBoundsStabilizer(report, {
      requestFrame: (callback) => {
        const handle = nextHandle++
        frames.set(handle, callback)
        return handle
      },
      cancelFrame: (handle) => {
        frames.delete(handle)
      },
      setTimer: (callback) => {
        const handle = nextHandle++
        timers.set(handle, callback)
        return handle
      },
      clearTimer: (handle) => {
        timers.delete(handle)
      },
    })

    stabilizer.schedule()
    expect(report).toHaveBeenCalledOnce()

    while (frames.size > 0) {
      const [handle, callback] = [...frames.entries()][0]
      frames.delete(handle)
      callback(0)
    }
    for (const callback of [...timers.values()]) callback()

    expect(report).toHaveBeenCalledTimes(8)
    stabilizer.dispose()
  })

  it('cancels stale settling work when a newer layout event arrives', () => {
    const report = vi.fn()
    const cancelFrame = vi.fn()
    const clearTimer = vi.fn()
    let nextHandle = 1
    const stabilizer = createBoundsStabilizer(report, {
      requestFrame: () => nextHandle++,
      cancelFrame,
      setTimer: () => nextHandle++,
      clearTimer,
    })

    stabilizer.schedule()
    stabilizer.schedule()

    expect(cancelFrame).toHaveBeenCalledOnce()
    expect(clearTimer).toHaveBeenCalledTimes(4)
    expect(report).toHaveBeenCalledTimes(2)
  })
})

describe('resolveSafeWorkbenchBounds', () => {
  it('clips stale content bounds below the tab bar', () => {
    expect(
      resolveSafeWorkbenchBounds(
        { left: 220, top: 70, right: 1220, bottom: 800, width: 1000, height: 730 },
        { left: 220, top: 72, right: 1220, bottom: 108.2, width: 1000, height: 36.2 },
      ),
    ).toEqual({ x: 220, y: 109, width: 1000, height: 691, protectedTop: 109 })
  })

  it('protects the full workbench chrome above the browser content', () => {
    expect(
      resolveSafeWorkbenchBounds(
        { left: 220, top: 154.2, right: 1220, bottom: 800, width: 1000, height: 645.8 },
        { left: 220, top: 72, right: 1220, bottom: 108, width: 1000, height: 36 },
      ),
    ).toEqual({ x: 220, y: 155, width: 1000, height: 645, protectedTop: 155 })
  })
})
