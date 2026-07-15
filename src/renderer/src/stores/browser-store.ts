import { create } from 'zustand'
import type { BrowserViewModeType, BrowserZoomModeType } from '@shared/ipc/browser'
import { isWorkspaceStateRestoring, persistWorkspaceSection } from '../utils/workspace-state'

/** 设备模式：桌面 / 移动 */
export type ViewMode = BrowserViewModeType
/** 缩放模式：适应宽度（自动） / 手动 */
export type ZoomMode = BrowserZoomModeType

/** 默认首页 */
const DEFAULT_URL = 'https://www.baidu.com'

/** 单个浏览器 Tab 的状态（每个浏览器 Tab 对应一个独立视图） */
export interface BrowserTabState {
  /** 当前 URL */
  url: string
  /** URL 输入框内容 */
  urlInput: string
  /** 设备模式（桌面 / 移动） */
  viewMode: ViewMode
  /** 缩放模式（适应宽度 / 手动） */
  zoomMode: ZoomMode
  /** 当前生效的缩放系数 */
  zoomFactor: number
  /** CCLink Studio 维护的导航栈（重启后恢复后退/前进） */
  history: string[]
  historyIndex: number
  /** 主进程视图是否已创建 */
  ready: boolean
}

interface BrowserState {
  /** tabId → 浏览器 Tab 状态 */
  tabs: Record<string, BrowserTabState>

  // --- Actions ---
  /** 确保某个浏览器 Tab 状态存在（不存在则用默认值创建），返回该状态 */
  ensureTab: (tabId: string, initialUrl?: string) => BrowserTabState
  /** 标记视图已创建 */
  setReady: (tabId: string) => void
  /** 移除某个浏览器 Tab 状态（Tab 关闭时调用） */
  removeTab: (tabId: string) => void
  /** 设置 URL（同时更新输入框） */
  setUrl: (tabId: string, url: string, nav?: { history?: string[]; historyIndex?: number }) => void
  /** 仅设置 URL 输入框内容 */
  setUrlInput: (tabId: string, url: string) => void
  /** 同步主进程下发的视图状态 */
  setViewState: (
    tabId: string,
    state: { viewMode: ViewMode; zoomMode: ZoomMode; zoomFactor: number },
  ) => void
  /** 从主进程 WorkspaceState 恢复浏览器 Tab 状态 */
  hydrateFromWorkspaceState: (value: unknown) => void
}

/** 构造默认浏览器 Tab 状态 */
function defaultTab(url: string = DEFAULT_URL): BrowserTabState {
  return {
    url,
    urlInput: url,
    viewMode: 'desktop',
    zoomMode: 'fit',
    zoomFactor: 1,
    history: [url],
    historyIndex: 0,
    ready: false,
  }
}

function normalizeBrowserTabsSnapshot(value: unknown): Record<string, BrowserTabState> | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as { tabs?: Record<string, BrowserTabState> }
  if (parsed.tabs && Object.keys(parsed.tabs).length === 0) return {}
  const tabs: Record<string, BrowserTabState> = {}
  for (const [id, tab] of Object.entries(parsed.tabs ?? {})) {
    if (!id || !tab?.url) continue
    const history = Array.isArray(tab.history) && tab.history.length > 0 ? tab.history : [tab.url]
    tabs[id] = {
      url: tab.url,
      urlInput: tab.urlInput || tab.url,
      viewMode: tab.viewMode === 'mobile' ? 'mobile' : 'desktop',
      zoomMode: tab.zoomMode === 'manual' ? 'manual' : 'fit',
      zoomFactor: typeof tab.zoomFactor === 'number' ? tab.zoomFactor : 1,
      history,
      historyIndex: typeof tab.historyIndex === 'number'
        ? Math.min(Math.max(tab.historyIndex, 0), Math.max(history.length - 1, 0))
        : 0,
      ready: false,
    }
  }
  return Object.keys(tabs).length > 0 ? tabs : null
}

function saveStoredBrowserTabs(state: BrowserState): void {
  try {
    if (isWorkspaceStateRestoring()) return
    const tabs: Record<string, BrowserTabState> = {}
    for (const [id, tab] of Object.entries(state.tabs)) {
      tabs[id] = { ...tab, ready: false }
    }
    persistWorkspaceSection('browserTabs', { tabs })
  } catch {
    // WorkspaceState 镜像失败不应影响当前浏览器状态。
  }
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  // 项目相关浏览器状态以 main process WorkspaceState 为权威，避免全局 localStorage 串项目。
  tabs: {},

  ensureTab: (tabId, initialUrl) => {
    const existing = get().tabs[tabId]
    if (existing) return existing
    const entry = defaultTab(initialUrl)
    set((state) => ({ tabs: { ...state.tabs, [tabId]: entry } }))
    return entry
  },

  setReady: (tabId) =>
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab) return state
      return { tabs: { ...state.tabs, [tabId]: { ...tab, ready: true } } }
    }),

  removeTab: (tabId) =>
    set((state) => {
      if (!state.tabs[tabId]) return state
      const { [tabId]: _removed, ...rest } = state.tabs
      return { tabs: rest }
    }),

  setUrl: (tabId, url, nav) =>
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab) return state
      return {
        tabs: {
          ...state.tabs,
          [tabId]: {
            ...tab,
            url,
            urlInput: url,
            history: nav?.history?.length ? nav.history : tab.history,
            historyIndex: typeof nav?.historyIndex === 'number' ? nav.historyIndex : tab.historyIndex,
          },
        },
      }
    }),

  setUrlInput: (tabId, url) =>
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab) return state
      return { tabs: { ...state.tabs, [tabId]: { ...tab, urlInput: url } } }
    }),

  setViewState: (tabId, viewState) =>
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab) return state
      return {
        tabs: {
          ...state.tabs,
          [tabId]: {
            ...tab,
            viewMode: viewState.viewMode,
            zoomMode: viewState.zoomMode,
            zoomFactor: viewState.zoomFactor,
          },
        },
      }
    }),

  hydrateFromWorkspaceState: (value) => {
    const tabs = normalizeBrowserTabsSnapshot(value)
    if (!tabs) return
    set({ tabs })
  },
}))

useBrowserStore.subscribe((state) => {
  saveStoredBrowserTabs(state)
})
