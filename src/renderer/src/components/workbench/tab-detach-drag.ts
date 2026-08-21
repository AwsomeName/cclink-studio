interface TabDetachDragInput {
  tabType: string
  releasedInsideTabBar: boolean
  cancelled: boolean
}

export function hasExceededTabDragThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = 5,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold
}

/** Renderer only decides eligibility; main owns the native release point and window bounds. */
export function shouldRequestTabDetach(input: TabDetachDragInput): boolean {
  return input.tabType === 'browser' && !input.releasedInsideTabBar && !input.cancelled
}
