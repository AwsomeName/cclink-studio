/**
 * 编辑器 Store
 *
 * 管理打开的编辑器文件状态：内容、脏标记、Agent 推送队列。
 * Tiptap Editor 实例由 React 组件持有，Store 只管理 Markdown 文本和状态。
 */

import { create } from 'zustand'
import type { EditorContentUpdate } from '@shared/ipc/editor'
import type { FsTextDocumentSnapshot } from '@shared/ipc/fs'
import type { MarkdownDiagnostic } from '../features/markdown/markdown-codec'
import { isWorkspaceStateRestoring, persistWorkspaceSection } from '../utils/workspace-state'

/** 单个文件的编辑器状态 */
export interface EditorFileState {
  /** 上次保存/加载时的 Markdown 内容 */
  savedContent: string
  /** 当前 Markdown 内容（与 savedContent 不同 = dirty） */
  currentContent: string
  /** 是否有未保存的修改 */
  dirty: boolean
  /** 是否正在加载 */
  loading: boolean
  /** Markdown 保真和兼容性诊断 */
  diagnostics?: MarkdownDiagnostic[]
  /** 最近一次读取/保存的磁盘内容指纹 */
  versionHash?: string
  modifiedAt?: number
  /** 外部修改产生的冲突快照 */
  externalContent?: string
  externalHash?: string
  /** 最近一次可见错误 */
  error?: string
}

export type { EditorContentUpdate } from '@shared/ipc/editor'

interface EditorState {
  /** 打开的文件状态：filePath → EditorFileState */
  files: Record<string, EditorFileState>
  /** Agent 推送的内容更新队列 */
  pendingUpdates: EditorContentUpdate[]

  // --- Actions ---

  /** 打开文件：从磁盘读取，初始化状态 */
  openFile: (filePath: string) => Promise<void>

  /** 关闭文件：从状态中移除 */
  closeFile: (filePath: string) => void

  /** 更新内容（用户编辑时调用，标 dirty） */
  updateContent: (filePath: string, markdown: string) => void

  /** 保存文件：写入磁盘，清 dirty */
  saveFile: (filePath: string, options?: { force?: boolean }) => Promise<'saved' | 'conflict'>

  /** 重新从磁盘载入文件 */
  reloadFile: (filePath: string) => Promise<void>

  /** 检查文件是否被外部程序修改 */
  checkExternalChange: (filePath: string) => Promise<'same' | 'reloaded' | 'conflict'>

  /** 更新 Markdown 诊断 */
  setDiagnostics: (filePath: string, diagnostics: MarkdownDiagnostic[]) => void

  /** 清除外部冲突 */
  clearConflict: (filePath: string) => void

  /** 判断文件是否有未保存修改 */
  isDirty: (filePath: string) => boolean

  /** 获取文件的已保存内容 */
  getSavedContent: (filePath: string) => string | undefined

  /** 应用 Agent 推送的内容更新 */
  applyAgentUpdate: (update: EditorContentUpdate) => void

  /** 确认一个更新已应用 */
  ackUpdate: (id: string) => void

  /** 获取并消费指定文件的待处理更新 */
  consumePendingUpdates: (filePath: string | undefined) => EditorContentUpdate[]

  /** 初始化虚拟文件（Agent 创建的无路径文档 / 复制 Tab 的种子内容） */
  initVirtualFile: (key: string, seed?: string) => void

  /** 从主进程 WorkspaceState 恢复编辑器草稿 */
  hydrateFromWorkspaceState: (value: unknown) => void
}

function normalizeEditorDrafts(value: unknown): Record<string, EditorFileState> | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as { files?: Record<string, EditorFileState> }
  if (parsed.files && Object.keys(parsed.files).length === 0) return {}
  const files: Record<string, EditorFileState> = {}
  for (const [key, file] of Object.entries(parsed.files ?? {})) {
    if (!file || typeof file.currentContent !== 'string') continue
    files[key] = {
      savedContent: typeof file.savedContent === 'string' ? file.savedContent : '',
      currentContent: file.currentContent,
      dirty: Boolean(file.dirty),
      loading: false,
      diagnostics: Array.isArray(file.diagnostics) ? file.diagnostics : [],
      ...(typeof file.versionHash === 'string' ? { versionHash: file.versionHash } : {}),
      ...(typeof file.modifiedAt === 'number' ? { modifiedAt: file.modifiedAt } : {}),
      ...(typeof file.externalContent === 'string'
        ? { externalContent: file.externalContent }
        : {}),
      ...(typeof file.externalHash === 'string' ? { externalHash: file.externalHash } : {}),
      ...(typeof file.error === 'string' ? { error: file.error } : {}),
    }
  }
  return Object.keys(files).length > 0 ? files : null
}

