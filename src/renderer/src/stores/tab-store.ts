import { create } from 'zustand'
import type { ConversationTabRef, Tab, TabType } from '../types'
import type { TerminalSessionSnapshot } from '@shared/ipc/terminal'
import { useBrowserStore } from './browser-store'
import { useEditorStore } from './editor-store'
import { getModelFileIcon, getTabTypeForFile } from '../utils/model-files'
import {
  getWorkspaceStateKey,
  isWorkspaceStateRestoring,
  persistWorkspaceSection,
} from '../utils/workspace-state'
import { workspaceRefFromKey } from '../utils/conversation-workspace'
import { workspaceRefKey } from '@shared/workspace-ref'
import { isHtmlFilePath } from '../utils/html-files'

/** 自增 ID 计数器 */
let nextId = 1
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
  if (type !== 'model' && type !== 'file-preview') return tab
  return {
    ...tab,
    type,
    icon: type === 'model' ? getModelFileIcon(extension) : tab.icon,
    dirty: false,
    initialContent: undefined,
  }
}

function isProjectTab(tab: Tab): boolean {
  return tab.type !== 'settings'
}

function getConversationRuntime(conversation?: ConversationTabRef): {
  location: 'local'
  transport: 'local'
  sessionId: string
} | null {
  if (!conversation) return null
  return {
    location: conversation.runtime.location,
    transport: conversation.runtime.transport,
    sessionId: conversation.sessionId,
  }
}

function getConversationKey(tab: Pick<Tab, 'type' | 'conversation'>): string | null {
  if (tab.type === 'conversation') {
    const runtime = getConversationRuntime(tab.conversation)
    return runtime ? `${runtime.location}:${runtime.transport}:${runtime.sessionId}` : null
  }
  return null
}

function getDataSourceQueryKey(query: Tab['dataSourceQuery']): string | null {
  if (!query) return null
  return [
    query.sourceId,
    query.collection ?? '',
    query.savedQueryId ? `saved:${query.savedQueryId}` : 'ad-hoc',
  ].join(':')
}

function normalizePersistedTab(tab: Tab): Tab {
  return { ...tab, dirty: false }
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
    if (isWorkspaceStateRestoring()) return
    const allTabs = state.tabs.map(normalizePersistedTab)
    const activeWorkspaceKey = getWorkspaceStateKey()
    const projectTabs = allTabs.filter(
      (tab) =>
        isProjectTab(tab) &&
        Boolean(tab.workspaceRef) &&
        workspaceRefKey(tab.workspaceRef!) === activeWorkspaceKey,
    )
    const projectActiveTabId =
      state.activeTabId && projectTabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : (projectTabs[0]?.id ?? null)

    persistWorkspaceSection('tabs', {
      tabs: projectTabs,
      activeTabId: projectActiveTabId,
    })
  } catch {
    // WorkspaceState 镜像失败不应影响当前 Tab 状态。
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
  /** 通用会话 Tab 引用 */
  conversation?: ConversationTabRef
  /** 设置页目标分组 */
  settingsSection?: string
  /** Gerber 生产包层预览 */
  hardwareGerber?: Tab['hardwareGerber']
  /** Terminal 工作现场 */
  terminal?: Tab['terminal']
  /** Terminal 只读历史记录 */
  terminalRecord?: Tab['terminalRecord']
  /** 数据源查询现场 */
  dataSourceQuery?: Tab['dataSourceQuery']
  /** 强制新建，跳过所有去重 */
  forceNew?: boolean
  /** 显式指定 Tab 归属；缺省使用当前工作空间。 */
  workspaceRef?: Tab['workspaceRef']
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
  /** 使用主进程 session 事实源校准 Terminal Tab 的可见投影。 */
  reconcileTerminalSession: (session: TerminalSessionSnapshot) => void
  /** 更新 Tab 关联的文件路径（Save-As 后回填） */
  updateTabFilePath: (id: string, filePath: string) => void
  /** 文件或目录移动后批量同步相关 Tab 路径。 */
  rebaseFilePaths: (oldPrefix: string, newPrefix: string) => void
  /** 复制 Tab（浏览器克隆 URL；编辑器克隆内容为未命名副本） */
  duplicateTab: (id: string) => void
  /** 获取当前活跃 Tab */
  getActiveTab: () => Tab | undefined
  /** 从主进程 WorkspaceState 恢复 Tab 列表 */
  hydrateFromWorkspaceState: (value: unknown) => void
}

