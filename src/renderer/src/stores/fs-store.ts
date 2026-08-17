import { create } from 'zustand'
import type { AppSettings } from '../../../shared/ipc/settings'
import type { FsCopyEntryResult, FsDirEntry } from '../../../shared/ipc/fs'
import {
  globalWorkspaceRef,
  localWorkspaceRef,
  workspaceRefKey,
} from '../../../shared/workspace-ref'
import {
  getWorkspaceStateOwnerKey,
  persistWorkspaceSection,
  setWorkspaceStatePath,
} from '../utils/workspace-state'
import {
  applyWorkspaceRuntimeTransition,
  beginWorkspaceRuntimeTransition,
  isWorkspaceRuntimeTransitionCurrent,
  prepareWorkspaceRuntimeTransition,
} from '../utils/workspace-transition'
import { hydrateRuntimeSections } from '../utils/workspace-runtime'
import {
  filterExistingWorkspacePaths,
  getRecentWorkspacePaths,
  normalizeWorkspacePath,
  resolveWorkspaceCandidate,
  saveRecentWorkspaceFallback,
  updateRecentWorkspacePaths,
} from '../utils/workspace-paths'
import {
  findFileTreeNode,
  normalizeFileTreeState,
  prepareWorkspaceTree,
  type FileTreeNode,
  type WorkspaceTreeProjection,
} from '../utils/workspace-tree'
import { useAgentStore } from './agent-store'
import { useBrowserStore } from './browser-store'
import { useOpenProjectsStore } from './open-projects-store'
import { useEditorStore } from './editor-store'
import { useTabStore } from './tab-store'
import { useWorkspaceStore } from './workspace-store'
import { isMarkdownDocumentPath } from '@shared/markdown-document'
import { toLocalFileUrl } from '../utils/html-files'

/** setWorkspace 的最新请求序号（模块级，用于丢弃过期的并发结果，避免竞态） */
let setWorkspaceSeq = 0
let refreshWorkspacePromise: Promise<void> | null = null
let refreshWorkspaceQueued = false

/** 提取父目录路径 */
function parentDir(filePath: string): string {
  const i = filePath.lastIndexOf('/')
  return i > 0 ? filePath.slice(0, i) : '/'
}

function hasPathSeparator(name: string): boolean {
  return name.includes('/') || name.includes('\\')
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function isPathWithin(root: string, path: string): boolean {
  return path === root || path.startsWith(root + '/')
}

function replacePathPrefix(
  path: string | null,
  oldPrefix: string,
  newPrefix: string,
): string | null {
  if (!path) return path
  if (path === oldPrefix) return newPrefix
  if (path.startsWith(oldPrefix + '/')) return newPrefix + path.slice(oldPrefix.length)
  return path
}

function updateRenamedTabTitle(filePath: string): void {
  const tabStore = useTabStore.getState()
  for (const tab of tabStore.tabs) {
    if (tab.filePath === filePath) {
      tabStore.updateTabTitle(tab.id, baseName(filePath))
    }
  }
}

function syncRenamedBrowserFileTabs(oldPath: string, newPath: string): void {
  const oldUrl = toLocalFileUrl(oldPath)
  const newUrl = toLocalFileUrl(newPath)
  const browserStore = useBrowserStore.getState()
  for (const tab of useTabStore.getState().tabs) {
    if (tab.type !== 'browser' || tab.filePath !== newPath) continue
    const browserTab = browserStore.tabs[tab.id]
    if (!browserTab || browserTab.url !== oldUrl) continue
    browserStore.setUrl(tab.id, newUrl, {
      history: browserTab.history.map((url) => (url === oldUrl ? newUrl : url)),
      historyIndex: browserTab.historyIndex,
    })
    void window.cclinkStudio.browser
      .navigate(tab.id, newUrl)
      .catch((error) => console.warn('[fs-store] 本地 HTML 重命名后重新导航失败:', error))
  }
}

/** 把任意错误归一化为用户可读文案，并友好化沙箱越界等常见错误 */
function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  if (/not in allowed|路径不在允许范围内/i.test(raw)) {
    return '该目录不在允许访问的范围内，请选择用户主目录（~）下的工作空间文件夹'
  }
  if (/EEXIST|already exists|file exists/i.test(raw)) {
    return '目标文件夹中已存在同名文件或文件夹'
  }
  return raw
}

const FS_STORAGE_KEY = 'cclink-studio-fs-state'

function loadFsPanelState(): { expandedPaths: string[]; selectedPath: string | null } {
  try {
    if (typeof localStorage === 'undefined') return { expandedPaths: [], selectedPath: null }
    const raw = localStorage.getItem(FS_STORAGE_KEY)
    if (!raw) return { expandedPaths: [], selectedPath: null }
    const parsed = JSON.parse(raw) as { expandedPaths?: string[]; selectedPath?: string | null }
    return {
      expandedPaths: Array.isArray(parsed.expandedPaths)
        ? parsed.expandedPaths.filter(Boolean)
        : [],
      selectedPath: parsed.selectedPath ?? null,
    }
  } catch {
    return { expandedPaths: [], selectedPath: null }
  }
}

