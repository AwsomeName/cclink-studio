import { createHash, randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMainInvokeEvent, MouseInputEvent } from 'electron'
import type { BrowserRuntimeIdentity } from '../../shared/ipc/browser'
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
  type WorkbenchTabDetachDragInput,
  type WorkbenchWindowBootstrap,
  type WorkbenchWindowCommandResult,
  type WorkbenchWindowDropPoint,
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
import { recordMainDiagnosticLog } from '../diagnostics/main-diagnostic-log'
import { resolveNativeTabDetachDropPoint } from './tab-detach-cursor'

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

type TransferDiagnosticPhase =
  | 'prepare'
  | 'create'
  | 'ready'
  | 'detach-attach'
  | 'commit'
  | 'publish'
  | 'rollback'
  | 'recovery'

type TransferRollbackResult =
  | 'not-needed'
  | 'attempted'
  | 'succeeded'
  | 'compensated'
  | 'recovery'
  | 'failed'

interface TransferDiagnosticContext {
  startedAt: number
  phaseStartedAt: number
  currentPhase: TransferDiagnosticPhase
  phaseDurationsMs: Partial<Record<TransferDiagnosticPhase, number>>
  initialIdentity: BrowserRuntimeIdentity | null
  rollbackResult: TransferRollbackResult
  failure: string | null
}

interface TabDetachDragSession {
  tabId: string
  startedAt: number
  sampleCount: number
  sawOutside: boolean
  lastOutsidePoint: WorkbenchWindowDropPoint | null
  sampleTimer: ReturnType<typeof setInterval>
  timeoutTimer: ReturnType<typeof setTimeout>
}

const TAB_DETACH_SAMPLE_INTERVAL_MS = 50
const TAB_DETACH_SESSION_TIMEOUT_MS = 30_000

interface ControllerOptions {
  mainWindow: BrowserWindow
  browserManager: BrowserManager
  tabModel: WorkbenchTabModel
  windowService: WorkbenchWindowService
  trustedRenderers: TrustedRendererRegistry
  recoveryHosts: BrowserRecoveryHostRegistry
  createAuxiliaryWindow: (
    windowId: string,
    dropPoint?: WorkbenchWindowDropPoint,
  ) => AuxiliaryBrowserWindowHandle
  getCursorScreenPoint: () => WorkbenchWindowDropPoint
  readyTimeoutMs?: number
}

/** Main-process transaction coordinator for Browser-only detachable M1. */
export class DetachableBrowserWindowController {
  private readonly auxiliaries = new Map<string, AuxiliaryEntry>()
  private readonly transferDiagnostics = new Map<string, TransferDiagnosticContext>()
  private readonly readyTimeoutMs: number
  private readonly disposeMainWorkspaceSync: () => void
  private tabDetachDragSession: TabDetachDragSession | null = null
  private disposed = false

