export type MountedEditorSaveTarget = { ok: true; filePath: string } | { ok: false; error: string }

/**
 * A mounted editor may only answer save requests for the document it owns.
 * Falling back to the mounted path keeps compatibility with requests that omit
 * filePath, while an explicit mismatch must fail instead of copying the active
 * buffer into another file.
 */
export function resolveMountedEditorSaveTarget(
  requestedFilePath: string | undefined,
  mountedFilePath: string | null | undefined,
): MountedEditorSaveTarget {
  const targetPath = requestedFilePath ?? mountedFilePath
  if (!targetPath) return { ok: false, error: '无文件路径' }
  if (targetPath !== mountedFilePath) {
    return {
      ok: false,
      error: '目标文件未在当前编辑器会话中打开，无法保存',
    }
  }
  return { ok: true, filePath: targetPath }
}
