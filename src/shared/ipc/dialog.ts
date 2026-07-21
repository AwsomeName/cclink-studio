import { defineIpcCall } from './contract'

export interface DialogFileFilter {
  name: string
  extensions: string[]
}

export interface OpenDialogOptions {
  title?: string
  multiSelections?: boolean
  /** 选择目录而非文件（用于选择工作区根目录）。 */
  selectDirectory?: boolean
  filters?: DialogFileFilter[]
}

export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  filters?: DialogFileFilter[]
}

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
}

export interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface SaveDialogResult {
  canceled: boolean
  filePath: string
}

export interface MessageBoxResult {
  response: number
  checkboxChecked?: boolean
}

export interface DialogApiContract {
  showOpenDialog: (options?: OpenDialogOptions) => Promise<OpenDialogResult>
  showSaveDialog: (options?: SaveDialogOptions) => Promise<SaveDialogResult>
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxResult>
}

export const dialogIpc = {
  showOpenDialog: defineIpcCall<[OpenDialogOptions | undefined], OpenDialogResult>(
    'dialog:showOpenDialog',
  ),
  showSaveDialog: defineIpcCall<[SaveDialogOptions | undefined], SaveDialogResult>(
    'dialog:showSaveDialog',
  ),
  showMessageBox: defineIpcCall<[MessageBoxOptions], MessageBoxResult>('dialog:showMessageBox'),
} as const
