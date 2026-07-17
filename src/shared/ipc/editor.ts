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

export interface EditorApiContract {
  onContentUpdate: (callback: (update: EditorContentUpdate) => void) => () => void
  contentUpdateAck: (id: string, success?: boolean, error?: string) => Promise<void>
  onReadRequest: (callback: (request: EditorReadRequest) => void) => () => void
  readResponse: (id: string, content: string) => Promise<void>
  onSaveRequest: (callback: (request: EditorSaveRequest) => void) => () => void
  saveResult: (id: string, success: boolean, error?: string) => Promise<void>
}
