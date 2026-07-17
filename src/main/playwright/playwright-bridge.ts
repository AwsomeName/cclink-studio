import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Download,
} from 'playwright-core'
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { BrowserDownloadStore } from '../browser/browser-download-store'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import type { BrowserPageDiagnosticSummary } from '../../shared/ipc/browser'

/**
 * 控制台日志条目
 */
export interface ConsoleLogEntry {
  type: 'log' | 'warn' | 'error' | 'info'
  text: string
  timestamp: number
}

/**
 * 网络请求日志条目
 */
export interface NetworkLogEntry {
  requestId: string
  method: string
  url: string
  status?: number
  resourceType?: string
  timestamp: number
  failed?: boolean
  errorText?: string
}

interface ScopedConsoleLogEntry extends ConsoleLogEntry {
  page: Page
}

interface ScopedNetworkLogEntry extends NetworkLogEntry {
  page: Page
}

/**
 * 路由拦截处理器
 */
export interface RouteHandler {
  action: 'block' | 'modify' | 'continue' | 'mock'
  statusCode?: number
  headers?: Record<string, string>
  body?: string
  contentType?: string
}

/**
 * Playwright CDP 桥接
 *
 * 连接到 Electron 内嵌的 Chromium 实例，提供完整的浏览器自动化能力。
 * 支持多 Tab 管理、网络拦截、控制台日志、对话框处理等。
 */
export class PlaywrightBridge {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  /** 多 Tab 注册表：tabId → Page */
  private pages: Map<string, Page> = new Map()
  /** 当前活跃 Tab ID */
  private activeTabId: string | null = null

  /** 控制台日志缓冲 */
  private consoleLogs: ScopedConsoleLogEntry[] = []
  /** 网络请求日志缓冲 */
  private networkLog: ScopedNetworkLogEntry[] = []
  /** 路由拦截处理器：URL pattern → RouteHandler */
  private routeHandlers: Map<string, RouteHandler> = new Map()
  /** 自动对话框处理模式 */
  private dialogAutoAction: 'accept' | 'dismiss' | null = 'accept'
  /** 对话框自动输入文本（prompt 场景） */
  private dialogAutoText: string | null = null
  /** 待处理下载：downloadId → Download */
  private downloads: Map<string, Download> = new Map()
  /** Download 对象 → downloadId，避免 page.on('download') 与 waitForDownload 生成重复记录 */
  private downloadIds = new WeakMap<Download, string>()
  /** 已安装监听器的页面，避免 claim/register 重复绑定 */
  private listenedPages = new WeakSet<Page>()

  constructor(
    private readonly browserDownloadStore?: BrowserDownloadStore | null,
    private readonly browserTaskRuntime?: BrowserTaskRuntime | null,
  ) {}

  /**
   * 通过 CDP 连接到内嵌的 Chromium
   */
  async connect(cdpPort: number): Promise<void> {
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {
      headers: { Connection: 'keep-alive' },
    })

    const contexts = this.browser.contexts()
    if (contexts.length > 0) {
      this.context = contexts[0]
      const pages = this.context.pages()

      console.log(`[CCLink Studio] 发现 ${pages.length} 个页面:`)
      for (const p of pages) {
        console.log(`  - ${p.url()}`)
      }
    }

