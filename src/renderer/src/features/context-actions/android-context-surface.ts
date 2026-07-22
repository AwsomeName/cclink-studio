export interface AndroidContextSurface {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}

const surfaces = new Map<string, AndroidContextSurface>()

export function registerAndroidContextSurface(
  tabId: string,
  surface: AndroidContextSurface,
): () => void {
  surfaces.set(tabId, surface)
  return () => {
    if (surfaces.get(tabId) === surface) surfaces.delete(tabId)
  }
}

export function getAndroidContextSurface(tabId: string): AndroidContextSurface | null {
  return surfaces.get(tabId) ?? null
}
