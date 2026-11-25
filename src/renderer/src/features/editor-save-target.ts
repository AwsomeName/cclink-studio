import type { EditorSessionState } from '@shared/ipc/editor'
import type { EditorFileState } from '../stores/editor-store'

export type EditorSaveTarget = { ok: true; filePath: string } | { ok: false; error: string }

export const EDITOR_SAVE_TARGET_NOT_OPEN = '目标文件未在当前编辑器会话中打开，无法保存'

/**
 * An Agent save request names the document it means. Any open editor session for that path may
 * be saved (a background Tab included); a path without a session fails at once instead of copying
 * another buffer into it. A request without a path means the active editor's document.
 */
export function resolveEditorSaveTarget(
  requestedFilePath: string | undefined,
  openFiles: Readonly<Record<string, EditorFileState>>,
  activeFilePath: string | null | undefined,
): EditorSaveTarget {
  const targetPath = requestedFilePath ?? activeFilePath
  if (!targetPath) return { ok: false, error: '无文件路径' }
  if (!openFiles[targetPath]) return { ok: false, error: EDITOR_SAVE_TARGET_NOT_OPEN }
  return { ok: true, filePath: targetPath }
}

/** What an Agent write to `filePath` would run into in this window. */
export function editorSessionState(
  openFiles: Readonly<Record<string, EditorFileState>>,
  filePath: string,
): EditorSessionState {
  const file = openFiles[filePath]
  if (!file) return { open: false, dirty: false, conflict: false }
  return {
    open: true,
    dirty: file.dirty || Boolean(file.saving),
    conflict: file.externalContent !== undefined,
  }
}
