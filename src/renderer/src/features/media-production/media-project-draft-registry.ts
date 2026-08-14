interface MediaProjectDraftSurface {
  save: () => Promise<boolean>
}

const surfaces = new Map<string, MediaProjectDraftSurface>()

export function registerMediaProjectDraft(
  tabId: string,
  surface: MediaProjectDraftSurface,
): () => void {
  surfaces.set(tabId, surface)
  return () => {
    if (surfaces.get(tabId) === surface) surfaces.delete(tabId)
  }
}

export function getMediaProjectDraft(tabId: string): MediaProjectDraftSurface | undefined {
  return surfaces.get(tabId)
}
