/**
 * 编辑器 IPC 处理器
 *
 * 处理渲染进程回传的编辑器操作结果：
 * - editor:contentUpdateAck — Agent 内容推送的确认
 * - editor:readResponse — 编辑器内容读取响应
 * - editor:saveResult — 保存操作结果
 */

import { ipcMain } from 'electron'
import type { EditorToolModule } from '../mcp/modules/editor'

/**
 * 注册编辑器相关 IPC 处理器
 */
export function registerEditorIpc(editorModule: EditorToolModule): void {
  // Agent 内容更新确认（renderer → main）
  ipcMain.handle('editor:contentUpdateAck', (_event, id: string) => {
    editorModule.resolveOperation(id, { success: true })
  })

  // 编辑器内容读取响应（renderer → main）
  ipcMain.handle(
    'editor:readResponse',
    (_event, id: string, content: string) => {
      editorModule.resolveOperation(id, { content })
    },
  )

  // 编辑器保存结果（renderer → main）
  ipcMain.handle(
    'editor:saveResult',
    (_event, id: string, success: boolean, error?: string) => {
      if (success) {
        editorModule.resolveOperation(id, { success: true })
      } else {
        editorModule.rejectOperation(id, error ?? '保存失败')
      }
    },
  )

  console.log('[CCLink Studio] 编辑器 IPC 已注册')
}
