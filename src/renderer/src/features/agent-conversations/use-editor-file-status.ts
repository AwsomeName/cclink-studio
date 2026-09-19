import { useShallow } from 'zustand/react/shallow'
import { useEditorStore, type EditorFileState } from '../../stores/editor-store'

const clean = { dirty: false }
const dirty = { dirty: true }

/** Resource suggestions and context chips need file identity/dirty state, never the body. */
export function selectEditorFileStatus(state: {
  files: Record<string, EditorFileState>
}): Record<string, { dirty: boolean }> {
  return Object.fromEntries(
    Object.entries(state.files).map(([key, file]) => [key, file.dirty ? dirty : clean]),
  )
}

export function useEditorFileStatus(): Record<string, { dirty: boolean }> {
  return useEditorStore(useShallow(selectEditorFileStatus))
}
