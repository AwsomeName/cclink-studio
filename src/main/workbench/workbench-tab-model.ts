import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import {
  workbenchBrowserProjectionSchema,
  workbenchTabDescriptorSchema,
  type WorkbenchBrowserProjection,
  type WorkbenchBrowserStateDelta,
  type WorkbenchBrowserStateSnapshot,
  type WorkbenchTabDelta,
  type WorkbenchTabDescriptor,
  type WorkbenchTabProjection,
} from '../../shared/ipc/workbench-tab-model'

interface WorkspaceTabState {
  workspaceKey: string | null
  ownerKey: string | null
  revision: number
  descriptors: Map<string, WorkbenchTabDescriptor>
  orderedTabIds: string[]
  activeTabId: string | null
}

interface WorkspaceBrowserState {
  workspaceKey: string | null
  ownerKey: string | null
  revision: number
  tabs: Map<string, WorkbenchBrowserProjection>
}

export class WorkbenchTabModelError extends Error {
  constructor(
    readonly code: 'stale-revision' | 'invalid-delta' | 'persist-failed',
    message: string,
  ) {
    super(message)
    this.name = 'WorkbenchTabModelError'
  }
}

/** Main-process owner and sole WorkspaceState writer for logical Tab descriptors. */
export class WorkbenchTabModel {
  private readonly states = new Map<string, WorkspaceTabState>()
  private readonly browserStates = new Map<string, WorkspaceBrowserState>()
  private readonly mutationQueues = new Map<string, Promise<unknown>>()

  constructor(private readonly workspaceStateService: WorkspaceStateService) {}

  getProjection(
    workspaceKey: string | null,
    ownerKey: string | null = null,
  ): Promise<WorkbenchTabProjection> {
    return this.enqueue(workspaceKey, ownerKey, async () =>
      this.toProjection(await this.loadState(workspaceKey, ownerKey)),
    )
  }

