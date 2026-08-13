import type { Editor } from '@tiptap/core'

interface MarkdownHydrationState {
  hasEditor: boolean
  hydratedVersion: string | null
  expectedVersion: string
  loadedFileKey?: string
  fileKey: string
}

export function setMarkdownEditorEditable(
  editor: Pick<Editor, 'setEditable'>,
  editable: boolean,
): void {
  // Tiptap emits an update by default even though editable is view state, not document content.
  // Suppress it so hydration/protection transitions cannot dirty or reserialize the Markdown buffer.
  editor.setEditable(editable, false)
}

export function shouldApplyMarkdownDocumentUpdate(
  hydrating: boolean,
  docChanged: boolean,
): boolean {
  return !hydrating && docChanged
}

export function isMarkdownHydrationPending({
  hasEditor,
  hydratedVersion,
  expectedVersion,
  loadedFileKey,
  fileKey,
}: MarkdownHydrationState): boolean {
  if (!hasEditor) return true
  if (hydratedVersion === expectedVersion) return false

  // A version/hash change for the document already mounted in this editor is
  // reconciled by the hydration effect. Keep the DOM mounted so a successful
  // save cannot reset the editor's scroll position.
  return loadedFileKey !== fileKey
}
