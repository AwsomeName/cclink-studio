import { randomUUID } from 'node:crypto'
import type { WorkbenchWindowRole } from '../../shared/ipc/workbench-window'

export type WorkbenchWindowState = 'creating' | 'ready' | 'closing' | 'closed' | 'failed'
export type TabPlacementState = 'attached' | 'moving' | 'returning' | 'recovering'

export interface WorkbenchWindowEntry {
  windowId: string
  role: WorkbenchWindowRole
  workspaceKey: string | null
  orderedTabIds: string[]
  generation: number
  state: WorkbenchWindowState
}

export interface TabPlacement {
  tabId: string
  workspaceKey: string | null
  windowId: string
  index: number
  generation: number
  state: TabPlacementState
}

export interface TabTransfer {
  transferId: string
  tabId: string
  workspaceKey: string | null
  sourceWindowId: string
  targetWindowId: string
  generation: number
  direction: 'move' | 'return'
  state: 'preparing' | 'target-ready' | 'committed' | 'rolled-back' | 'recovering'
}

export class WorkbenchWindowTransitionError extends Error {
  constructor(
    readonly code:
      | 'window-not-found'
      | 'window-not-ready'
      | 'placement-not-found'
      | 'invalid-source'
      | 'stale-generation'
      | 'transfer-in-progress'
      | 'transfer-not-found'
      | 'invalid-transfer-state',
    message: string,
  ) {
    super(message)
    this.name = 'WorkbenchWindowTransitionError'
  }
}

/**
 * Main-process ledger for windows and Browser Tabs that entered the detachable lifecycle.
 * BrowserManager remains the native host/active-view owner; this service owns only the
 * detachable placement/order generations and transfer state for seeded Tabs.
 */
export class WorkbenchWindowService {
  private readonly windows = new Map<string, WorkbenchWindowEntry>()
  private readonly placements = new Map<string, TabPlacement>()
  private readonly transfers = new Map<string, TabTransfer>()
  private readonly activeTransferByTab = new Map<string, string>()

  registerWindow(input: {
    windowId: string
    role: WorkbenchWindowRole
    workspaceKey: string | null
    state?: WorkbenchWindowState
  }): WorkbenchWindowEntry {
    const existing = this.windows.get(input.windowId)
    if (existing && existing.state !== 'closed' && existing.state !== 'failed') {
      throw new WorkbenchWindowTransitionError(
        'invalid-transfer-state',
        `窗口已注册: ${input.windowId}`,
      )
    }
    const entry: WorkbenchWindowEntry = {
      windowId: input.windowId,
      role: input.role,
      workspaceKey: input.workspaceKey,
      orderedTabIds: [],
      generation: (existing?.generation ?? 0) + 1,
      state: input.state ?? 'creating',
    }
    this.windows.set(entry.windowId, entry)
    return cloneWindow(entry)
  }

  markWindowReady(windowId: string, expectedGeneration?: number): WorkbenchWindowEntry {
    const entry = this.requireWindow(windowId)
    if (expectedGeneration !== undefined && entry.generation !== expectedGeneration) {
      throw new WorkbenchWindowTransitionError(
        'stale-generation',
        `窗口 generation 已过期: ${windowId}`,
      )
    }
    if (entry.state !== 'creating' && entry.state !== 'ready') {
      throw new WorkbenchWindowTransitionError('window-not-ready', `窗口不能 ready: ${windowId}`)
    }
    entry.state = 'ready'
    for (const transfer of this.transfers.values()) {
      if (transfer.targetWindowId === windowId && transfer.state === 'preparing') {
        transfer.state = 'target-ready'
      }
    }
    return cloneWindow(entry)
  }

  updateWindowWorkspace(windowId: string, workspaceKey: string | null): WorkbenchWindowEntry {
    const entry = this.requireWindow(windowId)
    if (entry.state !== 'creating' && entry.state !== 'ready') {
      throw new WorkbenchWindowTransitionError(
        'window-not-ready',
        `窗口不能更新工作空间: ${windowId}`,
      )
    }
    entry.workspaceKey = workspaceKey
    return cloneWindow(entry)
  }

