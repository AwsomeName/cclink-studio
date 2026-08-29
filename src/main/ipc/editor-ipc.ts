/**
 * 编辑器 IPC 处理器
 *
 * 处理渲染进程回传的编辑器操作结果：
 * - editor:readResponse — 编辑器内容读取响应
 * - editor:saveResult — 保存操作结果
 */

import { editorIpcContracts } from '../../shared/ipc/workbench-contract'
import type { EditorToolModule } from '../mcp/modules/editor'
import { registerTrustedIpcContract, type TrustedRendererGuard } from './trusted-renderer-guard'

/**
 * 注册编辑器相关 IPC 处理器
 */
export function registerEditorIpc(
  editorModule: EditorToolModule,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  // 编辑器内容读取响应（renderer → main）
  registerTrustedIpcContract(
    editorIpcContracts.readResponse,
    trustedRendererGuard,
    (_event, id, content) => editorModule.resolveOperation(id, { content }),
  )

  // 编辑器保存结果（renderer → main）
  registerTrustedIpcContract(
    editorIpcContracts.saveResult,
    trustedRendererGuard,
    (_event, id, success, error) => {
      if (success) editorModule.resolveOperation(id, { success: true })
      else editorModule.rejectOperation(id, error ?? '保存失败')
    },
  )

  console.log('[CCLink Studio] 编辑器 IPC 已注册')
}
