import { create } from 'zustand'
import {
  getWorkspaceStateKey,
  getWorkspaceStateOwnerKey,
  persistWorkspaceSection,
  setWorkspaceStatePath,
} from '../utils/workspace-state'
import { hydrateRuntimeSections, persistRuntimeSections } from '../utils/workspace-runtime'
import { useEditorStore } from './editor-store'
import { useWorkspaceStore } from './workspace-store'

/** setWorkspace 的最新请求序号（模块级，用于丢弃过期的并发结果，避免竞态） */
let setWorkspaceSeq = 0

/** 提取父目录路径 */
function parentDir(filePath: string): string {
  const i = filePath.lastIndexOf('/')
  return i > 0 ? filePath.slice(0, i) : '/'
}

/** 把任意错误归一化为用户可读文案，并友好化沙箱越界等常见错误 */
function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  if (/not in allowed|路径不在允许范围内/i.test(raw)) {
    return '该目录不在允许访问的范围内，请选择用户主目录（~）下的工作空间文件夹'
  }
  return raw
}

const FS_STORAGE_KEY = 'deepink-fs-state'
const RECENT_WORKSPACES_STORAGE_KEY = 'deepink-recent-workspaces'
const MAX_RECENT_WORKSPACES = 8

function normalizeWorkspacePath(path: unknown): string | null {
  if (typeof path !== 'string') return null
  const normalized = path.trim()
  return normalized.length > 0 ? normalized : null
}

function mergeRecentWorkspacePaths(...sources: unknown[]): string[] {
  const result: string[] = []
  const push = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(push)
      return
    }
    const path = normalizeWorkspacePath(value)
    if (!path || result.includes(path)) return
    result.push(path)
  }
  sources.forEach(push)
  return result.slice(0, MAX_RECENT_WORKSPACES)
}

function updateRecentWorkspacePaths(paths: string[], path: string): string[] {
  return mergeRecentWorkspacePaths(path, paths)
}

function loadRecentWorkspaceFallback(): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    return mergeRecentWorkspacePaths(JSON.parse(localStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY) ?? '[]'))
  } catch {
    return []
  }
}

function saveRecentWorkspaceFallback(paths: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      RECENT_WORKSPACES_STORAGE_KEY,
      JSON.stringify(mergeRecentWorkspacePaths(paths)),
    )
  } catch {
    // 最近项目 fallback 写入失败不影响当前工作区。
  }
}

function hasUnsavedEditorDrafts(): boolean {
  return Object.entries(useEditorStore.getState().files).some(([key, file]) => {
    if (file.dirty) return true
    return key.startsWith('virtual:') && file.currentContent.trim().length > 0
  })
}

function confirmProjectSwitch(currentPath: string | null, nextPath?: string | null): boolean {
  if (!currentPath || nextPath === currentPath || !hasUnsavedEditorDrafts()) return true
  persistWorkspaceSection('editorDrafts', { files: useEditorStore.getState().files }, currentPath)
  if (typeof window === 'undefined') return true
  const action = nextPath === null ? '切换到未归档后' : '切换工作空间后'
  return window.confirm(`当前工作空间有未保存草稿。${action}，草稿会保留在当前工作空间，稍后切回可继续。是否继续？`)
}

function loadFsPanelState(): { expandedPaths: string[]; selectedPath: string | null } {
  try {
    if (typeof localStorage === 'undefined') return { expandedPaths: [], selectedPath: null }
    const raw = localStorage.getItem(FS_STORAGE_KEY)
    if (!raw) return { expandedPaths: [], selectedPath: null }
    const parsed = JSON.parse(raw) as { expandedPaths?: string[]; selectedPath?: string | null }
    return {
      expandedPaths: Array.isArray(parsed.expandedPaths) ? parsed.expandedPaths.filter(Boolean) : [],
      selectedPath: parsed.selectedPath ?? null,
    }
  } catch {
    return { expandedPaths: [], selectedPath: null }
  }
}

