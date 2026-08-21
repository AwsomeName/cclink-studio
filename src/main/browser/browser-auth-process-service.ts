import { app, type BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserManager } from './browser-manager'
import {
  CLEAN_BROWSER_CHILD_ARGUMENT,
  encodeCleanBrowserChildOptions,
  isSupportedCleanBrowserUrl,
  type CleanBrowserNavigateMessage,
} from './clean-browser-contract'
import {
  BROWSER_AUTH_CHILD_ARGUMENT,
  encodeBrowserAuthChildOptions,
  isSupportedBrowserAuthRequest,
  type BrowserAuthAcknowledgement,
  type BrowserAuthChildMessage,
  type BrowserAuthRequest,
} from './browser-auth-contract'
import {
  BROWSER_HTTP_AUTH_CHILD_ARGUMENT,
  encodeBrowserHttpAuthChildOptions,
  isBrowserHttpAuthChildMessage,
  type BrowserHttpAuthAcknowledgement,
  type BrowserHttpAuthRequest,
} from '../../shared/ipc/browser-http-auth'

type BrowserHttpAuthCallback = (username?: string, password?: string) => void

interface ActiveHttpAuthChild {
  child: ChildProcess
  callback: BrowserHttpAuthCallback
  request: BrowserHttpAuthRequest
  attempt: number
  userDataPath: string
  timeout: ReturnType<typeof setTimeout>
  settled: boolean
}

interface HttpAuthAttemptState {
  key: string
  attempt: number
  submittedAt: number
  expiryTimer: ReturnType<typeof setTimeout>
}

const HTTP_AUTH_TIMEOUT_MS = 120_000
const HTTP_AUTH_RETRY_WINDOW_MS = 30_000
const HTTP_AUTH_MAX_ATTEMPTS = 3