  applyDelta(delta: WorkbenchTabDelta): Promise<WorkbenchTabProjection> {
    return this.enqueue(delta.workspaceKey, delta.ownerKey, async () => {
      const current = await this.loadState(delta.workspaceKey, delta.ownerKey)
      if (current.revision !== delta.expectedRevision) {
        throw new WorkbenchTabModelError(
          'stale-revision',
          `Tab revision 已过期，expected=${delta.expectedRevision} actual=${current.revision}`,
        )
      }
      const next = cloneState(current)
      for (const tabId of delta.removedTabIds) next.descriptors.delete(tabId)
      for (const descriptor of delta.upserts) {
        const parsed = workbenchTabDescriptorSchema.parse(descriptor)
        next.descriptors.set(String(parsed.id), parsed)
      }
      this.validateOrder(next.descriptors, delta.orderedTabIds, delta.activeTabId)
      next.orderedTabIds = [...delta.orderedTabIds]
      next.activeTabId = delta.activeTabId
      next.revision += 1

      try {
        await this.workspaceStateService.setSection(
          delta.workspaceKey,
          'tabs',
          {
            tabs: next.orderedTabIds.map((tabId) => next.descriptors.get(tabId)),
            activeTabId: next.activeTabId,
          },
          delta.ownerKey,
        )
      } catch (error) {
        throw new WorkbenchTabModelError(
          'persist-failed',
          `TabModel 持久化失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      this.states.set(stateKey(delta.workspaceKey, delta.ownerKey), next)
      return this.toProjection(next)
    })
  }

  getBrowserProjection(
    workspaceKey: string | null,
    ownerKey: string | null = null,
  ): Promise<WorkbenchBrowserStateSnapshot> {
    return this.enqueue(workspaceKey, ownerKey, async () =>
      this.toBrowserProjection(await this.loadBrowserState(workspaceKey, ownerKey)),
    )
  }

  applyBrowserDelta(delta: WorkbenchBrowserStateDelta): Promise<WorkbenchBrowserStateSnapshot> {
    return this.enqueue(delta.workspaceKey, delta.ownerKey, async () => {
      const current = await this.loadBrowserState(delta.workspaceKey, delta.ownerKey)
      if (current.revision !== delta.expectedRevision) {
        throw new WorkbenchTabModelError(
          'stale-revision',
          `Browser projection revision 已过期，expected=${delta.expectedRevision} actual=${current.revision}`,
        )
      }
      const tabs = new Map(
        [...current.tabs].map(([tabId, projection]) => [tabId, structuredClone(projection)]),
      )
      for (const tabId of delta.removedTabIds) tabs.delete(tabId)
      for (const upsert of delta.upserts) {
        tabs.set(upsert.tabId, workbenchBrowserProjectionSchema.parse(upsert.projection))
      }
      const next: WorkspaceBrowserState = {
        ...current,
        revision: current.revision + 1,
        tabs,
      }
      try {
        await this.workspaceStateService.setSection(
          delta.workspaceKey,
          'browserTabs',
          {
            tabs: Object.fromEntries(
              [...tabs].map(([tabId, projection]) => [tabId, { ...projection, ready: false }]),
            ),
          },
          delta.ownerKey,
        )
      } catch (error) {
        throw new WorkbenchTabModelError(
          'persist-failed',
          `Browser projection 持久化失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      this.browserStates.set(stateKey(delta.workspaceKey, delta.ownerKey), next)
      return this.toBrowserProjection(next)
    })
  }

  invalidate(workspaceKey: string | null, ownerKey: string | null = null): void {
    this.states.delete(stateKey(workspaceKey, ownerKey))
    this.browserStates.delete(stateKey(workspaceKey, ownerKey))
  }

  private async loadState(
    workspaceKey: string | null,
    ownerKey: string | null,
  ): Promise<WorkspaceTabState> {
    const key = stateKey(workspaceKey, ownerKey)
    const existing = this.states.get(key)
    if (existing) return existing
    const snapshot = await this.workspaceStateService.getSnapshot(workspaceKey, ownerKey)
    const section = normalizePersistedTabs(snapshot.sections.tabs)
    const state: WorkspaceTabState = {
      workspaceKey,
      ownerKey,
      revision: 0,
      descriptors: new Map(section.tabs.map((tab) => [String(tab.id), tab])),
      orderedTabIds: section.tabs.map((tab) => String(tab.id)),
      activeTabId: section.activeTabId,
    }
    this.states.set(key, state)
    return state
  }

  private async loadBrowserState(
    workspaceKey: string | null,
    ownerKey: string | null,
  ): Promise<WorkspaceBrowserState> {
    const key = stateKey(workspaceKey, ownerKey)
    const existing = this.browserStates.get(key)
    if (existing) return existing
    const snapshot = await this.workspaceStateService.getSnapshot(workspaceKey, ownerKey)
    const section = normalizePersistedBrowserTabs(snapshot.sections.browserTabs)
    const state: WorkspaceBrowserState = {
      workspaceKey,
      ownerKey,
      revision: 0,
      tabs: new Map(Object.entries(section)),
    }
    this.browserStates.set(key, state)
    return state
  }

  private validateOrder(
    descriptors: Map<string, WorkbenchTabDescriptor>,
    orderedTabIds: string[],
    activeTabId: string | null,
  ): void {
    if (descriptors.size !== orderedTabIds.length) {
      throw new WorkbenchTabModelError(
        'invalid-delta',
        'Tab 顺序必须完整覆盖当前 descriptor，不能产生隐藏或幽灵 Tab',
      )
    }
    for (const tabId of orderedTabIds) {
      if (!descriptors.has(tabId)) {
        throw new WorkbenchTabModelError('invalid-delta', `Tab 顺序引用未知 descriptor: ${tabId}`)
      }
    }
    if (activeTabId !== null && !descriptors.has(activeTabId)) {
      throw new WorkbenchTabModelError('invalid-delta', `activeTabId 不存在: ${activeTabId}`)
    }
  }

  private toProjection(state: WorkspaceTabState): WorkbenchTabProjection {
    return {
      workspaceKey: state.workspaceKey,
      ownerKey: state.ownerKey,
      revision: state.revision,
      tabs: state.orderedTabIds.map((tabId) => structuredClone(state.descriptors.get(tabId)!)),
      activeTabId: state.activeTabId,
    }
  }

  private toBrowserProjection(state: WorkspaceBrowserState): WorkbenchBrowserStateSnapshot {
    return {
      workspaceKey: state.workspaceKey,
      ownerKey: state.ownerKey,
      revision: state.revision,
      tabs: Object.fromEntries(
        [...state.tabs].map(([tabId, projection]) => [tabId, structuredClone(projection)]),
      ),
    }
  }

  private enqueue<T>(
    workspaceKey: string | null,
    ownerKey: string | null,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = stateKey(workspaceKey, ownerKey)
    const previous = this.mutationQueues.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.mutationQueues.set(key, current)
    const release = (): void => {
      if (this.mutationQueues.get(key) === current) this.mutationQueues.delete(key)
    }
    void current.then(release, release)
    return current
  }
}

function normalizePersistedBrowserTabs(value: unknown): Record<string, WorkbenchBrowserProjection> {
  if (!value || typeof value !== 'object') return {}
  const candidate = value as { tabs?: unknown }
  if (!candidate.tabs || typeof candidate.tabs !== 'object') return {}
  return Object.fromEntries(
    Object.entries(candidate.tabs).flatMap(([tabId, projection]) => {
      const parsed = workbenchBrowserProjectionSchema.safeParse(projection)
      return parsed.success ? [[tabId, { ...parsed.data, ready: false }]] : []
    }),
  )
}

function normalizePersistedTabs(value: unknown): {
  tabs: WorkbenchTabDescriptor[]
  activeTabId: string | null
} {
  if (!value || typeof value !== 'object') return { tabs: [], activeTabId: null }
  const candidate = value as { tabs?: unknown; activeTabId?: unknown }
  const tabs = Array.isArray(candidate.tabs)
    ? candidate.tabs.flatMap((tab) => {
        const parsed = workbenchTabDescriptorSchema.safeParse(tab)
        return parsed.success ? [parsed.data] : []
      })
    : []
  const ids = new Set(tabs.map((tab) => String(tab.id)))
  const activeTabId =
    typeof candidate.activeTabId === 'string' && ids.has(candidate.activeTabId)
      ? candidate.activeTabId
      : tabs[0]
        ? String(tabs[0].id)
        : null
  return { tabs, activeTabId }
}

function stateKey(workspaceKey: string | null, ownerKey: string | null): string {
  return JSON.stringify([ownerKey, workspaceKey])
}

function cloneState(state: WorkspaceTabState): WorkspaceTabState {
  return {
    ...state,
    descriptors: new Map(
      [...state.descriptors].map(([tabId, descriptor]) => [tabId, structuredClone(descriptor)]),
    ),
    orderedTabIds: [...state.orderedTabIds],
  }
}
