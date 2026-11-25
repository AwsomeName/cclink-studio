import { useEffect } from 'react'
import { editorSessionState, resolveEditorSaveTarget } from '../features/editor-save-target'
import { useEditorStore } from '../stores/editor-store'
import { useTabStore } from '../stores/tab-store'

function activeEditorPath(): string | null {
  const tab = useTabStore.getState().getActiveTab()
  return tab?.type === 'editor' ? (tab.filePath ?? null) : null
}

/**
 * Agent save and session-state requests are answered once, by the window, from the editor store
 * that owns every open document's draft — not by whichever editor component happens to be
 * mounted, so a background Tab is reachable and two mounted editors never race to answer.
 */
export function useEditorAgentRequests(): void {
  useEffect(() => {
    const editor = window.cclinkStudio.editor
    const offSave = editor.onSaveRequest(async (request) => {
      const target = resolveEditorSaveTarget(
        request.filePath,
        useEditorStore.getState().files,
        activeEditorPath(),
      )
      if (!target.ok) {
        void editor.saveResult(request.id, false, target.error)
        return
      }
      try {
        const result = await useEditorStore.getState().saveFile(target.filePath)
        void editor.saveResult(
          request.id,
          result === 'saved',
          result === 'conflict'
            ? '文件已被外部修改'
            : result === 'moved'
              ? '文件在保存期间已移动，请在新位置重新保存'
              : undefined,
        )
      } catch (error) {
        void editor.saveResult(
          request.id,
          false,
          error instanceof Error ? error.message : '保存失败',
        )
      }
    })
    const offSessionState = editor.onSessionStateRequest((request) => {
      void editor.sessionStateResult(
        request.id,
        editorSessionState(useEditorStore.getState().files, request.filePath),
      )
    })
    return () => {
      offSave()
      offSessionState()
    }
  }, [])
}