function getRecentWorkspacePathsFromSettings(settings: {
  recentWorkspacePaths?: unknown
  lastWorkspacePath?: unknown
}): string[] {
  return mergeRecentWorkspacePaths(
    settings.recentWorkspacePaths,
    settings.lastWorkspacePath,
    loadRecentWorkspaceFallback(),
  )
}

function normalizeFileTreeState(value: unknown): { expandedPaths: string[]; selectedPath: string | null } | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as { expandedPaths?: string[]; selectedPath?: string | null }
  return {
    expandedPaths: Array.isArray(parsed.expandedPaths) ? parsed.expandedPaths.filter(Boolean) : [],
    selectedPath: parsed.selectedPath ?? null,
  }
}

function saveFsPanelState(state: Pick<FsState, 'expandedPaths' | 'selectedPath'>, workspacePath?: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(FS_STORAGE_KEY, JSON.stringify({
      expandedPaths: state.expandedPaths,
      selectedPath: state.selectedPath,
    }))
    persistWorkspaceSection('fileTree', {
      expandedPaths: state.expandedPaths,
      selectedPath: state.selectedPath,
    }, workspacePath)
  } catch {
    // localStorage 可能不可用，忽略持久化失败。
  }
}

function applyExpandedFlags(nodes: FileTreeNode[], expandedPaths: Set<string>): FileTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    expanded: expandedPaths.has(node.path),
    children: node.children ? applyExpandedFlags(node.children, expandedPaths) : node.children,
  }))
}

/** 目录树节点 */
export interface FileTreeNode {
  name: string
  path: string
  type: 'directory' | 'file'
  extension?: string
  /** 子节点（仅目录有） */
  children?: FileTreeNode[]
  /** 是否已展开（仅目录有） */
  expanded?: boolean
  /** 是否正在加载子节点 */
  loading?: boolean
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
  /** 错误信息 */
  error: string | null
  /** 内联编辑状态：null = 未编辑，'new-folder'/'new-file' = 正在新建，path = 正在重命名该节点 */
  editingPath: string | null
  /** 新建文件/文件夹的目标父目录 */
  newFolderParent: string | null
  /** 已展开目录路径（用于重启后恢复文件树展开状态） */
  expandedPaths: string[]
  /** 当前选中的文件/目录路径 */
  selectedPath: string | null
  /** 最近打开的工作空间路径（工程侧仍是 workspace） */
  recentWorkspacePaths: string[]

  // --- Actions ---
  /** 设置工作区路径并加载根目录；返回是否成功（失败时回滚到原工作区，silent 不报错） */
  setWorkspace: (path: string, options?: { silent?: boolean }) => Promise<boolean>
  /** 启动时从设置恢复上次工作区（目录失效则静默清空记录） */
  initWorkspace: () => Promise<void>
  /** 弹出文件夹选择对话框选择工作区，成功后持久化 */
  openWorkspacePicker: () => Promise<void>
  /** 切换到最近打开过的工作区路径 */
  openRecentWorkspace: (path: string) => Promise<void>
  /** 切换到未归档，回到隐藏系统工作空间 */
  closeWorkspace: () => Promise<void>
  /** 刷新指定目录 */
  refreshDir: (dirPath: string) => Promise<void>
  /** 展开/折叠目录 */
  toggleDir: (dirPath: string) => Promise<void>
  /** 设置当前选中路径 */
  setSelectedPath: (path: string | null) => void
  /** 搜索文件 */
  searchFiles: (query: string) => Promise<FileTreeNode[]>
  /** 进入内联编辑模式（新建文件/文件夹 或 重命名节点） */
  startEditing: (editPath: string | 'new-folder' | 'new-file', parentForNewFolder?: string | null) => void
  /** 退出内联编辑模式 */
  cancelEditing: () => void
  /** 确认重命名 */
  confirmRename: (oldPath: string, newName: string) => Promise<void>
  /** 确认新建文件夹（从 state.newFolderParent 读取父目录） */
  confirmNewFolder: (name: string) => Promise<void>
  /** 确认新建文件（从 state.newFolderParent 读取父目录） */
  confirmNewFile: (name: string) => Promise<void>
  /** 从主进程 WorkspaceState 恢复文件树展开/选中状态 */
  hydrateFromWorkspaceState: (value: unknown) => void
}

