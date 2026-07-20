/**
 * 编辑器工具模块
 *
 * 提供 5 个 MCP 工具让 Agent 能操作主工作区的 Markdown 编辑器。
 * Agent 写入 Markdown → 渲染进程实时渲染为富文本。
 *
 * 工具通过 IPC 推送内容到渲染进程，等待 ack 确认。
 * 这与 PermissionManager 的 requestConfirmation 模式类似。
 */

import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { ToolModule, ToolDefinition } from '../../types'
import type {
  EditorContentUpdate,
  EditorReadRequest,
  EditorSaveRequest,
} from '../../../../shared/ipc/editor'
import type { DirEntry } from '../../../fs/file-service'

export interface EditorFileAccess {
  readFile(filePath: string): Promise<{ content: string; encoding: string }>
  readDir(dirPath: string, options?: { showHiddenFiles?: boolean }): Promise<DirEntry[]>
  writeFile(filePath: string, content: string): Promise<void>
}

/** 等待中的编辑器操作 */
interface PendingOperation {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/** 超时时间（毫秒） */
const OPERATION_TIMEOUT = 30_000

/**
 * 编辑器与工作区文本工具定义
 */
const EDITOR_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'editor_write',
    description:
      '写入完整 Markdown 文档。指定 filePath 时直接持久化到磁盘并自动创建父目录；省略 filePath 时只替换当前编辑器草稿。',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '完整的 Markdown 内容',
        },
        filePath: {
          type: 'string',
          description: '可选的目标文件路径。省略则写入当前活跃的编辑器 Tab。',
        },
        title: {
          type: 'string',
          description: '创建新 Tab 时的标题（如 "Report.md"）。默认 "Untitled.md"。',
        },
      },
      required: ['content'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'editor_append',
    description:
      '在 Markdown 文档末尾追加内容。指定 filePath 时直接持久化到磁盘；省略 filePath 时追加到当前编辑器草稿。',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要追加的 Markdown 内容',
        },
        filePath: {
          type: 'string',
          description: '可选的目标文件路径。省略则追加到当前活跃的编辑器 Tab。',
        },
      },
      required: ['content'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'editor_insert',
    description:
      '在 Markdown 文档指定位置插入内容。指定 filePath 时直接持久化到磁盘；省略 filePath 时操作当前编辑器草稿。position 可选 "start" 或 "end"。',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要插入的 Markdown 内容',
        },
        position: {
          type: 'string',
          description: '插入位置："start" 或 "end"。默认 "end"。',
        },
      },
      required: ['content', 'position'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'editor_read',
    description:
      '读取文本文件。指定 filePath 时直接读取磁盘文件，不要求文件已在编辑器中打开；省略 filePath 时读取当前活跃编辑器内容。不要用浏览器打开本地目录。',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '可选的文件路径。省略则读取当前活跃的编辑器 Tab。',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'editor_list',
    description:
      '列出本地目录中的文件和子目录，用于先确认项目结构再读取文件。不要猜测文件名，也不要用浏览器打开 file:// 目录。',
    inputSchema: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: '要列出的绝对目录路径。',
        },
        showHiddenFiles: {
          type: 'boolean',
          description: '是否显示点号开头的隐藏文件，默认 false。',
        },
      },
      required: ['dirPath'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'editor_save',
    description: '保存当前编辑器内容到磁盘。文件必须已关联文件路径。',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '可选的文件路径。省略则保存当前活跃的编辑器 Tab。',
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]

/**
 * 编辑器工具模块
 *
 * 将 Agent 的编辑请求通过 IPC 转发到渲染进程，
 * 等待渲染进程确认后返回结果。
 */
export class EditorToolModule implements ToolModule {
  readonly name = 'editor'
  readonly tools: ToolDefinition[] = EDITOR_TOOL_DEFINITIONS

  private mainWindow: BrowserWindow | null
  private readonly fileAccess: EditorFileAccess
  private pending: Map<string, PendingOperation> = new Map()

  constructor(mainWindow: BrowserWindow, fileAccess: EditorFileAccess) {
    this.mainWindow = mainWindow
    this.fileAccess = fileAccess
  }

  async execute(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      throw new Error('主窗口不可用')
    }

    const action = toolName.replace(/^editor_/, '')

