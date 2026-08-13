export type EditorSaveGuard = () => void | Promise<void>

const editorSaveGuards = new Map<string, EditorSaveGuard>()

export function registerEditorSaveGuard(fileKey: string, guard: EditorSaveGuard): () => void {
  editorSaveGuards.set(fileKey, guard)
  return () => {
    if (editorSaveGuards.get(fileKey) === guard) editorSaveGuards.delete(fileKey)
  }
}

export function runEditorSaveGuard(fileKey: string): void | Promise<void> {
  return editorSaveGuards.get(fileKey)?.()
}
