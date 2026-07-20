import { app, type BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
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

export class BrowserAuthProcessService {
  private activeChild: ChildProcess | null = null
  private activeChildKind: 'browser-auth' | 'clean-browser' | null = null

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
      if (!this.mainWindow.isDestroyed()) {
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

  destroy(): void {
    this.stopActiveChild()
  }

  private async handleChildMessage(
    child: ChildProcess,
    message: BrowserAuthChildMessage,
  ): Promise<void> {
    if (message.type === 'browser-auth-cancelled') {
      if (!this.mainWindow.isDestroyed()) this.mainWindow.focus()
      return
    }

    try {
      await this.browserManager.completeBrowserAuth(message)
      if (!this.mainWindow.isDestroyed()) {
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
}
