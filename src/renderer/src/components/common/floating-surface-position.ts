export type FloatingSurfacePlacement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'

export interface FloatingSurfaceRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface FloatingSurfaceSize {
  width: number
  height: number
}

export interface FloatingSurfaceViewport {
  width: number
  height: number
}

export interface FloatingSurfacePosition {
  top: number
  left: number
  placement: FloatingSurfacePlacement
}

interface ResolveFloatingSurfacePositionOptions {
  anchor: FloatingSurfaceRect
  surface: FloatingSurfaceSize
  viewport: FloatingSurfaceViewport
  placement: FloatingSurfacePlacement
  gap: number
  viewportPadding: number
}

export function resolveFloatingSurfacePosition({
  anchor,
  surface,
  viewport,
  placement,
  gap,
  viewportPadding,
}: ResolveFloatingSurfacePositionOptions): FloatingSurfacePosition {
  const preferredVertical = placement.startsWith('top') ? 'top' : 'bottom'
  const horizontal = placement.endsWith('end') ? 'end' : 'start'
  const topSpace = anchor.top - viewportPadding
  const bottomSpace = viewport.height - anchor.bottom - viewportPadding
  const requiredHeight = surface.height + gap

  let vertical: 'top' | 'bottom' = preferredVertical
  if (preferredVertical === 'top' && requiredHeight > topSpace && bottomSpace > topSpace) {
    vertical = 'bottom'
  } else if (
    preferredVertical === 'bottom' &&
    requiredHeight > bottomSpace &&
    topSpace > bottomSpace
  ) {
    vertical = 'top'
  }

  const rawTop = vertical === 'top' ? anchor.top - surface.height - gap : anchor.bottom + gap
  const rawLeft = horizontal === 'end' ? anchor.right - surface.width : anchor.left
  const maxTop = Math.max(viewportPadding, viewport.height - surface.height - viewportPadding)
  const maxLeft = Math.max(viewportPadding, viewport.width - surface.width - viewportPadding)

  return {
    top: clamp(rawTop, viewportPadding, maxTop),
    left: clamp(rawLeft, viewportPadding, maxLeft),
    placement: `${vertical}-${horizontal}`,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