    // 监听 context 上的新页面事件（弹窗、window.open 等）
    if (this.context) {
      this.context.on('page', async (newPage) => {
        for (const existing of this.pages.values()) {
          if (existing === newPage) {
            console.log(`[CCLink Studio] 新页面已在注册表，跳过自动注册: url=${newPage.url()}`)
            return
          }
        }

        const opener = await newPage.opener().catch(() => null)
        if (!opener || !Array.from(this.pages.values()).includes(opener)) {
          console.log(
            `[CCLink Studio] 未绑定 CDP 页面，等待 BrowserManager claim: url=${newPage.url()}`,
          )
          return
        }

        const tabId = this.registerPage(newPage)
        console.log(`[CCLink Studio] 新页面自动注册: tabId=${tabId}, url=${newPage.url()}`)
      })
    }
  }

  /**
   * 为页面设置事件监听器（控制台、网络、对话框、下载）
   */
  private setupPageListeners(page: Page): void {
    if (this.listenedPages.has(page)) return
    this.listenedPages.add(page)

    // 控制台日志
    page.on('console', (msg) => {
      this.consoleLogs.push({
        page,
        type: msg.type() as ConsoleLogEntry['type'],
        text: msg.text(),
        timestamp: Date.now(),
      })
      // 限制缓冲区大小
      if (this.consoleLogs.length > 1000) {
        this.consoleLogs = this.consoleLogs.slice(-500)
      }
    })

    // 页面错误
    page.on('pageerror', (err) => {
      this.consoleLogs.push({
        page,
        type: 'error',
        text: err.message,
        timestamp: Date.now(),
      })
    })

    // 网络请求
    page.on('request', (req) => {
      this.networkLog.push({
        page,
        requestId: req.url() + '::' + Date.now(),
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        timestamp: Date.now(),
      })
      // 限制缓冲区大小
      if (this.networkLog.length > 500) {
        this.networkLog = this.networkLog.slice(-250)
      }
    })

    page.on('requestfailed', (req) => {
      this.networkLog.push({
        page,
        requestId: req.url() + '::failed::' + Date.now(),
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        timestamp: Date.now(),
        failed: true,
        errorText: req.failure()?.errorText,
      })
      if (this.networkLog.length > 500) {
        this.networkLog = this.networkLog.slice(-250)
      }
    })

    // 网络响应
    page.on('response', (res) => {
      const url = res.url()
      const status = res.status()
      // 更新最近的匹配条目
      for (let i = this.networkLog.length - 1; i >= 0; i--) {
        if (
          this.networkLog[i].page === page &&
          this.networkLog[i].url === url &&
          !this.networkLog[i].status
        ) {
          this.networkLog[i].status = status
          break
        }
      }
    })

    // 对话框自动处理
    page.on('dialog', async (dialog) => {
      if (this.dialogAutoAction) {
        console.log(
          `[CCLink Studio] 自动处理对话框: type=${dialog.type()}, message=${dialog.message()}`,
        )
        if (this.dialogAutoAction === 'accept') {
          await dialog.accept(this.dialogAutoText ?? undefined)
        } else {
          await dialog.dismiss()
        }
      }
    })

    // 下载事件
    page.on('download', (download) => {
      void this.captureDownload(page, download)
    })
  }

  private async captureDownload(page: Page, download: Download): Promise<string> {
    const downloadId = this.registerDownload(download)
    const tabId = this.getTabIdForPage(page) ?? this.activeTabId ?? 'unbound'
    const task = this.browserTaskRuntime?.getActiveTaskForTab(tabId)

    console.log(
      `[CCLink Studio] 下载已捕获: id=${downloadId}, filename=${download.suggestedFilename()}`,
    )

    if (!this.browserDownloadStore) {
      return downloadId
    }

    try {
      const { targetPath } = await this.browserDownloadStore.startDownload({
        id: downloadId,
        trigger: task ? 'agent' : 'user',
        taskRunId: task?.id,
        tabId,
        workspaceKey: null,
        sourceUrl: download.url(),
        suggestedFilename: download.suggestedFilename(),
      })
      if (task) {
        this.browserTaskRuntime?.addDownload(task.id, downloadId)
      }
      await download.saveAs(targetPath)
      this.browserDownloadStore.completeDownload(downloadId, targetPath)
    } catch (error) {
      this.browserDownloadStore.failDownload(downloadId, error)
    }

    return downloadId
  }

  // ── 基础访问方法（向后兼容） ──────────────────

  /**
   * 获取当前自动化页面（向后兼容）
   */
  getPage(): Page | null {
    return this.getActivePage()
  }

  /**
   * 获取当前活跃页面
   */
  getActivePage(): Page | null {
    if (this.activeTabId) {
      return this.pages.get(this.activeTabId) ?? this.page
    }
    return this.page
  }

  /**
   * 获取 Browser 实例
   */
  getBrowser(): Browser | null {
    return this.browser
  }

  /**
   * 获取 BrowserContext（用于 Cookie、新建 Tab 等操作）
   */
  getContext(): BrowserContext | null {
    return this.context
  }

  // ── 多 Tab 管理 ──────────────────────────────

  /**
   * 注册新页面到 Tab 注册表
   *
   * @param page Playwright Page
   * @param key 可选的注册表 key（如渲染层 tabId）。省略则生成 randomUUID。
   *            用 tabId 作 key 让 Agent 作用域选择器能按用户可见的 Tab 定位到 Page。
   * @returns 实际使用的 tabId（= key 或生成的 randomUUID）
   */
  registerPage(page: Page, key?: string): string {
    const tabId = key ?? randomUUID()
    for (const [existingTabId, existingPage] of this.pages) {
      if (existingPage === page && existingTabId !== tabId) this.pages.delete(existingTabId)
    }
    this.pages.set(tabId, page)

    // 设置事件监听
    this.setupPageListeners(page)

    // 页面关闭时清理
    page.on('close', () => {
      this.pages.delete(tabId)
      if (this.activeTabId === tabId) {
        const remaining = Array.from(this.pages.keys())
        this.activeTabId = remaining.length > 0 ? remaining[0] : null
      }
    })

    return tabId
  }

  /**
   * 为一个 WebContentsView 认领（claim）对应的 Playwright Page，绑定到给定 tabId。
   *
   * WebContentsView 的页面会作为 CDP target 出现在默认 context 中。本方法从
   * `context.pages()` 找到与该 webContents 匹配的 Page：
   *   1. 首选按 targetId 匹配（最稳，1:1）；
   *   2. 兜底按 URL 匹配（首次加载完成后）；
   *   3. 仍找不到则轮询 context.pages()（页面可能延迟出现）。
   *
   * 命中后用 tabId 注册（覆盖该 key 下的旧 Page），保证 BrowserManager tabId 与
   * Playwright 注册表 key 严格对齐。绝不静默绑错页——找不到时抛错由调用方处理。
   *
   * @param tabId 渲染层 tabId（与 BrowserManager.views 的 key 一致）
   * @param webContents 该 view 的 webContents
   * @param expectedUrl 该 view 预期加载的 URL（URL 兜底匹配 + 轮询用）
   */
  async claimPageForView(
    tabId: string,
    webContents: WebContents,
    expectedUrl?: string,
  ): Promise<Page> {
    const context = this.context
    if (!context) throw new Error('Playwright context 未就绪，无法 claim page')

    // 已绑定过同 key 的 Page：直接返回（幂等，避免重复监听）
    const existing = this.pages.get(tabId)
    if (existing && !existing.isClosed()) {
      return existing
    }

    const matchPage = (): Page | null => {
      const pages = context.pages()
      // 1. 按 targetId 匹配（webContents 有 devtools targetId）
      const targetId = this.webContentsTargetId(webContents)
      if (targetId) {
        const byTarget = pages.find((p) => this.pageTargetId(p) === targetId)
        if (byTarget) return byTarget
      }
      // 2. 按 URL 兜底匹配（排除 about:blank / 空页面）
      if (expectedUrl) {
        const norm = expectedUrl.replace(/\/$/, '')
        const byUrl = pages.find((p) => {
          const u = p.url().replace(/\/$/, '')
          return u && u !== 'about:blank' && u === norm
        })
        if (byUrl) return byUrl
      }
      return null
    }

    // 立即尝试
    let page = matchPage()

    // 轮询兜底（页面可能延迟出现在 context.pages()）
    if (!page) {
      const maxTries = 10
      const intervalMs = 100
      for (let i = 0; i < maxTries; i++) {
        await new Promise((r) => setTimeout(r, intervalMs))
        page = matchPage()
        if (page) break
      }
    }

    if (!page) {
      throw new Error(
        `claimPageForView 找不到匹配的 Playwright Page（tabId=${tabId}, url=${expectedUrl ?? 'n/a'}）` +
          `。当前 context.pages()=${context.pages().length} 个`,
      )
    }

    // 用 tabId 注册（覆盖旧 key），监听 + 关闭清理由 registerPage 负责
    this.registerPage(page, tabId)
    console.log(
      `[CCLink Studio] view 已 claim 为 Playwright Page: tabId=${tabId}, url=${page.url()}`,
    )
    return page
  }

  /** 从 webContents 取 devtools targetId（用于精确匹配 Playwright Page） */
  private webContentsTargetId(webContents: WebContents): string | null {
    try {
      // Electron devtools targetId（undocumented 但稳定），用于和 Playwright 的 CDP targetId 对齐
      const id = (webContents as unknown as { _targetId?: string })._targetId
      return id ?? null
    } catch {
      return null
    }
  }

  /** 从 Playwright Page 取底层 CDP targetId */
  private pageTargetId(page: Page): string | null {
    try {
      // Playwright Page 暴露的 target 信息（不同版本字段位置略不同，尽力取）
      const unparsed = page as unknown as { _guid?: string; _target?: { _targetId?: string } }
      return unparsed._target?._targetId ?? unparsed._guid ?? null
    } catch {
      return null
    }
  }

  /**
   * 移除页面注册
   */
  unregisterPage(tabId: string): void {
    this.pages.delete(tabId)
    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.pages.keys())
      this.activeTabId = remaining.length > 0 ? remaining[0] : null
    }
  }

  /**
   * 切换活跃 Tab
   */
  async switchToPage(tabId: string): Promise<void> {
    const page = this.pages.get(tabId)
    if (!page) throw new Error(`Tab 不存在: ${tabId}`)
    this.activeTabId = tabId
    this.page = page
    await page.bringToFront()
  }

  /**
   * 列出所有 Tab
   */
  async listPages(): Promise<Array<{ tabId: string; url: string; title: string }>> {
    const result: Array<{ tabId: string; url: string; title: string }> = []
    for (const [tabId, page] of this.pages) {
      try {
        result.push({
          tabId,
          url: page.url(),
          title: await page.title(),
        })
      } catch {
        result.push({ tabId, url: page.url(), title: '' })
      }
    }
    return result
  }

  /**
   * 按 ID 获取特定页面
   */
  getPageById(tabId: string): Page | null {
    return this.pages.get(tabId) ?? null
  }

  private getTabIdForPage(page: Page): string | null {
    for (const [tabId, candidate] of this.pages) {
      if (candidate === page) return tabId
    }
    return null
  }

  /**
   * 获取当前活跃 Tab ID
   */
  getActiveTabId(): string | null {
    return this.activeTabId
  }

  // ── 对话框管理 ──────────────────────────────

  /**
   * 设置自动对话框处理模式
   */
  setDialogAutoAction(action: 'accept' | 'dismiss' | null, text?: string): void {
    this.dialogAutoAction = action
    this.dialogAutoText = text ?? null
  }

  /**
   * 获取当前对话框自动处理模式
   */
  getDialogAutoAction(): string | null {
    return this.dialogAutoAction
  }

  // ── 控制台日志 ──────────────────────────────

  /**
   * 获取缓冲的控制台日志
   */
  getConsoleLogs(): ConsoleLogEntry[] {
    return this.consoleLogs.map(({ page: _page, ...entry }) => entry)
  }

  /**
   * 清空控制台日志缓冲
   */
  clearConsoleLogs(): void {
    this.consoleLogs = []
  }

  // ── 网络日志 ──────────────────────────────

  /**
   * 获取缓冲的网络日志
   */
  getNetworkLog(): NetworkLogEntry[] {
    return this.networkLog.map(({ page: _page, ...entry }) => entry)
  }

  async getPageBindingDiagnostics(tabId: string): Promise<{
    playwrightTabId: string | null
    playwrightUrl: string | null
    playwrightTitle: string | null
  }> {
    const page = this.pages.get(tabId)
    if (!page || page.isClosed()) {
      return {
        playwrightTabId: this.activeTabId,
        playwrightUrl: null,
        playwrightTitle: null,
      }
    }
    return {
      playwrightTabId: this.getTabIdForPage(page) ?? this.activeTabId,
      playwrightUrl: page.url(),
      playwrightTitle: await page.title().catch(() => ''),
    }
  }

  async getPageDiagnostics(tabId?: string | null): Promise<BrowserPageDiagnosticSummary | null> {
    const page = tabId ? this.pages.get(tabId) : this.getActivePage()
    if (!page || page.isClosed()) return null

    const url = page.url()
    const title = await page.title().catch(() => '')
    const host = safeHost(url)
    const recentConsole = this.consoleLogs
      .filter((entry) => entry.page === page)
      .filter((entry) => entry.type === 'error' || entry.type === 'warn')
      .slice(-20)
      .map((entry) => ({
        type: entry.type,
        text: truncate(entry.text, 500),
        timestamp: entry.timestamp,
      }))
    const recentNetwork = this.networkLog
      .filter((entry) => entry.page === page)
      .filter((entry) => {
        const statusIssue =
          typeof entry.status === 'number' && (entry.status >= 400 || entry.status === 0)
        return Boolean(entry.failed || statusIssue)
      })
      .filter((entry) => !host || safeHost(entry.url) === host)
      .slice(-20)
      .map((entry) => ({
        method: entry.method,
        url: stripUrlQuery(entry.url),
        status: entry.status,
        resourceType: entry.resourceType,
        timestamp: entry.timestamp,
        failed: entry.failed,
        errorText: entry.errorText,
      }))

    const textSample = await page
      .evaluate(() => document.body?.innerText?.slice(0, 3000) ?? '')
      .catch(() => '')
    return {
      tabId: this.getTabIdForPage(page) ?? tabId ?? this.activeTabId ?? 'unbound',
      url,
      title,
      consoleErrors: recentConsole,
      networkIssues: recentNetwork,
      suspectedChallenges: detectPageChallenges(`${title}\n${url}\n${textSample}`),
      pageTextSample: truncate(textSample.replace(/\s+/g, ' ').trim(), 600),
    }
  }

  /**
   * 清空网络日志缓冲
   */
  clearNetworkLog(): void {
    this.networkLog = []
  }

  // ── 路由拦截管理 ──────────────────────────────

  /**
   * 设置路由拦截处理器
   */
  setRouteHandler(pattern: string, handler: RouteHandler): void {
    this.routeHandlers.set(pattern, handler)
  }

  /**
   * 获取路由拦截处理器
   */
  getRouteHandler(pattern: string): RouteHandler | undefined {
    return this.routeHandlers.get(pattern)
  }

  /**
   * 移除路由拦截处理器
   */
  removeRouteHandler(pattern: string): void {
    this.routeHandlers.delete(pattern)
  }

  /**
   * 获取所有路由拦截处理器的 pattern 列表
   */
  getRoutePatterns(): string[] {
    return Array.from(this.routeHandlers.keys())
  }

  /**
   * 清空所有路由拦截处理器
   */
  clearRouteHandlers(): Map<string, RouteHandler> {
    const old = new Map(this.routeHandlers)
    this.routeHandlers.clear()
    return old
  }

  // ── 下载管理 ──────────────────────────────

  /**
   * 存储下载引用
   */
  registerDownload(download: Download, preferredId?: string): string {
    const existing = this.downloadIds.get(download)
    if (existing) return existing
    const downloadId = preferredId || randomUUID()
    this.downloadIds.set(download, downloadId)
    this.downloads.set(downloadId, download)
    return downloadId
  }

  storeDownload(downloadId: string, download: Download): string {
    return this.registerDownload(download, downloadId)
  }

  /**
   * 获取下载引用
   */
  getDownload(downloadId: string): Download | undefined {
    return this.downloads.get(downloadId)
  }

  markDownloadSavedAs(downloadId: string, path: string): void {
    this.browserDownloadStore?.markDownloadSavedAs(downloadId, path)
  }

  // ── 生命周期 ──────────────────────────────

  /**
   * 断开连接（不关闭 Electron 的 Chromium）
   */
  async disconnect(): Promise<void> {
    // 清空所有状态
    this.pages.clear()
    this.consoleLogs = []
    this.networkLog = []
    this.routeHandlers.clear()
    this.downloads.clear()
    this.activeTabId = null
    this.dialogAutoAction = null
    this.dialogAutoText = null

    // 注意：不能调用 browser.close()，那会关闭 Electron 本身
    this.browser = null
    this.context = null
    this.page = null
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function stripUrlQuery(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split('?')[0] ?? url
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3)}...`
}

function detectPageChallenges(text: string): string[] {
  const normalized = text.toLowerCase()
  const signals: Array<[string, RegExp]> = [
    [
      'auth_required',
      /\/(?:login|signin)\b|登录页|账号登录|密码登录|手机号登录|请输入(?:账号|密码|手机号|验证码)|sign\s*in|log\s*in|扫码登录/iu,
    ],
    [
      'captcha_or_bot_check',
      /验证码|安全验证|人机验证|滑块|captcha|verify you are human|robot|bot check/iu,
    ],
    ['qr_login', /二维码|扫码登录|微信扫码|scan qr/iu],
    [
      'rate_limited_or_blocked',
      /访问受限|操作频繁|请求过于频繁|429|too many requests|forbidden|403|风控/iu,
    ],
  ]
  return signals.flatMap(([label, pattern]) => (pattern.test(normalized) ? [label] : []))
}
