import type {
  WorkbenchTabDescriptor,
  WorkbenchTabProjection,
} from '@shared/ipc/workbench-tab-model'

interface TabProjectionSnapshotInput {
  workspaceKey: string | null
  ownerKey: string | null
  tabs: unknown[]
  activeTabId: string | null
}

interface TabProjectionSnapshot {
  workspaceKey: string | null
  ownerKey: string | null
  tabs: WorkbenchTabDescriptor[]
  activeTabId: string | null
}

interface PendingSync {
  snapshot: TabProjectionSnapshot
  waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>
}

interface ProjectionQueue {
  running: boolean
  projection: WorkbenchTabProjection | null
  pending: PendingSync | null
  idleWaiters: Array<() => void>
}

const queues = new Map<string, ProjectionQueue>()

export function syncWorkbenchTabProjection(snapshot: TabProjectionSnapshotInput): void {
  void syncWorkbenchTabProjectionNow(snapshot).catch(() => undefined)
}

export function syncWorkbenchTabProjectionNow(snapshot: TabProjectionSnapshotInput): Promise<void> {
  const api = window.cclinkStudio?.workbenchTabs
  if (!api) return Promise.resolve()
  const normalized = normalizeSnapshot(snapshot)
  const key = queueKey(normalized.workspaceKey, normalized.ownerKey)
  const queue = queues.get(key) ?? {
    running: false,
    projection: null,
    pending: null,
    idleWaiters: [],
  }
  queues.set(key, queue)
  const completion = new Promise<void>((resolve, reject) => {
    if (queue.pending) {
      queue.pending.snapshot = normalized
      queue.pending.waiters.push({ resolve, reject })
    } else {
      queue.pending = { snapshot: normalized, waiters: [{ resolve, reject }] }
    }
  })
  if (!queue.running) void drainQueue(key, queue)
  return completion
}

export async function flushPendingWorkbenchTabWrites(): Promise<void> {
  while ([...queues.values()].some((queue) => queue.running || queue.pending)) {
    await Promise.all(
      [...queues.values()].map(
        (queue) =>
          new Promise<void>((resolve) => {
            if (!queue.running && !queue.pending) resolve()
            else queue.idleWaiters.push(resolve)
          }),
      ),
    )
  }
}

async function drainQueue(key: string, queue: ProjectionQueue): Promise<void> {
  queue.running = true
  try {
    while (queue.pending) {
      const pending = queue.pending
      queue.pending = null
      try {
        queue.projection ??= await window.cclinkStudio.workbenchTabs.getProjection({
          workspaceKey: pending.snapshot.workspaceKey,
          ownerKey: pending.snapshot.ownerKey,
        })
        let result = await applySnapshot(queue.projection, pending.snapshot)
        if (!result.success && result.error.code === 'stale-revision') {
          queue.projection = await window.cclinkStudio.workbenchTabs.getProjection({
            workspaceKey: pending.snapshot.workspaceKey,
            ownerKey: pending.snapshot.ownerKey,
          })
          result = await applySnapshot(queue.projection, pending.snapshot)
        }
        if (!result.success) throw new Error(result.error.message)
        queue.projection = result.projection
        for (const waiter of pending.waiters) waiter.resolve()
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error('TabModel 同步失败')
        for (const waiter of pending.waiters) waiter.reject(normalizedError)
      }
    }
  } finally {
    queue.running = false
    if (queue.pending) {
      void drainQueue(key, queue)
    } else {
      if (queues.get(key) === queue) queues.delete(key)
      for (const resolve of queue.idleWaiters.splice(0)) resolve()
    }
  }
}

function applySnapshot(projection: WorkbenchTabProjection, snapshot: TabProjectionSnapshot) {
  const currentById = new Map(projection.tabs.map((tab) => [String(tab.id), tab]))
  const nextById = new Map(snapshot.tabs.map((tab) => [String(tab.id), tab]))
  const upserts = snapshot.tabs.filter((tab) => {
    const current = currentById.get(String(tab.id))
    return !current || JSON.stringify(current) !== JSON.stringify(tab)
  })
  const removedTabIds = projection.tabs
    .map((tab) => String(tab.id))
    .filter((tabId) => !nextById.has(tabId))
  const orderedTabIds = snapshot.tabs.map((tab) => String(tab.id))
  if (
    upserts.length === 0 &&
    removedTabIds.length === 0 &&
    orderedTabIds.join('\0') === projection.tabs.map((tab) => String(tab.id)).join('\0') &&
    snapshot.activeTabId === projection.activeTabId
  ) {
    return Promise.resolve({ success: true as const, projection })
  }
  return window.cclinkStudio.workbenchTabs.applyDelta({
    workspaceKey: snapshot.workspaceKey,
    ownerKey: snapshot.ownerKey,
    expectedRevision: projection.revision,
    upserts,
    removedTabIds,
    orderedTabIds,
    activeTabId: snapshot.activeTabId,
  })
}

function normalizeSnapshot(snapshot: TabProjectionSnapshotInput): TabProjectionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as TabProjectionSnapshot
}

function queueKey(workspaceKey: string | null, ownerKey: string | null): string {
  return JSON.stringify([ownerKey, workspaceKey])
}
