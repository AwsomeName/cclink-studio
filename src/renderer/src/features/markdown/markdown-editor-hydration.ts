interface MarkdownHydrationState {
  hasEditor: boolean
  hydratedVersion: string | null
  expectedVersion: string
  loadedFileKey?: string
  fileKey: string
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
