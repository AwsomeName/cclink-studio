interface TabDetachDragInput {
  tabType: string
  handledInsideTabBar: boolean
  cancelled: boolean
}

/** Renderer only decides whether this drag end is eligible for main-process cursor arbitration. */
export function shouldRequestTabDetach(input: TabDetachDragInput): boolean {
  return input.tabType === 'browser' && !input.handledInsideTabBar && !input.cancelled
}
