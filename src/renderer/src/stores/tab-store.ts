import { create } from 'zustand'
import type { ConversationTabRef, Tab, TabType } from '../types'
import { useBrowserStore } from './browser-store'
import { useEditorStore } from './editor-store'
import { getModelFileIcon, getTabTypeForFile } from '../utils/model-files'
import { persistWorkspaceSection } from '../utils/workspace-state'

/** 自增 ID 计数器 */
let nextId = 1
const TAB_STORAGE_KEY = 'deepink-workbench-tabs'
const DEFAULT_TABS: Tab[] = []

/** 生成唯一 Tab ID */
function generateTabId(): string {
  return `tab-${nextId++}-${Date.now()}`
}

function getExtension(filePath?: string): string | undefined {
  if (!filePath) return undefined
  const fileName = filePath.split('/').pop() ?? ''
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index).toLowerCase() : undefined
}

function normalizeFileTab(tab: Tab): Tab {
  const extension = getExtension(tab.filePath)
  const type = getTabTypeForFile(extension)
  if (type !== 'model') return tab
  return {
    ...tab,
    type,
    icon: getModelFileIcon(extension),
    dirty: false,
    initialContent: undefined,
  }
}

function isProjectTab(tab: Tab): boolean {
  return tab.type !== 'settings'
}

function getConversationRuntime(conversation?: ConversationTabRef): {
  location: 'local' | 'remote'
  transport: 'local' | 'cclink' | 'direct'
  sessionId: string
} | null {
  if (!conversation) return null
  if ('runtime' in conversation) {
    return {
      location: conversation.runtime.location,
      transport: conversation.runtime.transport,
      sessionId: conversation.sessionId,
    }
  }
  if (conversation.kind === 'remote') {
    return {
      location: 'remote',
      transport: conversation.transport,
      sessionId: conversation.sessionId,
    }
  }
  return null
}

function getConversationKey(
  tab: Pick<Tab, 'type' | 'conversation' | 'cclinkSessionId'>,
): string | null {
  if (tab.type === 'conversation') {
    const runtime = getConversationRuntime(tab.conversation)
    return runtime ? `${runtime.location}:${runtime.transport}:${runtime.sessionId}` : null
  }
  if (tab.type === 'cclink' && tab.cclinkSessionId) {
    return `remote:cclink:${tab.cclinkSessionId}`
  }
  return null
}

function normalizePersistedTab(tab: Tab): Tab {
  return { ...tab, dirty: false }
}

function loadStoredTabs(): Pick<TabState, 'tabs' | 'activeTabId'> {
  try {
    if (typeof localStorage === 'undefined') return { tabs: DEFAULT_TABS, activeTabId: null }
    const raw = localStorage.getItem(TAB_STORAGE_KEY)
    if (!raw) return { tabs: DEFAULT_TABS, activeTabId: null }
    const parsed = JSON.parse(raw) as { tabs?: Tab[]; activeTabId?: string | null }
    const tabs = (parsed.tabs ?? [])
      .filter((tab): tab is Tab => Boolean(tab?.id && tab.type && tab.title && tab.icon))
      .map(normalizeFileTab)
    if (tabs.length === 0) return { tabs: DEFAULT_TABS, activeTabId: null }
    const activeTabId =
      parsed.activeTabId && tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : tabs[0].id
    return { tabs, activeTabId }
  } catch {
    return { tabs: DEFAULT_TABS, activeTabId: null }
  }
}

function normalizeTabsSnapshot(value: unknown): Pick<TabState, 'tabs' | 'activeTabId'> | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as { tabs?: Tab[]; activeTabId?: string | null }
  const tabs = (parsed.tabs ?? [])
    .filter((tab): tab is Tab => Boolean(tab?.id && tab.type && tab.title && tab.icon))
    .map(normalizeFileTab)
  if (tabs.length === 0 && Array.isArray(parsed.tabs)) return { tabs: [], activeTabId: null }
  if (tabs.length === 0) return null
  const activeTabId =
    parsed.activeTabId && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0].id
  return { tabs, activeTabId }
}

