export interface EditorContextSurface {
  getSelectionText: () => string
  cut: () => void | Promise<void>
  copy: () => void | Promise<void>
  paste: () => void | Promise<void>
  selectAll: () => void
}

const surfaces = new Map<string, EditorContextSurface>()

export function registerEditorContextSurface(
  tabId: string,
  surface: EditorContextSurface,
): () => void {
  surfaces.set(tabId, surface)
  return () => {
    if (surfaces.get(tabId) === surface) surfaces.delete(tabId)
  }
}

export function getEditorContextSurface(tabId: string): EditorContextSurface | null {
  return surfaces.get(tabId) ?? null
}
