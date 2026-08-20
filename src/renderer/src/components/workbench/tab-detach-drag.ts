import type { WorkbenchWindowDropPoint } from '@shared/ipc/workbench-window'

interface TabDetachDragInput {
  tabType: string
  screenPoint: WorkbenchWindowDropPoint
  clientPoint: WorkbenchWindowDropPoint
  windowBounds: { x: number; y: number; width: number; height: number }
  handledInsideTabBar: boolean
  cancelled: boolean
}

/** Returns a screen-space drop point only for a Browser Tab released outside the source window. */
export function resolveTabDetachDropPoint(
  input: TabDetachDragInput,
): WorkbenchWindowDropPoint | null {
  if (input.tabType !== 'browser' || input.handledInsideTabBar || input.cancelled) return null
  const { screenPoint, clientPoint, windowBounds } = input
  if (screenPoint.x === 0 && screenPoint.y === 0 && clientPoint.x === 0 && clientPoint.y === 0) {
    return null
  }
  const outside =
    screenPoint.x < windowBounds.x ||
    screenPoint.y < windowBounds.y ||
    screenPoint.x > windowBounds.x + windowBounds.width ||
    screenPoint.y > windowBounds.y + windowBounds.height
  return outside ? { x: Math.round(screenPoint.x), y: Math.round(screenPoint.y) } : null
}