  closeWindow(windowId: string, failed = false): void {
    const entry = this.requireWindow(windowId)
    entry.state = failed ? 'failed' : 'closed'
    entry.orderedTabIds = []
  }

  seedPlacement(input: {
    tabId: string
    workspaceKey: string | null
    windowId: string
    index?: number
  }): TabPlacement {
    const window = this.requireReadyWindow(input.windowId)
    const existingTransfer = this.activeTransferByTab.get(input.tabId)
    if (existingTransfer) {
      throw new WorkbenchWindowTransitionError(
        'transfer-in-progress',
        `Tab 正在迁移: ${input.tabId}`,
      )
    }
    const existing = this.placements.get(input.tabId)
    if (existing) this.removeTabFromWindow(existing.windowId, input.tabId)
    const index = clampIndex(
      input.index ?? window.orderedTabIds.length,
      window.orderedTabIds.length,
    )
    window.orderedTabIds.splice(index, 0, input.tabId)
    const placement: TabPlacement = {
      tabId: input.tabId,
      workspaceKey: input.workspaceKey,
      windowId: input.windowId,
      index,
      generation: (existing?.generation ?? 0) + 1,
      state: 'attached',
    }
    this.placements.set(input.tabId, placement)
    this.reindexWindow(window.windowId)
    return { ...placement }
  }

  beginTransfer(input: {
    tabId: string
    sourceWindowId: string
    targetWindowId: string
    expectedGeneration: number
    direction: 'move' | 'return'
  }): TabTransfer {
    const placement = this.requirePlacement(input.tabId)
    if (this.activeTransferByTab.has(input.tabId)) {
      throw new WorkbenchWindowTransitionError(
        'transfer-in-progress',
        `Tab 正在迁移: ${input.tabId}`,
      )
    }
    if (placement.windowId !== input.sourceWindowId) {
      throw new WorkbenchWindowTransitionError(
        'invalid-source',
        `Tab 不属于 source window: ${input.tabId}`,
      )
    }
    if (placement.generation !== input.expectedGeneration) {
      throw new WorkbenchWindowTransitionError(
        'stale-generation',
        `Tab placement generation 已过期: ${input.tabId}`,
      )
    }
    this.requireReadyWindow(input.sourceWindowId)
    const target = this.requireWindow(input.targetWindowId)
    if (target.state !== 'creating' && target.state !== 'ready') {
      throw new WorkbenchWindowTransitionError(
        'window-not-ready',
        `目标窗口不可用: ${input.targetWindowId}`,
      )
    }
    const transfer: TabTransfer = {
      transferId: randomUUID(),
      tabId: input.tabId,
      workspaceKey: placement.workspaceKey,
      sourceWindowId: input.sourceWindowId,
      targetWindowId: input.targetWindowId,
      generation: placement.generation + 1,
      direction: input.direction,
      state: target.state === 'ready' ? 'target-ready' : 'preparing',
    }
    placement.state = input.direction === 'return' ? 'returning' : 'moving'
    placement.generation = transfer.generation
    this.transfers.set(transfer.transferId, transfer)
    this.activeTransferByTab.set(input.tabId, transfer.transferId)
    return { ...transfer }
  }