function saveFsPanelState(
  state: Pick<FsState, 'expandedPaths' | 'selectedPath'>,
  workspacePath?: string | null,
): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      FS_STORAGE_KEY,
      JSON.stringify({
        expandedPaths: state.expandedPaths,
        selectedPath: state.selectedPath,
      }),
    )
    persistWorkspaceSection(
      'fileTree',
      {
        expandedPaths: state.expandedPaths,
        selectedPath: state.selectedPath,
      },
      workspacePath,
    )
  } catch {
    // localStorage 可能不可用，忽略持久化失败。
  }
}

function applyExpandedFlags(nodes: FileTreeNode[], expandedPaths: Set<string>): FileTreeNode[] {
  let changed = false
  const nextNodes = nodes.map((node) => {
    const expanded = expandedPaths.has(node.path)
    const children = node.children
      ? applyExpandedFlags(node.children, expandedPaths)
      : node.children
    if (node.expanded === expanded && children === node.children) return node
    changed = true
    return { ...node, expanded, children }
  })
  return changed ? nextNodes : nodes
}

function reconcileDirectoryEntries(
  entries: FsDirEntry[],
  currentNodes: FileTreeNode[],
  expandedPaths: Set<string>,
): FileTreeNode[] {
  const currentByPath = new Map(currentNodes.map((node) => [node.path, node]))
  const nextNodes = entries.map((entry) => {
    const current = currentByPath.get(entry.path)
    const expanded = expandedPaths.has(entry.path)
    if (
      current &&
      current.name === entry.name &&
      current.type === entry.type &&
      current.extension === entry.extension &&
      current.expanded === expanded
    ) {
      return current
    }
    return {
      name: entry.name,
      path: entry.path,
      type: entry.type,
      extension: entry.extension,
      children: current?.type === 'directory' ? current.children : undefined,
      expanded,
    }
  })
  return nextNodes.length === currentNodes.length &&
    nextNodes.every((node, index) => node === currentNodes[index])
    ? currentNodes
    : nextNodes
}

function replaceDirectoryChildren(
  nodes: FileTreeNode[],
  dirPath: string,
  children: FileTreeNode[],
): FileTreeNode[] {
  let changed = false
  const nextNodes = nodes.map((node) => {
    if (node.path === dirPath) {
      if (node.children === children && node.loading !== true) return node
      changed = true
      return { ...node, children, loading: false }
    }
    if (!node.children) return node
    const nextChildren = replaceDirectoryChildren(node.children, dirPath, children)
    if (nextChildren === node.children) return node
    changed = true
    return { ...node, children: nextChildren }
  })
  return changed ? nextNodes : nodes
}

export type { FileTreeNode } from '../utils/workspace-tree'

export interface FileClipboardEntry {
  workspacePath: string
  path: string
  name: string
  fileType: 'file' | 'directory'
}

interface FsState {
  /** 当前工作区根路径 */
  workspacePath: string | null
  /** 目录树根节点 */
  tree: FileTreeNode[]
  /** 正在加载 */
  loading: boolean
  /** 正在弹出文件夹选择对话框（防重入 + 按钮禁用） */
  picking: boolean
  /** 正在切换到的本地项目；与 Agent 运行状态相互独立 */
  switchingPath: string | null
  /** 错误信息 */
  error: string | null
  /** 文件操作错误，不影响工作区加载态 */
  operationError: string | null
  /** 内联编辑状态：null = 未编辑，'new-folder'/'new-file' = 正在新建，path = 正在重命名该节点 */
  editingPath: string | null
  /** 新建文件/文件夹的目标父目录 */
  newFolderParent: string | null
  /** 已展开目录路径（用于重启后恢复文件树展开状态） */
  expandedPaths: string[]
  /** 当前选中的文件/目录路径 */
  selectedPath: string | null
  /** 会话内文件剪贴板；实际写磁盘只发生在 pasteClipboardEntry。 */
  clipboardEntry: FileClipboardEntry | null
  /** 最近打开的工作空间路径（工程侧仍是 workspace） */
  recentWorkspacePaths: string[]

