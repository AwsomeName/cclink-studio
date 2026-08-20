import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import {
  workbenchWindowIpc,
  workbenchWindowIpcEvents,
  type WorkbenchAuxiliaryBrowserCommandInput,
  type WorkbenchAuxiliaryBoundsInput,
  type WorkbenchAuxiliaryReadyInput,
  type WorkbenchBrowserTabProjection,
  type WorkbenchMoveTabInput,
  type WorkbenchPlacementChanged,
  type WorkbenchReturnTabInput,
  type WorkbenchWindowBootstrap,
  type WorkbenchWindowCommandResult,
  type WorkbenchWindowProjection,
} from '../../shared/ipc/workbench-window'
import type { IpcInvokeContract } from '../../shared/ipc/contract'
import type { BrowserManager } from '../browser/browser-manager'
import type {
  TrustedRendererIdentity,
  TrustedRendererRegistry,
} from '../ipc/trusted-renderer-guard'
import type { WorkbenchTabModel } from './workbench-tab-model'
import {
  WorkbenchWindowService,
  WorkbenchWindowTransitionError,
  type TabPlacement,
  type TabTransfer,
} from './workbench-window-service'
import type { AuxiliaryBrowserWindowHandle } from './auxiliary-browser-window'
import { BrowserRecoveryHostRegistry } from './browser-recovery-host-registry'

interface AuxiliaryEntry {
  windowId: string
  handle: AuxiliaryBrowserWindowHandle
  windowGeneration: number
  tabProjection: WorkbenchBrowserTabProjection
  ready: Promise<void>
  resolveReady: () => void
  rejectReady: (error: Error) => void
  disposeTrust: () => void
  closingForDispose: boolean
}

interface ControllerOptions {
  mainWindow: BrowserWindow
  browserManager: BrowserManager
  tabModel: WorkbenchTabModel
  windowService: WorkbenchWindowService
  trustedRenderers: TrustedRendererRegistry
  recoveryHosts: BrowserRecoveryHostRegistry
  createAuxiliaryWindow: (windowId: string) => AuxiliaryBrowserWindowHandle
  readyTimeoutMs?: number
}

/** Main-process transaction coordinator for Browser-only detachable M1. */
export class DetachableBrowserWindowController {
  private readonly auxiliaries = new Map<string, AuxiliaryEntry>()
  private readonly readyTimeoutMs: number
  private readonly disposeMainWorkspaceSync: () => void
  private disposed = false

  constructor(private readonly options: ControllerOptions) {
    this.readyTimeoutMs = options.readyTimeoutMs ?? 5_000
    this.disposeMainWorkspaceSync = options.browserManager.onMainWorkspaceChanged(
      (workspaceKey) => {
        const main = options.windowService.getWindow('main')
        if (main && (main.state === 'creating' || main.state === 'ready')) {
          options.windowService.updateWindowWorkspace('main', workspaceKey)
        }
      },
    )
  }

  registerIpc(): void {
    this.handle(workbenchWindowIpc.getBootstrap, (event) =>
      this.getBootstrap(this.options.trustedRenderers.assertRole(event, ['main', 'auxiliary'])),
    )
    this.handle(workbenchWindowIpc.getProjection, (event) =>
      this.getProjection(this.options.trustedRenderers.assertRole(event, ['main', 'auxiliary'])),
    )
    this.handle(workbenchWindowIpc.moveTabToNewWindow, (event, input) => {
      const identity = this.options.trustedRenderers.assertRole(event, ['main'])
      if (input.sourceWindowId !== identity.windowId) return invalidSource()
      return this.moveTabToNewWindow(input)
    })
    this.handle(workbenchWindowIpc.returnTabToMain, (event, input) => {
      const identity = this.options.trustedRenderers.assertRole(event, ['auxiliary'])
      if (input.sourceWindowId !== identity.windowId) return invalidSource()
      return this.returnTabToMain(input)
    })
    this.handle(workbenchWindowIpc.auxiliaryReady, (event, input) => {
      const identity = this.options.trustedRenderers.assertRole(event, ['auxiliary'])
      this.auxiliaryReady(identity, input)
      return { success: true as const }
    })
    this.handle(workbenchWindowIpc.updateBounds, (event, input) => {
      const identity = this.options.trustedRenderers.assertRole(event, ['auxiliary'])
      this.updateBounds(identity, input)
      return { success: true as const }
    })
    this.handle(workbenchWindowIpc.browserCommand, async (event, input) => {
      const identity = this.options.trustedRenderers.assertRole(event, ['auxiliary'])
      await this.browserCommand(identity, input)
      return { success: true as const }
    })
  }

