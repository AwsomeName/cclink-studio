import type { BrowserBounds } from '../../shared/ipc/browser'

interface WindowContentSize {
  width: number
  height: number
}

function normalizeZoomFactor(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 将主 renderer 的 CSS 坐标转换成 BrowserWindow contentView 使用的 DIP 坐标。 */
export function rendererBoundsToWindowDip(
  bounds: BrowserBounds,
  zoomFactor: number,
  contentSize?: WindowContentSize,
): BrowserBounds {
  const factor = normalizeZoomFactor(zoomFactor)
  const scaled = {
    x: Math.round(bounds.x * factor),
    y: Math.round(bounds.y * factor),
    width: Math.max(0, Math.round(bounds.width * factor)),
    height: Math.max(0, Math.round(bounds.height * factor)),
  }

  if (!contentSize) return scaled

  const maxWidth = Math.max(0, Math.round(contentSize.width))
  const maxHeight = Math.max(0, Math.round(contentSize.height))
  const x = clamp(scaled.x, 0, maxWidth)
  const y = clamp(scaled.y, 0, maxHeight)
  return {
    x,
    y,
    width: clamp(scaled.width, 0, maxWidth - x),
    height: clamp(scaled.height, 0, maxHeight - y),
  }
}

/** 裁掉越过工作台工具栏/Tab 栏保护线的原生 View 区域。 */
export function clampBrowserBoundsBelowProtectedTop(
  bounds: BrowserBounds,
  protectedTop: number,
): BrowserBounds {
  const bottom = bounds.y + bounds.height
  const y = Math.max(bounds.y, Math.round(protectedTop))
  return {
    ...bounds,
    y,
    height: Math.max(0, bottom - y),
  }
}
