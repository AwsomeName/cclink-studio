import type { ContextTarget } from './context-target'

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
  | 'table-add-row-before'
  | 'table-add-row-after'
  | 'table-delete-row'
  | 'table-delete-column'
  | 'table-delete'

/** The single command behind 添加到会话: context menu, selection bar, ⌘L and the palette. */
export const SEND_SELECTION_COMMAND_ID = 'markdown.sendSelectionToConversation'

/** What the editor would pass to the context menu for its current selection. */
export type EditorSelectionTarget = Extract<ContextTarget, { kind: 'editor' }>

export interface EditorContextSurface {
  isFocused?: () => boolean
  /** The current selection as a context target (⌘L and the command palette use it). */
  getSelectionTarget?: () => EditorSelectionTarget | null
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

/** The editor that currently has keyboard focus, whether it is a tab or embedded in a page. */
export function getFocusedEditorSurface(): EditorContextSurface | null {
  for (const surface of surfaces.values()) if (surface.isFocused?.()) return surface
  return null
}