const initialFsPanelState = loadFsPanelState()

export const useFsStore = create<FsState>((set, get) => ({
  workspacePath: null,
  tree: [],
  loading: false,
  picking: false,
  error: null,
  editingPath: null,
  newFolderParent: null,
  expandedPaths: initialFsPanelState.expandedPaths,
  selectedPath: initialFsPanelState.selectedPath,
  recentWorkspacePaths: [],

  setWorkspace: async (path, options) => {
    // 保存调用前快照：失败时回滚到这里（而非清空），保留用户当前可用的工作区
    const prev = { workspacePath: get().workspacePath, tree: get().tree }
    const seq = ++setWorkspaceSeq
    set({ loading: true, error: null })
    // 不在开头设 workspacePath：readDir 成功后才赋值，避免非法路径作为中间态
    // 泄露给 SyncPanel/SearchPanel 等消费方（loading=true 期间它们通常已禁用，仍求稳妥）
    try {
      const entries = await window.deepink.fs.readDir(path)
      // 并发守卫：若期间又发起了新的 setWorkspace，丢弃本次过期结果
      if (seq !== setWorkspaceSeq) return false
      const expandedSet = new Set(get().expandedPaths)
      const tree: FileTreeNode[] = entries.map((e) => ({
        name: e.name,
        path: e.path,
        type: e.type,
        extension: e.extension,
        children: undefined,
        expanded: expandedSet.has(e.path),
      }))
      setWorkspaceStatePath(path)
      useWorkspaceStore.getState().activateLocalWorkspace(path)
      set((state) => ({
        workspacePath: path,
        tree,
        loading: false,
        recentWorkspacePaths: updateRecentWorkspacePaths(state.recentWorkspacePaths, path),
      }))
      saveRecentWorkspaceFallback(get().recentWorkspacePaths)
      saveFsPanelState({ expandedPaths: get().expandedPaths, selectedPath: get().selectedPath }, path)
      await restoreExpandedDirs(path, get, set)
      return true
    } catch (err) {
      if (seq !== setWorkspaceSeq) return false
      set({
        workspacePath: prev.workspacePath,
        tree: prev.tree,
        loading: false,
        // silent（如启动恢复）不向用户报错，避免启动时闪现红错
        ...(options?.silent ? {} : { error: describeError(err) }),
      })
      return false
    }
  },

  initWorkspace: async () => {
    try {
      const settings = await window.deepink.settings.getAll()
      const recentWorkspacePaths = getRecentWorkspacePathsFromSettings(settings)
      set({ recentWorkspacePaths })
      saveRecentWorkspaceFallback(recentWorkspacePaths)
      if (
        JSON.stringify(recentWorkspacePaths) !==
        JSON.stringify(Array.isArray(settings.recentWorkspacePaths) ? settings.recentWorkspacePaths : [])
      ) {
        void window.deepink.settings.set({ recentWorkspacePaths }).catch(() => {})
      }
      const last = settings.lastWorkspacePath
      if (!last) return
      const snapshot = await window.deepink.workspaceState
        .get(last, getWorkspaceStateOwnerKey())
        .catch(() => null)
      if (snapshot) get().hydrateFromWorkspaceState(snapshot.sections.fileTree)
      // 静默恢复：目录失效不报错（silent），仅清掉失效的持久化记录
      const ok = await get().setWorkspace(last, { silent: true })
      if (!ok) {
        await window.deepink.settings.set({ lastWorkspacePath: '' }).catch(() => {})
        setWorkspaceStatePath(null)
      }
    } catch {
      // 读设置失败 → 保持空工作区状态
    }
  },

  openWorkspacePicker: async () => {
    if (get().picking) return // 防重入：避免叠加多个模态对话框（macOS 会抛错）
    if (!confirmProjectSwitch(get().workspacePath)) return
    set({ picking: true, error: null })
    try {
      const result = await window.deepink.dialog.showOpenDialog({
        selectDirectory: true,
        title: '选择工作空间文件夹',
      })
      if (result.canceled || result.filePaths.length === 0) return
      const path = result.filePaths[0]!
      persistRuntimeSections(getWorkspaceStateKey())
      const snapshot = await window.deepink.workspaceState
        .get(path, getWorkspaceStateOwnerKey())
        .catch(() => null)
      if (snapshot) get().hydrateFromWorkspaceState(snapshot.sections.fileTree)
      const ok = await get().setWorkspace(path)
      if (ok) {
        hydrateRuntimeSections(snapshot)
        setWorkspaceStatePath(path)
        const recentWorkspacePaths = get().recentWorkspacePaths
        saveRecentWorkspaceFallback(recentWorkspacePaths)
        const r = await window.deepink.settings.set({ lastWorkspacePath: path, recentWorkspacePaths })
        // 持久化失败不阻断当前会话（workspacePath 已生效），仅提示下次不会记住
        if (!r.success) {
          set({ error: '无法记住此工作空间，下次启动需重新选择' })
        }
      }
    } catch (err) {
      set({ error: describeError(err) })
    } finally {
      set({ picking: false })
    }
  },

  openRecentWorkspace: async (path) => {
    if (!path) return
    if (path === get().workspacePath && useWorkspaceStore.getState().activeWorkspaceRef.kind === 'local') return
    if (!confirmProjectSwitch(get().workspacePath, path)) return
    persistRuntimeSections(getWorkspaceStateKey())
    const snapshot = await window.deepink.workspaceState
      .get(path, getWorkspaceStateOwnerKey())
      .catch(() => null)
    if (snapshot) get().hydrateFromWorkspaceState(snapshot.sections.fileTree)
    const ok = await get().setWorkspace(path)
    if (ok) {
      hydrateRuntimeSections(snapshot)
      const recentWorkspacePaths = get().recentWorkspacePaths
      saveRecentWorkspaceFallback(recentWorkspacePaths)
      await window.deepink.settings.set({ lastWorkspacePath: path, recentWorkspacePaths }).catch(() => {})
    }
  },

  closeWorkspace: async () => {
    const currentPath = get().workspacePath
    if (!currentPath) return
    if (!confirmProjectSwitch(currentPath, null)) return

    set({ loading: true, error: null })
    saveFsPanelState({ expandedPaths: get().expandedPaths, selectedPath: get().selectedPath }, currentPath)

    try {
      const snapshot = await window.deepink.workspaceState
        .get(null, getWorkspaceStateOwnerKey())
        .catch(() => null)
      setWorkspaceStatePath(null)
      useWorkspaceStore.getState().activateGlobalWorkspace()
      get().hydrateFromWorkspaceState(snapshot?.sections.fileTree ?? { expandedPaths: [], selectedPath: null })
      hydrateRuntimeSections(snapshot)
      set({
        workspacePath: null,
        tree: [],
        loading: false,
        editingPath: null,
        newFolderParent: null,
      })
      saveFsPanelState({ expandedPaths: get().expandedPaths, selectedPath: get().selectedPath }, null)
      saveRecentWorkspaceFallback(get().recentWorkspacePaths)
      await window.deepink.settings.set({
        lastWorkspacePath: '',
        recentWorkspacePaths: get().recentWorkspacePaths,
      }).catch(() => {})
    } catch (err) {
      set({ loading: false, error: describeError(err) })
    }
  },

  refreshDir: async (dirPath) => {
    try {
      const entries = await window.deepink.fs.readDir(dirPath)
      const expandedSet = new Set(get().expandedPaths)
      const newChildren: FileTreeNode[] = entries.map((e) => ({
        name: e.name,
        path: e.path,
        type: e.type,
        extension: e.extension,
        children: undefined,
        expanded: expandedSet.has(e.path),
      }))

      // 递归更新树中指定路径的节点
      const updateChildren = (nodes: FileTreeNode[]): FileTreeNode[] =>
        nodes.map((node) => {
          if (node.path === dirPath) {
            return { ...node, children: newChildren, loading: false }
          }
          if (node.children) {
            return { ...node, children: updateChildren(node.children) }
          }
          return node
        })

      set((state) => ({ tree: updateChildren(state.tree) }))
    } catch (err) {
      // 子目录加载失败（如无权限）不应污染全局 error（会让 FileTree 切错误态隐藏整棵树），静默即可
      console.warn('[fs-store] refreshDir 失败:', dirPath, err)
    }
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
    const node = findNode(get().tree, dirPath)
    if (node?.expanded && node.children === undefined) {
      await get().refreshDir(dirPath)
    }
  },

  setSelectedPath: (path) => {
    set({ selectedPath: path })
    saveFsPanelState({ expandedPaths: get().expandedPaths, selectedPath: path }, get().workspacePath)
  },

  searchFiles: async (query) => {
    // 简单实现：在当前工作区内递归搜索
    const { workspacePath } = get()
    if (!workspacePath || !query) return []

    const results: FileTreeNode[] = []
    const searchDir = async (dirPath: string, depth: number): Promise<void> => {
      if (depth > 3) return // 限制搜索深度
      try {
        const entries = await window.deepink.fs.readDir(dirPath)
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
    set({ editingPath: editPath, newFolderParent: parentForNewFolder ?? null }),

  cancelEditing: () => set({ editingPath: null, newFolderParent: null }),

  confirmRename: async (oldPath, newName) => {
    if (!newName.trim()) return
    const parent = parentDir(oldPath)
    const newPath = parent + '/' + newName.trim()
    set({ editingPath: null })
    try {
      await window.deepink.fs.rename(oldPath, newPath)
      await get().refreshDir(parent)
    } catch (err) {
      set({ error: '重命名失败: ' + describeError(err) })
    }
  },

  confirmNewFolder: async (name) => {
    if (!name.trim()) return
    const parentPath = get().newFolderParent
    if (!parentPath) return
    const newPath = parentPath + '/' + name.trim()
    set({ editingPath: null, newFolderParent: null })
    try {
      await window.deepink.fs.mkdir(newPath)
      await get().refreshDir(parentPath)
    } catch (err) {
      set({ error: '新建文件夹失败: ' + describeError(err) })
    }
  },

  confirmNewFile: async (name) => {
    if (!name.trim()) return
    const parentPath = get().newFolderParent
    if (!parentPath) return
    const newPath = parentPath + '/' + name.trim()
    set({ editingPath: null, newFolderParent: null })
    try {
      await window.deepink.fs.writeFile(newPath, '')
      await get().refreshDir(parentPath)
      set({ selectedPath: newPath })
      saveFsPanelState({ expandedPaths: get().expandedPaths, selectedPath: newPath }, get().workspacePath)
    } catch (err) {
      set({ error: '新建文件失败: ' + describeError(err) })
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

/** 在树中查找指定路径的节点 */
function findNode(nodes: FileTreeNode[], targetPath: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node
    if (node.children) {
      const found = findNode(node.children, targetPath)
      if (found) return found
    }
  }
  return undefined
}

async function restoreExpandedDirs(
  workspacePath: string,
  get: () => FsState,
  set: (partial: Partial<FsState> | ((state: FsState) => Partial<FsState>)) => void,
): Promise<void> {
  const paths = get()
    .expandedPaths
    .filter((p) => p !== workspacePath && p.startsWith(workspacePath + '/'))
    .sort((a, b) => a.split('/').length - b.split('/').length)

  for (const dirPath of paths) {
    const node = findNode(get().tree, dirPath)
    if (!node || node.type !== 'directory') continue

    set((state) => ({
      tree: applyExpandedFlags(state.tree, new Set([...state.expandedPaths, dirPath])),
    }))

    if (findNode(get().tree, dirPath)?.children === undefined) {
      await get().refreshDir(dirPath)
    }
  }
}
