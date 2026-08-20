import { describe, expect, it } from 'vitest'
import { resolveNativeTabDetachDropPoint } from './tab-detach-cursor'

const sourceBounds = { x: 100, y: 80, width: 1200, height: 800 }

describe('resolveNativeTabDetachDropPoint', () => {
  it('returns native cursor points outside the source window, including a left display', () => {
    expect(resolveNativeTabDetachDropPoint({ x: -600, y: 300 }, sourceBounds)).toEqual({
      x: -600,
      y: 300,
    })
    expect(resolveNativeTabDetachDropPoint({ x: 1300, y: 300 }, sourceBounds)).toEqual({
      x: 1300,
      y: 300,
    })
  })

  it('keeps cursor points inside the source window attached', () => {
    expect(resolveNativeTabDetachDropPoint({ x: 100, y: 80 }, sourceBounds)).toBeNull()
    expect(resolveNativeTabDetachDropPoint({ x: 1299, y: 879 }, sourceBounds)).toBeNull()
  })

  it('treats the half-open right and bottom edges as outside', () => {
    expect(resolveNativeTabDetachDropPoint({ x: 1300, y: 879 }, sourceBounds)).toEqual({
      x: 1300,
      y: 879,
    })
    expect(resolveNativeTabDetachDropPoint({ x: 1299, y: 880 }, sourceBounds)).toEqual({
      x: 1299,
      y: 880,
    })
  })
})