export const useTabStore = create<TabState>((set, get) => ({
  // 项目 Tab 由 WorkspaceState 恢复；localStorage 只作为短期镜像写入，不再作为启动种子。
  tabs: DEFAULT_TABS,
  activeTabId: null,

  openTab: ({
    type,
    title,
    icon,
    filePath,
    initialContent,
    initialUrl,
    browserProfile,
    restore,
    conversation,
    settingsSection,
    hardwareGerber,
    terminal,
    terminalRecord,
    dataSourceQuery,
    forceNew,
    workspaceRef,
  }) => {
    set((state) => {
      // forceNew 跳过所有去重
      if (!forceNew) {
        // HTML 可同时保留浏览器预览和源码文本；其他文件仍按 filePath 去重。
        if (filePath) {
          const existing = state.tabs.find(
            (tab) => tab.filePath === filePath && (!isHtmlFilePath(filePath) || tab.type === type),
          )
          if (existing) {
            const nextTabs = state.tabs.map((tab) =>
              tab.id === existing.id
                ? {
                    ...tab,
                    type,
                    title,
                    icon,
                    dirty: false,
                    initialUrl: type === 'browser' ? initialUrl : tab.initialUrl,
                    initialContent:
                      type === 'model' || type === 'file-preview' ? undefined : tab.initialContent,
                    hardwareGerber,
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
        } else if (type === 'conversation' && conversation) {
          // 会话按来源和会话 ID 去重。
          const targetKey = getConversationKey({ type, conversation })
          const existing = state.tabs.find((tab) => getConversationKey(tab) === targetKey)
          if (existing) {
            return { activeTabId: existing.id }
          }
        } else if (type === 'hardware-gerber' && hardwareGerber) {
          const existing = state.tabs.find(
            (t) =>
              t.type === 'hardware-gerber' &&
              t.hardwareGerber?.workspacePath === hardwareGerber.workspacePath &&
              t.hardwareGerber?.packagePath === hardwareGerber.packagePath &&
              (t.hardwareGerber?.entry ?? '') === (hardwareGerber.entry ?? ''),
          )
          if (existing) {
            return { activeTabId: existing.id }
          }
        } else if (type === 'data-source-query' && dataSourceQuery) {
          const targetKey = getDataSourceQueryKey(dataSourceQuery)
          const existing = state.tabs.find(
            (t) =>
              t.type === 'data-source-query' &&
              getDataSourceQueryKey(t.dataSourceQuery) === targetKey,
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
        ...(type === 'settings'
          ? {}
          : { workspaceRef: workspaceRef ?? workspaceRefFromKey(getWorkspaceStateKey()) }),
        filePath,
        initialContent,
        initialUrl,
        browserProfile,
        restore,
        conversation,
        settingsSection,
        hardwareGerber,
        terminal,
        terminalRecord,
        dataSourceQuery,
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

  reconcileTerminalSession: (session) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.type !== 'terminal' || tab.terminal?.sessionId !== session.sessionId) return tab
        return {
          ...tab,
          terminal: {
            ...tab.terminal,
            status: session.status,
            processId: session.processId,
          },
          terminalRecord: session,
        }
      }),
    })),

  updateTabFilePath: (id, filePath) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, filePath } : t)),
    })),

  rebaseFilePaths: (oldPrefix, newPrefix) => {
    if (oldPrefix === newPrefix) return
    const rebasePath = (path: string | undefined): string | undefined => {
      if (!path) return path
      if (path === oldPrefix) return newPrefix
      if (path.startsWith(oldPrefix + '/')) return newPrefix + path.slice(oldPrefix.length)
      return path
    }
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        const filePath = rebasePath(tab.filePath)
        const packagePath = rebasePath(tab.hardwareGerber?.packagePath)
        if (filePath === tab.filePath && packagePath === tab.hardwareGerber?.packagePath) return tab
        return {
          ...tab,
          filePath,
          hardwareGerber: tab.hardwareGerber
            ? { ...tab.hardwareGerber, packagePath: packagePath ?? tab.hardwareGerber.packagePath }
            : undefined,
        }
      }),
    }))
  },

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
        workspaceRef: tab.workspaceRef,
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
    // settings / preview / android / conversation / cclink / hardware-gerber / terminal：菜单层已禁用，此处不处理
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
