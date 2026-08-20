import type { Rectangle } from 'electron'
import type { WorkbenchWindowDropPoint } from '../../shared/ipc/workbench-window'

/**
 * Decides tab tear-off in Electron screen DIP coordinates.
 * BrowserWindow bounds are half-open: the right and bottom edges are outside the source window.
 */
export function resolveNativeTabDetachDropPoint(
  cursor: WorkbenchWindowDropPoint,
  sourceBounds: Rectangle,
): WorkbenchWindowDropPoint | null {
  const outside =
    cursor.x < sourceBounds.x ||
    cursor.y < sourceBounds.y ||
    cursor.x >= sourceBounds.x + sourceBounds.width ||
    cursor.y >= sourceBounds.y + sourceBounds.height
  return outside ? { x: Math.round(cursor.x), y: Math.round(cursor.y) } : null
}
