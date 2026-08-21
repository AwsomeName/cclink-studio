/**
 * 编辑器 Store
 *
 * 管理打开的编辑器文件状态：内容、脏标记、Agent 推送队列。
 * Tiptap Editor 实例由 React 组件持有，Store 只管理 Markdown 文本和状态。
 */

import { create } from 'zustand'
import type { EditorContentUpdate } from '@shared/ipc/editor'
import type { FsTextDocumentSnapshot } from '@shared/ipc/fs'
import {
  cclinkMarkdownMetadataLineOffset,
  collectMarkdownDestinations,
  decodeMarkdownPath,
  encodeMarkdownPath,
  isMarkdownDocumentPath,
  markdownAssetDirectoryName,
  rewriteMarkdownDestinations,
  splitMarkdownDestinationSuffix,
  stripCclinkMarkdownMetadata,
} from '@shared/markdown-document'
import type { MarkdownDiagnostic } from '../features/markdown/markdown-codec'
import { runEditorSaveGuard } from '../features/editor-save-guard'
import { isWorkspaceStateRestoring, persistWorkspaceSection } from '../utils/workspace-state'

/** 单个文件的编辑器状态 */
export interface EditorFileState {
  /** 仅用于当前 renderer 生命周期；关闭后重开会获得新身份，不持久化。 */
  sessionId?: number
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
  /** 磁盘文件头受控元数据占用的行数；编辑器正文不显示，但行号引用必须计入。 */
  sourceLineOffset?: number
  /** 外部修改产生的冲突快照 */
  externalContent?: string
  externalHash?: string
  /** 最近一次可见错误 */
  error?: string
}

export interface MarkdownViewState {
  /** Markdown 滚动容器相对文档顶部的位置。 */
  scrollTop: number
  /** 用于限制持久化条目数量，避免长期使用后无界增长。 */
  updatedAt: number
}

export type { EditorContentUpdate } from '@shared/ipc/editor'

interface EditorState {
  /** 打开的文件状态：filePath → EditorFileState */
  files: Record<string, EditorFileState>
  /** Markdown 阅读现场：filePath / virtual tab key → scroll state */
  markdownViewStates: Record<string, MarkdownViewState>
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
  saveFile: (
    filePath: string,
    options?: { force?: boolean },
  ) => Promise<'saved' | 'conflict' | 'moved'>

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

  /** 文件或目录移动后同步编辑缓冲和待处理更新的路径。 */
  rebaseFilePaths: (oldPrefix: string, newPrefix: string) => void

  /** Markdown 资源组成组移动后，用新的磁盘基线重定位打开中的草稿。 */
  relocateMarkdownFile: (oldPath: string, newPath: string, snapshot: FsTextDocumentSnapshot) => void

  /** 初始化虚拟文件（Agent 创建的无路径文档 / 复制 Tab 的种子内容） */
  initVirtualFile: (key: string, seed?: string) => void

  /** 从主进程 WorkspaceState 恢复编辑器草稿 */
  hydrateFromWorkspaceState: (value: unknown) => void

  /** 记录 Markdown 阅读位置；正文生命周期不拥有该视图状态。 */
  updateMarkdownViewState: (fileKey: string, scrollTop: number) => void
}

function normalizeMarkdownDiagnostics(diagnostics: MarkdownDiagnostic[]): MarkdownDiagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    // Selection/source mapping is transient operational state, not a document compatibility issue.
    if (diagnostic.code === 'source-map-mismatch') return false
    const key = JSON.stringify([
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.startLine ?? null,
      diagnostic.endLine ?? null,
    ])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sameMarkdownDiagnostics(left: MarkdownDiagnostic[], right: MarkdownDiagnostic[]): boolean {
  return (
    left.length === right.length &&
    left.every((diagnostic, index) => {
      const candidate = right[index]
      return (
        diagnostic.code === candidate.code &&
        diagnostic.severity === candidate.severity &&
        diagnostic.message === candidate.message &&
        diagnostic.startLine === candidate.startLine &&
        diagnostic.endLine === candidate.endLine
      )
    })
  )
}

interface EditorWorkspaceSnapshot {
  files: Record<string, EditorFileState>
  markdownViewStates: Record<string, MarkdownViewState>
}

