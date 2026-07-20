import { describe, expect, it } from 'vitest'
import { resolveFloatingSurfacePosition } from './floating-surface-position'

const viewport = { width: 800, height: 600 }
const surface = { width: 280, height: 220 }

describe('resolveFloatingSurfacePosition', () => {
  it('places a top-end surface above and aligned to the anchor end', () => {
    expect(
      resolveFloatingSurfacePosition({
        anchor: rect(650, 500, 30, 30),
        surface,
        viewport,
        placement: 'top-end',
        gap: 8,
        viewportPadding: 8,
      }),
    ).toEqual({ top: 272, left: 400, placement: 'top-end' })
  })

  it('flips below when the preferred top side has insufficient room', () => {
    expect(
      resolveFloatingSurfacePosition({
        anchor: rect(300, 20, 30, 30),
        surface,
        viewport,
        placement: 'top-start',
        gap: 8,
        viewportPadding: 8,
      }),
    ).toEqual({ top: 58, left: 300, placement: 'bottom-start' })
  })

  it('clamps a wide end-aligned surface to the left viewport edge', () => {
    expect(
      resolveFloatingSurfacePosition({
        anchor: rect(4, 500, 30, 30),
        surface,
        viewport,
        placement: 'top-end',
        gap: 8,
        viewportPadding: 12,
      }).left,
    ).toBe(12)
  })

  it('clamps a start-aligned surface to the right viewport edge', () => {
    expect(
      resolveFloatingSurfacePosition({
        anchor: rect(760, 500, 30, 30),
        surface,
        viewport,
        placement: 'top-start',
        gap: 8,
        viewportPadding: 12,
      }).left,
    ).toBe(508)
  })
})

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): { top: number; right: number; bottom: number; left: number; width: number; height: number } {
  return {
    top,
    right: left + width,
    bottom: top + height,
    left,
    width,
    height,
  }
}