  private handle<Args extends unknown[], Result>(
    contract: IpcInvokeContract<Args, Result>,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
  ): void {
    const registrations = this.options.trustedRenderers.ipcRegistrations
    if (!registrations) throw new Error('可信 renderer registry 缺少 IPC registration scope')
    registrations.handle(contract.channel, (event, ...unknownArgs: unknown[]) => {
      const args = contract.parseArgs(unknownArgs)
      return handler(event, ...args)
    })
  }

  private getBootstrap(identity: TrustedRendererIdentity): WorkbenchWindowBootstrap {
    const window = this.options.windowService.getWindow(identity.windowId)
    if (!window) throw new Error(`Workbench 窗口不存在: ${identity.windowId}`)
    return {
      windowId: window.windowId,
      role: window.role,
      workspaceKey: window.workspaceKey,
      activeTabId: window.activeTabId,
      generation: window.generation,
    }
  }

  private getProjection(identity: TrustedRendererIdentity): WorkbenchWindowProjection {
    const window = this.getBootstrap(identity)
    const auxiliary = this.auxiliaries.get(identity.windowId)
    return { window, tabs: auxiliary ? [auxiliary.tabProjection] : [] }
  }

  async moveTabToNewWindow(input: WorkbenchMoveTabInput): Promise<WorkbenchWindowCommandResult> {
    let auxiliary: AuxiliaryEntry | null = null
    let transfer: TabTransfer | null = null
    let failurePhase: 'preparing' | 'creating-window' | 'moving' = 'preparing'
    try {
      const tabProjection = await this.resolveBrowserTabProjection(
        input.tabId,
        input.workspaceKey,
        input.ownerKey ?? null,
      )
      if (this.options.browserManager.getViewOwnerWindowId(input.tabId) !== input.sourceWindowId) {
        return invalidSource()
      }
      let placement = this.options.windowService.getPlacement(input.tabId)
      if (!placement) {
        if (input.expectedGeneration !== 0) {
          throw new WorkbenchWindowTransitionError(
            'stale-generation',
            `首次 placement generation 必须为 0: ${input.tabId}`,
          )
        }
        placement = this.options.windowService.seedPlacement({
          tabId: input.tabId,
          workspaceKey: input.workspaceKey,
          windowId: input.sourceWindowId,
          active: true,
        })
        this.publishPlacement(placement)
      }
      const expectedGeneration =
        input.expectedGeneration === 0 ? placement.generation : input.expectedGeneration
      const windowId = `aux-${randomUUID()}`
      failurePhase = 'creating-window'
      auxiliary = this.createAuxiliary(windowId, tabProjection, input.workspaceKey)
      failurePhase = 'moving'
      transfer = this.options.windowService.beginTransfer({
        tabId: input.tabId,
        sourceWindowId: input.sourceWindowId,
        targetWindowId: windowId,
        expectedGeneration,
        direction: 'move',
      })
      await auxiliary.handle.load()
      await withTimeout(auxiliary.ready, this.readyTimeoutMs, '辅助窗口 ready 超时')
      this.options.browserManager.transferViewToHost(input.tabId, input.sourceWindowId, windowId)
      const committed = this.options.windowService.commitTransfer(transfer.transferId)
      auxiliary.tabProjection = { ...auxiliary.tabProjection, generation: committed.generation }
      auxiliary.handle.window.show()
      this.publishPlacement(committed)
      const projection = this.getProjection({
        windowId,
        role: 'auxiliary',
        webContents: auxiliary.handle.window.webContents,
      })
      auxiliary.handle.window.webContents.send(
        workbenchWindowIpcEvents.projectionChanged,
        projection,
      )
      return { success: true, transferId: transfer.transferId, projection }
    } catch (error) {
      if (transfer) {
        try {
          await this.rollbackOrRecover(transfer, error)
        } catch (recoveryError) {
          if (auxiliary) this.disposeAuxiliary(auxiliary.windowId)
          return failureResult(recoveryError, transfer.transferId, 'recovery')
        }
      }
      if (auxiliary) this.disposeAuxiliary(auxiliary.windowId)
      return failureResult(error, transfer?.transferId, failurePhase)
    }
  }