  commitTransfer(transferId: string): TabPlacement {
    const transfer = this.requireTransfer(transferId)
    if (transfer.state === 'committed') return { ...this.requirePlacement(transfer.tabId) }
    if (transfer.state !== 'target-ready') {
      throw new WorkbenchWindowTransitionError(
        'invalid-transfer-state',
        `迁移尚未 target-ready: ${transferId}`,
      )
    }
    const target = this.requireReadyWindow(transfer.targetWindowId)
    const placement = this.requirePlacement(transfer.tabId)
    if (placement.generation !== transfer.generation) {
      throw new WorkbenchWindowTransitionError(
        'stale-generation',
        `迁移 generation 已被替换: ${transferId}`,
      )
    }
    this.removeTabFromWindow(transfer.sourceWindowId, transfer.tabId)
    target.orderedTabIds.push(transfer.tabId)
    placement.windowId = transfer.targetWindowId
    placement.index = target.orderedTabIds.length - 1
    placement.state = 'attached'
    transfer.state = 'committed'
    this.activeTransferByTab.delete(transfer.tabId)
    this.reindexWindow(transfer.sourceWindowId)
    this.reindexWindow(transfer.targetWindowId)
    return { ...placement }
  }

  rollbackTransfer(transferId: string): TabPlacement {
    const transfer = this.requireTransfer(transferId)
    if (transfer.state === 'rolled-back') return { ...this.requirePlacement(transfer.tabId) }
    if (transfer.state === 'committed') {
      throw new WorkbenchWindowTransitionError(
        'invalid-transfer-state',
        `已 commit 的迁移必须创建补偿 transaction: ${transferId}`,
      )
    }
    this.requireReadyWindow(transfer.sourceWindowId)
    const placement = this.requirePlacement(transfer.tabId)
    placement.windowId = transfer.sourceWindowId
    placement.state = 'attached'
    transfer.state = 'rolled-back'
    this.activeTransferByTab.delete(transfer.tabId)
    const source = this.requireWindow(transfer.sourceWindowId)
    if (!source.orderedTabIds.includes(transfer.tabId)) source.orderedTabIds.push(transfer.tabId)
    this.reindexWindow(source.windowId)
    return { ...placement }
  }

  enterRecovery(transferId: string): TabPlacement {
    const transfer = this.requireTransfer(transferId)
    if (transfer.state === 'committed' || transfer.state === 'rolled-back') {
      throw new WorkbenchWindowTransitionError(
        'invalid-transfer-state',
        `终态迁移不能进入 recovery: ${transferId}`,
      )
    }
    const placement = this.requirePlacement(transfer.tabId)
    this.removeTabFromWindow(placement.windowId, placement.tabId)
    placement.windowId = `recovery:${placement.tabId}`
    placement.index = 0
    placement.state = 'recovering'
    transfer.state = 'recovering'
    this.activeTransferByTab.delete(transfer.tabId)
    return { ...placement }
  }

  /** 窗口在已提交迁移后突然失效时，直接把其 placement 收拢到 Recovery Host。 */
  recoverPlacementAfterWindowLoss(tabId: string, failedWindowId: string): TabPlacement {
    const placement = this.requirePlacement(tabId)
    if (placement.windowId !== failedWindowId) {
      throw new WorkbenchWindowTransitionError(
        'invalid-source',
        `失效窗口不再拥有 Tab placement: ${tabId}`,
      )
    }
    const transferId = this.activeTransferByTab.get(tabId)
    if (transferId) {
      const transfer = this.requireTransfer(transferId)
      transfer.state = 'recovering'
      this.activeTransferByTab.delete(tabId)
    }
    this.removeTabFromWindow(failedWindowId, tabId)
    placement.windowId = `recovery:${tabId}`
    placement.index = 0
    placement.state = 'recovering'
    placement.generation += 1
    return { ...placement }
  }

  restoreRecovery(tabId: string, targetWindowId: string): TabPlacement {
    const placement = this.requirePlacement(tabId)
    if (placement.state !== 'recovering' || placement.windowId !== `recovery:${tabId}`) {
      throw new WorkbenchWindowTransitionError(
        'invalid-transfer-state',
        `Tab 不在 recovery: ${tabId}`,
      )
    }
    const target = this.requireReadyWindow(targetWindowId)
    if (!target.orderedTabIds.includes(tabId)) target.orderedTabIds.push(tabId)
    placement.windowId = targetWindowId
    placement.state = 'attached'
    placement.generation += 1
    this.reindexWindow(targetWindowId)
    return { ...placement }
  }

