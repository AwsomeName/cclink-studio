export interface ImagePreviewContextSurface {
  copyImage(): Promise<void>
}

const surfaces = new Map<string, ImagePreviewContextSurface>()

export function registerImagePreviewContextSurface(
  tabId: string,
  surface: ImagePreviewContextSurface,
): () => void {
  surfaces.set(tabId, surface)
  return () => {
    if (surfaces.get(tabId) === surface) surfaces.delete(tabId)
  }
}

export function getImagePreviewContextSurface(
  tabId: string,
): ImagePreviewContextSurface | undefined {
  return surfaces.get(tabId)
}
