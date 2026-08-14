export type MarkdownEditorAction =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inline-code'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'blockquote'
  | 'code-block'
  | 'hard-break'
  | 'link'
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'indent-list'
  | 'outdent-list'

export interface EditorContextSurface {
  getSelectionText: () => string
  cut: () => void | Promise<void>
  copy: () => void | Promise<void>
  paste: () => void | Promise<void>
  selectAll: () => void
  openFind: () => void
  closeFind: () => void
  save?: () => boolean | void | Promise<boolean | void>
  runMarkdownAction?: (action: MarkdownEditorAction) => boolean
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
