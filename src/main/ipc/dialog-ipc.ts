/**
 * 对话框 IPC 处理器
 *
 * 封装 Electron dialog API，暴露给渲染进程用于：
 * - browser_upload_file 工具需要用户选择本地文件
 * - 未来导出文档时让用户选择保存位置
 */

import { dialog, type BrowserWindow } from 'electron'
import { dialogIpcContracts as dialogIpc } from '../../shared/ipc/dialog-contract'
import { registerTrustedIpcContract, type TrustedRendererGuard } from './trusted-renderer-guard'
export type {
  MessageBoxOptions,
  OpenDialogOptions,
  SaveDialogOptions,
} from '../../shared/ipc/dialog'

/**
 * 注册对话框相关的 IPC 处理器
 */
export function registerDialogIpc(
  mainWindow: BrowserWindow,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  /** 打开文件选择对话框 */
  registerTrustedIpcContract(
    dialogIpc.showOpenDialog,
    trustedRendererGuard,
    async (_event, options) => {
      if (mainWindow.isDestroyed()) {
        return { canceled: true, filePaths: [] }
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: options?.title ?? (options?.selectDirectory ? '选择文件夹' : '选择文件'),
        properties: options?.selectDirectory
          ? ['openDirectory']
          : ['openFile', ...(options?.multiSelections ? ['multiSelections' as const] : [])],
        filters: options?.filters,
      })
      return {
        canceled: result.canceled,
        filePaths: result.filePaths,
      }
    },
  )

  /** 打开保存文件对话框 */
  registerTrustedIpcContract(
    dialogIpc.showSaveDialog,
    trustedRendererGuard,
    async (_event, options) => {
      if (mainWindow.isDestroyed()) {
        return { canceled: true, filePath: '' }
      }
      const result = await dialog.showSaveDialog(mainWindow, {
        title: options?.title ?? '保存文件',
        defaultPath: options?.defaultPath,
        filters: options?.filters,
      })
      return {
        canceled: result.canceled,
        filePath: result.filePath ?? '',
      }
    },
  )

  /** 打开普通消息对话框 */
  registerTrustedIpcContract(
    dialogIpc.showMessageBox,
    trustedRendererGuard,
    async (_event, options) => {
      if (mainWindow.isDestroyed()) {
        return { response: options.cancelId ?? 0 }
      }
      return dialog.showMessageBox(mainWindow, {
        type: options.type ?? 'none',
        title: options.title,
        message: options.message,
        detail: options.detail,
        buttons: options.buttons,
        defaultId: options.defaultId,
        cancelId: options.cancelId,
      })
    },
  )
}