  async returnTabToMain(input: WorkbenchReturnTabInput): Promise<WorkbenchWindowCommandResult> {
    const auxiliary = this.auxiliaries.get(input.sourceWindowId)
    if (!auxiliary || auxiliary.tabProjection.tabId !== input.tabId) return notFound()
    let transfer: TabTransfer | null = null
    try {
      transfer = this.options.windowService.beginTransfer({
        tabId: input.tabId,
        sourceWindowId: input.sourceWindowId,
        targetWindowId: 'main',
        expectedGeneration: input.expectedGeneration,
        direction: 'return',
      })
      const activate =
        this.options.browserManager.getHostWorkspaceKey('main') ===
        auxiliary.tabProjection.workspaceKey
      this.options.browserManager.transferViewToHost(input.tabId, input.sourceWindowId, 'main', {
        activate,
      })
      const committed = this.options.windowService.commitTransfer(transfer.transferId)
      this.publishPlacement(committed)
      const projection: WorkbenchWindowProjection = {
        window: this.getBootstrap({
          windowId: 'main',
          role: 'main',
          webContents: this.options.mainWindow.webContents,
        }),
        tabs: [],
      }
      this.disposeAuxiliary(input.sourceWindowId)
      return { success: true, transferId: transfer.transferId, projection }
    } catch (error) {
      if (transfer) {
        try {
          await this.rollbackOrRecover(transfer, error)
        } catch (recoveryError) {
          return failureResult(recoveryError, transfer.transferId, 'recovery')
        }
      }
      return failureResult(error, transfer?.transferId)
    }
  }

  private createAuxiliary(
    windowId: string,
    tabProjection: WorkbenchBrowserTabProjection,
    workspaceKey: string | null,
  ): AuxiliaryEntry {
    const handle = this.options.createAuxiliaryWindow(windowId)
    const window = this.options.windowService.registerWindow({
      windowId,
      role: 'auxiliary',
      workspaceKey,
    })
    this.options.browserManager.registerHost(windowId, handle.window, workspaceKey)
    const disposeTrust = this.options.trustedRenderers.register({
      windowId,
      role: 'auxiliary',
      webContents: handle.window.webContents,
      rendererEntryUrl: handle.rendererEntryUrl,
      isHostDestroyed: () => handle.window.isDestroyed(),
    })
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const entry: AuxiliaryEntry = {
      windowId,
      handle,
      windowGeneration: window.generation,
      tabProjection,
      ready,
      resolveReady,
      rejectReady,
      disposeTrust,
      closingForDispose: false,
    }
    this.auxiliaries.set(windowId, entry)
    handle.window.on('close', (event) => {
      if (entry.closingForDispose || this.disposed) return
      event.preventDefault()
      const placement = this.options.windowService.getPlacement(tabProjection.tabId)
      if (!placement || placement.windowId !== windowId) {
        this.disposeAuxiliary(windowId)
        return
      }
      void this.returnTabToMain({
        tabId: tabProjection.tabId,
        sourceWindowId: windowId,
        expectedGeneration: placement.generation,
      })
    })
    handle.window.webContents.on('render-process-gone', () => {
      if (entry.closingForDispose || this.disposed) return
      const placement = this.options.windowService.getPlacement(tabProjection.tabId)
      if (!placement || placement.windowId !== windowId) return
      void this.returnTabToMain({
        tabId: tabProjection.tabId,
        sourceWindowId: windowId,
        expectedGeneration: placement.generation,
      })
    })
    handle.window.on('closed', () => {
      if (!entry.closingForDispose) entry.rejectReady(new Error('辅助窗口已关闭'))
    })
    return entry
  }

