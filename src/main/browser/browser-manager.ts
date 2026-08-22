import {
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  session,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type HandlerDetails,
  type Input,
  type WebContents,
  type WindowOpenHandlerResponse,
} from 'electron'
import { randomUUID } from 'node:crypto'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { BrowserInstanceStore } from '../persistence/browser-instance-store'
import {
  browserIpcEvents,
  type BrowserBounds,
  type BrowserPopupDisposition,
  type BrowserSessionDiagnosticSummary,
  type BrowserReconcileViewsOptions,
  type BrowserViewModeType,
  type BrowserViewState,
  type BrowserZoomModeType,
} from '../../shared/ipc/browser'
import { browserProfilePartition, normalizeBrowserProfileId } from '../../shared/browser-profile'
import { assertBrowserUrlAccess, isSupportedBrowserUrl } from './browser-url-access'
import { installBrowserCompatibilityHeaders, normalizeDesktopUserAgent } from './browser-stealth'
import {
  isAllowedBrowserAuthCookie,
  isSupportedBrowserAuthRequest,
  resolveBrowserAuthReturnUrl,
  sanitizeBrowserAuthMainUrl,
  type BrowserAuthCompleteMessage,
  type BrowserAuthRequest,
} from './browser-auth-contract'
import { BrowserSessionDiagnostics } from './browser-session-diagnostics'
import {
  resolveDraftAdoptionProfileId,
  shouldDestroyBrowserViewDuringReconcile,
  shouldRecreateBrowserViewForBinding,
} from './browser-view-reconciliation'
import { normalizeBrowserContext, showBrowserContextMenu } from './browser-context-menu'
import { installPlainTextLinkSupport } from './browser-plain-text-links'
import { installHorizontalPanSupport } from './browser-horizontal-pan'
import {
  clampBrowserBoundsBelowProtectedTop,
  rendererBoundsToWindowDip,
} from './browser-view-bounds'
import { resetVisualPageScale } from './browser-visual-page-scale'
import { keyChordId, normalizeKeyChord, type KeyChord } from '../../shared/keybindings'
import {
  createBrowserHttpAuthRequest,
  resolveBrowserHttpAuthOrigin,
  type BrowserHttpAuthDiagnosticSummary,
  type BrowserHttpAuthOutcome,
  type BrowserHttpAuthRequest,
} from '../../shared/ipc/browser-http-auth'
import type {
  BrowserFindRequest,
  BrowserFindRequestResult,
  BrowserFindShortcutSyncInput,
  BrowserFindShortcutSyncResult,
  BrowserFitWidthDiagnosticSample,
  BrowserFitWidthDiagnosticSummary,
  BrowserRuntimeIdentity,
  BrowserStopFindRequest,
} from '../../shared/ipc/browser'

/** 移动版模拟时的目标视口宽度（CSS px，约等于 iPhone Pro 逻辑宽度） */
const MOBILE_WIDTH = 414
/** 移动版 User-Agent（iOS Safari），让站点返回移动端布局 */
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
/** 缩放范围限制 */
const MIN_ZOOM = 0.3
const MAX_ZOOM = 3
const ZOOM_STEP = 0.1
/** 自动适宽低于 50% 时文字已不可用，改用 100% + 横向滑动兜底。 */
const MIN_TRUSTED_AUTO_FIT_ZOOM = 0.5
const FIT_RETRY_DELAYS_MS = [750, 1_500] as const
const FIT_SAMPLE_DELAYS_MS = [250, 500] as const
/** 与页面 main world 隔离的适宽测量上下文。 */
const FIT_WIDTH_MEASUREMENT_WORLD_ID = 10_139
/**
 * 页面只做单次同步快照；三次采样由主进程调度，避免后台 WebContents 内的
 * requestAnimationFrame / setTimeout 被 Chromium 节流后只返回一次假稳定值。
 */
export const FIT_WIDTH_MEASUREMENT_SCRIPT = String.raw`
(() => ({
  viewportWidth: document.documentElement
    ? document.documentElement.clientWidth
    : (globalThis.visualViewport ? globalThis.visualViewport.width : globalThis.innerWidth),
  rootWidth: document.documentElement ? document.documentElement.scrollWidth : 0,
  bodyWidth: document.body ? document.body.scrollWidth : 0,
}))()
`
/** 默认首页 */
const DEFAULT_URL = 'https://www.baidu.com'
/** renderer 必须在此时间内回应已开始接管，避免无主 WebContents 泄漏。 */
const POPUP_ADOPTION_START_TIMEOUT_MS = 10_000
/** 跨项目切换可能包含持久化、远程请求和运行态对账；已接管 popup 使用独立有界租约。 */
const POPUP_ADOPTION_COMPLETION_TIMEOUT_MS = 5 * 60_000

/** 设备模式：桌面 / 移动 */
export type ViewMode = BrowserViewModeType
/** 缩放模式：适应宽度（自动） / 手动 */
export type ZoomMode = BrowserZoomModeType
export type { BrowserViewState } from '../../shared/ipc/browser'

type FitWidthTrigger = BrowserFitWidthDiagnosticSummary['trigger']

interface FitWidthMeasurement {
  contentWidth: number
  paneWidth: number
  documentGeneration: number
  samples: BrowserFitWidthDiagnosticSample[]
}

function stableFitWidthMeasurement(
  value: unknown,
  paneWidth: number,
  documentGeneration: number,
):
  | { measurement: FitWidthMeasurement; rejectionReason?: never }
  | {
      measurement: null
      rejectionReason: NonNullable<BrowserFitWidthDiagnosticSummary['rejectionReason']>
      samples: BrowserFitWidthDiagnosticSample[]
    } {
  const samples: BrowserFitWidthDiagnosticSample[] =
    typeof value === 'number'
      ? [0, 250, 750].map((offsetMs) => ({
          offsetMs,
          viewportWidth: paneWidth,
          rootWidth: value,
          bodyWidth: value,
        }))
      : Array.isArray(value)
        ? value
            .map((sample) => {
              if (!sample || typeof sample !== 'object') return null
              const candidate = sample as Partial<BrowserFitWidthDiagnosticSample>
              if (
                !Number.isFinite(candidate.offsetMs) ||
                !Number.isFinite(candidate.viewportWidth) ||
                !Number.isFinite(candidate.rootWidth) ||
                !Number.isFinite(candidate.bodyWidth)
              ) {
                return null
              }
              return {
                offsetMs: candidate.offsetMs!,
                viewportWidth: candidate.viewportWidth!,
                rootWidth: candidate.rootWidth!,
                bodyWidth: candidate.bodyWidth!,
              }
            })
            .filter((sample): sample is BrowserFitWidthDiagnosticSample => sample !== null)
        : []

  if (samples.length < 3) {
    return { measurement: null, rejectionReason: 'insufficient-samples', samples }
  }
  const tail = samples.slice(-2)
  const viewportTolerance = Math.max(4, paneWidth * 0.02)
  if (tail.some((sample) => Math.abs(sample.viewportWidth - paneWidth) > viewportTolerance)) {
    return { measurement: null, rejectionReason: 'viewport-mismatch', samples }
  }
  const widths = tail.map((sample) => Math.max(sample.rootWidth, sample.bodyWidth))
  const contentTolerance = Math.max(8, paneWidth * 0.02)
  if (Math.abs(widths[0] - widths[1]) > contentTolerance) {
    return { measurement: null, rejectionReason: 'unstable-content-width', samples }
  }
  return {
    measurement: {
      contentWidth: Math.max(...widths),
      paneWidth,
      documentGeneration,
      samples,
    },
  }
}

/**
 * 单个浏览器视图的运行时状态
 *
 * 每个 Tab 对应一个独立的 WebContentsView，各自维护导航历史、缩放、设备模式。
 * 每个窗口同一时刻只有一个视图 attach（由该 host 的 activeViewId 标记），其余保持 warm。
 */
interface ViewEntry {
  view: WebContentsView
  /** 当前 native host；移动时只改 owner，不重建 View/WebContents。 */
  ownerWindowId: string
  /** 同 tabId 重建时变化，用于拒绝旧 renderer 请求。 */
  runtimeGeneration: number
  activeFind: {
    requestToken: string
    nativeRequestId: number
    query: string
    matches: number
    activeMatchOrdinal: number
    nativeResultReceived: boolean
    fallbackTimer: ReturnType<typeof setTimeout> | null
  } | null
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
  /** 缩放重算代次；用于阻止旧的异步适宽结果覆盖新操作。 */
  zoomRequestGeneration: number
  /** 当前主框架代次内，在 100% 下连续稳定采样后得到的适宽测量。 */
  fitWidthMeasurement: FitWidthMeasurement | null
  /** 当前顶层导航允许响应的 HTTP auth origin；页面稳定后立即清空。 */
  httpAuthNavigationOrigin: string | null
  fitDocumentGeneration: number
  fitRetryCount: number
  fitRetryTimer: ReturnType<typeof setTimeout> | null
  lastFitDiagnostic: BrowserFitWidthDiagnosticSummary | null
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
  /** 最近一次原生网页菜单 token；新菜单或 View 销毁后旧回调不可执行。 */
  contextMenuToken: string | null
  /** 仅 popup View 存在；普通工作台 View 为 null。 */
  popup: {
    adoptionState: 'pending' | 'adopting' | 'adopted'
    disposition: BrowserPopupDisposition
    adoptionTimer: ReturnType<typeof setTimeout> | null
  } | null
}

interface BrowserViewHost {
  windowId: string
  nativeWindow: BaseWindow
  /** Recovery Host intentionally has no renderer or preload. */
  rendererWindow: BrowserWindow | null
  workspaceKey: string | null
  activeViewId: string | null
  currentBounds: BrowserBounds
  currentRendererBounds: BrowserBounds
  protectedTop: number
  nativeProtectedTop: number
}

const MAIN_BROWSER_HOST_ID = 'main'