function getPersistableEditorFiles(
  files: Record<string, EditorFileState>,
): Record<string, EditorFileState> {
  const result: Record<string, EditorFileState> = {}
  for (const [key, file] of Object.entries(files)) {
    if (key.startsWith('virtual:') || file.dirty) {
      result[key] = { ...file, loading: false }
    }
  }
  return result
}

function saveStoredEditorFiles(state: EditorState): void {
  try {
    if (isWorkspaceStateRestoring()) return
    const files = getPersistableEditorFiles(state.files)
    persistWorkspaceSection('editorDrafts', { files })
  } catch {
    // WorkspaceState 镜像失败不应影响当前编辑器状态。
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // 编辑器草稿按工作空间恢复，避免全局 localStorage 把其他项目草稿带入当前项目。
  files: {},
  pendingUpdates: [],

  openFile: async (filePath) => {
    const existing = get().files[filePath]
    if (existing?.dirty) return

    // 先标记 loading
    set((state) => ({
      files: {
        ...state.files,
        [filePath]: {
          savedContent: '',
          currentContent: '',
          dirty: false,
          loading: true,
          diagnostics: existing?.diagnostics ?? [],
        },
      },
    }))

    try {
      const snapshot = await readTextSnapshot(filePath)
      set((state) => ({
        files: {
          ...state.files,
          [filePath]: fileStateFromSnapshot(snapshot, state.files[filePath]?.diagnostics ?? []),
        },
      }))
    } catch (err) {
      console.error('[EditorStore] 打开文件失败:', filePath, err)
      // 加载失败时创建空文件状态
      set((state) => ({
        files: {
          ...state.files,
          [filePath]: {
            savedContent: '',
            currentContent: '',
            dirty: false,
            loading: false,
            diagnostics: [],
            error: err instanceof Error ? err.message : '打开文件失败',
          },
        },
      }))
    }
  },

  closeFile: (filePath) => {
    set((state) => {
      const { [filePath]: _, ...rest } = state.files
      return { files: rest }
    })
  },

  updateContent: (filePath, markdown) => {
    set((state) => {
      const file = state.files[filePath]
      if (!file) return state
      return {
        files: {
          ...state.files,
          [filePath]: {
            ...file,
            currentContent: markdown,
            dirty: markdown !== file.savedContent,
          },
        },
      }
    })
  },

  saveFile: async (filePath, options) => {
    const file = get().files[filePath]
    if (!file) return 'saved'
    const blockingDiagnostic = file.diagnostics?.find(
      (diagnostic) => diagnostic.severity === 'error',
    )
    if (blockingDiagnostic) {
      throw new Error(blockingDiagnostic.message)
    }

    try {
      const fsApi = window.cclinkStudio.fs
      if (fsApi.saveTextDocument) {
        const result = await fsApi.saveTextDocument({
          filePath,
          content: file.currentContent,
          expectedHash: file.versionHash,
          force: options?.force,
        })
        if (result.status === 'conflict') {
          set((state) => ({
            files: {
              ...state.files,
              [filePath]: {
                ...state.files[filePath],
                externalContent: result.current?.content ?? '',
                externalHash: result.current?.hash,
                modifiedAt: result.current?.modifiedAt,
                error: '文件已被外部修改',
              },
            },
          }))
          return 'conflict'
        }
        set((state) => ({
          files: {
            ...state.files,
            [filePath]: fileStateFromSnapshot(
              result.snapshot,
              state.files[filePath]?.diagnostics ?? [],
            ),
          },
        }))
        return 'saved'
      }

      await fsApi.writeFile(filePath, file.currentContent)
      set((state) => ({
        files: {
          ...state.files,
          [filePath]: {
            ...state.files[filePath],
            savedContent: file.currentContent,
            dirty: false,
            externalContent: undefined,
            externalHash: undefined,
            error: undefined,
          },
        },
      }))
      return 'saved'
    } catch (err) {
      console.error('[EditorStore] 保存文件失败:', filePath, err)
      set((state) => ({
        files: {
          ...state.files,
          [filePath]: {
            ...state.files[filePath],
            error: err instanceof Error ? err.message : '保存文件失败',
          },
        },
      }))
      throw err
    }
  },

  reloadFile: async (filePath) => {
    const snapshot = await readTextSnapshot(filePath)
    set((state) => ({
      files: {
        ...state.files,
        [filePath]: fileStateFromSnapshot(snapshot, state.files[filePath]?.diagnostics ?? []),
      },
    }))
  },

  checkExternalChange: async (filePath) => {
    const current = get().files[filePath]
    if (!current) return 'same'
    const snapshot = await readTextSnapshot(filePath)
    if (!current.versionHash || snapshot.hash === current.versionHash) return 'same'
    if (!current.dirty) {
      set((state) => ({
        files: {
          ...state.files,
          [filePath]: fileStateFromSnapshot(snapshot, state.files[filePath]?.diagnostics ?? []),
        },
      }))
      return 'reloaded'
    }
    set((state) => ({
      files: {
        ...state.files,
        [filePath]: {
          ...state.files[filePath],
          externalContent: snapshot.content,
          externalHash: snapshot.hash,
          modifiedAt: snapshot.modifiedAt,
          error: '文件已被外部修改',
        },
      },
    }))
    return 'conflict'
  },

  setDiagnostics: (filePath, diagnostics) =>
    set((state) => {
      const file = state.files[filePath]
      if (!file) return state
      return {
        files: {
          ...state.files,
          [filePath]: { ...file, diagnostics },
        },
      }
    }),

  clearConflict: (filePath) =>
    set((state) => {
      const file = state.files[filePath]
      if (!file) return state
      return {
        files: {
          ...state.files,
          [filePath]: {
            ...file,
            externalContent: undefined,
            externalHash: undefined,
            error: undefined,
          },
        },
      }
    }),

  isDirty: (filePath) => {
    return get().files[filePath]?.dirty ?? false
  },

  getSavedContent: (filePath) => {
    return get().files[filePath]?.savedContent
  },

  applyAgentUpdate: (update) => {
    set((state) => ({
      pendingUpdates: [...state.pendingUpdates, update],
    }))
  },

  ackUpdate: (id) => {
    set((state) => ({
      pendingUpdates: state.pendingUpdates.filter((u) => u.id !== id),
    }))
  },

  consumePendingUpdates: (filePath) => {
    const updates = get().pendingUpdates.filter(
      (u) => u.filePath === filePath || (!u.filePath && !filePath),
    )
    if (updates.length > 0) {
      // 移除已消费的更新：取 match filter 的反集
      const consumedIds = new Set(updates.map((u) => u.id))
      set((state) => ({
        pendingUpdates: state.pendingUpdates.filter((u) => !consumedIds.has(u.id)),
      }))
    }
    return updates
  },

  initVirtualFile: (key, seed = '') => {
    set((state) => {
      if (state.files[key]) return state
      // 虚拟文档从未落盘：savedContent 固定为 ''，dirty 反映「有未保存内容」
      return {
        files: {
          ...state.files,
          [key]: {
            savedContent: '',
            currentContent: seed,
            dirty: seed !== '',
            loading: false,
            diagnostics: [],
          },
        },
      }
    })
  },

  hydrateFromWorkspaceState: (value) => {
    const files = normalizeEditorDrafts(value)
    if (!files) return
    set({ files })
  },
}))

useEditorStore.subscribe((state) => {
  saveStoredEditorFiles(state)
})

async function readTextSnapshot(filePath: string): Promise<FsTextDocumentSnapshot> {
  const fsApi = window.cclinkStudio.fs
  if (fsApi.readTextDocument) return fsApi.readTextDocument(filePath)
  const result = await fsApi.readFile(filePath)
  const content = typeof result === 'string' ? result : result.content
  return {
    path: filePath,
    content,
    size: new TextEncoder().encode(content).byteLength,
    modifiedAt: Date.now(),
    hash: '',
  }
}

function fileStateFromSnapshot(
  snapshot: FsTextDocumentSnapshot,
  diagnostics: MarkdownDiagnostic[] = [],
): EditorFileState {
  return {
    savedContent: snapshot.content,
    currentContent: snapshot.content,
    dirty: false,
    loading: false,
    diagnostics,
    versionHash: snapshot.hash || undefined,
    modifiedAt: snapshot.modifiedAt,
  }
}