  private auxiliaryReady(
    identity: TrustedRendererIdentity,
    input: WorkbenchAuxiliaryReadyInput,
  ): void {
    const entry = this.requireAuxiliaryScope(identity, input.windowId, input.generation)
    this.options.windowService.markWindowReady(entry.windowId, entry.windowGeneration)
    entry.resolveReady()
  }

  private updateBounds(
    identity: TrustedRendererIdentity,
    input: WorkbenchAuxiliaryBoundsInput,
  ): void {
    this.requireAuxiliaryScope(identity, input.windowId, input.generation)
    this.options.browserManager.updateBoundsForWindow(input.windowId, input.bounds)
  }

  private async browserCommand(
    identity: TrustedRendererIdentity,
    input: WorkbenchAuxiliaryBrowserCommandInput,
  ): Promise<void> {
    const entry = this.requireAuxiliaryScope(identity, input.windowId)
    const placement = this.options.windowService.getPlacement(input.tabId)
    if (
      entry.tabProjection.tabId !== input.tabId ||
      !placement ||
      placement.windowId !== input.windowId ||
      placement.generation !== input.generation
    ) {
      throw new WorkbenchWindowTransitionError('stale-generation', '辅助 Browser 命令 scope 已失效')
    }
    if (input.action === 'navigate')
      await this.options.browserManager.navigate(input.tabId, input.url!)
    else if (input.action === 'back') this.options.browserManager.goBack(input.tabId)
    else if (input.action === 'forward') this.options.browserManager.goForward(input.tabId)
    else if (input.action === 'reload') this.options.browserManager.reload(input.tabId)
    else {
      const runtime = this.options.browserManager.getRuntimeIdentity(input.tabId)
      if (!runtime) throw new Error('Browser runtime 已失效')
      if (input.action === 'find') {
        this.options.browserManager.findInPage({
          ...runtime,
          requestToken: input.requestToken!,
          query: input.query!,
          forward: input.forward ?? true,
          findNext: input.findNext ?? false,
        })
      } else {
        this.options.browserManager.stopFindInPage({ ...runtime, action: 'keepSelection' })
      }
    }
  }

  private requireAuxiliaryScope(
    identity: TrustedRendererIdentity,
    windowId: string,
    windowGeneration?: number,
  ): AuxiliaryEntry {
    const entry = this.auxiliaries.get(windowId)
    if (
      !entry ||
      identity.windowId !== windowId ||
      (windowGeneration !== undefined && entry.windowGeneration !== windowGeneration)
    ) {
      throw new WorkbenchWindowTransitionError('stale-generation', '辅助窗口 scope 已失效')
    }
    return entry
  }

  private async resolveBrowserTabProjection(
    tabId: string,
    workspaceKey: string | null,
    ownerKey: string | null,
  ): Promise<WorkbenchBrowserTabProjection> {
    const [tabs, browser] = await Promise.all([
      this.options.tabModel.getProjection(workspaceKey, ownerKey),
      this.options.tabModel.getBrowserProjection(workspaceKey, ownerKey),
    ])
    const descriptor = tabs.tabs.find((tab) => tab.id === tabId)
    if (!descriptor || descriptor.type !== 'browser') {
      throw new Error(`只有 Browser Tab 可移至新窗口: ${tabId}`)
    }
    const browserProjection = browser.tabs[tabId]
    return {
      tabId,
      type: 'browser',
      title: String(descriptor.title),
      icon: String(descriptor.icon),
      workspaceKey,
      generation: 0,
      initialUrl:
        browserProjection?.url ||
        (typeof descriptor.initialUrl === 'string' ? descriptor.initialUrl : undefined),
      browserProfile:
        typeof descriptor.browserProfile === 'string' ? descriptor.browserProfile : null,
    }
  }

