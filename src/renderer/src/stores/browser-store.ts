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
  /** 页面标题；独立于用户可重命名的 Workbench Tab 标题。 */
  title?: string | null
  /** 页面 favicon；不存在或加载失败时 UI 使用通用浏览器图标。 */
  faviconUrl?: string | null
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

export interface BrowserBookmark {
  id: string
  url: string
  title: string
  faviconUrl: string | null
  createdAt: number
}

interface BrowserState {
  /** tabId → 浏览器 Tab 状态 */
  tabs: Record<string, BrowserTabState>
  /** 当前项目收藏的网页；随 browserTabs 分区持久化。 */
  bookmarks: BrowserBookmark[]

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
  /** 同步页面标题与 favicon。 */
  setPageMeta: (tabId: string, meta: { title?: string; faviconUrl?: string | null }) => void
  /** 同步主进程下发的视图状态 */
  setViewState: (
    tabId: string,
    state: { viewMode: ViewMode; zoomMode: ZoomMode; zoomFactor: number },
  ) => void
  /** 从主进程 WorkspaceState 恢复浏览器 Tab 状态 */
  hydrateFromWorkspaceState: (value: unknown) => void
  /** 收藏网页到当前项目。 */
  addBookmark: (bookmark: Omit<BrowserBookmark, 'id' | 'createdAt'>) => void
  /** 从当前项目收藏中移除网页。 */
  removeBookmark: (id: string) => void
}

/** 构造默认浏览器 Tab 状态 */
function defaultTab(url: string = DEFAULT_URL): BrowserTabState {
  return {
    url,
    urlInput: url,
    title: null,
    faviconUrl: null,
    viewMode: 'desktop',
    zoomMode: 'fit',
    zoomFactor: 1,
    history: [url],
    historyIndex: 0,
    ready: false,
  }
}

function normalizeBrowserSnapshot(value: unknown): {
  tabs: Record<string, BrowserTabState>
  bookmarks: BrowserBookmark[]
} {
  if (!value || typeof value !== 'object') return { tabs: {}, bookmarks: [] }
  const parsed = value as {
    tabs?: Record<string, BrowserTabState>
    bookmarks?: BrowserBookmark[]
  }
  const tabs: Record<string, BrowserTabState> = {}
  for (const [id, tab] of Object.entries(parsed.tabs ?? {})) {
    if (!id || !tab?.url) continue
    const history = Array.isArray(tab.history) && tab.history.length > 0 ? tab.history : [tab.url]
    tabs[id] = {
      url: tab.url,
      urlInput: tab.urlInput || tab.url,
      title: typeof tab.title === 'string' && tab.title.trim() ? tab.title.trim() : null,
      faviconUrl:
        typeof tab.faviconUrl === 'string' && tab.faviconUrl.trim() ? tab.faviconUrl : null,
      viewMode: tab.viewMode === 'mobile' ? 'mobile' : 'desktop',
      zoomMode: tab.zoomMode === 'manual' ? 'manual' : 'fit',
      zoomFactor: typeof tab.zoomFactor === 'number' ? tab.zoomFactor : 1,
      history,
      historyIndex:
        typeof tab.historyIndex === 'number'
          ? Math.min(Math.max(tab.historyIndex, 0), Math.max(history.length - 1, 0))
          : 0,
      ready: false,
    }
  }
  const bookmarks = Array.isArray(parsed.bookmarks)
    ? parsed.bookmarks.flatMap((bookmark) => {
        if (!bookmark || typeof bookmark.url !== 'string' || !bookmark.url.trim()) return []
        return [
          {
            id:
              typeof bookmark.id === 'string' && bookmark.id
                ? bookmark.id
                : `bookmark-${bookmark.createdAt || Date.now()}`,
            url: bookmark.url.trim(),
            title:
              typeof bookmark.title === 'string' && bookmark.title.trim()
                ? bookmark.title.trim()
                : bookmark.url.trim(),
            faviconUrl:
              typeof bookmark.faviconUrl === 'string' && bookmark.faviconUrl.trim()
                ? bookmark.faviconUrl
                : null,
            createdAt: typeof bookmark.createdAt === 'number' ? bookmark.createdAt : Date.now(),
          },
        ]
      })
    : []
  return { tabs, bookmarks }
}

function saveStoredBrowserTabs(state: BrowserState): void {
  try {
    if (isWorkspaceStateRestoring()) return
    const tabs: Record<string, BrowserTabState> = {}
    for (const [id, tab] of Object.entries(state.tabs)) {
      tabs[id] = { ...tab, ready: false }
    }
    persistWorkspaceSection('browserTabs', { tabs, bookmarks: state.bookmarks })
  } catch {
    // WorkspaceState 镜像失败不应影响当前浏览器状态。
  }
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  // 项目相关浏览器状态以 main process WorkspaceState 为权威，避免全局 localStorage 串项目。
  tabs: {},
  bookmarks: [],

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
            historyIndex:
              typeof nav?.historyIndex === 'number' ? nav.historyIndex : tab.historyIndex,
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

  setPageMeta: (tabId, meta) =>
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab) return state
      return {
        tabs: {
          ...state.tabs,
          [tabId]: {
            ...tab,
            ...(typeof meta.title === 'string' ? { title: meta.title.trim() || null } : {}),
            ...(meta.faviconUrl !== undefined
              ? { faviconUrl: meta.faviconUrl?.trim() || null }
              : {}),
          },
        },
      }
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
    set(normalizeBrowserSnapshot(value))
  },

  addBookmark: (bookmark) =>
    set((state) => {
      const existing = state.bookmarks.find((item) => item.url === bookmark.url)
      if (existing) {
        return {
          bookmarks: state.bookmarks.map((item) =>
            item.id === existing.id ? { ...item, ...bookmark } : item,
          ),
        }
      }
      return {
        bookmarks: [
          ...state.bookmarks,
          {
            ...bookmark,
            id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
          },
        ],
      }
    }),

  removeBookmark: (id) =>
    set((state) => ({ bookmarks: state.bookmarks.filter((bookmark) => bookmark.id !== id) })),
}))

useBrowserStore.subscribe((state) => {
  saveStoredBrowserTabs(state)
})