function browserInputToKeyChord(input: Input): KeyChord | null {
  if (!input.code) return null
  const mac = process.platform === 'darwin'
  const modifiers: KeyChord['modifiers'] = []
  if (mac ? input.meta : input.control) modifiers.push('primary')
  if (mac && input.control) modifiers.push('control')
  if (input.alt) modifiers.push('alt')
  if (input.shift) modifiers.push('shift')
  return normalizeKeyChord({ code: input.code, modifiers })
}

function acceleratorKeyCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  const named: Record<string, string> = {
    Enter: 'Enter',
    BracketLeft: '[',
    BracketRight: ']',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
  }
  return named[code] ?? null
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
  /** windowId → 明确的 native host；不存在“最后一个窗口”隐式回退。 */
  private readonly hosts = new Map<string, BrowserViewHost>()
  /** 新建视图的默认状态（从设置继承） */
  private defaultViewMode: ViewMode = 'desktop'
  private defaultZoomMode: ZoomMode = 'fit'
  /** PlaywrightBridge（晚绑定，CDP 连上后注入）；用于让 Agent 工具按 tabId 寻址到 Page */
  private playwrightBridge: PlaywrightBridge | null = null
  /** view 被销毁时回调（tabId）—— AgentBridge / TaskRuntime 等据此清理状态 */
  private readonly viewDestroyedCallbacks = new Set<(tabId: string) => void>()
  private readonly mainWorkspaceChangedCallbacks = new Set<(workspaceKey: string | null) => void>()
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
  private readonly sessionDiagnostics = new BrowserSessionDiagnostics()
  private browserAuthRequestHandler: ((request: BrowserAuthRequest) => void) | null = null
  private browserHttpAuthRequestHandler:
    | ((
        request: BrowserHttpAuthRequest,
        callback: (username?: string, password?: string) => void,
      ) => void)
    | null = null
  private readonly lastHttpAuthByTab = new Map<string, BrowserHttpAuthDiagnosticSummary>()
  private nextRuntimeGeneration = 1
  private findShortcutConfig: { configVersion: number; bindings: KeyChord[] } = {
    configVersion: 0,
    bindings: [],
  }
  private findShortcutTriggerSequence = 0

  constructor(mainWindow: BrowserWindow, defaults?: { zoomMode?: ZoomMode; viewMode?: ViewMode }) {
    this.registerHost(MAIN_BROWSER_HOST_ID, mainWindow, null)
    if (defaults?.zoomMode) this.defaultZoomMode = defaults.zoomMode
    if (defaults?.viewMode) this.defaultViewMode = defaults.viewMode
  }

  /** Smoke-only native input path; rejected outside an isolated test userData process. */
  dispatchFindShortcutForSmoke(tabId: string): void {
    if (!process.env.CCLINK_STUDIO_TEST_USER_DATA_PATH) {
      throw new Error('Browser 快捷键 smoke 输入只允许隔离测试环境')
    }
    const entry = this.requireActiveView(tabId)
    const binding = this.findShortcutConfig.bindings[0]
    if (!binding) throw new Error('Browser 查找快捷键尚未同步')
    const keyCode = acceleratorKeyCode(binding.code)
    if (!keyCode) return
    const modifiers: NonNullable<Electron.InputEvent['modifiers']> = []
    for (const modifier of binding.modifiers) {
      if (modifier === 'primary') {
        modifiers.push(process.platform === 'darwin' ? 'command' : 'control')
      } else if (modifier === 'control') {
        modifiers.push('control')
      } else {
        modifiers.push(modifier)
      }
    }
    entry.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    entry.view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }

  private requireActiveView(tabId: string): ViewEntry {
    const entry = this.views.get(tabId)
    const host = entry ? this.hosts.get(entry.ownerWindowId) : null
    if (!entry || host?.activeViewId !== tabId || entry.workspaceKey !== host.workspaceKey) {
      throw new Error('Browser smoke 目标已失效')
    }
    return entry
  }

  /** 安全获取主窗口（已销毁则返回 null） */
  private win(): BrowserWindow | null {
    const window = this.hosts.get(MAIN_BROWSER_HOST_ID)?.rendererWindow
    return !window || window.isDestroyed() ? null : window
  }

  private resolveRendererBounds(
    bounds: BrowserBounds,
    windowId = MAIN_BROWSER_HOST_ID,
  ): BrowserBounds {
    const win = this.hosts.get(windowId)?.rendererWindow
    if (!win) return rendererBoundsToWindowDip(bounds, 1)
    try {
      const contentBounds = win.getContentBounds()
      return rendererBoundsToWindowDip(bounds, win.webContents.getZoomFactor(), {
        width: contentBounds.width,
        height: contentBounds.height,
      })
    } catch {
      return rendererBoundsToWindowDip(bounds, 1)
    }
  }

  private resolveRendererY(value: number, windowId = MAIN_BROWSER_HOST_ID): number {
    return this.resolveRendererBounds({ x: 0, y: value, width: 0, height: 0 }, windowId).y
  }

  registerHost(windowId: string, browserWindow: BrowserWindow, workspaceKey: string | null): void {
    const existing = this.hosts.get(windowId)
    if (existing && existing.nativeWindow !== browserWindow) {
      throw new Error(`Browser host 已注册: ${windowId}`)
    }
    this.hosts.set(windowId, {
      windowId,
      nativeWindow: browserWindow,
      rendererWindow: browserWindow,
      workspaceKey,
      activeViewId: existing?.activeViewId ?? null,
      currentBounds: existing?.currentBounds ?? { x: 0, y: 0, width: 0, height: 0 },
      currentRendererBounds: existing?.currentRendererBounds ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      protectedTop: existing?.protectedTop ?? 0,
      nativeProtectedTop: existing?.nativeProtectedTop ?? 0,
    })
  }

  registerRecoveryHost(
    windowId: string,
    nativeWindow: BaseWindow,
    workspaceKey: string | null,
  ): void {
    const existing = this.hosts.get(windowId)
    if (existing && existing.nativeWindow !== nativeWindow) {
      throw new Error(`Browser recovery host 已注册: ${windowId}`)
    }
    this.hosts.set(windowId, {
      windowId,
      nativeWindow,
      rendererWindow: null,
      workspaceKey,
      activeViewId: existing?.activeViewId ?? null,
      currentBounds: existing?.currentBounds ?? { x: 0, y: 0, width: 1, height: 1 },
      currentRendererBounds: existing?.currentRendererBounds ?? {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      protectedTop: existing?.protectedTop ?? 0,
      nativeProtectedTop: existing?.nativeProtectedTop ?? 0,
    })
  }

  unregisterHost(windowId: string): string[] {
    if (windowId === MAIN_BROWSER_HOST_ID && this.hosts.size > 1) {
      // 主窗口重建由 WindowService 协调；这里仍精确移除，绝不把 aux 当 main。
    }
    const host = this.hosts.get(windowId)
    if (!host) return []
    const ownedTabIds = [...this.views]
      .filter(([, entry]) => entry.ownerWindowId === windowId)
      .map(([tabId]) => tabId)
    for (const tabId of ownedTabIds) {
      const entry = this.views.get(tabId)
      if (!entry) continue
      try {
        host.nativeWindow.contentView.removeChildView(entry.view)
      } catch {
        // host 可能已销毁；返回 ownedTabIds 交给 WindowService 进入恢复路径。
      }
    }
    this.hosts.delete(windowId)
    return ownedTabIds
  }

  private hostWindow(windowId: string): BaseWindow | null {
    const window = this.hosts.get(windowId)?.nativeWindow
    return !window || window.isDestroyed() ? null : window
  }

  private hostForEntry(entry: ViewEntry): BrowserViewHost | null {
    const host = this.hosts.get(entry.ownerWindowId)
    return host && !host.nativeWindow.isDestroyed() ? host : null
  }

  private sendToOwner(entry: ViewEntry, channel: string, payload: unknown): void {
    const host = this.hostForEntry(entry)
    const webContents = host?.rendererWindow?.webContents
    if (!webContents || webContents.isDestroyed()) return
    webContents.send(channel, payload)
  }

  sendToTabOwner(tabId: string, channel: string, payload: unknown): boolean {
    const entry = this.views.get(tabId)
    if (!entry) return false
    const host = this.hostForEntry(entry)
    const webContents = host?.rendererWindow?.webContents
    if (!webContents || webContents.isDestroyed()) return false
    webContents.send(channel, payload)
    return true
  }

  focusTabOwner(tabId: string): boolean {
    const entry = this.views.get(tabId)
    const window = entry ? this.hostForEntry(entry)?.rendererWindow : null
    if (!window || window.isDestroyed()) return false
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return true
  }

  /** Existing main-renderer IPC aliases; auxiliary paths always address an explicit host. */
  private get activeViewId(): string | null {
    return this.hosts.get(MAIN_BROWSER_HOST_ID)?.activeViewId ?? null
  }

  private set activeViewId(tabId: string | null) {
    const host = this.hosts.get(MAIN_BROWSER_HOST_ID)
    if (host) host.activeViewId = tabId
  }

  private get currentWorkspaceKey(): string | null {
    return this.hosts.get(MAIN_BROWSER_HOST_ID)?.workspaceKey ?? null
  }

  private set currentWorkspaceKey(workspaceKey: string | null) {
    const host = this.hosts.get(MAIN_BROWSER_HOST_ID)
    if (!host || host.workspaceKey === workspaceKey) return
    host.workspaceKey = workspaceKey
    for (const callback of this.mainWorkspaceChangedCallbacks) callback(workspaceKey)
  }

  onMainWorkspaceChanged(callback: (workspaceKey: string | null) => void): () => void {
    this.mainWorkspaceChangedCallbacks.add(callback)
    callback(this.currentWorkspaceKey)
    return () => this.mainWorkspaceChangedCallbacks.delete(callback)
  }

  private get currentBounds(): BrowserBounds {
    return (
      this.hosts.get(MAIN_BROWSER_HOST_ID)?.currentBounds ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }
    )
  }

  private set currentBounds(bounds: BrowserBounds) {
    const host = this.hosts.get(MAIN_BROWSER_HOST_ID)
    if (host) host.currentBounds = bounds
  }

  private get currentRendererBounds(): BrowserBounds {
    return (
      this.hosts.get(MAIN_BROWSER_HOST_ID)?.currentRendererBounds ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }
    )
  }

  private set currentRendererBounds(bounds: BrowserBounds) {
    const host = this.hosts.get(MAIN_BROWSER_HOST_ID)
    if (host) host.currentRendererBounds = bounds
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

  attachBrowserHttpAuthRequestHandler(
    handler: (
      request: BrowserHttpAuthRequest,
      callback: (username?: string, password?: string) => void,
    ) => void,
  ): void {
    this.browserHttpAuthRequestHandler = handler
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
      if (this.views.get(tabId) !== entry) {
        this.playwrightBridge.unregisterPage(tabId)
        throw new Error(`浏览器 View 已在 claim 期间销毁: ${tabId}`)
      }
      if (this.hostForEntry(entry)?.activeViewId === tabId) {
        await this.playwrightBridge.switchToPage(tabId)
      }
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
  async createView(
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
  ): Promise<void> {
    const requestedProfileId = normalizeBrowserProfileId(opts?.profileId)
    const safeInitialUrl = initialUrl
      ? sanitizeBrowserAuthMainUrl(requestedProfileId, initialUrl)
      : undefined
    let existing = this.views.get(tabId)
    const workspaceKey = opts?.workspaceKey ?? null
    if (safeInitialUrl) await assertBrowserUrlAccess(safeInitialUrl, workspaceKey)
    if (opts?.restore?.history) {
      await Promise.all(
        opts.restore.history.map((url) =>
          assertBrowserUrlAccess(sanitizeBrowserAuthMainUrl(requestedProfileId, url), workspaceKey),
        ),
      )
    }
    if (
      existing &&
      shouldRecreateBrowserViewForBinding({
        currentWorkspaceKey: existing.workspaceKey,
        currentProfileId: existing.profileId,
        requestedWorkspaceKey: workspaceKey,
        requestedProfileId,
      })
    ) {
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
      ? session.fromPartition(browserProfilePartition(profileId))
      : undefined
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        ...(viewSession ? { session: viewSession } : {}),
      },
    })

    installBrowserCompatibilityHeaders(view.webContents.session)
    this.sessionDiagnostics.observe(view.webContents.session, profileId)

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
      ownerWindowId: MAIN_BROWSER_HOST_ID,
      runtimeGeneration: this.nextRuntimeGeneration++,
      activeFind: null,
      boundsReceived: false,
      viewMode: initViewMode,
      zoomMode: opts?.restore?.zoomMode ?? this.defaultZoomMode,
      manualZoom: opts?.restore?.manualZoom ?? 1,
      effectiveZoom: 1,
      zoomRequestGeneration: 0,
      fitWidthMeasurement: null,
      httpAuthNavigationOrigin: null,
      fitDocumentGeneration: 0,
      fitRetryCount: 0,
      fitRetryTimer: null,
      lastFitDiagnostic: null,
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
      contextMenuToken: null,
      popup: null,
    }

    this.installViewListeners(tabId, entry)
    this.views.set(tabId, entry)

    // 若该视图已是活跃视图，立即尝试加载（bounds 已就绪时）
    if (this.activeViewId === tabId) {
      this.ensureLoaded(tabId)
    }
  }

  /** 普通工作台 View 与网页 popup 共用同一套安全、导航和自动化监听。 */
  private installViewListeners(tabId: string, entry: ViewEntry): void {
    const wc = entry.view.webContents
    // Electron 默认关闭 visual zoom；显式开放后触控板 pinch 才能连续缩放网页。
    void wc
      .setVisualZoomLevelLimits(MIN_ZOOM, MAX_ZOOM)
      .catch((error) =>
        console.warn(
          `[BrowserManager] 触控板缩放降级 tabId=${tabId}:`,
          error instanceof Error ? error.message : 'unknown',
        ),
      )
    wc.on('before-input-event', (event, input) => {
      const ownerHost = this.hostForEntry(entry)
      if (
        input.type !== 'keyDown' ||
        input.isAutoRepeat ||
        input.isComposing ||
        this.views.get(tabId) !== entry ||
        ownerHost?.activeViewId !== tabId ||
        ownerHost.workspaceKey !== entry.workspaceKey
      ) {
        return
      }
      const chord = browserInputToKeyChord(input)
      if (
        !chord ||
        !this.findShortcutConfig.bindings.some(
          (binding) => keyChordId(binding) === keyChordId(chord),
        )
      ) {
        return
      }
      event.preventDefault()
      console.log(
        `[BrowserShortcut] 触发 workbench.find config=${this.findShortcutConfig.configVersion} tab=${tabId} generation=${entry.runtimeGeneration}`,
      )
      this.sendToOwner(entry, browserIpcEvents.findShortcutTriggered, {
        commandId: 'workbench.find',
        configVersion: this.findShortcutConfig.configVersion,
        triggerSequence: ++this.findShortcutTriggerSequence,
        tabId,
        workspaceKey: entry.workspaceKey,
        runtimeGeneration: entry.runtimeGeneration,
      })
    })
    wc.on('found-in-page', (_event, result) => {
      if (
        this.views.get(tabId) !== entry ||
        !entry.activeFind ||
        (entry.activeFind.nativeRequestId !== 0 &&
          entry.activeFind.nativeRequestId !== result.requestId)
      ) {
        return
      }
      console.log(
        `[BrowserFind] 结果 tab=${tabId} generation=${entry.runtimeGeneration} matches=${result.matches} active=${result.activeMatchOrdinal}`,
      )
      if (entry.activeFind.fallbackTimer) clearTimeout(entry.activeFind.fallbackTimer)
      entry.activeFind.fallbackTimer = null
      entry.activeFind.nativeResultReceived = true
      entry.activeFind.matches = result.matches
      entry.activeFind.activeMatchOrdinal = result.activeMatchOrdinal
      this.sendToOwner(entry, browserIpcEvents.findResult, {
        tabId,
        workspaceKey: entry.workspaceKey,
        runtimeGeneration: entry.runtimeGeneration,
        requestToken: entry.activeFind.requestToken,
        matches: result.matches,
        activeMatchOrdinal: result.activeMatchOrdinal,
        finalUpdate: result.finalUpdate,
      })
    })
    wc.on('login', (event, details, authInfo, callback) => {
      const request = createBrowserHttpAuthRequest({
        requestId: randomUUID(),
        tabId,
        runtimeGeneration: entry.runtimeGeneration,
        url: details.url,
        scheme: authInfo.scheme,
        isProxy: authInfo.isProxy,
        realm: authInfo.realm,
      })
      if (
        !request ||
        !this.browserHttpAuthRequestHandler ||
        this.views.get(tabId) !== entry ||
        entry.httpAuthNavigationOrigin !== request.origin
      ) {
        return
      }

      event.preventDefault()
      let settled = false
      const complete = (username?: string, password?: string): void => {
        if (settled) return
        settled = true
        const current = this.views.get(tabId)
        if (
          current !== entry ||
          current.runtimeGeneration !== request.runtimeGeneration ||
          current.httpAuthNavigationOrigin !== request.origin
        ) {
          callback()
          return
        }
        callback(username, password)
      }
      try {
        this.browserHttpAuthRequestHandler(request, complete)
      } catch (error) {
        this.recordHttpAuthOutcome(request, 'cancelled', 1, 'handler-failed')
        complete()
        console.error('[BrowserHttpAuth] 认证请求处理失败:', error)
      }
    })
    wc.on('will-navigate', (event, url) => {
      if (this.routeBrowserAuth(tabId, entry, url)) {
        event.preventDefault()
        return
      }
      if (!isSupportedBrowserUrl(url)) {
        event.preventDefault()
        return
      }
      if (new URL(url).protocol === 'file:') {
        event.preventDefault()
        void this.navigate(tabId, url).catch((error) =>
          console.warn(`[BrowserManager] 已拒绝本地文件导航 tabId=${tabId}:`, error),
        )
      }
    })
    wc.on('will-redirect', (event, url) => {
      if (this.routeBrowserAuth(tabId, entry, url) || !isSupportedBrowserUrl(url)) {
        event.preventDefault()
        return
      }
      if (new URL(url).protocol === 'file:') event.preventDefault()
    })
    wc.setWindowOpenHandler((details) => this.handleWindowOpen(tabId, entry, details))
    wc.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return
      entry.httpAuthNavigationOrigin = resolveBrowserHttpAuthOrigin(url)
      this.beginFitNavigation(tabId, entry)
    })
    wc.on('did-navigate', (_event, url) => {
      const completedOrigin = resolveBrowserHttpAuthOrigin(url)
      entry.httpAuthNavigationOrigin = null
      this.markHttpAuthAuthenticated(tabId, entry, completedOrigin)
      this.onNavigate(tabId, url)
    })
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      this.onNavigate(tabId, url)
      if (!isMainFrame) return
      this.beginFitNavigation(tabId, entry)
      void this.applyZoom(tabId, 'did-navigate-in-page')
    })
    wc.on('page-title-updated', (_event, title) => {
      this.emitPageMeta(tabId, { title })
    })
    wc.on('page-favicon-updated', (_event, favicons) => {
      this.emitPageMeta(tabId, { faviconUrl: favicons[0] ?? null })
    })
    wc.on('context-menu', (_event, params) => this.openContextMenu(tabId, entry, params))
    wc.once('destroyed', () => this.handleWebContentsDestroyed(tabId, entry))
    // 每次页面加载完成后，按当前模式重新计算并应用缩放
    wc.on('did-finish-load', () => {
      entry.httpAuthNavigationOrigin = null
      this.clearFitTimers(entry)
      entry.fitWidthMeasurement = null
      entry.fitRetryCount = 0
      void installHorizontalPanSupport(wc).catch((error) =>
        console.warn(
          `[BrowserManager] 横向滑动增强降级 tabId=${tabId}:`,
          error instanceof Error ? error.message : 'unknown',
        ),
      )
      void installPlainTextLinkSupport(wc).catch((error) =>
        console.warn(
          `[BrowserManager] 纯文本 URL 增强降级 tabId=${tabId}:`,
          error instanceof Error ? error.message : 'unknown',
        ),
      )
      void this.applyZoom(tabId, 'did-finish-load')
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
  }

  private handleWindowOpen(
    sourceTabId: string,
    sourceEntry: ViewEntry,
    details: HandlerDetails,
  ): WindowOpenHandlerResponse {
    if (
      this.views.get(sourceTabId) !== sourceEntry ||
      !this.hostForEntry(sourceEntry) ||
      this.routeBrowserAuth(sourceTabId, sourceEntry, details.url) ||
      !isSupportedBrowserUrl(details.url)
    ) {
      return { action: 'deny' }
    }
    if (details.url !== 'about:blank' && new URL(details.url).protocol === 'file:') {
      return { action: 'deny' }
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      },
      createWindow: (options) => this.createPopupView(sourceTabId, sourceEntry, details, options),
    }
  }

  /**
   * 让 Chromium 创建的 popup WebContents 直接进入 BrowserManager，而不是生成 BrowserWindow。
   * createWindow 是同步回调，因此先建立 pending runtime，再通过 IPC 让 renderer 接纳投影。
   */
  private createPopupView(
    sourceTabId: string,
    sourceEntry: ViewEntry,
    details: HandlerDetails,
    options: BrowserWindowConstructorOptions,
  ): WebContents {
    if (this.views.get(sourceTabId) !== sourceEntry || !this.hostForEntry(sourceEntry)) {
      throw new Error('来源浏览器 Tab 已失效，无法创建 popup')
    }

    // Electron 的 createWindow 运行时会为非 background disposition 附带预建 WebContents，
    // 但 BrowserWindowConstructorOptions 类型尚未声明该字段。
    const suppliedWebContents = (
      options as BrowserWindowConstructorOptions & { webContents?: WebContents }
    ).webContents
    const view = suppliedWebContents
      ? new WebContentsView({ webContents: suppliedWebContents })
      : new WebContentsView({
          webPreferences: {
            ...options.webPreferences,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            session: sourceEntry.view.webContents.session,
          },
        })
    const tabId = `browser-popup-${randomUUID()}`
    const popupUrl = details.url || 'about:blank'
    const desktopUA = sourceEntry.desktopUA
    // M1 auxiliary windows are single-tab. A child popup becomes a normal main-host Tab
    // while retaining the source Session/opener relationship and stable Browser runtime.
    const popupOwnerWindowId =
      sourceEntry.ownerWindowId !== MAIN_BROWSER_HOST_ID && this.hostWindow(MAIN_BROWSER_HOST_ID)
        ? MAIN_BROWSER_HOST_ID
        : sourceEntry.ownerWindowId
    if (view.webContents.session !== sourceEntry.view.webContents.session) {
      view.webContents.close()
      throw new Error('popup Session 未继承来源 Profile，已拒绝创建')
    }
    view.webContents.setUserAgent(
      sourceEntry.viewMode === 'mobile' ? MOBILE_UA : normalizeDesktopUserAgent(desktopUA),
    )
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 })

    installBrowserCompatibilityHeaders(view.webContents.session)
    this.sessionDiagnostics.observe(view.webContents.session, sourceEntry.profileId)

    const entry: ViewEntry = {
      view,
      ownerWindowId: popupOwnerWindowId,
      runtimeGeneration: this.nextRuntimeGeneration++,
      activeFind: null,
      // Chromium 已拥有此次 popup 导航；不能由 ensureLoaded 再次 loadURL。
      boundsReceived: true,
      viewMode: sourceEntry.viewMode,
      zoomMode: sourceEntry.zoomMode,
      manualZoom: sourceEntry.manualZoom,
      effectiveZoom: sourceEntry.effectiveZoom,
      zoomRequestGeneration: 0,
      fitWidthMeasurement: null,
      httpAuthNavigationOrigin: null,
      fitDocumentGeneration: 0,
      fitRetryCount: 0,
      fitRetryTimer: null,
      lastFitDiagnostic: null,
      desktopUA,
      fitDebounce: null,
      pendingUrl: popupUrl,
      url: popupUrl,
      history: [popupUrl],
      historyIndex: 0,
      pendingHistoryDirection: null,
      profileId: sourceEntry.profileId,
      workspaceKey: sourceEntry.workspaceKey,
      contextMenuToken: null,
      popup: {
        adoptionState: 'pending',
        disposition: details.disposition,
        adoptionTimer: null,
      },
    }

    this.installViewListeners(tabId, entry)
    this.views.set(tabId, entry)
    if (this.playwrightBridge) {
      void this.claimViewPage(tabId, entry).catch((error) =>
        console.warn(`[BrowserManager] popup 提前 claim 失败 tabId=${tabId}:`, error),
      )
    }

    const popup = entry.popup!
    popup.adoptionTimer = setTimeout(() => {
      const current = this.views.get(tabId)
      if (current !== entry || current.popup?.adoptionState !== 'pending') return
      console.warn(`[BrowserManager] popup 未开始接管，已超时清理 tabId=${tabId}`)
      this.destroyView(tabId)
      this.emitRuntimeTabClosed(tabId, entry.workspaceKey, entry.ownerWindowId)
    }, POPUP_ADOPTION_START_TIMEOUT_MS)

    this.sendToOwner(entry, browserIpcEvents.popupCreated, {
      tabId,
      sourceTabId,
      url: popupUrl,
      workspaceKey: entry.workspaceKey,
      profileId: entry.profileId,
      disposition: details.disposition,
      activate: details.disposition !== 'background-tab',
    })

    // Electron 对 background-tab 可能延迟创建 WebContents；此分支需主动保留请求语义。
    if (!suppliedWebContents && details.disposition === 'background-tab') {
      const contentType = details.postBody
        ? `${details.postBody.contentType}${details.postBody.boundary ? `; boundary=${details.postBody.boundary}` : ''}`
        : null
      void view.webContents
        .loadURL(popupUrl, {
          httpReferrer: details.referrer,
          ...(details.postBody ? { postData: details.postBody.data } : {}),
          ...(contentType ? { extraHeaders: `Content-Type: ${contentType}\n` } : {}),
        })
        .catch((error) =>
          console.warn(`[BrowserManager] background popup 加载失败 tabId=${tabId}:`, error),
        )
    }

    return view.webContents
  }

  private openContextMenu(tabId: string, entry: ViewEntry, params: ContextMenuParams): void {
    const host = this.hostForEntry(entry)
    const win = host?.rendererWindow
    if (!host || !win || this.views.get(tabId) !== entry) return
    const context = normalizeBrowserContext(
      {
        workspaceKey: entry.workspaceKey,
        tabId,
        profileId: entry.profileId,
      },
      entry.view.webContents.getURL() || entry.url || 'about:blank',
      params,
    )
    if (!context) return

    const token = randomUUID()
    entry.contextMenuToken = token
    win.webContents.send(browserIpcEvents.nativeContextMenuOpened, {
      workspaceKey: entry.workspaceKey,
      tabId,
      profileId: entry.profileId,
    })
    const validate = (): boolean => {
      const current = this.views.get(tabId)
      return Boolean(
        current === entry &&
        current.contextMenuToken === token &&
        host.workspaceKey === entry.workspaceKey &&
        host.activeViewId === tabId &&
        current.profileId === context.profileId,
      )
    }
    showBrowserContextMenu(win, {
      context,
      webContents: entry.view.webContents,
      validate,
      requestOpenTab: (request) => {
        if (!validate()) return
        // Workbench Tab 状态只由主 renderer 拥有。Browser View 拆到辅助窗口后，
        // 原生菜单仍在辅助窗口弹出，但“新建 Tab”必须回到主窗口统一创建；
        // 辅助 renderer 没有 Tab Store，也不应成为第二个状态所有者。
        const mainWindow = this.hosts.get(MAIN_BROWSER_HOST_ID)?.rendererWindow
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
        mainWindow.webContents.send(browserIpcEvents.requestOpenTab, request)
        if (entry.ownerWindowId !== MAIN_BROWSER_HOST_ID) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
      },
      requestAgentMount: (request) => {
        if (validate()) win.webContents.send(browserIpcEvents.contextAgentRequest, request)
      },
    })
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
    if (entry)
      this.sendToOwner(entry, browserIpcEvents.urlChanged, {
        tabId,
        url,
        history: entry.history,
        historyIndex: entry.historyIndex,
      })
  }

  private emitPageMeta(tabId: string, meta: { title?: string; faviconUrl?: string | null }): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    this.sendToOwner(entry, browserIpcEvents.pageMetaChanged, { tabId, ...meta })
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
    const hostBounds = this.hostForEntry(entry)?.currentBounds
    const bounds =
      hostBounds && hostBounds.width > 0 && hostBounds.height > 0
        ? hostBounds
        : { x: 0, y: 0, width: 1, height: 1 }
    entry.view.setBounds(bounds)
    void entry.view.webContents.loadURL(entry.pendingUrl)
  }

  /** renderer 已收到 popup 并开始切换项目；将 10 秒首次响应窗切换为有界完成租约。 */
  beginPopupAdoption(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry?.popup) throw new Error('待接纳 popup 不存在')
    if (entry.popup.adoptionState === 'adopted') return
    if (entry.popup.adoptionState === 'adopting') return
    if (entry.popup.adoptionTimer) clearTimeout(entry.popup.adoptionTimer)
    entry.popup.adoptionState = 'adopting'
    entry.popup.adoptionTimer = setTimeout(() => {
      const current = this.views.get(tabId)
      if (current !== entry || current.popup?.adoptionState !== 'adopting') return
      console.warn(`[BrowserManager] popup 接管未完成，已超时清理 tabId=${tabId}`)
      this.destroyView(tabId)
      this.emitRuntimeTabClosed(tabId, entry.workspaceKey, entry.ownerWindowId)
    }, POPUP_ADOPTION_COMPLETION_TIMEOUT_MS)
  }

  /** renderer 已创建同 ID 的工作台 Tab，runtime 进入正常对账生命周期。 */
  acceptPopup(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry?.popup) throw new Error('待接纳 popup 不存在')
    if (entry.popup.adoptionState === 'adopted') return
    if (entry.workspaceKey !== this.hostForEntry(entry)?.workspaceKey) {
      this.destroyView(tabId)
      this.emitRuntimeTabClosed(tabId, entry.workspaceKey, entry.ownerWindowId)
      throw new Error('popup 来源工作空间已切换')
    }
    entry.popup.adoptionState = 'adopted'
    if (entry.popup.adoptionTimer) clearTimeout(entry.popup.adoptionTimer)
    entry.popup.adoptionTimer = null
    // 前台 popup 必须真正出现在用户眼前。尤其来源位于单 Tab 辅助窗口时，popup 会被
    // 投影到主窗口；仅激活 renderer Tab 不会让被遮挡/最小化的主窗口自动置前。
    if (entry.popup.disposition !== 'background-tab' && !this.focusTabOwner(tabId)) {
      console.warn(`[BrowserManager] 前台 popup 已接纳但 owner 窗口无法置前 tabId=${tabId}`)
    }
  }

  /** renderer 无法安全投影该 popup，立即释放 runtime。 */
  rejectPopup(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry?.popup) return
    this.destroyView(tabId)
    this.emitRuntimeTabClosed(tabId, entry.workspaceKey, entry.ownerWindowId)
  }

  private handleWebContentsDestroyed(tabId: string, entry: ViewEntry): void {
    if (!this.removeViewEntry(tabId, entry)) return
    this.emitRuntimeTabClosed(tabId, entry.workspaceKey, entry.ownerWindowId)
  }

  private emitRuntimeTabClosed(
    tabId: string,
    workspaceKey: string | null,
    ownerWindowId = MAIN_BROWSER_HOST_ID,
  ): void {
    const host = this.hosts.get(ownerWindowId)
    const rendererWindow = host?.rendererWindow
    if (
      !host ||
      !rendererWindow ||
      host.nativeWindow.isDestroyed() ||
      rendererWindow.webContents.isDestroyed()
    ) {
      return
    }
    rendererWindow.webContents.send(browserIpcEvents.runtimeTabClosed, { tabId, workspaceKey })
  }

  /** 从 BrowserManager 和所有下游注册表移除 ViewEntry；不负责关闭 WebContents 本身。 */
  private removeViewEntry(tabId: string, entry: ViewEntry): boolean {
    if (this.views.get(tabId) !== entry) return false
    this.clearFitTimers(entry)
    if (entry.activeFind?.fallbackTimer) clearTimeout(entry.activeFind.fallbackTimer)
    if (entry.popup?.adoptionTimer) clearTimeout(entry.popup.adoptionTimer)
    entry.contextMenuToken = null
    if (entry.popup) entry.popup.adoptionTimer = null

    const host = this.hosts.get(entry.ownerWindowId)
    if (host && !host.nativeWindow.isDestroyed()) {
      try {
        host.nativeWindow.contentView.removeChildView(entry.view)
      } catch {
        // 窗口可能已销毁，忽略
      }
    }
    this.views.delete(tabId)
    this.lastHttpAuthByTab.delete(tabId)
    if (host?.activeViewId === tabId) host.activeViewId = null

    this.playwrightBridge?.unregisterPage(tabId)
    for (const cb of this.viewDestroyedCallbacks) cb(tabId)
    return true
  }

  /** 销毁指定视图 */
  destroyView(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    if (!this.removeViewEntry(tabId, entry)) return
    try {
      entry.view.webContents.close()
    } catch {
      // 忽略
    }
  }

  /**
   * 设置当前活跃视图（一次只 attach 一个）
   * @param tabId 目标视图 tabId；null = 全部隐藏
   */
  setActive(tabId: string | null): void {
    this.setActiveForWindow(MAIN_BROWSER_HOST_ID, tabId)
  }

  setActiveForWindow(windowId: string, tabId: string | null): void {
    const host = this.hosts.get(windowId)
    const win = this.hostWindow(windowId)
    if (!host || !win) return

    // activeViewId 可能因旧异步调用或 removeChildView 异常失真。
    // 每次都遍历并 detach 非目标视图，避免原生 View 盖到编辑器/其他项目 Tab 上。
    for (const [viewId, entry] of this.views) {
      if (entry.ownerWindowId !== windowId) continue
      if (viewId !== tabId) {
        try {
          win.contentView.removeChildView(entry.view)
        } catch {
          // 忽略
        }
      }
    }

    if (!tabId) {
      host.activeViewId = null
      return
    }

    const entry = this.views.get(tabId)
    if (!entry) {
      // 视图尚未创建（createView 尚未到达），记下活跃标记，createView 时会处理
      host.activeViewId = tabId
      return
    }
    if (entry.ownerWindowId !== windowId) {
      throw new Error(`Browser View 不属于目标 host: tab=${tabId} window=${windowId}`)
    }

    win.contentView.addChildView(entry.view)
    entry.view.setBounds(host.currentBounds)
    host.activeViewId = tabId
    entry.view.webContents.focus()
    void this.playwrightBridge?.switchToPage(tabId).catch(() => {
      // 页面尚未 claim 时由 did-finish-load 完成绑定和激活。
    })

    // 首次激活时加载页面；之后保持 warm 状态
    this.ensureLoaded(tabId)
    // 重新计算缩放（适配当前面板宽度）
    void this.applyZoom(tabId, 'activation')
    this.emitState(tabId)
  }

  transferViewToHost(
    tabId: string,
    sourceWindowId: string,
    targetWindowId: string,
    options: { activate?: boolean } = {},
  ): void {
    const entry = this.views.get(tabId)
    if (!entry) throw new Error(`Browser View 不存在: ${tabId}`)
    if (entry.ownerWindowId !== sourceWindowId) {
      throw new Error(`Browser View source 不匹配: tab=${tabId} source=${sourceWindowId}`)
    }
    const source = this.hosts.get(sourceWindowId)
    const target = this.hosts.get(targetWindowId)
    const sourceWindow = this.hostWindow(sourceWindowId)
    const targetWindow = this.hostWindow(targetWindowId)
    if (!source || !sourceWindow) throw new Error(`Browser source host 不可用: ${sourceWindowId}`)
    if (!target || !targetWindow) throw new Error(`Browser target host 不可用: ${targetWindowId}`)

    sourceWindow.contentView.removeChildView(entry.view)
    if (source.activeViewId === tabId) source.activeViewId = null
    try {
      const activate = options.activate ?? true
      if (activate) targetWindow.contentView.addChildView(entry.view)
      entry.ownerWindowId = targetWindowId
      if (activate) {
        target.activeViewId = tabId
        entry.view.setBounds(
          target.currentBounds.width > 0 && target.currentBounds.height > 0
            ? target.currentBounds
            : { x: 0, y: 0, width: 1, height: 1 },
        )
        entry.view.webContents.focus()
        void this.playwrightBridge?.switchToPage(tabId).catch(() => undefined)
        this.ensureLoaded(tabId)
        void this.applyZoom(tabId, 'activation')
      }
      this.emitState(tabId)
    } catch (error) {
      try {
        sourceWindow.contentView.addChildView(entry.view)
        entry.ownerWindowId = sourceWindowId
        source.activeViewId = tabId
        entry.view.setBounds(source.currentBounds)
      } catch (rollbackError) {
        throw new Error(
          `Browser View attach 与 source rollback 均失败: attach=${formatError(error)} rollback=${formatError(rollbackError)}`,
        )
      }
      throw error
    }
  }

  /**
   * Emergency attachment used only after the source host is already unavailable.
   * Unlike a normal transfer it cannot roll back to source, so the caller must provide
   * a live Recovery Host before invoking it.
   */
  recoverViewToHost(tabId: string, sourceWindowId: string, recoveryWindowId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) throw new Error(`Browser View 不存在: ${tabId}`)
    if (entry.ownerWindowId !== sourceWindowId) {
      throw new Error(`Browser View recovery source 不匹配: tab=${tabId} source=${sourceWindowId}`)
    }
    const source = this.hosts.get(sourceWindowId)
    const recovery = this.hosts.get(recoveryWindowId)
    const recoveryWindow = this.hostWindow(recoveryWindowId)
    if (!recovery || !recoveryWindow) {
      throw new Error(`Browser Recovery Host 不可用: ${recoveryWindowId}`)
    }
    if (source && !source.nativeWindow.isDestroyed()) {
      try {
        source.nativeWindow.contentView.removeChildView(entry.view)
      } catch {
        // Source is already unreliable; the recovery attachment below is the authority.
      }
    }
    recoveryWindow.contentView.addChildView(entry.view)
    if (source?.activeViewId === tabId) source.activeViewId = null
    entry.ownerWindowId = recoveryWindowId
    recovery.activeViewId = tabId
    entry.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
  }

  getViewOwnerWindowId(tabId: string): string | null {
    return this.views.get(tabId)?.ownerWindowId ?? null
  }

  /** 返回指定窗口实际 attach 的 Browser View；用于校准 renderer 的激活投影。 */
  getActiveViewIdForWindow(windowId: string): string | null {
    return this.hosts.get(windowId)?.activeViewId ?? null
  }

  getHostWorkspaceKey(windowId: string): string | null | undefined {
    return this.hosts.get(windowId)?.workspaceKey
  }

  /** 让 renderer 声明当前工作区允许存在和显示的浏览器视图。 */
  reconcileViews(options: BrowserReconcileViewsOptions): void {
    this.currentWorkspaceKey = options.workspaceKey
    const expectedProfileByTabId = new Map(
      options.views.map(({ tabId, profileId }) => [tabId, normalizeBrowserProfileId(profileId)]),
    )
    for (const [tabId, entry] of [...this.views]) {
      if (entry.ownerWindowId !== MAIN_BROWSER_HOST_ID) continue
      if (entry.popup && entry.popup.adoptionState !== 'adopted') {
        const rendererDeclaredPopup = expectedProfileByTabId.has(tabId)
        const bindingMismatch =
          rendererDeclaredPopup &&
          (entry.workspaceKey !== options.workspaceKey ||
            entry.profileId !== expectedProfileByTabId.get(tabId))
        if (bindingMismatch) {
          this.destroyView(tabId)
          this.emitRuntimeTabClosed(tabId, entry.workspaceKey, entry.ownerWindowId)
        }
        // 接纳 IPC 与 renderer effect 异步竞速期间，pending View 不能按孤儿销毁。
        continue
      }
      if (
        shouldDestroyBrowserViewDuringReconcile({
          tabId,
          viewWorkspaceKey: entry.workspaceKey,
          viewProfileId: entry.profileId,
          activeWorkspaceKey: options.workspaceKey,
          expectedProfileByTabId,
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
  updateBounds(bounds: {
    x: number
    y: number
    width: number
    height: number
    protectedTop?: number
  }): void {
    this.updateBoundsForWindow(MAIN_BROWSER_HOST_ID, bounds, bounds.protectedTop)
  }

  updateBoundsForWindow(
    windowId: string,
    bounds: { x: number; y: number; width: number; height: number },
    protectedTop = bounds.y,
  ): void {
    const host = this.hosts.get(windowId)
    if (!host) return
    const previousBounds = host.currentBounds
    host.currentRendererBounds = bounds
    const nativeProtectedTop = this.resolveRendererY(protectedTop, windowId)
    const nextBounds = clampBrowserBoundsBelowProtectedTop(
      this.resolveRendererBounds(bounds, windowId),
      nativeProtectedTop,
    )
    host.currentBounds = nextBounds
    host.protectedTop = protectedTop
    host.nativeProtectedTop = nativeProtectedTop
    if (!host.activeViewId) return
    const entry = this.views.get(host.activeViewId)
    if (!entry) return

    // 首次收到真实 bounds → 触发加载
    if (!entry.boundsReceived) {
      this.ensureLoaded(host.activeViewId)
      return
    }

    if (
      previousBounds.x === nextBounds.x &&
      previousBounds.y === nextBounds.y &&
      previousBounds.width === nextBounds.width &&
      previousBounds.height === nextBounds.height
    ) {
      return
    }

    // bounds 立即生效，保证 resize 跟手；缩放重算防抖处理
    entry.view.setBounds(nextBounds)
    this.scheduleFit(host.activeViewId, 'bounds')
  }

  private clearFitTimers(entry: ViewEntry): void {
    if (entry.fitDebounce) clearTimeout(entry.fitDebounce)
    if (entry.fitRetryTimer) clearTimeout(entry.fitRetryTimer)
    entry.fitDebounce = null
    entry.fitRetryTimer = null
  }

  /** 新主框架或页内导航立即回到 100%，旧页面测量不得跨文档复用。 */
  private beginFitNavigation(tabId: string, entry: ViewEntry): void {
    if (this.views.get(tabId) !== entry) return
    entry.zoomRequestGeneration += 1
    entry.fitDocumentGeneration += 1
    entry.fitWidthMeasurement = null
    entry.fitRetryCount = 0
    this.clearFitTimers(entry)
    const host = this.hostForEntry(entry)
    if (entry.zoomMode !== 'fit' || host?.activeViewId !== tabId) return
    entry.view.webContents.setZoomFactor(1)
    entry.effectiveZoom = 1
    this.emitState(tabId)
  }

  /** 防抖触发缩放重算（resize 期间高频调用，避免抖动） */
  private scheduleFit(tabId: string, trigger: FitWidthTrigger): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    // bounds 已变化，立即使正在等待 DOM 测量的旧请求失效。
    entry.zoomRequestGeneration += 1
    if (entry.fitDebounce) clearTimeout(entry.fitDebounce)
    entry.fitDebounce = setTimeout(() => {
      entry.fitDebounce = null
      void this.applyZoom(tabId, trigger)
    }, 120)
  }

  private scheduleFitRetry(tabId: string, entry: ViewEntry): void {
    if (
      entry.zoomMode !== 'fit' ||
      entry.fitRetryTimer ||
      entry.fitRetryCount >= FIT_RETRY_DELAYS_MS.length
    ) {
      return
    }
    const delay = FIT_RETRY_DELAYS_MS[entry.fitRetryCount]
    entry.fitRetryCount += 1
    entry.fitRetryTimer = setTimeout(() => {
      entry.fitRetryTimer = null
      void this.applyZoom(tabId, 'stabilization-retry')
    }, delay)
  }

  /**
   * 按当前 viewMode / zoomMode 计算并应用缩放系数
   * @param tabId 目标视图
   */
  private async applyZoom(tabId: string, trigger: FitWidthTrigger): Promise<void> {
    const entry = this.views.get(tabId)
    if (!entry) return
    const host = this.hostForEntry(entry)
    // 仅对活跃视图应用（非活跃视图会在 setActive 时重算）
    if (host?.activeViewId !== tabId) return
    const paneWidth = host.currentBounds.width
    if (paneWidth <= 0) return
    const wc = entry.view.webContents
    const requestGeneration = ++entry.zoomRequestGeneration

    let factor = 1
    let visualScaleBeforeReset: number | null = null
    let actualVisualScale: number | null = null
    let rawFactor: number | null = null
    let contentWidth: number | null = null
    let samples: BrowserFitWidthDiagnosticSample[] = []
    let fitStatus: BrowserFitWidthDiagnosticSummary['status'] = 'manual'
    let rejectionReason: BrowserFitWidthDiagnosticSummary['rejectionReason']
    let nextFitWidthMeasurement: ViewEntry['fitWidthMeasurement'] = null
    let visualScaleResetFailed = false
    try {
      // Chromium 的 visual/pinch zoom 与 Electron page zoom 独立。缩放模式由
      // BrowserManager 统一持有时，先清掉残留 visual scale，避免 toolbar 显示
      // 100% 但页面实际仍停在 30%，也避免该状态随 WebContentsView 迁移。
      const visualReset = await resetVisualPageScale(wc.debugger)
      visualScaleBeforeReset = visualReset.before
      actualVisualScale = visualReset.after
    } catch (error) {
      visualScaleResetFailed = true
      console.warn(
        `[BrowserManager] visual scale 复位失败 tabId=${tabId}:`,
        error instanceof Error ? error.message : 'unknown',
      )
    }
    try {
      if (visualScaleResetFailed && entry.zoomMode === 'fit') {
        fitStatus = 'rejected'
        rejectionReason = 'visual-scale-reset-failed'
        factor = 1
      } else if (entry.viewMode === 'mobile') {
        // 移动版：把约 414px 的移动视口放大填满面板
        factor = paneWidth / MOBILE_WIDTH
      } else if (entry.zoomMode === 'fit') {
        let measurement =
          entry.fitWidthMeasurement?.documentGeneration === entry.fitDocumentGeneration
            ? entry.fitWidthMeasurement
            : null
        const measuredOverflow = measurement && measurement.contentWidth > measurement.paneWidth
        // 当前文档的稳定固定宽内容可直接复用；响应式页面在面板变窄时重新测量。
        const needsUnitMeasurement =
          !measurement || (!measuredOverflow && paneWidth < measurement.paneWidth)
        if (needsUnitMeasurement) {
          // 测量期间明确保持 100%，不让旧页面的错误 factor 继续显示。
          wc.setZoomFactor(1)
          entry.effectiveZoom = 1
          this.emitState(tabId)
          const resolved = stableFitWidthMeasurement(
            await this.measureContentWidth(tabId),
            paneWidth,
            entry.fitDocumentGeneration,
          )
          if (!resolved.measurement) {
            samples = resolved.samples
            rejectionReason = resolved.rejectionReason
            measurement = null
          } else {
            measurement = resolved.measurement
            samples = measurement.samples
            nextFitWidthMeasurement = measurement
          }
        }
        if (measurement) {
          contentWidth = measurement.contentWidth
          samples = measurement.samples
          rawFactor = contentWidth > paneWidth ? paneWidth / contentWidth : 1
          if (rawFactor < MIN_TRUSTED_AUTO_FIT_ZOOM) {
            rejectionReason = 'auto-fit-too-small'
            nextFitWidthMeasurement = null
            factor = 1
            fitStatus = 'rejected'
          } else {
            factor = rawFactor
            fitStatus = nextFitWidthMeasurement ? 'accepted' : 'cached'
          }
        } else {
          factor = 1
          fitStatus = 'rejected'
        }
      } else {
        // 手动缩放
        factor = entry.manualZoom
      }
    } catch {
      factor = entry.zoomMode === 'manual' ? entry.manualZoom : 1
      if (entry.zoomMode === 'fit') {
        fitStatus = 'rejected'
        rejectionReason = 'measurement-failed'
      }
    }

    const currentEntry = this.views.get(tabId)
    const currentHost = currentEntry ? this.hostForEntry(currentEntry) : null
    if (
      currentEntry !== entry ||
      entry.zoomRequestGeneration !== requestGeneration ||
      currentHost?.activeViewId !== tabId
    ) {
      return
    }

    factor = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor))
    let viewBounds = host.currentBounds
    try {
      viewBounds = entry.view.getBounds()
    } catch {
      // 测试替身或已销毁 View 使用当前 host bounds 作为诊断降级。
    }
    if (entry.zoomMode === 'fit') {
      entry.lastFitDiagnostic = {
        trigger,
        status: fitStatus,
        timestamp: Date.now(),
        documentGeneration: entry.fitDocumentGeneration,
        paneWidth,
        viewBounds,
        contentWidth,
        rawFactor,
        appliedFactor: factor,
        actualZoomFactor: factor,
        visualScaleBeforeReset,
        actualVisualScale,
        ...(rejectionReason ? { rejectionReason } : {}),
        samples,
      }
      if (fitStatus === 'accepted' && nextFitWidthMeasurement) {
        if (entry.fitRetryTimer) clearTimeout(entry.fitRetryTimer)
        entry.fitRetryTimer = null
        entry.fitWidthMeasurement = nextFitWidthMeasurement
        entry.fitRetryCount = 0
      } else if (fitStatus === 'rejected') {
        entry.fitWidthMeasurement = null
        this.scheduleFitRetry(tabId, entry)
      }
    } else {
      entry.lastFitDiagnostic = {
        trigger,
        status: 'manual',
        timestamp: Date.now(),
        documentGeneration: entry.fitDocumentGeneration,
        paneWidth,
        viewBounds,
        contentWidth: null,
        rawFactor: null,
        appliedFactor: factor,
        actualZoomFactor: factor,
        visualScaleBeforeReset,
        actualVisualScale,
        samples: [],
      }
    }
    wc.setZoomFactor(factor)
    if (entry.lastFitDiagnostic) entry.lastFitDiagnostic.actualZoomFactor = wc.getZoomFactor()
    entry.effectiveZoom = factor
    this.emitState(tabId)
  }

  /** 由主进程调度三次页面快照，不依赖可能被节流的页面定时器。 */
  private async measureContentWidth(tabId: string): Promise<unknown> {
    const entry = this.views.get(tabId)
    if (!entry) return []
    const capture = (): Promise<unknown> =>
      entry.view.webContents.executeJavaScriptInIsolatedWorld(FIT_WIDTH_MEASUREMENT_WORLD_ID, [
        { code: FIT_WIDTH_MEASUREMENT_SCRIPT },
      ])
    const first = await capture()
    // 保留数字/数组形式，便于兼容旧运行时与稳定的单元测试替身。
    if (typeof first === 'number' || Array.isArray(first)) return first

    const startedAt = Date.now()
    const samples: unknown[] = [{ ...(first as object), offsetMs: 0 }]
    for (const delay of FIT_SAMPLE_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      const sample = await capture()
      samples.push({ ...(sample as object), offsetMs: Date.now() - startedAt })
    }
    return samples
  }

  /** 把指定视图的状态同步给渲染进程 */
  private emitState(tabId: string): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    this.sendToOwner(entry, browserIpcEvents.viewStateChanged, {
      tabId,
      ...this.getState(tabId),
    })
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

  syncFindShortcut(input: BrowserFindShortcutSyncInput): BrowserFindShortcutSyncResult {
    if (input.configVersion >= this.findShortcutConfig.configVersion) {
      this.findShortcutConfig = {
        configVersion: input.configVersion,
        bindings: input.bindings.map(normalizeKeyChord),
      }
      console.log(
        `[BrowserShortcut] 已同步 workbench.find config=${input.configVersion} bindings=${input.bindings.length}`,
      )
    }
    return { appliedConfigVersion: this.findShortcutConfig.configVersion }
  }

  getRuntimeIdentity(tabId: string): BrowserRuntimeIdentity | null {
    const entry = this.views.get(tabId)
    const ownerHost = entry ? this.hostForEntry(entry) : null
    console.log(
      `[BrowserFind] 查询 runtime tab=${tabId} found=${Boolean(entry)} active=${ownerHost?.activeViewId === tabId}`,
    )
    if (!entry) return null
    return {
      tabId,
      workspaceKey: entry.workspaceKey,
      runtimeGeneration: entry.runtimeGeneration,
    }
  }

  findInPage(input: BrowserFindRequest): BrowserFindRequestResult {
    const entry = this.requireCurrentFindTarget(input)
    const previousFind = entry.activeFind
    if (previousFind?.fallbackTimer) clearTimeout(previousFind.fallbackTimer)
    let activeMatchOrdinal = 1
    if (input.findNext && previousFind?.query === input.query && previousFind.matches > 0) {
      activeMatchOrdinal = input.forward
        ? (previousFind.activeMatchOrdinal % previousFind.matches) + 1
        : ((previousFind.activeMatchOrdinal + previousFind.matches - 2) % previousFind.matches) + 1
    }
    // Electron may emit the first found-in-page update before findInPage returns its
    // native requestId, so publish the client correlation token first.
    entry.activeFind = {
      requestToken: input.requestToken,
      nativeRequestId: 0,
      query: input.query,
      matches: previousFind?.query === input.query ? previousFind.matches : 0,
      activeMatchOrdinal,
      nativeResultReceived: false,
      fallbackTimer: null,
    }
    const nativeRequestId = entry.view.webContents.findInPage(input.query, {
      forward: input.forward,
      findNext: input.findNext,
    })
    console.log(
      `[BrowserFind] 已发起 tab=${input.tabId} generation=${input.runtimeGeneration} request=${nativeRequestId}`,
    )
    if (entry.activeFind?.requestToken === input.requestToken) {
      entry.activeFind.nativeRequestId = nativeRequestId
      if (!entry.activeFind.nativeResultReceived) {
        entry.activeFind.fallbackTimer = setTimeout(
          () => void this.emitFindFallback(input.tabId, entry, input.requestToken),
          300,
        )
      }
    }
    return { accepted: true, runtimeGeneration: entry.runtimeGeneration }
  }

  stopFindInPage(input: BrowserStopFindRequest): void {
    const entry = this.requireCurrentFindTarget(input)
    if (entry.activeFind?.fallbackTimer) clearTimeout(entry.activeFind.fallbackTimer)
    entry.activeFind = null
    entry.view.webContents.stopFindInPage(input.action)
  }

  private async emitFindFallback(
    tabId: string,
    entry: ViewEntry,
    requestToken: string,
  ): Promise<void> {
    const activeFind = entry.activeFind
    if (
      this.views.get(tabId) !== entry ||
      !activeFind ||
      activeFind.requestToken !== requestToken
    ) {
      return
    }
    activeFind.fallbackTimer = null
    try {
      const matches = await entry.view.webContents.executeJavaScript(
        `(function(q){var root=document.body;if(!root||!q)return 0;var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){var p=n.parentElement;return !p||/^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}});var total=0;var needle=q.toLocaleLowerCase();var n;while((n=w.nextNode())){var text=(n.nodeValue||'').toLocaleLowerCase();var i=0;while((i=text.indexOf(needle,i))>=0){total++;i+=Math.max(needle.length,1);}}return total;})(${JSON.stringify(activeFind.query)})`,
      )
      if (
        this.views.get(tabId) !== entry ||
        entry.activeFind !== activeFind ||
        activeFind.requestToken !== requestToken
      ) {
        return
      }
      activeFind.matches = typeof matches === 'number' ? Math.max(0, Math.trunc(matches)) : 0
      activeFind.activeMatchOrdinal =
        activeFind.matches > 0
          ? Math.min(Math.max(activeFind.activeMatchOrdinal, 1), activeFind.matches)
          : 0
      console.warn(
        `[BrowserFind] 原生结果超时，使用计数降级 tab=${tabId} matches=${activeFind.matches}`,
      )
      this.sendToOwner(entry, browserIpcEvents.findResult, {
        tabId,
        workspaceKey: entry.workspaceKey,
        runtimeGeneration: entry.runtimeGeneration,
        requestToken,
        matches: activeFind.matches,
        activeMatchOrdinal: activeFind.activeMatchOrdinal,
        finalUpdate: true,
      })
    } catch (error) {
      console.warn(`[BrowserFind] 计数降级失败 tab=${tabId}:`, error)
    }
  }

  private requireCurrentFindTarget(input: BrowserRuntimeIdentity): ViewEntry {
    const entry = this.views.get(input.tabId)
    const host = entry ? this.hostForEntry(entry) : null
    if (
      !entry ||
      entry.runtimeGeneration !== input.runtimeGeneration ||
      entry.workspaceKey !== input.workspaceKey ||
      host?.workspaceKey !== input.workspaceKey ||
      host.activeViewId !== input.tabId
    ) {
      throw new Error('浏览器查找目标已失效')
    }
    return entry
  }

  /** 返回指定项目当前可见的浏览器；绝不回退到其他项目的活跃视图。 */
  getActiveViewIdForWorkspace(workspaceKey: string | null): string | null {
    for (const host of this.hosts.values()) {
      if (!host.activeViewId || host.workspaceKey !== workspaceKey) continue
      const entry = this.views.get(host.activeViewId)
      if (entry?.workspaceKey === workspaceKey && entry.ownerWindowId === host.windowId) {
        return host.activeViewId
      }
    }
    return null
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
    return [...this.hosts.values()].some((host) => host.workspaceKey === workspaceKey)
  }

  /** 查询 Tab 的真实项目归属；undefined 表示视图不存在。 */
  getViewWorkspaceKey(tabId: string): string | null | undefined {
    return this.views.get(tabId)?.workspaceKey
  }

  /** 查询 Tab 的真实 Profile 归属；undefined 表示视图不存在。 */
  getViewProfileId(tabId: string): string | null | undefined {
    return this.views.get(tabId)?.profileId
  }

  /** 等待 renderer 完成浏览器 Tab -> WebContentsView 的异步创建与激活。 */
  async waitForActiveView(timeoutMs = 2500): Promise<string | null> {
    const deadline = Date.now() + timeoutMs
    let lastRequestAt = 0
    while (!this.activeViewId && Date.now() < deadline) {
      if (Date.now() - lastRequestAt >= 500) {
        this.win()?.webContents.send(browserIpcEvents.requestOpenTab, {
          initialUrl: DEFAULT_URL,
          workspaceKey: this.currentWorkspaceKey,
        })
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
    const mainHost = this.hosts.get(MAIN_BROWSER_HOST_ID)
    if (!tabId && mainHost?.workspaceKey !== workspaceKey) return null
    while (!tabId && Date.now() < deadline) {
      if (mainHost?.workspaceKey === workspaceKey && Date.now() - lastRequestAt >= 500) {
        this.win()?.webContents.send(browserIpcEvents.requestOpenTab, {
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

  /** 等待 renderer 把指定账号 Tab 绑定到精确的项目和隔离 Profile。 */
  async waitForViewBinding(
    tabId: string,
    workspaceKey: string | null,
    profileId: string | null,
    timeoutMs = 8_000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const view = this.views.get(tabId)
      if (view?.workspaceKey === workspaceKey && view.profileId === profileId) return true
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return false
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

    const ownerHost = this.hostForEntry(entry)
    if (ownerHost?.activeViewId !== tabId && entry.ownerWindowId === MAIN_BROWSER_HOST_ID) {
      this.setActive(tabId)
    }
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
    this.clearFitTimers(entry)
    entry.zoomRequestGeneration += 1
    entry.zoomMode = 'manual'
    entry.manualZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor))
    // toolbar 状态立即响应；applyZoom 再将同一个 factor 下发给 WebContents。
    entry.effectiveZoom = entry.manualZoom
    this.emitState(tabId)
    void this.applyZoom(tabId, 'manual-fit')
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
    this.clearFitTimers(entry)
    entry.fitWidthMeasurement = null
    entry.fitRetryCount = 0
    entry.zoomMode = 'fit'
    void this.applyZoom(tabId, 'manual-fit')
  }

  // ─────────────────────── 设备模式 ───────────────────────

  /** 设置设备模式（桌面 / 移动）；切换 UA 并重新加载以获取对应布局 */
  setDeviceMode(tabId: string, mode: ViewMode): void {
    const entry = this.views.get(tabId)
    if (!entry) return
    if (mode === entry.viewMode) return
    entry.zoomRequestGeneration += 1
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
    await assertBrowserUrlAccess(url, entry.workspaceKey)
    entry.pendingUrl = url
    entry.url = url
    try {
      await entry.view.webContents.loadURL(url)
    } catch (error) {
      // Chromium 会在重定向、页面自行替换导航或更新的用户导航抢占当前请求时，
      // 以 ERR_ABORTED 拒绝旧 loadURL Promise。它表示旧请求被取消，不等于最终页面加载失败；
      // did-navigate/did-fail-load 仍负责发布真实页面结果，辅助窗口不应显示原始 IPC 红条。
      if (isNavigationAborted(error)) {
        // loadURL 的 rejection 可能早于 did-navigate/URL 状态发布一个事件循环；只在真实
        // WebContents 已到达目标时把它认作“旧 Promise 被替代”。仍停在旧页的 abort 必须上抛，
        // 否则会把真正没有发生的导航伪装成成功。
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (sameNavigationDestination(entry.view.webContents.getURL(), url)) return
      }
      throw error
    }
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
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const entry = this.views.get(tabId)
      if (!entry || entry.view.webContents.isDestroyed()) return null
      try {
        const image = await entry.view.webContents.capturePage()
        return image.isEmpty() ? null : image.toDataURL()
      } catch (error) {
        if (attempt === 3) {
          console.warn(`[BrowserManager] 网页占位截图失败 tabId=${tabId}:`, error)
          return null
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
      }
    }
    return null
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

  recordHttpAuthOutcome(
    request: BrowserHttpAuthRequest,
    outcome: BrowserHttpAuthOutcome,
    attempt: number,
    reason?: string,
  ): void {
    const entry = this.views.get(request.tabId)
    if (!entry || entry.runtimeGeneration !== request.runtimeGeneration) return
    this.lastHttpAuthByTab.set(request.tabId, {
      timestamp: Date.now(),
      tabId: request.tabId,
      runtimeGeneration: request.runtimeGeneration,
      origin: request.origin,
      realm: request.realm,
      transport: request.transport,
      attempt: Math.max(1, Math.min(3, Math.trunc(attempt))),
      outcome,
      ...(reason ? { reason: sanitizeHttpAuthDiagnosticText(reason) } : {}),
    })
  }

  private markHttpAuthAuthenticated(
    tabId: string,
    entry: ViewEntry,
    completedOrigin: string | null,
  ): void {
    const diagnostic = this.lastHttpAuthByTab.get(tabId)
    if (
      !diagnostic ||
      diagnostic.outcome !== 'submitted' ||
      diagnostic.runtimeGeneration !== entry.runtimeGeneration ||
      diagnostic.origin !== completedOrigin
    ) {
      return
    }
    this.lastHttpAuthByTab.set(tabId, {
      ...diagnostic,
      timestamp: Date.now(),
      outcome: 'authenticated',
      reason: undefined,
    })
  }

  /** 查询指定持久化 Profile 的 Cookie 元数据；不需要先创建可见 BrowserView。 */
  async getSessionDiagnostics(
    url: string,
    profileId?: string | null,
  ): Promise<BrowserSessionDiagnosticSummary> {
    const normalizedProfileId = normalizeBrowserProfileId(profileId)
    const browserSession = normalizedProfileId
      ? session.fromPartition(browserProfilePartition(normalizedProfileId))
      : session.defaultSession
    this.sessionDiagnostics.observe(browserSession, normalizedProfileId)
    return this.sessionDiagnostics.describe(browserSession, normalizedProfileId, url)
  }

  /** Clear all persisted login/session data owned by one isolated website-account profile. */
  async clearProfileData(profileId: string): Promise<void> {
    const normalizedProfileId = normalizeBrowserProfileId(profileId)
    if (!normalizedProfileId) throw new Error('不能清理默认浏览器环境')
    for (const [tabId, entry] of this.views) {
      if (entry.profileId === normalizedProfileId) this.destroyView(tabId)
    }
    const browserSession = session.fromPartition(browserProfilePartition(normalizedProfileId))
    await browserSession.clearStorageData()
    await browserSession.clearCache()
    await browserSession.cookies.flushStore()
    await browserSession.flushStorageData()
  }

  /**
   * 只有当前 Tab 独占的持久 Profile 才能直接转为可清理的网站账号草稿。
   * popup/新 Tab 可能继承来源 Profile；共享环境不能交给单个草稿拥有，否则关闭草稿会
   * 连带清除其他 Tab 的登录状态。
   */
  getDraftAdoptionProfileId(
    tabId: string,
    expectedWorkspaceKey: string | null,
  ): string | null | undefined {
    const target = this.views.get(tabId)
    if (!target || target.workspaceKey !== expectedWorkspaceKey) return undefined
    return resolveDraftAdoptionProfileId(
      tabId,
      [...this.views].map(([viewTabId, entry]) => ({
        tabId: viewTabId,
        profileId: entry.profileId,
      })),
    )
  }

  /** 返回诊断所需的真实视图、Profile 和 Cookie 元数据，不暴露 Cookie 值。 */
  async getRuntimeDiagnostics(tabId: string): Promise<{
    visibleTabId: string | null
    visibleUrl: string | null
    visibleTitle: string | null
    profileId: string | null
    viewState: BrowserViewState | null
    popup: {
      adoptionState: 'pending' | 'adopting' | 'adopted'
      disposition: BrowserPopupDisposition
    } | null
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
    fitWidth: BrowserFitWidthDiagnosticSummary | null
    httpAuth: BrowserHttpAuthDiagnosticSummary | null
    layout: {
      rendererBounds: BrowserBounds
      nativeBounds: BrowserBounds
      protectedTop: number
      nativeProtectedTop: number
      overlapsProtectedTop: boolean
    } | null
    session: BrowserSessionDiagnosticSummary | null
  }> {
    const entry = this.views.get(tabId)
    const visibleTabId = entry
      ? (this.hosts.get(entry.ownerWindowId)?.activeViewId ?? null)
      : this.activeViewId
    if (!entry) {
      return {
        visibleTabId,
        visibleUrl: null,
        visibleTitle: null,
        profileId: null,
        viewState: null,
        popup: null,
        recentUrls: [],
        engineVersions: this.getEngineVersions(),
        lastClaim: this.lastClaimByTab.get(tabId) ?? null,
        fitWidth: null,
        httpAuth: this.lastHttpAuthByTab.get(tabId) ?? null,
        layout: null,
        session: null,
      }
    }

    const visibleUrl = entry.view.webContents.getURL() || entry.url || null
    const browserSession = entry.view.webContents.session
    const host = this.hosts.get(entry.ownerWindowId)
    const sessionDiagnostics = await this.sessionDiagnostics.describe(
      browserSession,
      entry.profileId,
      visibleUrl,
    )

    return {
      visibleTabId,
      visibleUrl,
      visibleTitle: entry.view.webContents.getTitle() || null,
      profileId: entry.profileId,
      viewState: this.getState(tabId),
      popup: entry.popup
        ? {
            adoptionState: entry.popup.adoptionState,
            disposition: entry.popup.disposition,
          }
        : null,
      recentUrls: entry.history.slice(-10),
      engineVersions: this.getEngineVersions(),
      lastClaim: this.lastClaimByTab.get(tabId) ?? null,
      fitWidth: entry.lastFitDiagnostic,
      httpAuth: this.lastHttpAuthByTab.get(tabId) ?? null,
      layout: host
        ? {
            rendererBounds: host.currentRendererBounds,
            nativeBounds: host.currentBounds,
            protectedTop: host.protectedTop,
            nativeProtectedTop: host.nativeProtectedTop,
            overlapsProtectedTop: host.currentBounds.y < host.nativeProtectedTop,
          }
        : null,
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

  /** 销毁所有视图并清空窗口引用 */
  destroy(): void {
    for (const tabId of [...this.views.keys()]) {
      this.destroyView(tabId)
    }
    this.activeViewId = null
    this.browserAuthRequestHandler = null
    this.browserHttpAuthRequestHandler = null
    this.lastHttpAuthByTab.clear()
    this.mainWorkspaceChangedCallbacks.clear()
    this.hosts.clear()
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNavigationAborted(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; errno?: unknown }
  return candidate.code === 'ERR_ABORTED' || candidate.errno === -3
}

function sameNavigationDestination(currentUrl: string, requestedUrl: string): boolean {
  try {
    const current = new URL(currentUrl)
    const requested = new URL(requestedUrl)
    current.hash = ''
    requested.hash = ''
    return current.href === requested.href
  } catch {
    return currentUrl === requestedUrl
  }
}

function sanitizeHttpAuthDiagnosticText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128)
}
