import { BrowserWindow, WebContentsView, session } from 'electron'
import { randomUUID } from 'node:crypto'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { BrowserInstanceStore } from '../persistence/browser-instance-store'
import type { BrowserViewModeType, BrowserViewState, BrowserZoomModeType } from '../../shared/ipc/browser'
import { installBrowserCompatibilityHeaders, normalizeDesktopUserAgent } from './browser-stealth'

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
  /** DeepInk 维护的导航栈（用于重启恢复和原生栈不可用时兜底） */
  history: string[]
  historyIndex: number
  pendingHistoryDirection: 'back' | 'forward' | null
  /** 项目运营平台 Profile；为空时使用默认 session。 */
  profileId: string | null
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
  /** 实例快照存储（晚绑定，关闭 Tab 时序列化以便重启重建） */
  private instanceStore: BrowserInstanceStore | null = null

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
    // 为启动种子视图补登记（'browser' 种子已在 connect() 时用字面量 key 登记，
    // 这里幂等：claimPageForView 内部会跳过已绑定的 key）
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

  /** 绑定实例快照存储（关闭 Tab 时序列化） */
  attachInstanceStore(store: BrowserInstanceStore): void {
    this.instanceStore = store
  }

  /**
   * 把某 view 的 webContents claim 为 Playwright Page，绑定到 tabId。
   * 期望在页面加载完成后调用（URL 匹配更稳）。失败抛错由调用方处理。
   */
  private async claimViewPage(tabId: string, entry: ViewEntry): Promise<void> {
    if (!this.playwrightBridge) return
    const url = entry.view.webContents.getURL() || entry.pendingUrl
    await this.playwrightBridge.claimPageForView(tabId, entry.view.webContents, url)
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
      restore?: { viewMode: ViewMode; zoomMode: ZoomMode; manualZoom: number; history?: string[]; historyIndex?: number }
      profileId?: string | null
    },
  ): void {
    const existing = this.views.get(tabId)
    if (existing) {
      if (opts?.restore) {
        existing.viewMode = opts.restore.viewMode
        existing.zoomMode = opts.restore.zoomMode
        existing.manualZoom = opts.restore.manualZoom
        if (opts.restore.history?.length) {
          existing.history = opts.restore.history
          existing.historyIndex = typeof opts.restore.historyIndex === 'number'
            ? Math.min(Math.max(opts.restore.historyIndex, 0), opts.restore.history.length - 1)
            : opts.restore.history.length - 1
        }
        existing.view.webContents.setUserAgent(existing.viewMode === 'mobile' ? MOBILE_UA : existing.desktopUA)
      }
      if (initialUrl && existing.url === DEFAULT_URL) {
        existing.pendingUrl = initialUrl
        existing.url = initialUrl
        if (existing.boundsReceived) {
          void existing.view.webContents.loadURL(initialUrl)
        }
      }
      return
    }
    if (!this.win()) return

    const profileId = this.normalizeProfileId(opts?.profileId)
    const viewSession = profileId
      ? session.fromPartition(`persist:deepink-profile-${profileId}`)
      : undefined
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        ...(viewSession ? { session: viewSession } : {}),
      },
    })

    installBrowserCompatibilityHeaders(view.webContents.session)

    // 去掉 Electron/deepink 标识，让 UA 看起来像真实 Chrome
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
      pendingUrl: initialUrl ?? DEFAULT_URL,
      url: initialUrl ?? DEFAULT_URL,
      history: opts?.restore?.history?.length ? opts.restore.history : [initialUrl ?? DEFAULT_URL],
      historyIndex: typeof opts?.restore?.historyIndex === 'number'
        ? Math.min(Math.max(opts.restore.historyIndex, 0), Math.max((opts.restore.history?.length ?? 1) - 1, 0))
        : 0,
      pendingHistoryDirection: null,
      profileId,
    }

    // 监听导航事件（闭包捕获 tabId，发出的事件携带 tabId）
    const wc = view.webContents
    wc.on('did-navigate', (_event, url) => this.onNavigate(tabId, url))
    wc.on('did-navigate-in-page', (_event, url) => this.onNavigate(tabId, url))
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
    if (win) win.webContents.send('browser:urlChanged', {
      tabId,
      url,
      history: entry?.history ?? [url],
      historyIndex: entry?.historyIndex ?? 0,
    })
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
    const bounds = this.currentBounds.width > 0 && this.currentBounds.height > 0
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

    // 序列化快照（URL + 视图模式 + 缩放），供重启「恢复上次会话」重建。
    // 登录态由默认 session 持久化，不在此处；仅记录「回到哪个页面 + 视图模式」。
    // 注意：须在 webContents.close() 之前读，否则可能拿不到；上面已用 entry.url（onNavigate 维护），
    // 这里不再碰 webContents。
    if (this.instanceStore) {
      const url = entry.url
      // 忽略空/默认页面（about:blank、首页）——不值得恢复
      if (url && url !== 'about:blank' && url !== DEFAULT_URL) {
        void this.instanceStore.record({
          id: randomUUID(),
          url,
          title: null,
          viewMode: entry.viewMode,
          zoomMode: entry.zoomMode,
          manualZoom: entry.manualZoom,
          history: entry.history,
          historyIndex: entry.historyIndex,
          closedAt: Date.now(),
        })
      }
    }
  }

  /**
   * 设置当前活跃视图（一次只 attach 一个）
   * @param tabId 目标视图 tabId；null = 全部隐藏
   */
  setActive(tabId: string | null): void {
    const win = this.win()
    if (!win) return

    // detach 当前活跃视图（保持 warm，不销毁）
    if (this.activeViewId && this.activeViewId !== tabId) {
      const prev = this.views.get(this.activeViewId)
      if (prev) {
        try {
          win.contentView.removeChildView(prev.view)
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

    // 首次激活时加载页面；之后保持 warm 状态
    this.ensureLoaded(tabId)
    // 重新计算缩放（适配当前面板宽度）
    void this.applyZoom(tabId, false)
    this.emitState(tabId)
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

  /** 获取当前 URL（优先实时读取，回退到记录值） */
  getCurrentURL(tabId: string): string {
    const entry = this.views.get(tabId)
    if (!entry) return ''
    return entry.view.webContents.getURL() || entry.url
  }

  /** 销毁所有视图并清空窗口引用 */
  destroy(): void {
    for (const tabId of [...this.views.keys()]) {
      this.destroyView(tabId)
    }
    this.activeViewId = null
    // 清空 mainWindow 引用，防止后续访问已销毁的窗口
    this.mainWindow = null as unknown as BrowserWindow
  }
}