function normalizeEditorWorkspaceSnapshot(value: unknown): EditorWorkspaceSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as {
    files?: Record<string, EditorFileState>
    markdownViewStates?: Record<string, MarkdownViewState>
  }
  const hasFiles = Boolean(parsed.files && typeof parsed.files === 'object')
  const hasViewStates = Boolean(
    parsed.markdownViewStates && typeof parsed.markdownViewStates === 'object',
  )
  if (!hasFiles && !hasViewStates) return null
  const files: Record<string, EditorFileState> = {}
  for (const [key, file] of Object.entries(parsed.files ?? {})) {
    if (!file || typeof file.currentContent !== 'string') continue
    files[key] = {
      sessionId: createEditorFileSessionId(),
      savedContent: typeof file.savedContent === 'string' ? file.savedContent : '',
      currentContent: file.currentContent,
      dirty: Boolean(file.dirty),
      loading: false,
      diagnostics: Array.isArray(file.diagnostics)
        ? normalizeMarkdownDiagnostics(file.diagnostics)
        : [],
      ...(typeof file.versionHash === 'string' ? { versionHash: file.versionHash } : {}),
      ...(typeof file.modifiedAt === 'number' ? { modifiedAt: file.modifiedAt } : {}),
      ...(typeof file.sourceLineOffset === 'number'
        ? { sourceLineOffset: file.sourceLineOffset }
        : {}),
      ...(typeof file.externalContent === 'string'
        ? { externalContent: file.externalContent }
        : {}),
      ...(typeof file.externalHash === 'string' ? { externalHash: file.externalHash } : {}),
      ...(typeof file.error === 'string' ? { error: file.error } : {}),
    }
  }
  const markdownViewStates: Record<string, MarkdownViewState> = {}
  for (const [key, viewState] of Object.entries(parsed.markdownViewStates ?? {})) {
    if (!viewState || typeof viewState !== 'object') continue
    if (!Number.isFinite(viewState.scrollTop) || viewState.scrollTop < 0) continue
    markdownViewStates[key] = {
      scrollTop: viewState.scrollTop,
      updatedAt: Number.isFinite(viewState.updatedAt) ? viewState.updatedAt : 0,
    }
  }
  return { files, markdownViewStates }
}

function getPersistableEditorFiles(
  files: Record<string, EditorFileState>,
): Record<string, EditorFileState> {
  const result: Record<string, EditorFileState> = {}
  for (const [key, file] of Object.entries(files)) {
    if (key.startsWith('virtual:') || file.dirty) {
      const { sessionId: _sessionId, ...persistable } = file
      result[key] = { ...persistable, loading: false }
    }
  }
  return result
}

function saveStoredEditorFiles(state: EditorState): void {
  try {
    if (isWorkspaceStateRestoring()) return
    const files = getPersistableEditorFiles(state.files)
    persistWorkspaceSection('editorDrafts', { files, markdownViewStates: state.markdownViewStates })
  } catch {
    // WorkspaceState 镜像失败不应影响当前编辑器状态。
  }
}

const pendingFileSaves = new Map<string, Promise<void>>()
let editorFileSessionSequence = 0

function createEditorFileSessionId(): number {
  editorFileSessionSequence += 1
  return editorFileSessionSequence
}

function ensureEditorFileSessionId(
  filePath: string,
  set: (updater: (state: EditorState) => Partial<EditorState> | EditorState) => void,
  get: () => EditorState,
): number | undefined {
  const existing = get().files[filePath]
  if (!existing) return undefined
  if (existing.sessionId !== undefined) return existing.sessionId
  const sessionId = createEditorFileSessionId()
  set((state) => {
    const file = state.files[filePath]
    if (!file || file.sessionId !== undefined) return state
    return {
      files: {
        ...state.files,
        [filePath]: { ...file, sessionId },
      },
    }
  })
  return get().files[filePath]?.sessionId
}

function findEditorFileSession(
  files: Record<string, EditorFileState>,
  sessionId: number,
): [filePath: string, file: EditorFileState] | undefined {
  return Object.entries(files).find(([, file]) => file.sessionId === sessionId)
}

function rebasePendingFileSavePaths(oldPrefix: string, newPrefix: string): void {
  for (const [path, pending] of [...pendingFileSaves]) {
    const nextPath = rebasePath(path, oldPrefix, newPrefix)
    if (!nextPath || nextPath === path) continue
    pendingFileSaves.delete(path)
    const existing = pendingFileSaves.get(nextPath)
    if (!existing || existing === pending) {
      pendingFileSaves.set(nextPath, pending)
      continue
    }
    const combined = Promise.all([existing, pending]).then(() => undefined)
    pendingFileSaves.set(nextPath, combined)
    void combined.finally(() => {
      if (pendingFileSaves.get(nextPath) === combined) pendingFileSaves.delete(nextPath)
    })
  }
}