    switch (action) {
      case 'write':
        return this.sendContentUpdate('write', params)
      case 'append':
        return this.sendContentUpdate('append', params)
      case 'insert':
        return this.sendContentUpdate('insert', params)
      case 'read':
        return this.requestRead(params)
      case 'list':
        return this.listDirectory(params)
      case 'save':
        return this.requestSave(params)
      default:
        throw new Error(`未知编辑器工具: ${toolName}`)
    }
  }

  /**
   * 推送内容更新到渲染进程，等待 ack
   */
  private async sendContentUpdate(
    type: 'write' | 'append' | 'insert',
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : ''
    const content = typeof params.content === 'string' ? params.content : ''
    if (filePath) {
      const nextContent = await this.resolveDiskContent(type, filePath, content, params.position)
      await this.fileAccess.writeFile(filePath, nextContent)
      const persisted = await this.fileAccess.readFile(filePath)
      if (persisted.encoding !== 'utf-8' || persisted.content !== nextContent) {
        throw new Error(`文件写入后校验失败: ${filePath}`)
      }
      return {
        success: true,
        persisted: true,
        verified: true,
        filePath,
        bytes: Buffer.byteLength(nextContent, 'utf-8'),
      }
    }

    return new Promise((resolve, reject) => {
      const id = randomUUID()

      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('编辑器操作超时'))
      }, OPERATION_TIMEOUT)

      this.pending.set(id, { resolve, reject, timeout })

      const payload: EditorContentUpdate = {
        id,
        type,
        content,
        position: params.position as string | undefined,
        title: params.title as string | undefined,
        timestamp: Date.now(),
      }

      this.mainWindow!.webContents.send('editor:contentUpdate', payload)
    })
  }

  private async resolveDiskContent(
    type: 'write' | 'append' | 'insert',
    filePath: string,
    content: string,
    position: unknown,
  ): Promise<string> {
    if (type === 'write') return content

    let current = ''
    try {
      const result = await this.fileAccess.readFile(filePath)
      if (result.encoding !== 'utf-8') {
        throw new Error(`不支持修改二进制文件: ${filePath}`)
      }
      current = result.content
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }

    return type === 'insert' && position === 'start'
      ? joinMarkdown(content, current)
      : joinMarkdown(current, content)
  }

  /**
   * 请求读取编辑器内容（renderer → main 返回内容）
   */
  private async requestRead(params: Record<string, unknown>): Promise<unknown> {
    const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : ''
    if (filePath) {
      const result = await this.fileAccess.readFile(filePath)
      if (result.encoding !== 'utf-8') {
        throw new Error(`不支持把二进制文件作为文本读取: ${filePath}`)
      }
      return { content: result.content }
    }

    return this.requestActiveEditorRead()
  }

  private requestActiveEditorRead(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID()

      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('编辑器读取超时'))
      }, OPERATION_TIMEOUT)

      this.pending.set(id, { resolve, reject, timeout })

      const request: EditorReadRequest = { id }
      this.mainWindow!.webContents.send('editor:readRequest', request)
    })
  }

  private async listDirectory(params: Record<string, unknown>): Promise<unknown> {
    const dirPath = typeof params.dirPath === 'string' ? params.dirPath.trim() : ''
    if (!dirPath) throw new Error('缺少要列出的目录路径')
    const entries = await this.fileAccess.readDir(dirPath, {
      showHiddenFiles: params.showHiddenFiles === true,
    })
    return { dirPath, entries }
  }

  /**
   * 请求保存编辑器
   */
  private requestSave(params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID()

      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('编辑器保存超时'))
      }, OPERATION_TIMEOUT)

      this.pending.set(id, { resolve, reject, timeout })

      const request: EditorSaveRequest = {
        id,
        filePath: params.filePath as string | undefined,
      }
      this.mainWindow!.webContents.send('editor:saveRequest', request)
    })
  }

  /**
   * 确认操作已完成（由 IPC handler 调用）
   */
  resolveOperation(id: string, result: unknown): void {
    const op = this.pending.get(id)
    if (!op) {
      console.warn(`[EditorToolModule] 未找到操作: ${id}`)
      return
    }

    clearTimeout(op.timeout)
    this.pending.delete(id)
    op.resolve(result)
  }

  /**
   * 拒绝操作（由 IPC handler 调用）
   */
  rejectOperation(id: string, error: string): void {
    const op = this.pending.get(id)
    if (!op) return

    clearTimeout(op.timeout)
    this.pending.delete(id)
    op.reject(new Error(error))
  }

  /** 销毁 */
  destroy(): void {
    for (const [, op] of this.pending) {
      clearTimeout(op.timeout)
      op.reject(new Error('模块销毁'))
    }
    this.pending.clear()
    this.mainWindow = null
  }
}

function joinMarkdown(before: string, after: string): string {
  if (!before) return after
  if (!after) return before
  return `${before.replace(/\s+$/, '')}\n\n${after.replace(/^\s+/, '')}`
}

function isMissingFileError(error: unknown): boolean {
  return (
    (error instanceof Error && /\bENOENT\b/.test(error.message)) ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT')
  )
}
