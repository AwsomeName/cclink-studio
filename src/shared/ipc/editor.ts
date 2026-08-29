import { defineIpcCall } from './contract'

export type EditorContentUpdateType = 'write' | 'append' | 'insert'

export interface EditorContentUpdate {
  /** 唯一请求 ID */
  id: string
  /** 操作类型 */
  type: EditorContentUpdateType
  /** Markdown 内容 */
  content: string
  /** 目标文件路径（空 = 当前活跃编辑器） */
  filePath?: string
  /** 插入位置（仅 insert 类型） */
  position?: string
  /** 用于创建新 Tab 时的标题 */
  title?: string
  /** 时间戳 */
  timestamp: number
}

export interface EditorReadRequest {
  id: string
  filePath?: string
}

export interface EditorSaveRequest {
  id: string
  filePath?: string
}

function parseEditorRequest<T extends EditorReadRequest | EditorSaveRequest>(
  value: unknown,
): T | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const request = value as Partial<T>
  if (
    typeof request.id !== 'string' ||
    request.id.length === 0 ||
    request.id.length > 256 ||
    request.id.includes('\0')
  ) {
    return null
  }
  if (
    request.filePath !== undefined &&
    (typeof request.filePath !== 'string' ||
      request.filePath.length === 0 ||
      request.filePath.length > 32_768 ||
      request.filePath.includes('\0'))
  ) {
    return null
  }
  return value as T
}

export const parseEditorReadRequest = (value: unknown): EditorReadRequest | null =>
  parseEditorRequest<EditorReadRequest>(value)

export const parseEditorSaveRequest = (value: unknown): EditorSaveRequest | null =>
  parseEditorRequest<EditorSaveRequest>(value)

export interface EditorApiContract {
  onReadRequest: (callback: (request: EditorReadRequest) => void) => () => void
  readResponse: (id: string, content: string) => Promise<void>
  onSaveRequest: (callback: (request: EditorSaveRequest) => void) => () => void
  saveResult: (id: string, success: boolean, error?: string) => Promise<void>
}

export const editorIpc = {
  readResponse: defineIpcCall<[id: string, content: string], void>('editor:readResponse'),
  saveResult: defineIpcCall<[id: string, success: boolean, error: string | undefined], void>(
    'editor:saveResult',
  ),
} as const

export const editorIpcEvents = {
  readRequest: 'editor:readRequest',
  saveRequest: 'editor:saveRequest',
} as const