/**
 * Serialize saves for one file so an older request can never finish after a
 * newer request and overwrite its disk snapshot. The operation reads EditorStore
 * only after it owns the turn, so a queued save captures the latest draft/hash.
 */
async function serializeFileSave<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingFileSaves.get(filePath)
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  pendingFileSaves.set(filePath, current)

  if (previous) await previous
  try {
    return await operation()
  } finally {
    release()
    for (const [path, pending] of pendingFileSaves) {
      if (pending === current) pendingFileSaves.delete(path)
    }
  }
}

function rebasePath(
  path: string | undefined,
  oldPrefix: string,
  newPrefix: string,
): string | undefined {
  if (!path) return path
  if (path === oldPrefix) return newPrefix
  if (path.startsWith(oldPrefix + '/')) return newPrefix + path.slice(oldPrefix.length)
  return path
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // 编辑器草稿按工作空间恢复，避免全局 localStorage 把其他项目草稿带入当前项目。
  files: {},
  markdownViewStates: {},
  pendingUpdates: [],

  openFile: async (filePath) => {
    const existing = get().files[filePath]
    if (existing?.dirty) return
    const sessionId = createEditorFileSessionId()

    // 先标记 loading
    set((state) => ({
      files: {
        ...state.files,
        [filePath]: {
          sessionId,
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
      set((state) => {
        const current = state.files[filePath]
        if (current?.sessionId !== sessionId) return state
        return {
          files: {
            ...state.files,
            [filePath]: fileStateFromSnapshot(snapshot, current.diagnostics ?? [], sessionId),
          },
        }
      })
    } catch (err) {
      console.error('[EditorStore] 打开文件失败:', filePath, err)
      // 加载失败时创建空文件状态
      set((state) => {
        if (state.files[filePath]?.sessionId !== sessionId) return state
        return {
          files: {
            ...state.files,
            [filePath]: {
              sessionId,
              savedContent: '',
              currentContent: '',
              dirty: false,
              loading: false,
              diagnostics: [],
              error: err instanceof Error ? err.message : '打开文件失败',
            },
          },
        }
      })
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

  saveFile: (requestedPath, options) => {
    const sessionId = ensureEditorFileSessionId(requestedPath, set, get)
    if (sessionId === undefined) return Promise.resolve('saved')
    return serializeFileSave(requestedPath, async () => {
      const located = findEditorFileSession(get().files, sessionId)
      if (!located) return 'moved'
      const [filePath] = located
      const guardResult = runEditorSaveGuard(filePath)
      if (guardResult) await guardResult
      const guarded = findEditorFileSession(get().files, sessionId)
      if (!guarded) return 'moved'
      const [guardedPath, file] = guarded
      if (guardedPath !== filePath) return 'moved'
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
          const completed = findEditorFileSession(get().files, sessionId)
          if (!completed || completed[0] !== filePath) return 'moved'
          if (result.status === 'conflict') {
            set((state) => {
              const latest = state.files[filePath]
              if (latest?.sessionId !== sessionId) return state
              return {
                files: {
                  ...state.files,
                  [filePath]: {
                    ...latest,
                    externalContent: result.current
                      ? editorContent(result.current.path, result.current.content)
                      : '',
                    externalHash: result.current?.hash,
                    modifiedAt: result.current?.modifiedAt,
                    error: '文件已被外部修改',
                  },
                },
              }
            })
            return 'conflict'
          }
          set((state) => {
            const latest = state.files[filePath]
            if (latest?.sessionId !== sessionId) return state
            const savedContent = file.currentContent
            const currentContent = latest?.currentContent ?? savedContent
            const snapshotState = fileStateFromSnapshot(
              result.snapshot,
              latest.diagnostics ?? [],
              sessionId,
            )
            return {
              files: {
                ...state.files,
                [filePath]: {
                  ...snapshotState,
                  // The snapshot may contain controlled metadata or normalized
                  // line endings. Keep the exact editor buffer as the new local
                  // baseline so Markdown hydration does not rewrite the document
                  // immediately after its own save.
                  savedContent,
                  currentContent,
                  dirty: currentContent !== savedContent,
                },
              },
            }
          })
          return 'saved'
        }

        await fsApi.writeFile(filePath, file.currentContent)
        const completed = findEditorFileSession(get().files, sessionId)
        if (!completed || completed[0] !== filePath) return 'moved'
        set((state) => {
          const latest = state.files[filePath]
          if (latest?.sessionId !== sessionId) return state
          const currentContent = latest?.currentContent ?? file.currentContent
          return {
            files: {
              ...state.files,
              [filePath]: {
                ...latest,
                savedContent: file.currentContent,
                currentContent,
                dirty: currentContent !== file.currentContent,
                loading: false,
                externalContent: undefined,
                externalHash: undefined,
                error: undefined,
              },
            },
          }
        })
        return 'saved'
      } catch (err) {
        console.error('[EditorStore] 保存文件失败:', filePath, err)
        set((state) => {
          if (state.files[filePath]?.sessionId !== sessionId) return state
          return {
            files: {
              ...state.files,
              [filePath]: {
                ...state.files[filePath],
                error: err instanceof Error ? err.message : '保存文件失败',
              },
            },
          }
        })
        throw err
      }
    })
  },

  reloadFile: async (filePath) => {
    const sessionId = ensureEditorFileSessionId(filePath, set, get)
    if (sessionId === undefined) return
    const snapshot = await readTextSnapshot(filePath)
    set((state) => {
      const current = state.files[filePath]
      if (current?.sessionId !== sessionId) return state
      return {
        files: {
          ...state.files,
          [filePath]: fileStateFromSnapshot(snapshot, current.diagnostics ?? [], sessionId),
        },
      }
    })
  },

  checkExternalChange: async (filePath) => {
    const sessionId = ensureEditorFileSessionId(filePath, set, get)
    if (sessionId === undefined) return 'same'
    const snapshot = await readTextSnapshot(filePath)
    const latest = get().files[filePath]
    if (latest?.sessionId !== sessionId) return 'same'
    if (!latest.versionHash || snapshot.hash === latest.versionHash) return 'same'
    if (!latest.dirty) {
      set((state) => {
        const current = state.files[filePath]
        if (current?.sessionId !== sessionId || current.dirty) return state
        return {
          files: {
            ...state.files,
            [filePath]: fileStateFromSnapshot(snapshot, current.diagnostics ?? [], sessionId),
          },
        }
      })
      return 'reloaded'
    }
    set((state) => {
      const current = state.files[filePath]
      if (current?.sessionId !== sessionId) return state
      return {
        files: {
          ...state.files,
          [filePath]: {
            ...current,
            externalContent: snapshot.content,
            externalHash: snapshot.hash,
            modifiedAt: snapshot.modifiedAt,
            error: '文件已被外部修改',
          },
        },
      }
    })
    return 'conflict'
  },

  setDiagnostics: (filePath, diagnostics) =>
    set((state) => {
      const file = state.files[filePath]
      if (!file) return state
      const normalized = normalizeMarkdownDiagnostics(diagnostics)
      if (sameMarkdownDiagnostics(file.diagnostics ?? [], normalized)) return state
      return {
        files: {
          ...state.files,
          [filePath]: { ...file, diagnostics: normalized },
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

  rebaseFilePaths: (oldPrefix, newPrefix) => {
    if (oldPrefix === newPrefix) return
    rebasePendingFileSavePaths(oldPrefix, newPrefix)
    set((state) => {
      let changed = false
      const files: Record<string, EditorFileState> = {}
      for (const [path, file] of Object.entries(state.files)) {
        const nextPath = rebasePath(path, oldPrefix, newPrefix) ?? path
        if (nextPath !== path) changed = true
        files[nextPath] = file
      }
      const pendingUpdates = state.pendingUpdates.map((update) => {
        const filePath = rebasePath(update.filePath, oldPrefix, newPrefix)
        if (filePath === update.filePath) return update
        changed = true
        return { ...update, filePath }
      })
      const markdownViewStates: Record<string, MarkdownViewState> = {}
      for (const [path, viewState] of Object.entries(state.markdownViewStates)) {
        const nextPath = rebasePath(path, oldPrefix, newPrefix) ?? path
        if (nextPath !== path) changed = true
        markdownViewStates[nextPath] = viewState
      }
      return changed ? { files, markdownViewStates, pendingUpdates } : state
    })
  },

  relocateMarkdownFile: (oldPath, newPath, snapshot) => {
    rebasePendingFileSavePaths(oldPath, newPath)
    set((state) => {
      const existing = state.files[oldPath]
      const nextSavedContent = editorContent(newPath, snapshot.content)
      const { [oldPath]: _removed, ...remainingFiles } = state.files
      const files = { ...remainingFiles }
      if (existing) {
        const currentContent = existing.dirty
          ? rewriteRelocatedMarkdownDraft(
              existing.currentContent,
              existing.savedContent,
              nextSavedContent,
              oldPath,
              newPath,
            )
          : nextSavedContent
        files[newPath] = {
          ...existing,
          savedContent: nextSavedContent,
          currentContent,
          dirty: currentContent !== nextSavedContent,
          loading: false,
          versionHash: snapshot.hash || undefined,
          modifiedAt: snapshot.modifiedAt,
          sourceLineOffset: cclinkMarkdownMetadataLineOffset(snapshot.content) || undefined,
          externalContent: undefined,
          externalHash: undefined,
          error: undefined,
        }
      }
      const pendingUpdates = state.pendingUpdates.map((update) =>
        update.filePath === oldPath ? { ...update, filePath: newPath } : update,
      )
      const { [oldPath]: movedViewState, ...remainingViewStates } = state.markdownViewStates
      const markdownViewStates = movedViewState
        ? { ...remainingViewStates, [newPath]: movedViewState }
        : state.markdownViewStates
      return { files, markdownViewStates, pendingUpdates }
    })
  },

  initVirtualFile: (key, seed = '') => {
    set((state) => {
      if (state.files[key]) return state
      // 虚拟文档从未落盘：savedContent 固定为 ''，dirty 反映「有未保存内容」
      return {
        files: {
          ...state.files,
          [key]: {
            sessionId: createEditorFileSessionId(),
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
    const snapshot = normalizeEditorWorkspaceSnapshot(value)
    if (!snapshot) return
    set(snapshot)
  },

  updateMarkdownViewState: (fileKey, scrollTop) => {
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return
    set((state) => {
      const previous = state.markdownViewStates[fileKey]
      if (previous && Math.abs(previous.scrollTop - scrollTop) < 1) return state
      const entries = Object.entries({
        ...state.markdownViewStates,
        [fileKey]: { scrollTop, updatedAt: Date.now() },
      })
      const markdownViewStates = Object.fromEntries(
        entries.sort(([, left], [, right]) => right.updatedAt - left.updatedAt).slice(0, 200),
      )
      return { markdownViewStates }
    })
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
  sessionId = createEditorFileSessionId(),
): EditorFileState {
  const content = editorContent(snapshot.path, snapshot.content)
  const sourceLineOffset = isMarkdownDocumentPath(snapshot.path)
    ? cclinkMarkdownMetadataLineOffset(snapshot.content)
    : 0
  return {
    sessionId,
    savedContent: content,
    currentContent: content,
    dirty: false,
    loading: false,
    diagnostics: normalizeMarkdownDiagnostics(diagnostics),
    versionHash: snapshot.hash || undefined,
    modifiedAt: snapshot.modifiedAt,
    ...(sourceLineOffset > 0 ? { sourceLineOffset } : {}),
  }
}

function editorContent(filePath: string, content: string): string {
  return isMarkdownDocumentPath(filePath) ? stripCclinkMarkdownMetadata(content) : content
}

function rewriteRelocatedMarkdownDraft(
  currentContent: string,
  previousSavedContent: string,
  nextSavedContent: string,
  oldPath: string,
  newPath: string,
): string {
  const previous = collectMarkdownDestinations(previousSavedContent)
  const next = collectMarkdownDestinations(nextSavedContent)
  const savedRewrites = new Map<string, string>()
  if (previous.length === next.length) {
    previous.forEach((destination, index) => {
      const nextDestination = next[index]
      if (nextDestination && destination.value !== nextDestination.value) {
        savedRewrites.set(destination.value, nextDestination.value)
      }
    })
  }
  const oldAssetDir = markdownAssetDirectoryName(oldPath)
  const newAssetDir = markdownAssetDirectoryName(newPath)
  return rewriteMarkdownDestinations(currentContent, (destination) => {
    const savedRewrite = savedRewrites.get(destination)
    if (savedRewrite) return savedRewrite
    const { path, suffix } = splitMarkdownDestinationSuffix(destination)
    const normalized = decodeMarkdownPath(path).replace(/^\.\//, '').replace(/\\/g, '/')
    if (normalized !== oldAssetDir && !normalized.startsWith(`${oldAssetDir}/`)) {
      return destination
    }
    return `${encodeMarkdownPath(`${newAssetDir}${normalized.slice(oldAssetDir.length)}`)}${suffix}`
  })
}