function saveStoredTabs(state: TabState): void {
  try {
    if (typeof localStorage === 'undefined') return
    const allTabs = state.tabs.map(normalizePersistedTab)
    const projectTabs = allTabs.filter(isProjectTab)
    const projectActiveTabId =
      state.activeTabId && projectTabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : (projectTabs[0]?.id ?? null)

    localStorage.setItem(
      TAB_STORAGE_KEY,
      JSON.stringify({
        tabs: allTabs,
        activeTabId: state.activeTabId,
      }),
    )
    persistWorkspaceSection('tabs', {
      tabs: projectTabs,
      activeTabId: projectActiveTabId,
    })
  } catch {
    // localStorage 可能不可用，忽略持久化失败。
  }
}

/** 打开 Tab 的选项 */
interface OpenTabOptions {
  type: TabType
  title: string
  icon: string
  filePath?: string
  /** 复制编辑器 Tab 时的种子内容（仅激活创建时消费一次） */
  initialContent?: string
  /** 新建/复制浏览器 Tab 时的初始 URL（仅激活创建时消费一次） */
  initialUrl?: string
  /** 浏览器持久化 Profile，用于隔离平台登录态。 */
  browserProfile?: string | null
  /** 从快照重建时的视图模式/缩放（仅激活创建时消费一次） */
  restore?: {
    viewMode: 'desktop' | 'mobile'
    zoomMode: 'fit' | 'manual'
    manualZoom: number
    history?: string[]
    historyIndex?: number
  }
  /** CCLink 远程会话 ID */
  cclinkSessionId?: string
  /** 通用会话 Tab 引用 */
  conversation?: ConversationTabRef
  /** 设置页目标分组 */
  settingsSection?: string
  /** CCLink 远程只读文件 */
  remoteFile?: Tab['remoteFile']
  /** Terminal 工作现场 */
  terminal?: Tab['terminal']
  /** 强制新建，跳过所有去重 */
  forceNew?: boolean
}

interface TabState {
  /** 打开的 Tab 列表 */
  tabs: Tab[]
  /** 当前激活的 Tab ID */
  activeTabId: string | null

  // --- Actions ---
  /** 打开新 Tab */
  openTab: (options: OpenTabOptions) => void
  /** 关闭 Tab */
  closeTab: (id: string) => void
  /** 激活 Tab */
  activateTab: (id: string) => void
  /** 拖拽排序：把 fromId 移动到 toId 的位置 */
  reorderTabs: (fromId: string, toId: string) => void
  /** 更新 Tab 标题 */
  updateTabTitle: (id: string, title: string) => void
  /** 更新 Tab dirty 状态 */
  updateTabDirty: (id: string, dirty: boolean) => void
  /** 更新 Terminal Tab 的运行态 */
  updateTabTerminal: (id: string, terminal: NonNullable<Tab['terminal']>) => void
  /** 更新 Tab 关联的文件路径（Save-As 后回填） */
  updateTabFilePath: (id: string, filePath: string) => void
  /** 复制 Tab（浏览器克隆 URL；编辑器克隆内容为未命名副本） */
  duplicateTab: (id: string) => void
  /** 获取当前活跃 Tab */
  getActiveTab: () => Tab | undefined
  /** 从主进程 WorkspaceState 恢复 Tab 列表 */
  hydrateFromWorkspaceState: (value: unknown) => void
}

const initialTabState = loadStoredTabs()

