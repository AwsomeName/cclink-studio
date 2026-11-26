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
import type { ToolModule, ToolDefinition, ToolExecutionContext } from '../../types'
import {
  editorIpcEvents,
  type EditorReadRequest,
  type EditorSaveRequest,
  type EditorSessionState,
  type EditorSessionStateRequest,
} from '../../../../shared/ipc/editor'
import type { FsSaveTextDocumentResult, FsTextDocumentSnapshot } from '../../../../shared/ipc/fs'
import type { DirEntry } from '../../../fs/file-service'
import type { FileAccessContext } from '../../../fs/file-service'

export interface EditorFileAccess {
  readFile(filePath: string): Promise<{ content: string; encoding: string }>
  readDir(dirPath: string, options?: { showHiddenFiles?: boolean }): Promise<DirEntry[]>
  readTextDocument(filePath: string): Promise<FsTextDocumentSnapshot>
  /** Versioned, atomic document save (the same path the editor's own save uses). */
  saveTextDocument(input: {
    filePath: string
    content: string
    expectedHash?: string
  }): Promise<FsSaveTextDocumentResult>
  withAccess?<T>(context: FileAccessContext, operation: () => T): T
}

/** The renderer must answer quickly; a hung renderer must not let a write slip past a draft. */
const SESSION_STATE_TIMEOUT = 5_000

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
      '写入完整 Markdown 文档。必须指定 filePath，内容持久化到磁盘并自动创建父目录。若用户正在编辑器中修改该文件且尚未保存，会拒绝写入并返回 EDITOR_SESSION_DIRTY，不覆盖任何一方。图片显示宽度只能写成 <img src="路径" alt="说明" width="像素">；其他原始 HTML 所在的 Markdown 块会按原文显示和编辑。',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '完整的 Markdown 内容',
        },
        filePath: {
          type: 'string',
          description: '目标文件路径。',
        },
        title: {
          type: 'string',
          description: '创建新 Tab 时的标题（如 "Report.md"）。默认 "Untitled.md"。',
        },
      },
      required: ['content', 'filePath'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'editor_append',
    description:
      '在 Markdown 文档末尾追加内容。必须指定 filePath，内容持久化到磁盘。用户有未保存修改时返回 EDITOR_SESSION_DIRTY。',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要追加的 Markdown 内容',
        },
        filePath: {
          type: 'string',
          description: '目标文件路径。',
        },
      },
      required: ['content', 'filePath'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'editor_insert',
    description:
      '在 Markdown 文档指定位置插入内容。必须指定 filePath，position 可选 "start" 或 "end"。用户有未保存修改时返回 EDITOR_SESSION_DIRTY。',
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
        filePath: {
          type: 'string',
          description: '目标文件路径。',
        },
      },
      required: ['content', 'position', 'filePath'],
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
    description: '保存指定编辑器文件到磁盘，必须提供 filePath。',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要保存的文件路径。',
        },
      },
      required: ['filePath'],
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

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    context?.abortSignal?.throwIfAborted()
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      throw new Error('主窗口不可用')
    }

    const operation = async (): Promise<unknown> => {
      const action = toolName.replace(/^editor_/, '')
      switch (action) {
        case 'write':
          return this.sendContentUpdate('write', params, context?.abortSignal)
        case 'append':
          return this.sendContentUpdate('append', params, context?.abortSignal)
        case 'insert':
          return this.sendContentUpdate('insert', params, context?.abortSignal)
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
    return this.fileAccess.withAccess
      ? this.fileAccess.withAccess({ trustedWorkspace: context?.trustedWorkspace }, operation)
      : operation()
  }

  /**
   * 推送内容更新到渲染进程，等待 ack
   */
  private async sendContentUpdate(
    type: 'write' | 'append' | 'insert',
    params: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<unknown> {
    const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : ''
    const content = typeof params.content === 'string' ? params.content : ''
    if (!filePath) throw new Error('编辑器写入必须提供明确的文件路径')
    // An open document with unsaved edits owns the text: never write around the user's draft.
    const session = await this.querySessionState(filePath)
    if (session.dirty || session.conflict) {
      throw new Error(
        `EDITOR_SESSION_DIRTY: 用户正在编辑器中修改 ${filePath}，${
          session.conflict ? '且有待处理的外部变更冲突' : '且有未保存的修改'
        }；为避免覆盖，本次未写入。请让用户先保存或放弃修改后再试。`,
      )
    }
    abortSignal?.throwIfAborted()
    const disk = await this.readDiskDocument(filePath)
    const nextContent = mergeEditorContent(type, disk?.content ?? '', content, params.position)
    abortSignal?.throwIfAborted()
    const result = await this.fileAccess.saveTextDocument({
      filePath,
      content: nextContent,
      expectedHash: disk?.hash,
    })
    if (result.status === 'conflict') {
      throw new Error(
        `EDITOR_DISK_CHANGED: ${filePath} 在写入期间被其他程序修改，本次未写入；请重新读取后再试。`,
      )
    }
    return {
      success: true,
      persisted: true,
      verified: true,
      filePath,
      bytes: Buffer.byteLength(result.snapshot.content, 'utf-8'),
    }
  }

  /** The current disk text and its version, or null for a file that does not exist yet. */
  private async readDiskDocument(filePath: string): Promise<FsTextDocumentSnapshot | null> {
    try {
      const raw = await this.fileAccess.readFile(filePath)
      if (raw.encoding !== 'utf-8') throw new Error(`不支持修改二进制文件: ${filePath}`)
      return await this.fileAccess.readTextDocument(filePath)
    } catch (error) {
      if (isMissingFileError(error)) return null
      throw error
    }
  }

  /** Ask the renderer whether `filePath` has an editor session with unsaved edits. */
  querySessionState(filePath: string): Promise<EditorSessionState> {
    const window = this.mainWindow
    if (!window || window.isDestroyed()) {
      return Promise.resolve({ open: false, dirty: false, conflict: false })
    }
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new Error('EDITOR_SESSION_UNKNOWN: 无法确认编辑器中该文件是否有未保存修改，本次未写入'),
        )
      }, SESSION_STATE_TIMEOUT)
      this.pending.set(id, {
        resolve: (state) => resolve(state as EditorSessionState),
        reject,
        timeout,
      })
      const request: EditorSessionStateRequest = { id, filePath }
      window.webContents.send(editorIpcEvents.sessionStateRequest, request)
    })
  }

  /**
   * 请求读取编辑器内容（renderer → main 返回内容）
   */
  private async requestRead(params: Record<string, unknown>): Promise<unknown> {
    if (Object.keys(params).some((key) => key !== 'filePath')) {
      throw new Error('editor_read 只接受 filePath 参数；读取磁盘文件请传入 filePath，不是 path。')
    }
    if (
      params.filePath !== undefined &&
      (typeof params.filePath !== 'string' || !params.filePath.trim())
    ) {
      throw new Error('editor_read 的 filePath 必须是非空文件路径；读取当前编辑器请省略该参数。')
    }
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
      this.mainWindow!.webContents.send(editorIpcEvents.readRequest, request)
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
    const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : ''
    if (!filePath) return Promise.reject(new Error('编辑器保存必须提供明确的文件路径'))
    return new Promise((resolve, reject) => {
      const id = randomUUID()

      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('编辑器保存超时'))
      }, OPERATION_TIMEOUT)

      this.pending.set(id, { resolve, reject, timeout })

      const request: EditorSaveRequest = {
        id,
        filePath,
      }
      this.mainWindow!.webContents.send(editorIpcEvents.saveRequest, request)
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

function mergeEditorContent(
  type: 'write' | 'append' | 'insert',
  current: string,
  content: string,
  position: unknown,
): string {
  if (type === 'write') return content
  return type === 'insert' && position === 'start'
    ? joinMarkdown(content, current)
    : joinMarkdown(current, content)
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