  private readonly handleMainMouseEvent = (_event: Electron.Event, mouse: MouseInputEvent): void => {
    if (mouse.type !== 'mouseUp' || (mouse.button && mouse.button !== 'left')) return
    const completed = this.completeTabDetachDrag('native-mouse-up')
    if (!completed?.dropPoint || this.options.mainWindow.webContents.isDestroyed()) return
    this.options.mainWindow.webContents.send(workbenchWindowIpcEvents.tabDetachReleased, {
      tabId: completed.tabId,
      dropPoint: completed.dropPoint,
    })
  }

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
    options.mainWindow.webContents.on('before-mouse-event', this.handleMainMouseEvent)
  }

  registerIpc(): void {
    this.handle(workbenchWindowIpc.getBootstrap, (event) =>
      this.getBootstrap(this.options.trustedRenderers.assertRole(event, ['main', 'auxiliary'])),
    )
    this.handle(workbenchWindowIpc.getProjection, (event) =>
      this.getProjection(this.options.trustedRenderers.assertRole(event, ['main', 'auxiliary'])),
    )
    this.handle(workbenchWindowIpc.beginTabDetachDrag, (event, input) => {
      this.options.trustedRenderers.assertRole(event, ['main'])
      this.beginTabDetachDrag(input)
      return { success: true as const }
    })
    this.handle(workbenchWindowIpc.finishTabDetachDrag, (event, input) => {
      this.options.trustedRenderers.assertRole(event, ['main'])
      return this.finishTabDetachDrag(input)
    })
    this.handle(workbenchWindowIpc.cancelTabDetachDrag, (event, input) => {
      this.options.trustedRenderers.assertRole(event, ['main'])
      this.cancelTabDetachDrag(input, 'renderer-cancel')
      return { success: true as const }
    })
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

  private beginTabDetachDrag(input: WorkbenchTabDetachDragInput): void {
    if (this.options.browserManager.getViewOwnerWindowId(input.tabId) !== 'main') {
      throw new Error(`Browser Tab 不属于主窗口: ${input.tabId}`)
    }
    this.clearTabDetachDragSession('superseded')
    const session: TabDetachDragSession = {
      tabId: input.tabId,
      startedAt: Date.now(),
      sampleCount: 0,
      sawOutside: false,
      lastOutsidePoint: null,
      sampleTimer: setInterval(() => this.sampleTabDetachCursor(), TAB_DETACH_SAMPLE_INTERVAL_MS),
      timeoutTimer: setTimeout(() => {
        this.clearTabDetachDragSession('timeout')
      }, TAB_DETACH_SESSION_TIMEOUT_MS),
    }
    session.sampleTimer.unref?.()
    session.timeoutTimer.unref?.()
    this.tabDetachDragSession = session
    this.sampleTabDetachCursor()
    recordMainDiagnosticLog('info', [
      '[TabDetachDrag]',
      { phase: 'begin', tabId: input.tabId, sourceWindowId: 'main' },
    ])
  }

  private finishTabDetachDrag(input: WorkbenchTabDetachDragInput): WorkbenchWindowDropPoint | null {
    const completed = this.completeTabDetachDrag('renderer-pointer-up', input.tabId)
    return completed?.dropPoint ?? null
  }

  private cancelTabDetachDrag(input: WorkbenchTabDetachDragInput, reason: string): void {
    if (this.tabDetachDragSession?.tabId !== input.tabId) return
    this.clearTabDetachDragSession(reason)
  }

  private sampleTabDetachCursor(): WorkbenchWindowDropPoint | null {
    const session = this.tabDetachDragSession
    if (!session || this.options.mainWindow.isDestroyed()) return null
    const dropPoint = resolveNativeTabDetachDropPoint(
      this.options.getCursorScreenPoint(),
      this.options.mainWindow.getBounds(),
    )
    session.sampleCount += 1
    if (dropPoint) {
      session.sawOutside = true
      session.lastOutsidePoint = dropPoint
    }
    return dropPoint
  }

  private completeTabDetachDrag(
    trigger: 'native-mouse-up' | 'renderer-pointer-up',
    expectedTabId?: string,
  ): { tabId: string; dropPoint: WorkbenchWindowDropPoint | null } | null {
    const session = this.tabDetachDragSession
    if (!session || (expectedTabId && session.tabId !== expectedTabId)) return null
    const dropPoint = this.sampleTabDetachCursor()
    const diagnostic = {
      phase: 'finish',
      trigger,
      tabId: session.tabId,
      sourceWindowId: 'main',
      durationMs: Date.now() - session.startedAt,
      sampleCount: session.sampleCount,
      sawOutside: session.sawOutside,
      lastOutsidePoint: session.lastOutsidePoint,
      dropPoint,
      sourceBounds: this.options.mainWindow.isDestroyed()
        ? null
        : this.options.mainWindow.getBounds(),
    }
    this.disposeTabDetachDragSession()
    recordMainDiagnosticLog('info', ['[TabDetachDrag]', diagnostic])
    return { tabId: session.tabId, dropPoint }
  }

  private clearTabDetachDragSession(reason: string): void {
    const session = this.tabDetachDragSession
    if (!session) return
    const diagnostic = {
      phase: 'cancel',
      reason,
      tabId: session.tabId,
      sourceWindowId: 'main',
      durationMs: Date.now() - session.startedAt,
      sampleCount: session.sampleCount,
      sawOutside: session.sawOutside,
      lastOutsidePoint: session.lastOutsidePoint,
    }
    this.disposeTabDetachDragSession()
    recordMainDiagnosticLog(reason === 'timeout' ? 'warn' : 'info', [
      '[TabDetachDrag]',
      diagnostic,
    ])
  }

  private disposeTabDetachDragSession(): void {
    const session = this.tabDetachDragSession
    if (!session) return
    clearInterval(session.sampleTimer)
    clearTimeout(session.timeoutTimer)
    this.tabDetachDragSession = null
  }

  async moveTabToNewWindow(input: WorkbenchMoveTabInput): Promise<WorkbenchWindowCommandResult> {
    const operationStartedAt = Date.now()
    let createStartedAt = operationStartedAt
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
      createStartedAt = Date.now()
      auxiliary = this.createAuxiliary(windowId, tabProjection, input.workspaceKey, input.dropPoint)
      failurePhase = 'moving'
      transfer = this.options.windowService.beginTransfer({
        tabId: input.tabId,
        sourceWindowId: input.sourceWindowId,
        targetWindowId: windowId,
        expectedGeneration,
        direction: 'move',
      })
      this.startTransferDiagnostic(transfer, operationStartedAt, {
        prepare: createStartedAt - operationStartedAt,
        create: Date.now() - createStartedAt,
      })
      this.markTransferPhase(transfer.transferId, 'ready')
      await auxiliary.handle.load()
      await withTimeout(auxiliary.ready, this.readyTimeoutMs, '辅助窗口 ready 超时')
      this.markTransferPhase(transfer.transferId, 'detach-attach')
      this.options.browserManager.transferViewToHost(input.tabId, input.sourceWindowId, windowId)
      this.markTransferPhase(transfer.transferId, 'commit')
      committed = this.options.windowService.commitTransfer(transfer.transferId)
    } catch (error) {
      if (transfer) {
        this.markTransferFailure(transfer.transferId, error)
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
      this.markTransferPhase(transfer.transferId, 'publish')
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
      this.markTransferFailure(transfer.transferId, error)
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
    const operationStartedAt = Date.now()
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
      this.startTransferDiagnostic(transfer, operationStartedAt)
      const activate =
        this.options.browserManager.getHostWorkspaceKey('main') ===
        auxiliary.tabProjection.workspaceKey
      this.markTransferPhase(transfer.transferId, 'detach-attach')
      this.options.browserManager.transferViewToHost(input.tabId, input.sourceWindowId, 'main', {
        activate,
      })
      this.markTransferPhase(transfer.transferId, 'commit')
      committed = this.options.windowService.commitTransfer(transfer.transferId)
    } catch (error) {
      if (transfer) {
        this.markTransferFailure(transfer.transferId, error)
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
      this.markTransferPhase(transfer.transferId, 'publish')
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
      this.markTransferFailure(transfer.transferId, error)
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
    dropPoint?: WorkbenchWindowDropPoint,
  ): AuxiliaryEntry {
    const handle = this.options.createAuxiliaryWindow(windowId, dropPoint)
    let disposeTrust: (() => void) | null = null
    let entry: AuxiliaryEntry | null = null
    try {
      const window = this.options.windowService.registerWindow({
        windowId,
        role: 'auxiliary',
        workspaceKey,
      })
      this.options.browserManager.registerHost(windowId, handle.window, workspaceKey)
      disposeTrust = this.options.trustedRenderers.register({
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
      const createdEntry: AuxiliaryEntry = {
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
      entry = createdEntry
      this.auxiliaries.set(windowId, createdEntry)
      handle.window.on('close', (event) => {
        if (createdEntry.closingForDispose || this.disposed) return
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
          if (!result.success) void this.recoverLostAuxiliary(createdEntry, result.error)
        })
      })
      handle.window.webContents.on('render-process-gone', () => {
        if (createdEntry.closingForDispose || this.disposed) return
        const placement = this.options.windowService.getPlacement(tabProjection.tabId)
        if (!placement || placement.windowId !== windowId) return
        void this.returnTabToMain({
          tabId: tabProjection.tabId,
          sourceWindowId: windowId,
          expectedGeneration: placement.generation,
        }).then((result) => {
          if (!result.success) void this.recoverLostAuxiliary(createdEntry, result.error)
        })
      })
      handle.window.on('closed', () => {
        if (createdEntry.closingForDispose || this.disposed) return
        createdEntry.rejectReady(new Error('辅助窗口已关闭'))
        void this.recoverLostAuxiliary(createdEntry, new Error('辅助窗口意外关闭'))
      })
      return createdEntry
    } catch (error) {
      this.cleanupPartialAuxiliary(windowId, handle, disposeTrust, entry, error)
      throw error
    }
  }

  private cleanupPartialAuxiliary(
    windowId: string,
    handle: AuxiliaryBrowserWindowHandle,
    disposeTrust: (() => void) | null,
    entry: AuxiliaryEntry | null,
    cause: unknown,
  ): void {
    this.auxiliaries.delete(windowId)
    if (entry) entry.closingForDispose = true
    const cleanupErrors: unknown[] = []
    for (const cleanup of [
      () => disposeTrust?.(),
      () => this.options.browserManager.unregisterHost(windowId),
      () => {
        const window = this.options.windowService.getWindow(windowId)
        if (!window) return
        if (window.state !== 'closed' && window.state !== 'failed') {
          this.options.windowService.closeWindow(windowId, true)
        }
        this.options.windowService.releaseWindow(windowId)
      },
      () => {
        if (!handle.window.isDestroyed()) handle.window.destroy()
      },
    ]) {
      try {
        cleanup()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    recordMainDiagnosticLog('error', [
      '[WorkbenchWindow] auxiliary-create-failed',
      {
        windowId,
        cause: diagnosticErrorMessage(cause),
        cleanupErrorCount: cleanupErrors.length,
        cleanupErrors: cleanupErrors.map(diagnosticErrorMessage),
      },
    ])
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
      this.startTransferDiagnostic(compensation)
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
      this.markTransferPhase(compensation.transferId, 'detach-attach')
      this.options.browserManager.transferViewToHost(
        committedTransfer.tabId,
        committedTransfer.targetWindowId,
        committedTransfer.sourceWindowId,
        { activate },
      )
      this.markTransferPhase(compensation.transferId, 'commit')
      let restored: TabPlacement
      try {
        restored = this.options.windowService.commitTransfer(compensation.transferId)
      } catch (error) {
        const current = this.options.windowService.getTransfer(compensation.transferId)
        if (current?.state !== 'committed') throw error
        restored = this.options.windowService.getPlacement(committedTransfer.tabId)!
      }
      this.markTransferPhase(compensation.transferId, 'publish')
      this.publishPlacementBestEffort(restored, '已提交迁移补偿通知失败')
      this.setTransferRollbackResult(committedTransfer.transferId, 'compensated')
    } catch (compensationError) {
      this.markTransferFailure(committedTransfer.transferId, compensationError)
      if (compensation) this.markTransferFailure(compensation.transferId, compensationError)
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
    this.markTransferPhase(transfer.transferId, 'recovery')
    this.setTransferRollbackResult(transfer.transferId, 'recovery')
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
    this.markTransferPhase(transfer.transferId, 'rollback')
    this.setTransferRollbackResult(transfer.transferId, 'attempted')
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
      this.markTransferFailure(transfer.transferId, rollbackError)
      const ownerWindowId = this.options.browserManager.getViewOwnerWindowId(transfer.tabId)
      if (!ownerWindowId) {
        this.setTransferRollbackResult(transfer.transferId, 'failed')
        throw rollbackError
      }
      try {
        this.markTransferPhase(transfer.transferId, 'recovery')
        this.options.recoveryHosts.recover(transfer.tabId, ownerWindowId, transfer.workspaceKey)
        const placement = this.options.windowService.enterRecovery(transfer.transferId)
        this.publishPlacementBestEffort(placement, 'rollback recovery 通知失败')
        await this.tryRestoreRecovery(transfer.tabId)
      } catch (recoveryError) {
        this.setTransferRollbackResult(transfer.transferId, 'failed')
        console.error('[WorkbenchWindow] recovery 失败', { cause, rollbackError, recoveryError })
        throw recoveryError
      }
      this.setTransferRollbackResult(transfer.transferId, 'recovery')
      return
    }
    this.setTransferRollbackResult(transfer.transferId, 'succeeded')
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

  private startTransferDiagnostic(
    transfer: TabTransfer,
    startedAt = Date.now(),
    initialDurations: Partial<Record<TransferDiagnosticPhase, number>> = {},
  ): void {
    const now = Date.now()
    let initialIdentity: BrowserRuntimeIdentity | null = null
    try {
      initialIdentity = this.options.browserManager.getRuntimeIdentity(transfer.tabId)
    } catch (error) {
      recordMainDiagnosticLog('warn', [
        '[WorkbenchTransfer] identity-capture-failed',
        { transferId: transfer.transferId, error: diagnosticErrorMessage(error) },
      ])
    }
    this.transferDiagnostics.set(transfer.transferId, {
      startedAt,
      phaseStartedAt: now,
      currentPhase: 'prepare',
      phaseDurationsMs: { ...initialDurations },
      initialIdentity,
      rollbackResult: 'not-needed',
      failure: null,
    })
  }

  private markTransferPhase(transferId: string, phase: TransferDiagnosticPhase): void {
    const diagnostic = this.transferDiagnostics.get(transferId)
    if (!diagnostic || diagnostic.currentPhase === phase) return
    const now = Date.now()
    diagnostic.phaseDurationsMs[diagnostic.currentPhase] =
      (diagnostic.phaseDurationsMs[diagnostic.currentPhase] ?? 0) +
      (now - diagnostic.phaseStartedAt)
    diagnostic.currentPhase = phase
    diagnostic.phaseStartedAt = now
  }

  private markTransferFailure(transferId: string, error: unknown): void {
    const diagnostic = this.transferDiagnostics.get(transferId)
    if (!diagnostic || diagnostic.failure) return
    diagnostic.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }

  private setTransferRollbackResult(transferId: string, result: TransferRollbackResult): void {
    const diagnostic = this.transferDiagnostics.get(transferId)
    if (diagnostic) diagnostic.rollbackResult = result
  }

  private releaseTransferIfTerminal(transferId: string): void {
    const transfer = this.options.windowService.getTransfer(transferId)
    if (!transfer || transfer.state === 'preparing' || transfer.state === 'target-ready') return
    const diagnostic = this.transferDiagnostics.get(transferId)
    try {
      if (diagnostic) {
        const now = Date.now()
        diagnostic.phaseDurationsMs[diagnostic.currentPhase] =
          (diagnostic.phaseDurationsMs[diagnostic.currentPhase] ?? 0) +
          (now - diagnostic.phaseStartedAt)
        const finalIdentity = this.options.browserManager.getRuntimeIdentity(transfer.tabId)
        const finalOwnerWindowId = this.options.browserManager.getViewOwnerWindowId(transfer.tabId)
        const finalPlacement = this.options.windowService.getPlacement(transfer.tabId)
        const identityMatched = runtimeIdentitiesMatch(diagnostic.initialIdentity, finalIdentity)
        const ownerMatchedPlacement =
          finalOwnerWindowId !== null && finalOwnerWindowId === finalPlacement?.windowId
        recordMainDiagnosticLog(
          diagnostic.failure || !identityMatched || !ownerMatchedPlacement ? 'warn' : 'info',
          [
            '[WorkbenchTransfer]',
            {
              transferId: transfer.transferId,
              tabId: transfer.tabId,
              tabType: 'browser',
              workspaceKeyRef: workspaceKeyRef(transfer.workspaceKey),
              sourceWindowId: transfer.sourceWindowId,
              sourceRole: windowRole(transfer.sourceWindowId),
              targetWindowId: transfer.targetWindowId,
              targetRole: windowRole(transfer.targetWindowId),
              generation: transfer.generation,
              terminalState: transfer.state,
              totalDurationMs: now - diagnostic.startedAt,
              phaseDurationsMs: diagnostic.phaseDurationsMs,
              runtimeGeneration: finalIdentity?.runtimeGeneration ?? null,
              identityMatched,
              rollbackResult: diagnostic.rollbackResult,
              finalOwnerWindowId,
              finalPlacementWindowId: finalPlacement?.windowId ?? null,
              ownerMatchedPlacement,
              failure: diagnostic.failure,
            },
          ],
        )
      }
    } catch (error) {
      recordMainDiagnosticLog('warn', [
        '[WorkbenchTransfer] diagnostic-collection-failed',
        {
          transferId,
          terminalState: transfer.state,
          error: diagnosticErrorMessage(error),
        },
      ])
    } finally {
      this.transferDiagnostics.delete(transferId)
      this.options.windowService.releaseTransfer(transferId)
    }
  }

  destroy(): void {
    this.disposed = true
    this.options.mainWindow.webContents.removeListener(
      'before-mouse-event',
      this.handleMainMouseEvent,
    )
    this.clearTabDetachDragSession('controller-destroy')
    this.disposeMainWorkspaceSync()
    for (const windowId of [...this.auxiliaries.keys()]) this.disposeAuxiliary(windowId)
    this.transferDiagnostics.clear()
    this.options.recoveryHosts.destroy()
  }
}

function runtimeIdentitiesMatch(
  before: BrowserRuntimeIdentity | null,
  after: BrowserRuntimeIdentity | null,
): boolean {
  return Boolean(
    before &&
    after &&
    before.tabId === after.tabId &&
    before.workspaceKey === after.workspaceKey &&
    before.runtimeGeneration === after.runtimeGeneration,
  )
}

function diagnosticErrorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function workspaceKeyRef(workspaceKey: string | null): string {
  if (workspaceKey === null) return 'global'
  return createHash('sha256').update(workspaceKey).digest('hex').slice(0, 12)
}

function windowRole(windowId: string): 'main' | 'auxiliary' | 'recovery' {
  if (windowId === 'main') return 'main'
  return windowId.startsWith('recovery:') ? 'recovery' : 'auxiliary'
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
