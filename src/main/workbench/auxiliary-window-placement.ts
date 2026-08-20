import type { WorkbenchWindowDropPoint } from '../../shared/ipc/workbench-window'

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export const defaultAuxiliaryWindowSize = { width: 1100, height: 760 } as const

export function resolveAuxiliaryWindowBounds(
  dropPoint: WorkbenchWindowDropPoint,
  workArea: WindowBounds,
): WindowBounds {
  const width = Math.min(defaultAuxiliaryWindowSize.width, workArea.width)
  const height = Math.min(defaultAuxiliaryWindowSize.height, workArea.height)
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height
  return {
    x: clamp(Math.round(dropPoint.x - 80), workArea.x, maxX),
    y: clamp(Math.round(dropPoint.y - 24), workArea.y, maxY),
    width,
    height,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