export class BrowserAuthProcessService {
  private activeChild: ChildProcess | null = null
  private activeChildKind: 'browser-auth' | 'clean-browser' | null = null
  private readonly activeHttpAuthChildren = new Map<string, ActiveHttpAuthChild>()
  private readonly httpAuthAttempts = new Map<string, HttpAuthAttemptState>()

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly browserManager: BrowserManager,
  ) {}

  open(request: BrowserAuthRequest): void {
    if (!isSupportedBrowserAuthRequest(request)) return

    this.stopActiveChild()
    const userDataPath = join(app.getPath('userData'), 'Browser Auth', request.profileId)
    const encodedOptions = encodeBrowserAuthChildOptions({ ...request, userDataPath })
    const childArguments = [`${BROWSER_AUTH_CHILD_ARGUMENT}${encodedOptions}`]
    if (!app.isPackaged) childArguments.unshift(app.getAppPath())

    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(process.execPath, childArguments, {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.activeChild = child
    this.activeChildKind = 'browser-auth'

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) console.log(`[BrowserAuth] ${text}`)
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) console.warn(`[BrowserAuth] ${text}`)
    })
    child.on('message', (message: BrowserAuthChildMessage) => {
      if (message.tabId !== request.tabId || message.profileId !== request.profileId) {
        console.error('[BrowserAuth] 登录进程返回了不匹配的目标')
        return
      }
      void this.handleChildMessage(child, message)
    })
    child.on('exit', () => {
      if (this.activeChild !== child) return
      this.activeChild = null
      this.activeChildKind = null
      if (!this.browserManager.focusTabOwner(request.tabId) && !this.mainWindow.isDestroyed()) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore()
        this.mainWindow.show()
        this.mainWindow.focus()
      }
    })
    child.on('error', (error) => {
      console.error('[BrowserAuth] 登录进程启动失败:', error)
      if (this.activeChild === child) {
        this.activeChild = null
        this.activeChildKind = null
      }
    })
  }

  openExternalUrl(url: string): void {
    if (!isSupportedCleanBrowserUrl(url)) return

    if (
      this.activeChild &&
      this.activeChildKind === 'clean-browser' &&
      this.activeChild.connected
    ) {
      const message: CleanBrowserNavigateMessage = { type: 'clean-browser-navigate', url }
      try {
        this.activeChild.send?.(message)
        return
      } catch {
        this.stopActiveChild()
      }
    }

    this.stopActiveChild()
    const userDataPath = join(app.getPath('userData'), 'Browser Auth', 'terminal')
    const encodedOptions = encodeCleanBrowserChildOptions({ url, userDataPath })
    const childArguments = [`${CLEAN_BROWSER_CHILD_ARGUMENT}${encodedOptions}`]
    if (!app.isPackaged) childArguments.unshift(app.getAppPath())

    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(process.execPath, childArguments, {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.activeChild = child
    this.activeChildKind = 'clean-browser'

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) console.log(`[CleanBrowser] ${text}`)
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) console.warn(`[CleanBrowser] ${text}`)
    })
    child.on('exit', () => {
      if (this.activeChild !== child) return
      this.activeChild = null
      this.activeChildKind = null
      if (!this.mainWindow.isDestroyed()) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore()
        this.mainWindow.show()
        this.mainWindow.focus()
      }
    })
    child.on('error', (error) => {
      console.error('[CleanBrowser] 登录进程启动失败:', error)
      if (this.activeChild === child) {
        this.activeChild = null
        this.activeChildKind = null
      }
    })
  }

  openHttpBasic(request: BrowserHttpAuthRequest, callback: BrowserHttpAuthCallback): void {
    this.stopHttpAuthChild(request.tabId)
    const attempt = this.resolveHttpAuthAttempt(request)
    if (attempt > HTTP_AUTH_MAX_ATTEMPTS) {
      this.browserManager.recordHttpAuthOutcome(
        request,
        'cancelled',
        HTTP_AUTH_MAX_ATTEMPTS,
        'retry-limit',
      )
      callback()
      return
    }

    const userDataPath = mkdtempSync(join(tmpdir(), 'cclink-http-auth-'))
    const encodedOptions = encodeBrowserHttpAuthChildOptions({
      ...request,
      attempt,
      userDataPath,
    })
    const childArguments = [`${BROWSER_HTTP_AUTH_CHILD_ARGUMENT}${encodedOptions}`]
    if (!app.isPackaged) childArguments.unshift(app.getAppPath())

    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    let child: ChildProcess
    try {
      child = spawn(process.execPath, childArguments, {
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      })
    } catch (error) {
      rmSync(userDataPath, { recursive: true, force: true })
      this.browserManager.recordHttpAuthOutcome(request, 'cancelled', attempt, 'spawn-failed')
      callback()
      console.error('[BrowserHttpAuth] 认证窗口启动失败:', error)
      return
    }

    const entry: ActiveHttpAuthChild = {
      child,
      callback,
      request,
      attempt,
      userDataPath,
      timeout: setTimeout(
        () => this.stopHttpAuthChild(request.tabId, 'timed-out'),
        HTTP_AUTH_TIMEOUT_MS,
      ),
      settled: false,
    }
    this.activeHttpAuthChildren.set(request.tabId, entry)
    this.browserManager.recordHttpAuthOutcome(
      request,
      attempt > 1 ? 'rejected' : 'prompted',
      attempt,
      attempt > 1 ? 'previous-credentials-rejected' : undefined,
    )

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) console.log(`[BrowserHttpAuth] ${text}`)
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) console.warn(`[BrowserHttpAuth] ${text}`)
    })
    child.on('message', (message: unknown) => this.handleHttpAuthChildMessage(entry, message))
    child.on('exit', () => {
      if (!entry.settled) this.settleHttpAuthEntry(entry)
      this.releaseHttpAuthEntry(entry)
      this.focusBrowserOwner(request.tabId)
    })
    child.on('error', (error) => {
      if (!entry.settled) {
        this.browserManager.recordHttpAuthOutcome(request, 'cancelled', attempt, 'child-error')
        this.settleHttpAuthEntry(entry)
      }
      this.releaseHttpAuthEntry(entry)
      console.error('[BrowserHttpAuth] 认证窗口运行失败:', error)
    })
  }

  cancelHttpBasicForTab(tabId: string): void {
    this.stopHttpAuthChild(tabId, 'tab-closed')
    this.clearHttpAuthAttempt(tabId)
  }

  destroy(): void {
    this.stopActiveChild()
    for (const tabId of [...this.activeHttpAuthChildren.keys()]) {
      this.stopHttpAuthChild(tabId, 'shutdown')
    }
    for (const tabId of [...this.httpAuthAttempts.keys()]) this.clearHttpAuthAttempt(tabId)
  }

  private async handleChildMessage(
    child: ChildProcess,
    message: BrowserAuthChildMessage,
  ): Promise<void> {
    if (message.type === 'browser-auth-cancelled') {
      if (!this.browserManager.focusTabOwner(message.tabId) && !this.mainWindow.isDestroyed()) {
        this.mainWindow.focus()
      }
      return
    }

    try {
      await this.browserManager.completeBrowserAuth(message)
      if (!this.browserManager.focusTabOwner(message.tabId) && !this.mainWindow.isDestroyed()) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore()
        this.mainWindow.show()
        this.mainWindow.focus()
      }
      const acknowledgement: BrowserAuthAcknowledgement = { type: 'browser-auth-ack' }
      child.send?.(acknowledgement)
    } catch (error) {
      console.error('[BrowserAuth] 登录状态写回失败:', error)
    }
  }

  private stopActiveChild(): void {
    if (!this.activeChild) return
    const child = this.activeChild
    this.activeChild = null
    this.activeChildKind = null
    child.kill('SIGTERM')
  }

  private handleHttpAuthChildMessage(entry: ActiveHttpAuthChild, message: unknown): void {
    if (
      entry.settled ||
      this.activeHttpAuthChildren.get(entry.request.tabId) !== entry ||
      !isBrowserHttpAuthChildMessage(message) ||
      message.requestId !== entry.request.requestId ||
      message.tabId !== entry.request.tabId ||
      message.runtimeGeneration !== entry.request.runtimeGeneration
    ) {
      return
    }

    if (message.type === 'browser-http-auth-cancelled') {
      this.browserManager.recordHttpAuthOutcome(
        entry.request,
        'cancelled',
        entry.attempt,
        'user-cancelled',
      )
      this.settleHttpAuthEntry(entry)
      return
    }

    this.rememberSubmittedAttempt(entry)
    this.browserManager.recordHttpAuthOutcome(entry.request, 'submitted', entry.attempt)
    this.settleHttpAuthEntry(entry, message.username, message.password)
    const acknowledgement: BrowserHttpAuthAcknowledgement = {
      type: 'browser-http-auth-ack',
      requestId: entry.request.requestId,
    }
    entry.child.send?.(acknowledgement)
  }

  private settleHttpAuthEntry(
    entry: ActiveHttpAuthChild,
    username?: string,
    password?: string,
  ): void {
    if (entry.settled) return
    entry.settled = true
    entry.callback(username, password)
  }

  private releaseHttpAuthEntry(entry: ActiveHttpAuthChild): void {
    if (this.activeHttpAuthChildren.get(entry.request.tabId) === entry) {
      this.activeHttpAuthChildren.delete(entry.request.tabId)
    }
    clearTimeout(entry.timeout)
    try {
      rmSync(entry.userDataPath, { recursive: true, force: true })
    } catch (error) {
      console.warn('[BrowserHttpAuth] 临时认证目录清理失败:', error)
    }
  }

  private stopHttpAuthChild(tabId: string, reason = 'superseded'): void {
    const entry = this.activeHttpAuthChildren.get(tabId)
    if (!entry) return
    this.browserManager.recordHttpAuthOutcome(entry.request, 'cancelled', entry.attempt, reason)
    this.settleHttpAuthEntry(entry)
    this.activeHttpAuthChildren.delete(tabId)
    clearTimeout(entry.timeout)
    entry.child.kill('SIGTERM')
  }

  private resolveHttpAuthAttempt(request: BrowserHttpAuthRequest): number {
    const state = this.httpAuthAttempts.get(request.tabId)
    const key = `${request.runtimeGeneration}\u0000${request.origin}\u0000${request.realm}`
    if (!state || state.key !== key || Date.now() - state.submittedAt > HTTP_AUTH_RETRY_WINDOW_MS) {
      this.clearHttpAuthAttempt(request.tabId)
      return 1
    }
    return state.attempt + 1
  }

  private rememberSubmittedAttempt(entry: ActiveHttpAuthChild): void {
    this.clearHttpAuthAttempt(entry.request.tabId)
    const key = `${entry.request.runtimeGeneration}\u0000${entry.request.origin}\u0000${entry.request.realm}`
    const expiryTimer = setTimeout(
      () => this.clearHttpAuthAttempt(entry.request.tabId),
      HTTP_AUTH_RETRY_WINDOW_MS,
    )
    this.httpAuthAttempts.set(entry.request.tabId, {
      key,
      attempt: entry.attempt,
      submittedAt: Date.now(),
      expiryTimer,
    })
  }

  private clearHttpAuthAttempt(tabId: string): void {
    const state = this.httpAuthAttempts.get(tabId)
    if (!state) return
    clearTimeout(state.expiryTimer)
    this.httpAuthAttempts.delete(tabId)
  }

  private focusBrowserOwner(tabId: string): void {
    if (!this.browserManager.focusTabOwner(tabId) && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.show()
      this.mainWindow.focus()
    }
  }
}
