export type FileTreeClipboardShortcut = 'copy' | 'paste'

export function resolveFileTreeClipboardShortcut(input: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing: boolean
  isTextEditing: boolean
}): FileTreeClipboardShortcut | null {
  if (
    input.isComposing ||
    input.isTextEditing ||
    input.altKey ||
    input.shiftKey ||
    (!input.metaKey && !input.ctrlKey)
  ) {
    return null
  }
  const key = input.key.toLowerCase()
  if (key === 'c') return 'copy'
  if (key === 'v') return 'paste'
  return null
}