  getWindow(windowId: string): WorkbenchWindowEntry | null {
    const entry = this.windows.get(windowId)
    return entry ? cloneWindow(entry) : null
  }

  getPlacement(tabId: string): TabPlacement | null {
    const placement = this.placements.get(tabId)
    return placement ? { ...placement } : null
  }

  getTransfer(transferId: string): TabTransfer | null {
    const transfer = this.transfers.get(transferId)
    return transfer ? { ...transfer } : null
  }

  getPlacementSnapshot(): TabPlacement[] {
    return [...this.placements.values()].map((placement) => ({ ...placement }))
  }

  /** Release a terminal transaction after its command/fault diagnostic has been emitted. */
  releaseTransfer(transferId: string): void {
    const transfer = this.requireTransfer(transferId)
    if (transfer.state === 'preparing' || transfer.state === 'target-ready') {
      throw new WorkbenchWindowTransitionError(
        'invalid-transfer-state',
        `进行中的迁移不能释放: ${transferId}`,
      )
    }
    if (this.activeTransferByTab.get(transfer.tabId) === transferId) {
      this.activeTransferByTab.delete(transfer.tabId)
    }
    this.transfers.delete(transferId)
  }

  /** Closed auxiliary windows are not retained as an unbounded historical registry. */
  releaseWindow(windowId: string): void {
    const window = this.requireWindow(windowId)
    if (window.state !== 'closed' && window.state !== 'failed') {
      throw new WorkbenchWindowTransitionError(
        'invalid-transfer-state',
        `仍存活的窗口不能释放: ${windowId}`,
      )
    }
    if ([...this.placements.values()].some((placement) => placement.windowId === windowId)) {
      throw new WorkbenchWindowTransitionError(
        'invalid-transfer-state',
        `仍拥有 placement 的窗口不能释放: ${windowId}`,
      )
    }
    this.windows.delete(windowId)
  }

  private requireWindow(windowId: string): WorkbenchWindowEntry {
    const entry = this.windows.get(windowId)
    if (!entry) {
      throw new WorkbenchWindowTransitionError('window-not-found', `窗口不存在: ${windowId}`)
    }
    return entry
  }

  private requireReadyWindow(windowId: string): WorkbenchWindowEntry {
    const entry = this.requireWindow(windowId)
    if (entry.state !== 'ready') {
      throw new WorkbenchWindowTransitionError('window-not-ready', `窗口未就绪: ${windowId}`)
    }
    return entry
  }

  private requirePlacement(tabId: string): TabPlacement {
    const placement = this.placements.get(tabId)
    if (!placement) {
      throw new WorkbenchWindowTransitionError(
        'placement-not-found',
        `Tab placement 不存在: ${tabId}`,
      )
    }
    return placement
  }

  private requireTransfer(transferId: string): TabTransfer {
    const transfer = this.transfers.get(transferId)
    if (!transfer) {
      throw new WorkbenchWindowTransitionError('transfer-not-found', `迁移不存在: ${transferId}`)
    }
    return transfer
  }

  private removeTabFromWindow(windowId: string, tabId: string): void {
    const window = this.windows.get(windowId)
    if (!window) return
    window.orderedTabIds = window.orderedTabIds.filter((id) => id !== tabId)
    this.reindexWindow(windowId)
  }

  private reindexWindow(windowId: string): void {
    const window = this.windows.get(windowId)
    if (!window) return
    window.orderedTabIds.forEach((tabId, index) => {
      const placement = this.placements.get(tabId)
      if (placement?.windowId === windowId) placement.index = index
    })
  }
}

function cloneWindow(entry: WorkbenchWindowEntry): WorkbenchWindowEntry {
  return { ...entry, orderedTabIds: [...entry.orderedTabIds] }
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length
  return Math.min(Math.max(Math.trunc(index), 0), length)
}