  // --- Actions ---
  /** 设置工作区路径并加载根目录；返回是否成功（失败时回滚到原工作区，silent 不报错） */
  setWorkspace: (
    path: string,
    options?: {
      silent?: boolean
      restoredFileTree?: unknown
      persistPanelState?: boolean
      commitGuard?: () => boolean
    },
  ) => Promise<boolean>
  /** 启动时从设置恢复上次工作区（目录失效则静默清空记录） */
  initWorkspace: (
    workspacePath?: string | null,
    settings?: AppSettings | null,
  ) => Promise<string | null>
  /** 弹出文件夹选择对话框选择工作区，成功后持久化 */
  openWorkspacePicker: () => Promise<boolean>
  /** 切换到最近打开过的工作区路径 */
  openRecentWorkspace: (path: string) => Promise<boolean>
  /** 切换到未归档，回到隐藏系统工作空间 */
  closeWorkspace: () => Promise<void>
  /** 刷新指定目录 */
  refreshDir: (dirPath: string) => Promise<void>
  /** 刷新整个工作区文件树，并恢复已展开目录 */
  refreshWorkspace: () => Promise<void>
  /** 展开/折叠目录 */
  toggleDir: (dirPath: string) => Promise<void>
  /** 设置当前选中路径 */
  setSelectedPath: (path: string | null) => void
  /** 搜索文件 */
  searchFiles: (query: string) => Promise<FileTreeNode[]>
  /** 进入内联编辑模式（新建文件/文件夹 或 重命名节点） */
  startEditing: (
    editPath: string | 'new-folder' | 'new-file',
    parentForNewFolder?: string | null,
  ) => void
  /** 退出内联编辑模式 */
  cancelEditing: () => void
  /** 清除文件操作错误 */
  clearOperationError: () => void
  /** 确认重命名 */
  confirmRename: (oldPath: string, newName: string) => Promise<boolean>
  /** 将文件或目录记录为待复制资源。 */
  copyEntryToClipboard: (entry: FileClipboardEntry) => void
  /** 将待复制资源粘贴到目录目标，或文件目标的父目录。 */
  pasteClipboardEntry: (
    targetPath: string,
    targetType: 'file' | 'directory',
  ) => Promise<FsCopyEntryResult | null>
  /** 把文件或目录移动到当前工作空间内的目标目录。 */
  moveEntry: (sourcePath: string, targetDir: string) => Promise<boolean>
  /** 确认新建文件夹（从 state.newFolderParent 读取父目录） */
  confirmNewFolder: (name: string) => Promise<void>
  /** 确认新建文件（从 state.newFolderParent 读取父目录） */
  confirmNewFile: (name: string) => Promise<void>
  /** 从主进程 WorkspaceState 恢复文件树展开/选中状态 */
  hydrateFromWorkspaceState: (value: unknown) => void
}

type FsStateGetter = () => FsState
type FsStateSetter = (partial: Partial<FsState> | ((state: FsState) => Partial<FsState>)) => void

function commitPreparedWorkspaceTree(prepared: WorkspaceTreeProjection, set: FsStateSetter): void {
  set((state) => ({
    workspacePath: prepared.path,
    tree: prepared.tree,
    expandedPaths: prepared.expandedPaths,
    selectedPath: prepared.selectedPath,
    recentWorkspacePaths: updateRecentWorkspacePaths(state.recentWorkspacePaths, prepared.path),
  }))
}

async function finishPreparedWorkspaceTree(
  prepared: WorkspaceTreeProjection,
  get: FsStateGetter,
  set: FsStateSetter,
  persistPanelState = true,
): Promise<void> {
  saveRecentWorkspaceFallback(get().recentWorkspacePaths)
  if (persistPanelState) {
    saveFsPanelState(
      { expandedPaths: get().expandedPaths, selectedPath: get().selectedPath },
      prepared.path,
    )
  }
  await restoreExpandedDirs(prepared.path, get, set)
}

const initialFsPanelState = loadFsPanelState()

