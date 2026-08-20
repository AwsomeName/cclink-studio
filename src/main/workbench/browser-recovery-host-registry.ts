import { BaseWindow } from 'electron'
import type { BrowserManager } from '../browser/browser-manager'

interface RecoveryEntry {
  tabId: string
  windowId: string
  host: BaseWindow
}

/**
 * Owns one hidden native BaseWindow per recovering Browser View.
 * These hosts never load a renderer and are not Workbench windows or persisted placements.
 */
export class BrowserRecoveryHostRegistry {
  private readonly entries = new Map<string, RecoveryEntry>()

  constructor(
    private readonly browserManager: BrowserManager,
    private readonly createHost: () => BaseWindow = () =>
      new BaseWindow({ show: false, width: 1, height: 1 }),
  ) {}

  recover(tabId: string, sourceWindowId: string, workspaceKey: string | null): string {
    const existing = this.entries.get(tabId)
    if (existing) return existing.windowId

    const windowId = `recovery:${tabId}`
    const host = this.createHost()
    try {
      this.browserManager.registerRecoveryHost(windowId, host, workspaceKey)
      this.browserManager.recoverViewToHost(tabId, sourceWindowId, windowId)
      this.entries.set(tabId, { tabId, windowId, host })
      return windowId
    } catch (error) {
      this.browserManager.unregisterHost(windowId)
      if (!host.isDestroyed()) host.destroy()
      throw error
    }
  }

  restore(tabId: string, targetWindowId: string): void {
    const entry = this.entries.get(tabId)
    if (!entry) throw new Error(`Browser Recovery Host 不存在: ${tabId}`)
    this.browserManager.transferViewToHost(tabId, entry.windowId, targetWindowId)
    this.release(tabId)
  }

  has(tabId: string): boolean {
    return this.entries.has(tabId)
  }

  release(tabId: string): void {
    const entry = this.entries.get(tabId)
    if (!entry) return
    this.entries.delete(tabId)
    this.browserManager.unregisterHost(entry.windowId)
    if (!entry.host.isDestroyed()) entry.host.destroy()
  }

  destroy(): void {
    for (const tabId of [...this.entries.keys()]) this.release(tabId)
  }
}
