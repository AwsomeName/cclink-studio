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
  | 'insert-date-time'
  | 'insert-time'

export interface EditorContextSurface {
  isFocused?: () => boolean
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
/** Editors embedded in a page (My Space 今天 / 日记), not in a tab of their own. */
const embedded: EditorContextSurface[] = []

export function registerEditorContextSurface(
  tabId: string,
  surface: EditorContextSurface,
  options: { embedded?: boolean } = {},
): () => void {
  surfaces.set(tabId, surface)
  if (options.embedded) embedded.push(surface)
  return () => {
    if (surfaces.get(tabId) === surface) surfaces.delete(tabId)
    const index = embedded.indexOf(surface)
    if (index >= 0) embedded.splice(index, 1)
  }
}

/**
 * The editor embedded in the page shown by the home tab, if any. Markdown shortcuts and ⌘S use it
 * when the active tab is that home page, exactly as they use a Markdown tab's editor.
 */
export function getEmbeddedEditorSurface(): EditorContextSurface | null {
  return embedded.at(-1) ?? null
}

export function getEditorContextSurface(tabId: string): EditorContextSurface | null {
  return surfaces.get(tabId) ?? null
}
