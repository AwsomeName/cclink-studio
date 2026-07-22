import type { NormalizedRecord } from '@shared/ipc/data-source'

export interface DataSourceContextSurface {
  getRecord: (recordId: string) => NormalizedRecord | null
  mountRecord: (recordId: string) => void
}

const surfaces = new Map<string, DataSourceContextSurface>()

export function registerDataSourceContextSurface(
  tabId: string,
  surface: DataSourceContextSurface,
): () => void {
  surfaces.set(tabId, surface)
  return () => {
    if (surfaces.get(tabId) === surface) surfaces.delete(tabId)
  }
}

export function getDataSourceContextSurface(tabId: string): DataSourceContextSurface | null {
  return surfaces.get(tabId) ?? null
}