export const useFsStore = create<FsState>((set, get) => ({
  workspacePath: null,
  tree: [],
  loading: false,
  picking: false,
  switchingPath: null,
  error: null,
  operationError: null,
  editingPath: null,
  newFolderParent: null,
  expandedPaths: initialFsPanelState.expandedPaths,
  selectedPath: initialFsPanelState.selectedPath,
  clipboardEntry: null,
  recentWorkspacePaths: [],

  setWorkspace: async (path, options) => {
    const seq = ++setWorkspaceSeq
    set({
      loading: true,
      error: null,
      operationError: null,
    })
    try {
      const prepared = await prepareWorkspaceTree(path, options?.restoredFileTree, get())
      if (seq !== setWorkspaceSeq) return false
      if (options?.commitGuard?.() === false) {
        set({ loading: false })
        return false
      }
      commitPreparedWorkspaceTree(prepared, set)
      await finishPreparedWorkspaceTree(prepared, get, set, options?.persistPanelState !== false)
      if (seq === setWorkspaceSeq) set({ loading: false })
      return true
    } catch (err) {
      if (seq !== setWorkspaceSeq) return false
      set({
        loading: false,
        // silent（如启动恢复）不向用户报错，避免启动时闪现红错
        ...(options?.silent ? {} : { error: describeError(err) }),
      })
      return false
    }
  },

  initWorkspace: async (workspacePath, settingsOverride) => {
    try {
      const settings = settingsOverride ?? (await window.cclinkStudio.settings.getAll())
      const workspaceStatePaths = await window.cclinkStudio.workspaceState
        .listLocalWorkspaces(getWorkspaceStateOwnerKey())
        .then((workspaces) => workspaces.map((workspace) => workspace.workspacePath))
        .catch(() => [])
      const recentWorkspacePaths = await filterExistingWorkspacePaths(
        getRecentWorkspacePaths(settings, workspaceStatePaths),
      )
      const settingsRecentWorkspacePaths = Array.isArray(settings.recentWorkspacePaths)
        ? settings.recentWorkspacePaths
        : []
      set({ recentWorkspacePaths })
      saveRecentWorkspaceFallback(recentWorkspacePaths)
      if (
        recentWorkspacePaths.length > 0 &&
        JSON.stringify(recentWorkspacePaths) !== JSON.stringify(settingsRecentWorkspacePaths)
      ) {
        void window.cclinkStudio.settings.set({ recentWorkspacePaths }).catch(() => {})
      }
      const last =
        workspacePath === undefined
          ? normalizeWorkspacePath(settings.lastWorkspacePath)
          : workspacePath
      if (!last) {
        await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(null)
        useWorkspaceStore.getState().commitActiveWorkspace(globalWorkspaceRef())
        hydrateRuntimeSections(null)
        set({
          workspacePath: null,
          tree: [],
          expandedPaths: [],
          selectedPath: null,
        })
        return null
      }

      // 这里只确认并打开项目，不读取或恢复任何项目现场。
      const ok = await get().setWorkspace(last, {
        silent: true,
        restoredFileTree: { expandedPaths: [], selectedPath: null },
        persistPanelState: false,
      })
      if (!ok) {
        await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(null)
        useWorkspaceStore.getState().commitActiveWorkspace(globalWorkspaceRef())
        hydrateRuntimeSections(null)
        setWorkspaceStatePath(null)
        return null
      }
      const activeResult = await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(last)
      if (!activeResult.success) throw new Error(activeResult.error || '主进程无法绑定工作空间')
      useWorkspaceStore.getState().commitActiveWorkspace(localWorkspaceRef(last))
      const canonicalRecentPaths = updateRecentWorkspacePaths(get().recentWorkspacePaths, last)
      set({ recentWorkspacePaths: canonicalRecentPaths })
      await window.cclinkStudio.settings
        .set({ recentWorkspacePaths: canonicalRecentPaths })
        .catch(() => {})
      return last
    } catch (error) {
      console.warn('[FsStore] 工作区与最近项目恢复失败:', error)
      useWorkspaceStore.getState().commitActiveWorkspace(globalWorkspaceRef())
      hydrateRuntimeSections(null)
      return null
    }
  },

  openWorkspacePicker: async () => {
    if (get().picking || get().loading || get().switchingPath) return false
    const generation = beginWorkspaceRuntimeTransition()
    set({ picking: true, error: null, operationError: null })
    try {
      const result = await window.cclinkStudio.dialog.showOpenDialog({
        selectDirectory: true,
        title: '选择工作空间文件夹',
      })
      if (result.canceled || result.filePaths.length === 0) return false
      const path = await resolveWorkspaceCandidate(result.filePaths[0]!)
      if (!path || !isWorkspaceRuntimeTransitionCurrent(generation)) {
        if (!path) {
          console.warn('[FsStore] 打开所选项目失败：路径不存在、不可访问或不受支持', {
            selectedPath: result.filePaths[0],
          })
          set({ error: '无法打开所选工作空间' })
        }
        return false
      }
      set({ switchingPath: path })
      const transition = await prepareWorkspaceRuntimeTransition(localWorkspaceRef(path), {
        generation,
      })
      if (!isWorkspaceRuntimeTransitionCurrent(generation)) return false
      set({ loading: true })
      const prepared = await prepareWorkspaceTree(
        path,
        transition.snapshot?.sections.fileTree,
        get(),
      )
      if (!isWorkspaceRuntimeTransitionCurrent(generation)) return false
      const applied = await applyWorkspaceRuntimeTransition(transition, {
        commitProjection: () => commitPreparedWorkspaceTree(prepared, set),
      })
      if (applied) {
        await finishPreparedWorkspaceTree(prepared, get, set)
        useOpenProjectsStore.getState().addProject(path)
        const recentWorkspacePaths = get().recentWorkspacePaths
        saveRecentWorkspaceFallback(recentWorkspacePaths)
        const r = await window.cclinkStudio.settings.set({
          recentWorkspacePaths,
        })
        // 持久化失败不阻断当前会话（workspacePath 已生效），仅提示下次不会记住
        if (!r.success) {
          set({ error: '无法记住此工作空间，下次启动需重新选择' })
        }
        return true
      } else {
        console.warn('[FsStore] 打开所选项目失败：工作台运行时切换未能应用', { path })
        return false
      }
    } catch (err) {
      console.error('[FsStore] 打开所选项目失败:', err)
      set({ error: describeError(err) })
      return false
    } finally {
      set({ loading: false, picking: false, switchingPath: null })
    }
  },

  openRecentWorkspace: async (path) => {
    if (!path) return false
    if (
      path === get().workspacePath &&
      useWorkspaceStore.getState().activeWorkspaceRef.kind === 'local'
    )
      return true
    if (get().picking || get().loading || get().switchingPath) {
      set({ error: '另一个项目正在切换，请稍候' })
      return false
    }

    set({ switchingPath: path, error: null, operationError: null })
    try {
      const generation = beginWorkspaceRuntimeTransition()
      const resolvedPath = await resolveWorkspaceCandidate(path)
      if (!resolvedPath || !isWorkspaceRuntimeTransitionCurrent(generation)) {
        if (!resolvedPath) {
          console.warn('[FsStore] 打开最近项目失败：工作空间已不存在或不可访问', { path })
          set({ error: '该工作空间已不存在或不可访问' })
        }
        return false
      }
      const transition = await prepareWorkspaceRuntimeTransition(localWorkspaceRef(resolvedPath), {
        generation,
      })
      if (!isWorkspaceRuntimeTransitionCurrent(generation)) return false
      set({ loading: true })
      const prepared = await prepareWorkspaceTree(
        resolvedPath,
        transition.snapshot?.sections.fileTree,
        get(),
      )
      if (!isWorkspaceRuntimeTransitionCurrent(generation)) return false
      if (
        !(await applyWorkspaceRuntimeTransition(transition, {
          commitProjection: () => commitPreparedWorkspaceTree(prepared, set),
        }))
      ) {
        console.warn('[FsStore] 打开最近项目失败：工作台运行时切换未能应用', {
          path: resolvedPath,
        })
        return false
      }
      await finishPreparedWorkspaceTree(prepared, get, set)
      useOpenProjectsStore.getState().addProject(resolvedPath)
      const recentWorkspacePaths = get().recentWorkspacePaths
      saveRecentWorkspaceFallback(recentWorkspacePaths)
      await window.cclinkStudio.settings.set({ recentWorkspacePaths }).catch(() => {})
      return true
    } catch (err) {
      console.error('[FsStore] 打开最近项目失败:', { path, error: err })
      set({ error: describeError(err) })
      return false
    } finally {
      if (get().switchingPath === path) set({ loading: false, switchingPath: null })
    }
  },

  closeWorkspace: async () => {
    const currentPath = get().workspacePath
    const activeWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
    if (!currentPath && activeWorkspaceRef.kind !== 'remote') return
    if (get().picking || get().loading || get().switchingPath) {
      set({ error: '另一个项目正在切换，请稍候' })
      return
    }

    const switchingToken = currentPath ?? workspaceRefKey(activeWorkspaceRef) ?? 'remote-workspace'
    set({ loading: true, switchingPath: switchingToken, error: null, operationError: null })
    if (currentPath) {
      saveFsPanelState(
        { expandedPaths: get().expandedPaths, selectedPath: get().selectedPath },
        currentPath,
      )
    }

    try {
      const generation = beginWorkspaceRuntimeTransition()
      const transition = await prepareWorkspaceRuntimeTransition(globalWorkspaceRef(), {
        generation,
      })
      if (!isWorkspaceRuntimeTransitionCurrent(generation)) {
        set({ loading: false })
        return
      }
      const restoredFileTree = normalizeFileTreeState(transition.snapshot?.sections.fileTree)
      if (
        !(await applyWorkspaceRuntimeTransition(transition, {
          commitProjection: () =>
            set({
              workspacePath: null,
              tree: [],
              expandedPaths: restoredFileTree?.expandedPaths ?? [],
              selectedPath: restoredFileTree?.selectedPath ?? null,
              editingPath: null,
              newFolderParent: null,
            }),
        }))
      ) {
        return
      }
      saveFsPanelState(
        { expandedPaths: get().expandedPaths, selectedPath: get().selectedPath },
        null,
      )
      saveRecentWorkspaceFallback(get().recentWorkspacePaths)
      await window.cclinkStudio.settings
        .set({
          recentWorkspacePaths: get().recentWorkspacePaths,
        })
        .catch(() => {})
    } catch (err) {
      set({ loading: false, error: describeError(err) })
    } finally {
      if (get().switchingPath === switchingToken) {
        set({ loading: false, switchingPath: null })
      }
    }
  },

  refreshDir: async (dirPath) => {
    try {
      const entries = await window.cclinkStudio.fs.readDir(dirPath)
      set((state) => {
        const currentChildren =
          dirPath === state.workspacePath
            ? state.tree
            : (findFileTreeNode(state.tree, dirPath)?.children ?? [])
        const newChildren = reconcileDirectoryEntries(
          entries,
          currentChildren,
          new Set(state.expandedPaths),
        )
        const tree =
          dirPath === state.workspacePath
            ? newChildren
            : replaceDirectoryChildren(state.tree, dirPath, newChildren)
        return tree === state.tree ? state : { tree }
      })
    } catch (err) {
      // 子目录加载失败（如无权限）不应污染全局 error（会让 FileTree 切错误态隐藏整棵树），静默即可
      console.warn('[fs-store] refreshDir 失败:', dirPath, err)
    }
  },

  refreshWorkspace: async () => {
    if (refreshWorkspacePromise) {
      refreshWorkspaceQueued = true
      return refreshWorkspacePromise
    }
    refreshWorkspacePromise = (async () => {
      do {
        refreshWorkspaceQueued = false
        const workspacePath = get().workspacePath
        if (!workspacePath) return
        await get().refreshDir(workspacePath)
        if (get().workspacePath !== workspacePath) continue
        await restoreExpandedDirs(workspacePath, get, set, true)
      } while (refreshWorkspaceQueued)
    })().finally(() => {
      refreshWorkspacePromise = null
    })
    return refreshWorkspacePromise
  },

  toggleDir: async (dirPath) => {
    let nextExpandedPaths = get().expandedPaths
    let found = false
    const findAndToggle = (nodes: FileTreeNode[]): FileTreeNode[] =>
      nodes.map((node) => {
        if (node.path === dirPath) {
          found = true
          const expanded = !node.expanded
          const current = new Set(get().expandedPaths)
          if (expanded) current.add(dirPath)
          else current.delete(dirPath)
          nextExpandedPaths = Array.from(current)
          return { ...node, expanded }
        }
        if (node.children) {
          return { ...node, children: findAndToggle(node.children) }
        }
        return node
      })

    set((state) => ({ tree: findAndToggle(state.tree), expandedPaths: nextExpandedPaths }))
    if (found) {
      saveFsPanelState(
        { expandedPaths: nextExpandedPaths, selectedPath: get().selectedPath },
        get().workspacePath,
      )
    }

    // 刚展开且从未加载过子节点（children===undefined）才加载
    // 区分"未加载"(undefined) 与 "加载过但为空目录"([])，避免空目录每次展开都重读
    const node = findFileTreeNode(get().tree, dirPath)
    if (node?.expanded && node.children === undefined) {
      await get().refreshDir(dirPath)
    }
  },

  setSelectedPath: (path) => {
    set({ selectedPath: path })
    saveFsPanelState(
      { expandedPaths: get().expandedPaths, selectedPath: path },
      get().workspacePath,
    )
  },

  searchFiles: async (query) => {
    // 简单实现：在当前工作区内递归搜索
    const { workspacePath } = get()
    if (!workspacePath || !query) return []

    const results: FileTreeNode[] = []
    const searchDir = async (dirPath: string, depth: number): Promise<void> => {
      if (depth > 3) return // 限制搜索深度
      try {
        const entries = await window.cclinkStudio.fs.readDir(dirPath)
        for (const e of entries) {
          if (e.name.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              name: e.name,
              path: e.path,
              type: e.type,
              extension: e.extension,
            })
          }
          if (e.type === 'directory') {
            await searchDir(e.path, depth + 1)
          }
        }
      } catch {
        // 跳过无权限的目录
      }
    }

    await searchDir(workspacePath, 0)
    return results
  },

  startEditing: (editPath, parentForNewFolder) =>
    set({
      editingPath: editPath,
      newFolderParent: parentForNewFolder ?? null,
      operationError: null,
    }),

  cancelEditing: () => set({ editingPath: null, newFolderParent: null }),

  clearOperationError: () => set({ operationError: null }),

  confirmRename: async (oldPath, newName) => {
    const trimmedName = newName.trim()
    if (!trimmedName) return false
    if (hasPathSeparator(trimmedName)) {
      console.warn('[FileSystem] 重命名被拒绝：文件名包含路径分隔符', { oldPath })
      set({ operationError: '重命名失败: 文件名不能包含路径分隔符' })
      return false
    }
    const parent = parentDir(oldPath)
    const newPath = parent === '/' ? '/' + trimmedName : parent + '/' + trimmedName
    set({ editingPath: null })
    if (newPath === oldPath) {
      set({ operationError: null })
      return true
    }
    try {
      let companionMove: { oldPath: string; newPath: string } | null = null
      if (
        isMarkdownDocumentPath(oldPath) &&
        isMarkdownDocumentPath(newPath) &&
        window.cclinkStudio.fs.relocateMarkdownDocument
      ) {
        const result = await window.cclinkStudio.fs.relocateMarkdownDocument({
          sourcePath: oldPath,
          targetPath: newPath,
        })
        useEditorStore.getState().relocateMarkdownFile(oldPath, newPath, result.snapshot)
        if (result.oldAssetDir && result.newAssetDir) {
          companionMove = { oldPath: result.oldAssetDir, newPath: result.newAssetDir }
          useEditorStore.getState().rebaseFilePaths(result.oldAssetDir, result.newAssetDir)
          useTabStore.getState().rebaseFilePaths(result.oldAssetDir, result.newAssetDir)
          useAgentStore
            .getState()
            .rebaseMountedResourcePaths(result.oldAssetDir, result.newAssetDir)
        }
      } else {
        await window.cclinkStudio.fs.rename(oldPath, newPath)
        useEditorStore.getState().rebaseFilePaths(oldPath, newPath)
      }
      useTabStore.getState().rebaseFilePaths(oldPath, newPath)
      useAgentStore.getState().rebaseMountedResourcePaths(oldPath, newPath)
      updateRenamedTabTitle(newPath)
      syncRenamedBrowserFileTabs(oldPath, newPath)
      await get().refreshDir(parent)
      set((state) => {
        const expandedPaths = state.expandedPaths.map((path) => {
          const rebased = replacePathPrefix(path, oldPath, newPath) ?? path
          return companionMove
            ? (replacePathPrefix(rebased, companionMove.oldPath, companionMove.newPath) ?? rebased)
            : rebased
        })
        let selectedPath = replacePathPrefix(state.selectedPath, oldPath, newPath)
        if (companionMove) {
          selectedPath = replacePathPrefix(
            selectedPath,
            companionMove.oldPath,
            companionMove.newPath,
          )
        }
        return { expandedPaths, selectedPath, operationError: null }
      })
      saveFsPanelState(
        { expandedPaths: get().expandedPaths, selectedPath: get().selectedPath },
        get().workspacePath,
      )
      return true
    } catch (err) {
      await get().refreshDir(parent)
      const error = describeError(err)
      console.error('[FileSystem] 重命名失败', { oldPath, newPath, error })
      set({ operationError: '重命名失败: ' + error })
      return false
    }
  },

  copyEntryToClipboard: (entry) => {
    set({ clipboardEntry: entry, operationError: null })
  },

  pasteClipboardEntry: async (targetPath, targetType) => {
    const workspacePath = get().workspacePath
    const clipboardEntry = get().clipboardEntry
    if (!workspacePath || !clipboardEntry) {
      set({ operationError: '粘贴失败: 尚未复制文件或文件夹' })
      return null
    }
    const targetDirectory = targetType === 'directory' ? targetPath : parentDir(targetPath)
    if (!isPathWithin(workspacePath, targetDirectory)) {
      set({ operationError: '粘贴失败: 目标不属于当前项目' })
      return null
    }
    if (
      clipboardEntry.fileType === 'directory' &&
      (targetDirectory === clipboardEntry.path ||
        targetDirectory.startsWith(`${clipboardEntry.path}/`))
    ) {
      set({ operationError: '粘贴失败: 文件夹不能复制到自身或其子目录' })
      return null
    }

    try {
      const result = await window.cclinkStudio.fs.copyEntry({
        sourceWorkspacePath: clipboardEntry.workspacePath,
        sourcePath: clipboardEntry.path,
        targetWorkspacePath: workspacePath,
        targetDirectory,
      })
      set((state) => {
        const expandedPaths =
          targetDirectory === workspacePath || state.expandedPaths.includes(targetDirectory)
            ? state.expandedPaths
            : [...state.expandedPaths, targetDirectory]
        return {
          tree: applyExpandedFlags(state.tree, new Set(expandedPaths)),
          expandedPaths,
          selectedPath: result.destinationPath,
          operationError: null,
        }
      })
      await get().refreshDir(targetDirectory)
      saveFsPanelState(
        { expandedPaths: get().expandedPaths, selectedPath: result.destinationPath },
        workspacePath,
      )
      return result
    } catch (err) {
      const error = describeError(err)
      console.error('[FileSystem] 复制粘贴失败', {
        sourcePath: clipboardEntry.path,
        targetDirectory,
        error,
      })
      set({ operationError: '粘贴失败: ' + error })
      await get().refreshDir(targetDirectory)
      return null
    }
  },

  moveEntry: async (sourcePath, targetDir) => {
    const workspacePath = get().workspacePath
    if (
      !workspacePath ||
      !isPathWithin(workspacePath, sourcePath) ||
      !isPathWithin(workspacePath, targetDir)
    ) {
      set({ operationError: '移动失败: 只能在当前项目内移动文件' })
      return false
    }
    if (sourcePath === workspacePath) {
      set({ operationError: '移动失败: 不能移动项目根目录' })
      return false
    }
    if (targetDir === sourcePath || targetDir.startsWith(sourcePath + '/')) {
      set({ operationError: '移动失败: 文件夹不能移动到自身或其子目录' })
      return false
    }

    const destinationPath = `${targetDir}/${baseName(sourcePath)}`
    if (destinationPath === sourcePath) {
      set({ operationError: null })
      return false
    }

    try {
      let companionMove: { oldPath: string; newPath: string } | null = null
      if (
        isMarkdownDocumentPath(sourcePath) &&
        isMarkdownDocumentPath(destinationPath) &&
        window.cclinkStudio.fs.relocateMarkdownDocument
      ) {
        const result = await window.cclinkStudio.fs.relocateMarkdownDocument({
          sourcePath,
          targetPath: destinationPath,
        })
        useEditorStore.getState().relocateMarkdownFile(sourcePath, destinationPath, result.snapshot)
        if (result.oldAssetDir && result.newAssetDir) {
          companionMove = { oldPath: result.oldAssetDir, newPath: result.newAssetDir }
          useEditorStore.getState().rebaseFilePaths(result.oldAssetDir, result.newAssetDir)
          useTabStore.getState().rebaseFilePaths(result.oldAssetDir, result.newAssetDir)
          useAgentStore
            .getState()
            .rebaseMountedResourcePaths(result.oldAssetDir, result.newAssetDir)
        }
      } else {
        await window.cclinkStudio.fs.move(sourcePath, destinationPath)
        useEditorStore.getState().rebaseFilePaths(sourcePath, destinationPath)
      }
      useTabStore.getState().rebaseFilePaths(sourcePath, destinationPath)
      useAgentStore.getState().rebaseMountedResourcePaths(sourcePath, destinationPath)
      updateRenamedTabTitle(destinationPath)
      syncRenamedBrowserFileTabs(sourcePath, destinationPath)
      set((state) => {
        const expandedPaths = state.expandedPaths
          .map((path) => {
            const rebased = replacePathPrefix(path, sourcePath, destinationPath) ?? path
            return companionMove
              ? (replacePathPrefix(rebased, companionMove.oldPath, companionMove.newPath) ??
                  rebased)
              : rebased
          })
          .filter((path, index, paths) => paths.indexOf(path) === index)
        if (!expandedPaths.includes(targetDir)) expandedPaths.push(targetDir)
        let selectedPath = replacePathPrefix(state.selectedPath, sourcePath, destinationPath)
        if (companionMove) {
          selectedPath = replacePathPrefix(
            selectedPath,
            companionMove.oldPath,
            companionMove.newPath,
          )
        }
        return {
          expandedPaths,
          selectedPath,
          operationError: null,
        }
      })
      await get().refreshWorkspace()
      saveFsPanelState(
        { expandedPaths: get().expandedPaths, selectedPath: get().selectedPath },
        workspacePath,
      )
      return true
    } catch (err) {
      await get().refreshWorkspace()
      set({ operationError: '移动失败: ' + describeError(err) })
      return false
    }
  },

  confirmNewFolder: async (name) => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    if (hasPathSeparator(trimmedName)) {
      set({ operationError: '新建文件夹失败: 文件夹名不能包含路径分隔符' })
      return
    }
    const parentPath = get().newFolderParent
    if (!parentPath) return
    const newPath = parentPath === '/' ? '/' + trimmedName : parentPath + '/' + trimmedName
    set({ editingPath: null, newFolderParent: null })
    try {
      await window.cclinkStudio.fs.mkdir(newPath)
      await get().refreshDir(parentPath)
      set({ operationError: null })
    } catch (err) {
      set({ operationError: '新建文件夹失败: ' + describeError(err) })
    }
  },

  confirmNewFile: async (name) => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    if (hasPathSeparator(trimmedName)) {
      set({ operationError: '新建文件失败: 文件名不能包含路径分隔符' })
      return
    }
    const parentPath = get().newFolderParent
    if (!parentPath) return
    const newPath = parentPath === '/' ? '/' + trimmedName : parentPath + '/' + trimmedName
    set({ editingPath: null, newFolderParent: null })
    try {
      await window.cclinkStudio.fs.writeFile(newPath, '')
      await get().refreshDir(parentPath)
      set({ selectedPath: newPath, operationError: null })
      saveFsPanelState(
        { expandedPaths: get().expandedPaths, selectedPath: newPath },
        get().workspacePath,
      )
    } catch (err) {
      set({ operationError: '新建文件失败: ' + describeError(err) })
    }
  },

  hydrateFromWorkspaceState: (value) => {
    const next = normalizeFileTreeState(value)
    if (!next) return
    set({
      expandedPaths: next.expandedPaths,
      selectedPath: next.selectedPath,
    })
  },
}))

async function restoreExpandedDirs(
  workspacePath: string,
  get: () => FsState,
  set: (partial: Partial<FsState> | ((state: FsState) => Partial<FsState>)) => void,
  refreshLoaded = false,
): Promise<void> {
  const paths = get()
    .expandedPaths.filter((p) => p !== workspacePath && p.startsWith(workspacePath + '/'))
    .sort((a, b) => a.split('/').length - b.split('/').length)

  for (const dirPath of paths) {
    const node = findFileTreeNode(get().tree, dirPath)
    if (!node || node.type !== 'directory') continue

    set((state) => {
      const tree = applyExpandedFlags(state.tree, new Set([...state.expandedPaths, dirPath]))
      return tree === state.tree ? state : { tree }
    })

    if (refreshLoaded || findFileTreeNode(get().tree, dirPath)?.children === undefined) {
      await get().refreshDir(dirPath)
    }
  }
}