  private async rollbackOrRecover(transfer: TabTransfer, cause: unknown): Promise<void> {
    try {
      const ownerWindowId = this.options.browserManager.getViewOwnerWindowId(transfer.tabId)
      if (!ownerWindowId) throw new Error(`Browser runtime owner 已丢失: ${transfer.tabId}`)
      if (ownerWindowId !== transfer.sourceWindowId) {
        const activate =
          this.options.browserManager.getHostWorkspaceKey(transfer.sourceWindowId) ===
          transfer.workspaceKey
        this.options.browserManager.transferViewToHost(
          transfer.tabId,
          ownerWindowId,
          transfer.sourceWindowId,
          { activate },
        )
      }
      const placement = this.options.windowService.rollbackTransfer(transfer.transferId)
      this.publishPlacement(placement)
      return
    } catch (rollbackError) {
      const ownerWindowId = this.options.browserManager.getViewOwnerWindowId(transfer.tabId)
      if (!ownerWindowId) throw rollbackError
      try {
        this.options.recoveryHosts.recover(transfer.tabId, ownerWindowId, transfer.workspaceKey)
        const placement = this.options.windowService.enterRecovery(transfer.transferId)
        this.publishPlacement(placement)
        await this.tryRestoreRecovery(transfer.tabId)
      } catch (recoveryError) {
        console.error('[WorkbenchWindow] recovery 失败', { cause, rollbackError, recoveryError })
        throw recoveryError
      }
    }
  }

  private async tryRestoreRecovery(tabId: string): Promise<void> {
    const main = this.options.windowService.getWindow('main')
    if (!main || main.state !== 'ready' || this.options.mainWindow.isDestroyed()) return
    this.options.recoveryHosts.restore(tabId, 'main')
    const placement = this.options.windowService.restoreRecovery(tabId, 'main')
    this.publishPlacement(placement)
  }

  private publishPlacement(placement: TabPlacement): void {
    const payload: WorkbenchPlacementChanged = {
      tabId: placement.tabId,
      workspaceKey: placement.workspaceKey,
      windowId: placement.windowId,
      generation: placement.generation,
      state: placement.state,
    }
    if (
      !this.options.mainWindow.isDestroyed() &&
      !this.options.mainWindow.webContents.isDestroyed()
    ) {
      this.options.mainWindow.webContents.send(workbenchWindowIpcEvents.placementChanged, payload)
    }
    const auxiliary = this.auxiliaries.get(placement.windowId)
    if (auxiliary && !auxiliary.handle.window.webContents.isDestroyed()) {
      auxiliary.handle.window.webContents.send(workbenchWindowIpcEvents.placementChanged, payload)
    }
  }

  private disposeAuxiliary(windowId: string): void {
    const entry = this.auxiliaries.get(windowId)
    if (!entry) return
    this.auxiliaries.delete(windowId)
    entry.closingForDispose = true
    entry.disposeTrust()
    this.options.browserManager.unregisterHost(windowId)
    const window = this.options.windowService.getWindow(windowId)
    if (window && window.state !== 'closed' && window.state !== 'failed') {
      this.options.windowService.closeWindow(windowId)
    }
    if (!entry.handle.window.isDestroyed()) entry.handle.window.destroy()
  }

  destroy(): void {
    this.disposed = true
    this.disposeMainWorkspaceSync()
    for (const windowId of [...this.auxiliaries.keys()]) this.disposeAuxiliary(windowId)
    this.options.recoveryHosts.destroy()
  }
}

function invalidSource(): WorkbenchWindowCommandResult {
  return { success: false, error: { code: 'invalid-source', message: '窗口 source 已失效' } }
}

function notFound(): WorkbenchWindowCommandResult {
  return { success: false, error: { code: 'not-found', message: '辅助窗口或 Tab 已不存在' } }
}

function failureResult(
  error: unknown,
  transferId?: string,
  phase: 'preparing' | 'creating-window' | 'moving' | 'recovery' = 'moving',
): WorkbenchWindowCommandResult {
  const code =
    phase === 'creating-window' && !transferId
      ? 'window-create-failed'
      : phase === 'recovery'
        ? 'recovery-failed'
        : error instanceof Error && error.message.includes('只有 Browser Tab')
          ? 'unsupported-tab'
          : error instanceof WorkbenchWindowTransitionError
            ? error.code === 'stale-generation'
              ? 'stale-generation'
              : error.code === 'invalid-source'
                ? 'invalid-source'
                : 'attach-failed'
            : error instanceof Error && error.message.includes('ready')
              ? 'target-not-ready'
              : 'attach-failed'
  return {
    success: false,
    error: { code, message: error instanceof Error ? error.message : String(error), transferId },
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
