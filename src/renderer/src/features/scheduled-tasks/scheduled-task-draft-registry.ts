export interface ScheduledTaskDraftSurface {
  save: () => Promise<boolean>
}

const surfaces = new Map<string, ScheduledTaskDraftSurface>()

export function registerScheduledTaskDraft(
  tabId: string,
  surface: ScheduledTaskDraftSurface,
): () => void {
  surfaces.set(tabId, surface)
  return () => {
    if (surfaces.get(tabId) === surface) surfaces.delete(tabId)
  }
}

export function getScheduledTaskDraft(tabId: string): ScheduledTaskDraftSurface | undefined {
  return surfaces.get(tabId)
}
