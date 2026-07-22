export interface OperationsContextSurface {
  hasPlatform: (platformId: string) => boolean
  openConfig: () => Promise<void>
  preparePlatformSession: (platformId: string) => void
  getPlatformStatus: (platformId: string) => string | null
}

const surfaces = new Map<string, OperationsContextSurface>()

export function registerOperationsContextSurface(
  workspaceKey: string,
  surface: OperationsContextSurface,
): () => void {
  surfaces.set(workspaceKey, surface)
  return () => {
    if (surfaces.get(workspaceKey) === surface) surfaces.delete(workspaceKey)
  }
}

export function getOperationsContextSurface(workspaceKey: string): OperationsContextSurface | null {
  return surfaces.get(workspaceKey) ?? null
}