export const useTabStore = create<TabState>((set, get) => ({
  tabs: initialTabState.tabs,
  activeTabId: initialTabState.activeTabId,

  openTab: ({
    type,
    title,
    icon,
    filePath,
    initialContent,
    initialUrl,
    browserProfile,
    restore,
    cclinkSessionId,
    conversation,
    settingsSection,
    remoteFile,
    terminal,
    forceNew,
  }) => {
    set((state) => {
      // forceNew 跳过所有去重
      if (!forceNew) {
        // 文件 Tab：按 filePath 去重
        if (filePath) {
          const existing = state.tabs.find((t) => t.filePath === filePath)
          if (existing) {
            const nextTabs = state.tabs.map((tab) =>
              tab.id === existing.id
                ? {
                    ...tab,
                    type,
                    title,
                    icon,
                    dirty: false,
                    initialContent: type === 'model' ? undefined : tab.initialContent,
                  }
                : tab,
            )
            return { tabs: nextTabs, activeTabId: existing.id }
          }
        } else if (type === 'settings') {
          // settings 是单例，去重
          const existing = state.tabs.find((t) => t.type === 'settings' && !t.filePath)
          if (existing) {
            const nextTabs = state.tabs.map((tab) =>
              tab.id === existing.id
                ? {
                    ...tab,
                    title,
                    icon,
                    settingsSection,
                  }
                : tab,
            )
            return { tabs: nextTabs, activeTabId: existing.id }
          }
        } else if (type === 'cclink' && cclinkSessionId) {
          // 兼容旧 CCLink Tab：按通用会话 key 去重。
          const targetKey = getConversationKey({ type, cclinkSessionId })
          const existing = state.tabs.find((tab) => getConversationKey(tab) === targetKey)
          if (existing) {
            return { activeTabId: existing.id }
          }
        } else if (type === 'conversation' && conversation) {
          // 会话按来源和会话 ID 去重，一个远程会话只开一个 Tab。
          const targetKey = getConversationKey({ type, conversation })
          const existing = state.tabs.find((tab) => getConversationKey(tab) === targetKey)
          if (existing) {
            return { activeTabId: existing.id }
          }
        } else if (type === 'remote-file' && remoteFile) {
          // 远程文件按 server/workspace/path 去重，避免同一文件开多个只读 Tab
          const existing = state.tabs.find(
            (t) =>
              t.type === 'remote-file' &&
              t.remoteFile?.serverId === remoteFile.serverId &&
              t.remoteFile?.workspaceId === remoteFile.workspaceId &&
              t.remoteFile?.path === remoteFile.path,
          )
          if (existing) {
            return { activeTabId: existing.id }
          }
        }
        // browser / 未命名 editor 不去重 → 可开多个
      }

      const newTab: Tab = {
        id: generateTabId(),
        type,
        title,
        icon,
        filePath,
        initialContent,
        initialUrl,
        browserProfile,
        restore,
        cclinkSessionId,
        conversation,
        settingsSection,
        remoteFile,
        terminal,
      }
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }
    })
  },

  closeTab: (id) => {
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== id)
      // 如果关闭的是当前 Tab，切换到最后一个剩余 Tab
      const activeTabId =
        state.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId
      return { tabs, activeTabId }
    })
  },

  activateTab: (id) => set({ activeTabId: id }),

  reorderTabs: (fromId, toId) => {
    if (fromId === toId) return
    set((state) => {
      const fromIdx = state.tabs.findIndex((t) => t.id === fromId)
      const toIdx = state.tabs.findIndex((t) => t.id === toId)
      if (fromIdx === -1 || toIdx === -1) return state
      const next = [...state.tabs]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return { tabs: next }
    })
  },

  updateTabTitle: (id, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    })),

  updateTabDirty: (id, dirty) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
    })),

  updateTabTerminal: (id, terminal) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, terminal } : t)),
    })),

  updateTabFilePath: (id, filePath) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, filePath } : t)),
    })),

  duplicateTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return

    if (tab.type === 'browser') {
      // 浏览器：克隆当前 URL（从 browser-store 读取）
      const url = useBrowserStore.getState().tabs[id]?.url ?? 'https://www.baidu.com'
      get().openTab({
        type: 'browser',
        title: '浏览器',
        icon: '🌐',
        forceNew: true,
        initialUrl: url,
        browserProfile: tab.browserProfile ?? null,
      })
    } else if (tab.type === 'editor') {
      // 编辑器：克隆当前内容为可编辑未命名副本
      const fileKey = tab.filePath ?? `virtual:${id}`
      const content = useEditorStore.getState().files[fileKey]?.currentContent ?? ''
      get().openTab({
        type: 'editor',
        title: `副本: ${tab.title}`,
        icon: '📄',
        forceNew: true,
        initialContent: content,
      })
    }
    // settings / preview / android / conversation / cclink / terminal：菜单层已禁用，此处不处理
  },

  getActiveTab: () => {
    const state = get()
    return state.tabs.find((t) => t.id === state.activeTabId)
  },

  hydrateFromWorkspaceState: (value) => {
    const next = normalizeTabsSnapshot(value)
    if (!next) return
    set((state) => {
      const globalTabs = state.tabs.filter((tab) => !isProjectTab(tab))
      const tabs = [...globalTabs, ...next.tabs]
      const activeTabId =
        state.activeTabId && globalTabs.some((tab) => tab.id === state.activeTabId)
          ? state.activeTabId
          : (next.activeTabId ?? globalTabs[0]?.id ?? null)
      return { tabs, activeTabId }
    })
  },
}))

useTabStore.subscribe((state) => {
  saveStoredTabs(state)
})
