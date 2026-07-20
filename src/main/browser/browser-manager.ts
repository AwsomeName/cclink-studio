import { BrowserWindow, WebContentsView, session, type Cookie, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { BrowserInstanceStore } from '../persistence/browser-instance-store'
import type {
  BrowserCookieChangeDiagnosticEntry,
  BrowserCookieDiagnosticEntry,
  BrowserSessionDiagnosticSummary,
  BrowserReconcileViewsOptions,
  BrowserViewModeType,
  BrowserViewState,
  BrowserZoomModeType,
} from '../../shared/ipc/browser'
import { installBrowserCompatibilityHeaders, normalizeDesktopUserAgent } from './browser-stealth'
import {
  isAllowedBrowserAuthCookie,
  isSupportedBrowserAuthRequest,
  resolveBrowserAuthReturnUrl,
  sanitizeBrowserAuthMainUrl,
  type BrowserAuthCompleteMessage,
  type BrowserAuthRequest,
} from './browser-auth-contract'
import { shouldDestroyBrowserViewDuringReconcile } from './browser-view-reconciliation'

/** 移动版模拟时的目标视口宽度（CSS px，约等于 iPhone Pro 逻辑宽度） */
const MOBILE_WIDTH = 414
/** 移动版 User-Agent（iOS Safari），让站点返回移动端布局 */
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
/** 缩放范围限制 */
const MIN_ZOOM = 0.3
const MAX_ZOOM = 3
const ZOOM_STEP = 0.1
/** 默认首页 */
const DEFAULT_URL = 'https://www.baidu.com'
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/
const LIKELY_AUTH_COOKIE_RE =
  /(?:^|[_-])(auth|account|login|session(?:id)?|sid|sso|token|user|uid)(?:$|[_-])|^(?:a2|sessionid|z_c0|q_c1)$/i
const NON_AUTH_COOKIE_RE = /(captcha|challenge|csrf|xsrf|analytics|tracking|experiment)/i

/** 设备模式：桌面 / 移动 */
export type ViewMode = BrowserViewModeType
/** 缩放模式：适应宽度（自动） / 手动 */
export type ZoomMode = BrowserZoomModeType
export type { BrowserViewState } from '../../shared/ipc/browser'

/**
 * 单个浏览器视图的运行时状态
 *
 * 每个 Tab 对应一个独立的 WebContentsView，各自维护导航历史、缩放、设备模式。
 * 同一时刻只有一个视图 attach 到窗口（由 activeViewId 标记），其余保持 warm。
 */
interface ViewEntry {
  view: WebContentsView
  /** 是否已收到真实 bounds（首次加载用） */
  boundsReceived: boolean
  /** 设备模式：桌面 / 移动 */
  viewMode: ViewMode
  /** 缩放模式：适应宽度 / 手动 */
  zoomMode: ZoomMode
  /** 手动缩放系数 */
  manualZoom: number
  /** 当前实际生效的缩放系数 */
  effectiveZoom: number
  /** 桌面版原始 UA（切回桌面时还原） */
  desktopUA: string
  /** 适应宽度重算的防抖定时器 */
  fitDebounce: ReturnType<typeof setTimeout> | null
  /** 首次激活时加载的 URL */
  pendingUrl: string
  /** 当前 URL */
  url: string
  /** CCLink Studio 维护的导航栈（用于重启恢复和原生栈不可用时兜底） */
  history: string[]
  historyIndex: number
  pendingHistoryDirection: 'back' | 'forward' | null
  /** 项目运营平台 Profile；为空时使用默认 session。 */
  profileId: string | null
  /** 创建该视图的工作区；用于阻断相同 tabId 的跨项目复用。 */
  workspaceKey: string | null
}

/**
 * 内嵌浏览器管理器（多视图）
 *
 * 使用 WebContentsView（Electron 30+）。相比单视图版本，按 tabId 维护一个视图注册表，
 * 让每个浏览器 Tab 成为独立网页。缩放/设备模式说明见 applyZoom 注释。
 */
export class BrowserManager {
  /** tabId → 视图运行时状态 */
  private views = new Map<string, ViewEntry>()
  /** 当前 attach 到窗口的视图 tabId（一次只能 attach 一个） */
  private activeViewId: string | null = null
  /** renderer 最近声明的当前项目；与 Playwright 当前页、BrowserView 活跃页分开维护。 */
  private currentWorkspaceKey: string | null = null
  private mainWindow: BrowserWindow
  /** 内容区坐标（全局，所有视图共享同一矩形） */
  private currentBounds = { x: 0, y: 0, width: 0, height: 0 }
  /** 新建视图的默认状态（从设置继承） */
  private defaultViewMode: ViewMode = 'desktop'
  private defaultZoomMode: ZoomMode = 'fit'
  /** PlaywrightBridge（晚绑定，CDP 连上后注入）；用于让 Agent 工具按 tabId 寻址到 Page */
  private playwrightBridge: PlaywrightBridge | null = null
  /** view 被销毁时回调（tabId）—— AgentBridge / TaskRuntime 等据此清理状态 */
  private readonly viewDestroyedCallbacks = new Set<(tabId: string) => void>()
  /** 浏览历史存储（晚绑定）。项目浏览器现场由 WorkspaceState 负责。 */
  private instanceStore: BrowserInstanceStore | null = null
  private readonly lastClaimByTab = new Map<
    string,
    {
      status: 'succeeded' | 'failed'
      timestamp: number
      expectedUrl: string
      errorMessage?: string
    }
  >()
  private readonly observedCookieSessions = new WeakSet<Session>()
  private readonly cookieChanges: Array<
    BrowserCookieChangeDiagnosticEntry & { partition: string }
  > = []
  private browserAuthRequestHandler: ((request: BrowserAuthRequest) => void) | null = null

  constructor(mainWindow: BrowserWindow, defaults?: { zoomMode?: ZoomMode; viewMode?: ViewMode }) {
    this.mainWindow = mainWindow
    if (defaults?.zoomMode) this.defaultZoomMode = defaults.zoomMode
    if (defaults?.viewMode) this.defaultViewMode = defaults.viewMode
  }

  /** 安全获取主窗口（已销毁则返回 null） */
  private win(): BrowserWindow | null {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return null
    return this.mainWindow
  }

  /**
   * 晚绑定 PlaywrightBridge（CDP 连上后调用）。
   *
   * BrowserManager 在 createWindow 阶段先于 PlaywrightBridge 构造，无法构造期注入；
   * 由 index.ts 在 connect() 之后调用本方法注入。注入后会为已存在的视图补 claim。
   */
  attachPlaywright(bridge: PlaywrightBridge): void {
    this.playwrightBridge = bridge
    // Playwright 连接后，为已存在的项目浏览器视图补做显式 claim。
    for (const [tabId, entry] of this.views) {
      // 不 await：claim 失败仅记录日志，不阻塞 UI
      void this.claimViewPage(tabId, entry).catch((err) =>
        console.warn(`[BrowserManager] 补 claim 失败 tabId=${tabId}:`, (err as Error).message),
      )
    }
    console.log(`[BrowserManager] PlaywrightBridge 已绑定，补 claim ${this.views.size} 个视图`)
  }

  /** 注册 view 销毁回调（AgentBridge 据此把失效的 browser scope 降级） */
  onViewDestroyed(cb: (tabId: string) => void): void {
    this.viewDestroyedCallbacks.add(cb)
  }

  /** 绑定浏览历史存储。 */
  attachInstanceStore(store: BrowserInstanceStore): void {
    this.instanceStore = store
  }

  attachBrowserAuthRequestHandler(handler: (request: BrowserAuthRequest) => void): void {
    this.browserAuthRequestHandler = handler
  }

  /**
   * 把某 view 的 webContents claim 为 Playwright Page，绑定到 tabId。
   * 期望在页面加载完成后调用（URL 匹配更稳）。失败抛错由调用方处理。
   */
  private async claimViewPage(tabId: string, entry: ViewEntry): Promise<void> {
    if (!this.playwrightBridge) return
    const url = entry.view.webContents.getURL() || entry.pendingUrl
    try {
      await this.playwrightBridge.claimPageForView(tabId, entry.view.webContents, url)
      if (this.activeViewId === tabId) await this.playwrightBridge.switchToPage(tabId)
      this.lastClaimByTab.set(tabId, {
        status: 'succeeded',
        timestamp: Date.now(),
        expectedUrl: url,
      })
    } catch (error) {
      this.lastClaimByTab.set(tabId, {
        status: 'failed',
        timestamp: Date.now(),
        expectedUrl: url,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * 创建一个浏览器视图（已存在则忽略）
   * 视图以零尺寸创建但不 attach；首次 setActive 时才会 attach 并按 pendingUrl 加载。
   *
   * @param opts.restore 恢复态：从快照重建时传入，覆盖默认 viewMode/zoom（实现「不是只恢复 URL」）
   */
  createView(
    tabId: string,
    initialUrl?: string,
    opts?: {
      restore?: {
        viewMode: ViewMode
        zoomMode: ZoomMode
        manualZoom: number
        history?: string[]
        historyIndex?: number
      }
      profileId?: string | null
      workspaceKey?: string | null
    },
  ): void {
    const requestedProfileId = this.normalizeProfileId(opts?.profileId)
    const safeInitialUrl = initialUrl
      ? sanitizeBrowserAuthMainUrl(requestedProfileId, initialUrl)
      : undefined
    let existing = this.views.get(tabId)
    const workspaceKey = opts?.workspaceKey ?? null
    if (existing && existing.workspaceKey !== workspaceKey) {
      this.destroyView(tabId)
      existing = undefined
    }
    if (existing) {
      if (opts?.restore) {
        existing.viewMode = opts.restore.viewMode
        existing.zoomMode = opts.restore.zoomMode
        existing.manualZoom = opts.restore.manualZoom
        if (opts.restore.history?.length) {
          existing.history = opts.restore.history.map((url) =>
            sanitizeBrowserAuthMainUrl(existing.profileId, url),
          )
          existing.historyIndex =
            typeof opts.restore.historyIndex === 'number'
              ? Math.min(Math.max(opts.restore.historyIndex, 0), opts.restore.history.length - 1)
              : opts.restore.history.length - 1
        }
        existing.view.webContents.setUserAgent(
          existing.viewMode === 'mobile' ? MOBILE_UA : existing.desktopUA,
        )
      }
      if (safeInitialUrl && existing.url === DEFAULT_URL) {
        existing.pendingUrl = safeInitialUrl
        existing.url = safeInitialUrl
        if (existing.boundsReceived) {
          void existing.view.webContents.loadURL(safeInitialUrl)
        }
      }
      return
    }
    if (!this.win()) return

    const profileId = requestedProfileId
    const viewSession = profileId
      ? session.fromPartition(`persist:cclink-studio-profile-${profileId}`)
      : undefined
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        ...(viewSession ? { session: viewSession } : {}),
      },
    })

    installBrowserCompatibilityHeaders(view.webContents.session)
    this.observeCookieChanges(view.webContents.session, profileId)

    // 去掉 Electron/CCLink Studio 标识，让 UA 看起来像真实 Chrome
    const desktopUA = normalizeDesktopUserAgent(view.webContents.getUserAgent())
    // 恢复态：按快照设置 UA（移动/桌面）以拿到对应布局
    const initViewMode = opts?.restore?.viewMode ?? this.defaultViewMode
    if (initViewMode === 'mobile') {
      view.webContents.setUserAgent(MOBILE_UA)
    } else {
      view.webContents.setUserAgent(desktopUA)
    }

    const entry: ViewEntry = {
      view,
      boundsReceived: false,
      viewMode: initViewMode,
      zoomMode: opts?.restore?.zoomMode ?? this.defaultZoomMode,
      manualZoom: opts?.restore?.manualZoom ?? 1,
      effectiveZoom: 1,
      desktopUA,
      fitDebounce: null,
      pendingUrl: safeInitialUrl ?? DEFAULT_URL,
      url: safeInitialUrl ?? DEFAULT_URL,
      history: opts?.restore?.history?.length
        ? opts.restore.history.map((url) => sanitizeBrowserAuthMainUrl(profileId, url))
        : [safeInitialUrl ?? DEFAULT_URL],
      historyIndex:
        typeof opts?.restore?.historyIndex === 'number'
          ? Math.min(
              Math.max(opts.restore.historyIndex, 0),
              Math.max((opts.restore.history?.length ?? 1) - 1, 0),
            )
          : 0,
      pendingHistoryDirection: null,
      profileId,
      workspaceKey,
    }

    // 监听导航事件（闭包捕获 tabId，发出的事件携带 tabId）
    const wc = view.webContents
    wc.on('will-navigate', (event, url) => {
      if (this.routeBrowserAuth(tabId, entry, url)) event.preventDefault()
    })
    wc.on('will-redirect', (event, url) => {
      if (this.routeBrowserAuth(tabId, entry, url)) event.preventDefault()
    })
    wc.setWindowOpenHandler(({ url }) => {
      return this.routeBrowserAuth(tabId, entry, url) ? { action: 'deny' } : { action: 'allow' }
    })
    wc.on('did-navigate', (_event, url) => this.onNavigate(tabId, url))
    wc.on('did-navigate-in-page', (_event, url) => this.onNavigate(tabId, url))
    wc.on('page-title-updated', (_event, title) => {
      this.emitPageMeta(tabId, { title })
    })
    wc.on('page-favicon-updated', (_event, favicons) => {
      this.emitPageMeta(tabId, { faviconUrl: favicons[0] ?? null })
    })
    // 每次页面加载完成后，按当前模式重新计算并应用缩放
    wc.on('did-finish-load', () => {
      void this.applyZoom(tabId, true)
      // 页面加载完成 → 把该 view claim 为 Playwright Page（绑定 tabId）。
      // 仅在绑定了 PlaywrightBridge 后生效；幂等（claimPageForView 跳过已绑定的 key）。
      // 失败仅记录日志，不阻塞 UI——Agent 寻址在下次 did-finish-load 重试。
      const entry2 = this.views.get(tabId)
      if (entry2 && this.playwrightBridge) {
        void this.claimViewPage(tabId, entry2).catch((err) =>
          console.warn(`[BrowserManager] claim 失败 tabId=${tabId}:`, (err as Error).message),
        )
      }
    })

    this.views.set(tabId, entry)

    // 若该视图已是活跃视图，立即尝试加载（bounds 已就绪时）
    if (this.activeViewId === tabId) {
      this.ensureLoaded(tabId)
    }
  }

  private normalizeProfileId(profileId?: string | null): string | null {
    if (!profileId) return null
    const normalized = profileId.trim()
    return PROFILE_ID_PATTERN.test(normalized) ? normalized : null
  }

  private routeBrowserAuth(tabId: string, entry: ViewEntry, url: string): boolean {
    if (!entry.profileId || !this.browserAuthRequestHandler) return false
    const request = { tabId, profileId: entry.profileId, url }
    if (!isSupportedBrowserAuthRequest(request)) return false
    this.browserAuthRequestHandler(request)
    return true
  }

  /** 导航事件：记录 URL 并同步给渲染进程 */
  private onNavigate(tabId: string, url: string): void {
    const entry = this.views.get(tabId)
    if (entry) {
      entry.url = url
      if (entry.pendingHistoryDirection === 'back') {
        entry.historyIndex = Math.max(0, entry.historyIndex - 1)
        entry.pendingHistoryDirection = null
      } else if (entry.pendingHistoryDirection === 'forward') {
        entry.historyIndex = Math.min(entry.history.length - 1, entry.historyIndex + 1)
        entry.pendingHistoryDirection = null
      } else if (entry.history[entry.historyIndex] !== url) {
        entry.history = [...entry.history.slice(0, entry.historyIndex + 1), url].slice(-100)
        entry.historyIndex = entry.history.length - 1
      }
    }
    if (entry && this.instanceStore && url && url !== 'about:blank' && url !== DEFAULT_URL) {
      void this.instanceStore.recordHistory({
        id: randomUUID(),
        url,
        title: entry.view.webContents.getTitle() || null,
        visitedAt: Date.now(),
      })
    }
    const win = this.win()
    if (win)
      win.webContents.send('browser:urlChanged', {
        tabId,
        url,
        history: entry?.history ?? [url],
        historyIndex: entry?.historyIndex ?? 0,
      })
  }

  private emitPageMeta(tabId: string, meta: { title?: string; faviconUrl?: string | null }): void {
    const win = this.win()
    if (!win) return
    win.webContents.send('browser:pageMetaChanged', { tabId, ...meta })
  }

  /**
   * 首次激活 + bounds 就绪时加载 pendingUrl
   * 保证视图只在真正需要展示时才发起网络请求（惰性加载）
   */
  private ensureLoaded(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry || entry.boundsReceived) return
    entry.boundsReceived = true
    // 即使 renderer 尚未上报真实 bounds，也先用 1x1 临时区域加载页面。
    // 否则 Electron 会暴露一个空 URL 的 CDP target，Playwright connectOverCDP 可能卡住。
    const bounds =
      this.currentBounds.width > 0 && this.currentBounds.height > 0
        ? this.currentBounds
        : { x: 0, y: 0, width: 1, height: 1 }
    entry.view.setBounds(bounds)
    void entry.view.webContents.loadURL(entry.pendingUrl)
  }

  /** 销毁指定视图 */
  destroyView(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    if (entry.fitDebounce) clearTimeout(entry.fitDebounce)
    const win = this.win()
    if (win) {
      try {
        win.contentView.removeChildView(entry.view)
      } catch {
        // 窗口可能已销毁，忽略
      }
    }
    try {
      entry.view.webContents.close()
    } catch {
      // 忽略
    }
    this.views.delete(tabId)
    if (this.activeViewId === tabId) this.activeViewId = null

    // 解绑 Playwright Page（释放注册表 key），并通知 AgentBridge 把失效的 browser scope 降级
    if (this.playwrightBridge) {
      this.playwrightBridge.unregisterPage(tabId)
    }
    for (const cb of this.viewDestroyedCallbacks) {
      cb(tabId)
    }
  }

  /**
   * 设置当前活跃视图（一次只 attach 一个）
   * @param tabId 目标视图 tabId；null = 全部隐藏
   */
  setActive(tabId: string | null): void {
    const win = this.win()
    if (!win) return

    // activeViewId 可能因旧异步调用或 removeChildView 异常失真。
    // 每次都遍历并 detach 非目标视图，避免原生 View 盖到编辑器/其他项目 Tab 上。
    for (const [viewId, entry] of this.views) {
      if (viewId !== tabId) {
        try {
          win.contentView.removeChildView(entry.view)
        } catch {
          // 忽略
        }
      }
    }

    if (!tabId) {
      this.activeViewId = null
      return
    }

    const entry = this.views.get(tabId)
    if (!entry) {
      // 视图尚未创建（createView 尚未到达），记下活跃标记，createView 时会处理
      this.activeViewId = tabId
      return
    }

    win.contentView.addChildView(entry.view)
    entry.view.setBounds(this.currentBounds)
    this.activeViewId = tabId
    void this.playwrightBridge?.switchToPage(tabId).catch(() => {
      // 页面尚未 claim 时由 did-finish-load 完成绑定和激活。
    })

    // 首次激活时加载页面；之后保持 warm 状态
    this.ensureLoaded(tabId)
    // 重新计算缩放（适配当前面板宽度）
    void this.applyZoom(tabId, false)
    this.emitState(tabId)
  }

  /** 让 renderer 声明当前工作区允许存在和显示的浏览器视图。 */
  reconcileViews(options: BrowserReconcileViewsOptions): void {
    this.currentWorkspaceKey = options.workspaceKey
    const validTabIds = new Set(options.validTabIds)
    for (const [tabId, entry] of [...this.views]) {
      if (
        shouldDestroyBrowserViewDuringReconcile({
          tabId,
          viewWorkspaceKey: entry.workspaceKey,
          activeWorkspaceKey: options.workspaceKey,
          validTabIds,
        })
      ) {
        this.destroyView(tabId)
      }
    }

    const activeEntry = options.activeTabId ? this.views.get(options.activeTabId) : null
    this.setActive(
      activeEntry && activeEntry.workspaceKey === options.workspaceKey ? options.activeTabId : null,
    )
  }

  /**
   * 更新内容区坐标（全局）
   * 由渲染进程通过 IPC 上报 Workbench 区域坐标，作用于当前活跃视图
   */
  updateBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.currentBounds = bounds
    if (!this.activeViewId) return
    const entry = this.views.get(this.activeViewId)
    if (!entry) return

    // 首次收到真实 bounds → 触发加载
    if (!entry.boundsReceived) {
      this.ensureLoaded(this.activeViewId)
      return
    }

    // bounds 立即生效，保证 resize 跟手；缩放重算防抖处理
    entry.view.setBounds(bounds)
    this.scheduleFit(this.activeViewId)
  }

  /** 防抖触发缩放重算（resize 期间高频调用，避免抖动） */
  private scheduleFit(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    if (entry.fitDebounce) clearTimeout(entry.fitDebounce)
    entry.fitDebounce = setTimeout(() => {
      void this.applyZoom(tabId, false)
    }, 120)
  }

  /**
   * 按当前 viewMode / zoomMode 计算并应用缩放系数
   * @param tabId 目标视图
   * @param rebase 是否以 1 倍为基准重新测量内容宽度（首次加载 / 切换到适应模式时用）
   */
  private async applyZoom(tabId: string, rebase = false): Promise<void> {
    const entry = this.views.get(tabId)
    if (!entry) return
    // 仅对活跃视图应用（非活跃视图会在 setActive 时重算）
    if (this.activeViewId !== tabId) return
    const paneWidth = this.currentBounds.width
    if (paneWidth <= 0) return
    const wc = entry.view.webContents

    let factor = 1
    try {
      if (entry.viewMode === 'mobile') {
        // 移动版：把约 414px 的移动视口放大填满面板
        factor = paneWidth / MOBILE_WIDTH
      } else if (entry.zoomMode === 'fit') {
        // 适应宽度：测量内容真实宽度，缩小到刚好放下（只缩不放大）
        if (rebase) wc.setZoomFactor(1)
        const contentWidth = await this.measureContentWidth(tabId)
        factor = contentWidth > paneWidth ? paneWidth / contentWidth : 1
      } else {
        // 手动缩放
        factor = entry.manualZoom
      }
    } catch {
      factor = entry.zoomMode === 'manual' ? entry.manualZoom : 1
    }

    factor = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor))
    wc.setZoomFactor(factor)
    entry.effectiveZoom = factor
    this.emitState(tabId)
  }

  /** 测量指定视图当前页面的真实内容宽度（CSS px） */
  private async measureContentWidth(tabId: string): Promise<number> {
    const entry = this.views.get(tabId)
    if (!entry) return 0
    const result = await entry.view.webContents.executeJavaScript(
      '(function(){var d=document;return Math.max(d.documentElement?d.documentElement.scrollWidth:0, d.body?d.body.scrollWidth:0);})()',
    )
    return typeof result === 'number' ? result : 0
  }

  /** 把指定视图的状态同步给渲染进程 */
  private emitState(tabId: string): void {
    const win = this.win()
    if (!win) return
    win.webContents.send('browser:viewStateChanged', { tabId, ...this.getState(tabId) })
  }

  /** 获取指定视图状态 */
  getState(tabId: string): BrowserViewState | null {
    const entry = this.views.get(tabId)
    if (!entry) return null
    return {
      viewMode: entry.viewMode,
      zoomMode: entry.zoomMode,
      zoomFactor: entry.effectiveZoom,
    }
  }

  /** 兼容：返回当前活跃视图状态（无活跃视图返回 null） */
  getViewState(): BrowserViewState | null {
    if (!this.activeViewId) return null
    return this.getState(this.activeViewId)
  }

  /** 当前真正 attach 到窗口里的可视浏览器视图 ID。 */
  getActiveViewId(): string | null {
    return this.activeViewId
  }

  /** 返回指定项目当前可见的浏览器；绝不回退到其他项目的活跃视图。 */
  getActiveViewIdForWorkspace(workspaceKey: string | null): string | null {
    if (!this.activeViewId) return null
    return this.views.get(this.activeViewId)?.workspaceKey === workspaceKey
      ? this.activeViewId
      : null
  }

  /** 返回项目内可继续执行的浏览器，允许它处于后台但不改变 UI 激活态。 */
  getViewIdForWorkspace(workspaceKey: string | null): string | null {
    return (
      this.getActiveViewIdForWorkspace(workspaceKey) ??
      [...this.views].find(([, entry]) => entry.workspaceKey === workspaceKey)?.[0] ??
      null
    )
  }

  isWorkspaceActive(workspaceKey: string | null): boolean {
    return this.currentWorkspaceKey === workspaceKey
  }

  /** 查询 Tab 的真实项目归属；undefined 表示视图不存在。 */
  getViewWorkspaceKey(tabId: string): string | null | undefined {
    return this.views.get(tabId)?.workspaceKey
  }

  /** 等待 renderer 完成浏览器 Tab -> WebContentsView 的异步创建与激活。 */
  async waitForActiveView(timeoutMs = 2500): Promise<string | null> {
    const deadline = Date.now() + timeoutMs
    let lastRequestAt = 0
    while (!this.activeViewId && Date.now() < deadline) {
      if (Date.now() - lastRequestAt >= 500) {
        this.win()?.webContents.send('browser:requestOpenTab', { initialUrl: DEFAULT_URL })
        lastRequestAt = Date.now()
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return this.activeViewId
  }

  /** 等待指定项目的浏览器；后台项目只复用已有 View，不会在当前 UI 新建。 */
  async waitForActiveViewForWorkspace(
    workspaceKey: string | null,
    timeoutMs = 2500,
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutMs
    let lastRequestAt = 0
    let tabId = this.getViewIdForWorkspace(workspaceKey)
    if (!tabId && !this.isWorkspaceActive(workspaceKey)) return null
    while (!tabId && Date.now() < deadline) {
      if (this.isWorkspaceActive(workspaceKey) && Date.now() - lastRequestAt >= 500) {
        this.win()?.webContents.send('browser:requestOpenTab', {
          initialUrl: DEFAULT_URL,
          workspaceKey,
        })
        lastRequestAt = Date.now()
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
      tabId = this.getViewIdForWorkspace(workspaceKey)
    }
    return tabId
  }

  /** 列出真实可视浏览器 View，不依赖 Playwright 是否已完成 claim。 */
  listViews(): Array<{ tabId: string; url: string; title: string }> {
    const activeWorkspaceKey = this.activeViewId
      ? (this.views.get(this.activeViewId)?.workspaceKey ?? null)
      : null
    return [...this.views]
      .filter(([, entry]) => entry.workspaceKey === activeWorkspaceKey)
      .map(([tabId, entry]) => ({
        tabId,
        url: entry.view.webContents.getURL() || entry.url || entry.pendingUrl,
        title: entry.view.webContents.getTitle() || '',
      }))
  }

  /** 列出指定项目的浏览器视图，不受当前 UI 项目影响。 */
  listViewsForWorkspace(
    workspaceKey: string | null,
  ): Array<{ tabId: string; url: string; title: string }> {
    return [...this.views]
      .filter(([, entry]) => entry.workspaceKey === workspaceKey)
      .map(([tabId, entry]) => ({
        tabId,
        url: entry.view.webContents.getURL() || entry.url || entry.pendingUrl,
        title: entry.view.webContents.getTitle() || '',
      }))
  }

  /** 主动补做 Playwright claim，供工具在页面恢复竞态中自愈。 */
  async ensurePlaywrightPage(tabId: string): Promise<void> {
    const entry = this.views.get(tabId)
    if (!entry) throw new Error(`可视浏览器 Tab 不存在: ${tabId}`)
    if (!this.playwrightBridge) throw new Error('Playwright 尚未连接')

    if (this.isWorkspaceActive(entry.workspaceKey)) this.setActive(tabId)
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.claimViewPage(tabId, entry)
        return
      } catch (error) {
        lastError = error
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  // ─────────────────────── 缩放控制 ───────────────────────

  /** 设置手动缩放系数（切换到手动模式） */
  setZoom(tabId: string, factor: number): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    entry.zoomMode = 'manual'
    entry.manualZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor))
    void this.applyZoom(tabId)
  }

  /** 放大一档 */
  zoomIn(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    this.setZoom(tabId, entry.effectiveZoom + ZOOM_STEP)
  }

  /** 缩小一档 */
  zoomOut(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    this.setZoom(tabId, entry.effectiveZoom - ZOOM_STEP)
  }

  /** 重置为 100% */
  resetZoom(tabId: string): void {
    this.setZoom(tabId, 1)
  }

  /** 切换到「适应宽度」自动模式 */
  setFitWidth(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    entry.zoomMode = 'fit'
    void this.applyZoom(tabId, true)
  }

  // ─────────────────────── 设备模式 ───────────────────────

  /** 设置设备模式（桌面 / 移动）；切换 UA 并重新加载以获取对应布局 */
  setDeviceMode(tabId: string, mode: ViewMode): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    if (mode === entry.viewMode) return
    entry.viewMode = mode
    entry.view.webContents.setUserAgent(mode === 'mobile' ? MOBILE_UA : entry.desktopUA)
    // 重新加载，让站点按新 UA 返回对应布局；加载完成后 did-finish-load 会应用缩放
    entry.view.webContents.reload()
    this.emitState(tabId)
  }

  // ─────────────────────── 导航 ───────────────────────

  /** 导航到指定 URL */
  async navigate(tabId: string, url: string): Promise<void> {
    const entry = this.views.get(tabId)
    if (!entry) return
    if (this.routeBrowserAuth(tabId, entry, url)) return
    entry.pendingUrl = url
    entry.url = url
    await entry.view.webContents.loadURL(url)
  }

  /** 后退 */
  goBack(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    if (entry.view.webContents.canGoBack()) {
      entry.pendingHistoryDirection = 'back'
      entry.view.webContents.goBack()
      return
    }
    if (entry.historyIndex > 0) {
      entry.pendingHistoryDirection = 'back'
      void entry.view.webContents.loadURL(entry.history[entry.historyIndex - 1])
    }
  }

  /** 前进 */
  goForward(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    if (entry.view.webContents.canGoForward()) {
      entry.pendingHistoryDirection = 'forward'
      entry.view.webContents.goForward()
      return
    }
    if (entry.historyIndex < entry.history.length - 1) {
      entry.pendingHistoryDirection = 'forward'
      void entry.view.webContents.loadURL(entry.history[entry.historyIndex + 1])
    }
  }

  /** 刷新 */
  reload(tabId: string): void {
    this.views.get(tabId)?.view.webContents.reload()
  }

  /** 捕获当前网页画面，供原生 View 暂时隐藏时作为无闪烁占位。 */
  async capturePage(tabId: string): Promise<string | null> {
    const entry = this.views.get(tabId)
    if (!entry || entry.view.webContents.isDestroyed()) return null
    const image = await entry.view.webContents.capturePage()
    return image.isEmpty() ? null : image.toDataURL()
  }

  /** 获取当前 URL（优先实时读取，回退到记录值） */
  getCurrentURL(tabId: string): string {
    const entry = this.views.get(tabId)
    if (!entry) return ''
    return entry.view.webContents.getURL() || entry.url
  }

  /** 获取当前页面标题（优先实时读取）。 */
  getTitle(tabId: string): string {
    const entry = this.views.get(tabId)
    if (!entry) return ''
    return entry.view.webContents.getTitle()
  }

  async completeBrowserAuth(message: BrowserAuthCompleteMessage): Promise<void> {
    const entry = this.views.get(message.tabId)
    if (!entry) throw new Error(`登录对应的浏览器 Tab 已关闭: ${message.tabId}`)
    if (entry.profileId !== message.profileId) throw new Error('登录 Profile 与目标 Tab 不一致')

    const cookies = message.cookies.filter((cookie) =>
      isAllowedBrowserAuthCookie(message.profileId, cookie),
    )
    if (!cookies.some((cookie) => cookie.name === 'A2')) {
      throw new Error('登录进程未返回 V2EX 登录 Cookie')
    }

    const targetSession = entry.view.webContents.session
    for (const cookie of cookies) {
      const host = cookie.domain.replace(/^\./, '')
      await targetSession.cookies.set({
        url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        ...(typeof cookie.expirationDate === 'number'
          ? { expirationDate: cookie.expirationDate }
          : {}),
      })
    }
    await targetSession.cookies.flushStore()
    await targetSession.flushStorageData()

    const returnUrl = resolveBrowserAuthReturnUrl(message.profileId, message.returnUrl)
    entry.pendingUrl = returnUrl
    entry.url = returnUrl
    await entry.view.webContents.loadURL(returnUrl)
  }

  /** 查询指定持久化 Profile 的 Cookie 元数据；不需要先创建可见 BrowserView。 */
  async getSessionDiagnostics(
    url: string,
    profileId?: string | null,
  ): Promise<BrowserSessionDiagnosticSummary> {
    const normalizedProfileId = this.normalizeProfileId(profileId)
    const browserSession = normalizedProfileId
      ? session.fromPartition(`persist:cclink-studio-profile-${normalizedProfileId}`)
      : session.defaultSession
    this.observeCookieChanges(browserSession, normalizedProfileId)
    return this.describeSession(browserSession, normalizedProfileId, url)
  }

  /** 返回诊断所需的真实视图、Profile 和 Cookie 元数据，不暴露 Cookie 值。 */
  async getRuntimeDiagnostics(tabId: string): Promise<{
    visibleTabId: string | null
    visibleUrl: string | null
    visibleTitle: string | null
    profileId: string | null
    viewState: BrowserViewState | null
    recentUrls: string[]
    engineVersions: {
      electron: string
      chromium: string
      node: string
    }
    lastClaim: {
      status: 'succeeded' | 'failed'
      timestamp: number
      expectedUrl: string
      errorMessage?: string
    } | null
    session: BrowserSessionDiagnosticSummary | null
  }> {
    const entry = this.views.get(tabId)
    if (!entry) {
      return {
        visibleTabId: this.activeViewId,
        visibleUrl: null,
        visibleTitle: null,
        profileId: null,
        viewState: null,
        recentUrls: [],
        engineVersions: this.getEngineVersions(),
        lastClaim: this.lastClaimByTab.get(tabId) ?? null,
        session: null,
      }
    }

    const visibleUrl = entry.view.webContents.getURL() || entry.url || null
    const browserSession = entry.view.webContents.session
    const sessionDiagnostics = await this.describeSession(
      browserSession,
      entry.profileId,
      visibleUrl,
    )

    return {
      visibleTabId: this.activeViewId,
      visibleUrl,
      visibleTitle: entry.view.webContents.getTitle() || null,
      profileId: entry.profileId,
      viewState: this.getState(tabId),
      recentUrls: entry.history.slice(-10),
      engineVersions: this.getEngineVersions(),
      lastClaim: this.lastClaimByTab.get(tabId) ?? null,
      session: sessionDiagnostics,
    }
  }

  private getEngineVersions(): { electron: string; chromium: string; node: string } {
    return {
      electron: process.versions.electron ?? 'unknown',
      chromium: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
    }
  }

  private async describeSession(
    browserSession: Session,
    profileId: string | null,
    url: string | null,
  ): Promise<BrowserSessionDiagnosticSummary> {
    const partition = profileId ? `persist:cclink-studio-profile-${profileId}` : 'default'
    let cookieStoreFlushed = false

    try {
      await browserSession.cookies.flushStore()
      cookieStoreFlushed = true
    } catch {
      // 诊断继续返回内存中的 Cookie 元数据。
    }

    try {
      const cookies = url ? await browserSession.cookies.get({ url }) : []
      const nowSeconds = Date.now() / 1000
      const metadata = cookies.map((cookie) => this.cookieMetadata(cookie))
      return {
        partition,
        persistent: true,
        cookieStoreFlushed,
        cookieCount: metadata.length,
        persistentCookieCount: metadata.filter((cookie) => !cookie.session).length,
        expiredCookieCount: metadata.filter(
          (cookie) => typeof cookie.expiresAt === 'number' && cookie.expiresAt / 1000 <= nowSeconds,
        ).length,
        likelyAuthCookies: metadata.filter((cookie) => cookie.likelyAuth),
        cookieNames: metadata.map((cookie) => cookie.name).sort(),
        recentCookieChanges: this.getRecentCookieChanges(partition, url),
      }
    } catch (error) {
      return {
        partition,
        persistent: true,
        cookieStoreFlushed,
        cookieCount: 0,
        persistentCookieCount: 0,
        expiredCookieCount: 0,
        likelyAuthCookies: [],
        cookieNames: [],
        recentCookieChanges: this.getRecentCookieChanges(partition, url),
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private observeCookieChanges(browserSession: Session, profileId: string | null): void {
    if (this.observedCookieSessions.has(browserSession)) return
    this.observedCookieSessions.add(browserSession)
    const partition = profileId ? `persist:cclink-studio-profile-${profileId}` : 'default'
    browserSession.cookies.on('changed', (_event, cookie, cause, removed) => {
      this.cookieChanges.push({
        ...this.cookieMetadata(cookie),
        partition,
        timestamp: Date.now(),
        cause,
        removed,
      })
      if (this.cookieChanges.length > 500) {
        this.cookieChanges.splice(0, this.cookieChanges.length - 300)
      }
    })
  }

  private cookieMetadata(cookie: Cookie): BrowserCookieDiagnosticEntry {
    return {
      name: cookie.name,
      domain: cookie.domain ?? '',
      path: cookie.path ?? '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      session: Boolean(cookie.session),
      ...(typeof cookie.expirationDate === 'number'
        ? { expiresAt: Math.round(cookie.expirationDate * 1000) }
        : {}),
      likelyAuth: !NON_AUTH_COOKIE_RE.test(cookie.name) && LIKELY_AUTH_COOKIE_RE.test(cookie.name),
    }
  }

  private getRecentCookieChanges(
    partition: string,
    visibleUrl: string | null,
  ): BrowserCookieChangeDiagnosticEntry[] {
    const host = safeHost(visibleUrl)
    return this.cookieChanges
      .filter((change) => change.partition === partition)
      .filter((change) => !host || cookieDomainMatchesHost(change.domain, host))
      .slice(-50)
      .map(({ partition: _partition, ...change }) => change)
  }

  /** 销毁所有视图并清空窗口引用 */
  destroy(): void {
    for (const tabId of [...this.views.keys()]) {
      this.destroyView(tabId)
    }
    this.activeViewId = null
    this.browserAuthRequestHandler = null
    // 清空 mainWindow 引用，防止后续访问已销毁的窗口
    this.mainWindow = null as unknown as BrowserWindow
  }
}

function safeHost(value: string | null): string {
  if (!value) return ''
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function cookieDomainMatchesHost(domain: string, host: string): boolean {
  const normalizedDomain = domain.replace(/^\./, '').toLowerCase()
  return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`)
}
