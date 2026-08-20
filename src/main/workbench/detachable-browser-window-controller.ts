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
  recoveryInFlight: boolean
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
      activeTabId: this.options.browserManager.getActiveViewIdForWindow(window.windowId),
      generation: window.generation,
    }
  }

  private getProjection(identity: TrustedRendererIdentity): WorkbenchWindowProjection {
    const window = this.getBootstrap(identity)
    const auxiliary = this.auxiliaries.get(identity.windowId)
    const placements = this.options.windowService
      .getPlacementSnapshot()
      .filter((placement) => identity.role === 'main' || placement.windowId === identity.windowId)
      .map((placement) => this.toPlacementPayload(placement))
    return { window, tabs: auxiliary ? [auxiliary.tabProjection] : [], placements }
  }

  async moveTabToNewWindow(input: WorkbenchMoveTabInput): Promise<WorkbenchWindowCommandResult> {
    let auxiliary: AuxiliaryEntry | null = null
    let transfer: TabTransfer | null = null
    let failurePhase: 'preparing' | 'creating-window' | 'moving' = 'preparing'
    let committed: TabPlacement | null = null
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
      committed = this.options.windowService.commitTransfer(transfer.transferId)
    } catch (error) {
      if (transfer) {
        try {
          await this.restoreAfterTransferFailure(transfer, error)
        } catch (recoveryError) {
          this.releaseTransferIfTerminal(transfer.transferId)
          if (auxiliary) this.disposeAuxiliaryIfUnowned(auxiliary.windowId)
          return failureResult(recoveryError, transfer.transferId, 'recovery')
        }
        this.releaseTransferIfTerminal(transfer.transferId)
      }
      if (auxiliary) this.disposeAuxiliaryIfUnowned(auxiliary.windowId)
      return failureResult(error, transfer?.transferId, failurePhase)
    }

    let projection: WorkbenchWindowProjection
    try {
      auxiliary.tabProjection = { ...auxiliary.tabProjection, generation: committed.generation }
      auxiliary.handle.window.show()
      this.publishPlacement(committed)
      projection = this.getProjection({
        windowId: auxiliary.windowId,
        role: 'auxiliary',
        webContents: auxiliary.handle.window.webContents,
      })
      auxiliary.handle.window.webContents.send(
        workbenchWindowIpcEvents.projectionChanged,
        projection,
      )
    } catch (error) {
      try {
        await this.compensateCommittedTransfer(transfer, error)
      } catch (recoveryError) {
        this.releaseTransferIfTerminal(transfer.transferId)
        this.disposeAuxiliaryIfUnowned(auxiliary.windowId)
        return failureResult(recoveryError, transfer.transferId, 'recovery')
      }
      this.releaseTransferIfTerminal(transfer.transferId)
      this.disposeAuxiliaryIfUnowned(auxiliary.windowId)
      return failureResult(error, transfer.transferId, failurePhase)
    }
    this.releaseTransferIfTerminal(transfer.transferId)
    return { success: true, transferId: transfer.transferId, projection }
  }

  async returnTabToMain(input: WorkbenchReturnTabInput): Promise<WorkbenchWindowCommandResult> {
    const auxiliary = this.auxiliaries.get(input.sourceWindowId)
    if (!auxiliary || auxiliary.tabProjection.tabId !== input.tabId) return notFound()
    let transfer: TabTransfer | null = null
    let committed: TabPlacement | null = null
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
      committed = this.options.windowService.commitTransfer(transfer.transferId)
    } catch (error) {
      if (transfer) {
        try {
          await this.restoreAfterTransferFailure(transfer, error)
        } catch (recoveryError) {
          this.releaseTransferIfTerminal(transfer.transferId)
          return failureResult(recoveryError, transfer.transferId, 'recovery')
        }
        this.releaseTransferIfTerminal(transfer.transferId)
      }
      return failureResult(error, transfer?.transferId)
    }

    let projection: WorkbenchWindowProjection
    try {
      this.publishPlacement(committed)
      projection = {
        window: this.getBootstrap({
          windowId: 'main',
          role: 'main',
          webContents: this.options.mainWindow.webContents,
        }),
        tabs: [],
        placements: this.options.windowService
          .getPlacementSnapshot()
          .map((placement) => this.toPlacementPayload(placement)),
      }
    } catch (error) {
      try {
        await this.compensateCommittedTransfer(transfer, error)
      } catch (recoveryError) {
        this.releaseTransferIfTerminal(transfer.transferId)
        return failureResult(recoveryError, transfer.transferId, 'recovery')
      }
      this.releaseTransferIfTerminal(transfer.transferId)
      return failureResult(error, transfer.transferId)
    }
    this.releaseTransferIfTerminal(transfer.transferId)
    this.disposeAuxiliary(input.sourceWindowId)
    return { success: true, transferId: transfer.transferId, projection }
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
      recoveryInFlight: false,
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
      }).then((result) => {
        if (!result.success) void this.recoverLostAuxiliary(entry, result.error)
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
      }).then((result) => {
        if (!result.success) void this.recoverLostAuxiliary(entry, result.error)
      })
    })
    handle.window.on('closed', () => {
      if (entry.closingForDispose || this.disposed) return
      entry.rejectReady(new Error('辅助窗口已关闭'))
      void this.recoverLostAuxiliary(entry, new Error('辅助窗口意外关闭'))
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

  private async restoreAfterTransferFailure(transfer: TabTransfer, cause: unknown): Promise<void> {
    const current = this.options.windowService.getTransfer(transfer.transferId)
    if (current?.state === 'committed') {
      await this.compensateCommittedTransfer(current, cause)
      return
    }
    await this.rollbackOrRecover(transfer, cause)
  }

  /** A committed transfer is immutable; reversing it always uses a new generation/transaction. */
  private async compensateCommittedTransfer(
    committedTransfer: TabTransfer,
    cause: unknown,
  ): Promise<void> {
    const currentPlacement = this.options.windowService.getPlacement(committedTransfer.tabId)
    if (!currentPlacement) throw new Error(`Tab placement 已丢失: ${committedTransfer.tabId}`)
    if (
      currentPlacement.windowId === committedTransfer.sourceWindowId &&
      currentPlacement.state === 'attached'
    ) {
      return
    }
    if (
      currentPlacement.windowId !== committedTransfer.targetWindowId ||
      currentPlacement.state !== 'attached'
    ) {
      throw new WorkbenchWindowTransitionError(
        'invalid-source',
        `已提交迁移的补偿 source 已失效: ${committedTransfer.tabId}`,
      )
    }

    let compensation: TabTransfer | null = null
    try {
      compensation = this.options.windowService.beginTransfer({
        tabId: committedTransfer.tabId,
        sourceWindowId: committedTransfer.targetWindowId,
        targetWindowId: committedTransfer.sourceWindowId,
        expectedGeneration: currentPlacement.generation,
        direction: committedTransfer.direction === 'move' ? 'return' : 'move',
      })
      const ownerWindowId = this.options.browserManager.getViewOwnerWindowId(
        committedTransfer.tabId,
      )
      if (ownerWindowId !== committedTransfer.targetWindowId) {
        throw new Error(
          `Browser runtime 与 committed placement owner 不一致: ${committedTransfer.tabId}`,
        )
      }
      const activate =
        this.options.browserManager.getHostWorkspaceKey(committedTransfer.sourceWindowId) ===
        committedTransfer.workspaceKey
      this.options.browserManager.transferViewToHost(
        committedTransfer.tabId,
        committedTransfer.targetWindowId,
        committedTransfer.sourceWindowId,
        { activate },
      )
      let restored: TabPlacement
      try {
        restored = this.options.windowService.commitTransfer(compensation.transferId)
      } catch (error) {
        const current = this.options.windowService.getTransfer(compensation.transferId)
        if (current?.state !== 'committed') throw error
        restored = this.options.windowService.getPlacement(committedTransfer.tabId)!
      }
      this.publishPlacementBestEffort(restored, '已提交迁移补偿通知失败')
    } catch (compensationError) {
      if (compensation) {
        await this.rollbackOrRecover(compensation, compensationError)
      } else {
        await this.recoverCommittedPlacement(committedTransfer, compensationError)
      }
      console.error('[WorkbenchWindow] 已提交迁移已进入补偿路径', {
        cause,
        compensationError,
      })
      throw compensationError
    } finally {
      if (compensation) this.releaseTransferIfTerminal(compensation.transferId)
    }
  }

  private async recoverCommittedPlacement(transfer: TabTransfer, cause: unknown): Promise<void> {
    const placement = this.options.windowService.getPlacement(transfer.tabId)
    const ownerWindowId = this.options.browserManager.getViewOwnerWindowId(transfer.tabId)
    if (!placement || !ownerWindowId)
      throw new Error(`Browser runtime owner 已丢失: ${transfer.tabId}`)
    this.options.recoveryHosts.recover(transfer.tabId, ownerWindowId, transfer.workspaceKey)
    let recovering: TabPlacement
    try {
      recovering = this.options.windowService.recoverPlacementAfterWindowLoss(
        transfer.tabId,
        placement.windowId,
      )
    } catch (placementError) {
      try {
        this.options.recoveryHosts.restore(transfer.tabId, placement.windowId)
      } catch (nativeRollbackError) {
        try {
          recovering = this.options.windowService.recoverPlacementAfterWindowLoss(
            transfer.tabId,
            placement.windowId,
          )
        } catch (retryError) {
          console.error('[WorkbenchWindow] committed recovery 无法对齐 owner', {
            cause,
            placementError,
            nativeRollbackError,
            retryError,
          })
          throw retryError
        }
        this.publishPlacementBestEffort(recovering, 'committed recovery 重试通知失败')
        await this.tryRestoreRecovery(transfer.tabId)
        return
      }
      throw placementError
    }
    this.publishPlacementBestEffort(recovering, 'committed recovery 通知失败')
    await this.tryRestoreRecovery(transfer.tabId)
  }

  private async rollbackOrRecover(transfer: TabTransfer, cause: unknown): Promise<void> {
    let rolledBack: TabPlacement
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
      rolledBack = this.options.windowService.rollbackTransfer(transfer.transferId)
    } catch (rollbackError) {
      const ownerWindowId = this.options.browserManager.getViewOwnerWindowId(transfer.tabId)
      if (!ownerWindowId) throw rollbackError
      try {
        this.options.recoveryHosts.recover(transfer.tabId, ownerWindowId, transfer.workspaceKey)
        const placement = this.options.windowService.enterRecovery(transfer.transferId)
        this.publishPlacementBestEffort(placement, 'rollback recovery 通知失败')
        await this.tryRestoreRecovery(transfer.tabId)
      } catch (recoveryError) {
        console.error('[WorkbenchWindow] recovery 失败', { cause, rollbackError, recoveryError })
        throw recoveryError
      }
      return
    }
    this.publishPlacementBestEffort(rolledBack, 'rollback 通知失败')
  }

  private async tryRestoreRecovery(tabId: string): Promise<void> {
    const main = this.options.windowService.getWindow('main')
    if (!main || main.state !== 'ready' || this.options.mainWindow.isDestroyed()) return
    const recovering = this.options.windowService.getPlacement(tabId)
    if (!recovering || recovering.state !== 'recovering') return
    this.options.recoveryHosts.restore(tabId, 'main')
    let placement: TabPlacement
    try {
      placement = this.options.windowService.restoreRecovery(tabId, 'main')
    } catch (placementError) {
      try {
        this.options.recoveryHosts.recover(tabId, 'main', recovering.workspaceKey)
      } catch (nativeRollbackError) {
        try {
          placement = this.options.windowService.restoreRecovery(tabId, 'main')
        } catch (retryError) {
          console.error('[WorkbenchWindow] Recovery Host 送回无法对齐 owner', {
            placementError,
            nativeRollbackError,
            retryError,
          })
          throw retryError
        }
        this.publishPlacementBestEffort(placement, 'recovery restore 重试通知失败')
        return
      }
      throw placementError
    }
    this.publishPlacementBestEffort(placement, 'recovery restore 通知失败')
  }

  private async recoverLostAuxiliary(entry: AuxiliaryEntry, cause: unknown): Promise<void> {
    if (entry.recoveryInFlight || entry.closingForDispose || this.disposed) return
    const tabId = entry.tabProjection.tabId
    const placement = this.options.windowService.getPlacement(tabId)
    if (!placement || placement.windowId !== entry.windowId) return
    entry.recoveryInFlight = true
    try {
      const window = this.options.windowService.getWindow(entry.windowId)
      if (window && window.state !== 'closed' && window.state !== 'failed') {
        this.options.windowService.closeWindow(entry.windowId, true)
      }
      const ownerWindowId = this.options.browserManager.getViewOwnerWindowId(tabId)
      if (!ownerWindowId) throw new Error(`Browser runtime owner 已丢失: ${tabId}`)
      this.options.recoveryHosts.recover(tabId, ownerWindowId, placement.workspaceKey)
      const recovering = this.options.windowService.recoverPlacementAfterWindowLoss(
        tabId,
        entry.windowId,
      )
      this.publishPlacementBestEffort(recovering, '辅助窗口失效恢复通知失败')
      this.disposeAuxiliary(entry.windowId)
      await this.tryRestoreRecovery(tabId)
    } catch (error) {
      console.error('[WorkbenchWindow] 辅助窗口失效恢复失败', { cause, error })
    } finally {
      entry.recoveryInFlight = false
    }
  }

  private publishPlacement(placement: TabPlacement): void {
    const payload = this.toPlacementPayload(placement)
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

  private publishPlacementBestEffort(placement: TabPlacement, message: string): void {
    try {
      this.publishPlacement(placement)
    } catch (error) {
      // Placement/native owner consistency is already committed. Renderer can rehydrate this
      // generation through getProjection; a notification failure must not start another rollback.
      console.error(`[WorkbenchWindow] ${message}`, error)
    }
  }

  private toPlacementPayload(placement: TabPlacement): WorkbenchPlacementChanged {
    return {
      tabId: placement.tabId,
      workspaceKey: placement.workspaceKey,
      windowId: placement.windowId,
      generation: placement.generation,
      state: placement.state,
      active:
        placement.state === 'attached' &&
        this.options.browserManager.getActiveViewIdForWindow(placement.windowId) ===
          placement.tabId,
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
    const closed = this.options.windowService.getWindow(windowId)
    const stillOwnsPlacement = this.options.windowService
      .getPlacementSnapshot()
      .some((placement) => placement.windowId === windowId)
    if (closed && !stillOwnsPlacement && (closed.state === 'closed' || closed.state === 'failed')) {
      this.options.windowService.releaseWindow(windowId)
    }
  }

  private disposeAuxiliaryIfUnowned(windowId: string): void {
    const entry = this.auxiliaries.get(windowId)
    if (!entry) return
    const placement = this.options.windowService.getPlacement(entry.tabProjection.tabId)
    if (placement?.windowId === windowId) return
    this.disposeAuxiliary(windowId)
  }

  private releaseTransferIfTerminal(transferId: string): void {
    const transfer = this.options.windowService.getTransfer(transferId)
    if (!transfer || transfer.state === 'preparing' || transfer.state === 'target-ready') return
    this.options.windowService.releaseTransfer(transferId)
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
