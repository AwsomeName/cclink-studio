import type {
  WorkbenchBrowserBookmark,
  WorkbenchBrowserBookmarkSnapshot,
  WorkbenchBrowserProjection,
  WorkbenchBrowserStateSnapshot,
} from '@shared/ipc/workbench-tab-model'

interface BrowserSyncInput {
  workspaceKey: string | null
  ownerKey: string | null
  tabs: Record<string, unknown>
}

interface BookmarkSyncInput {
  workspaceKey: string | null
  ownerKey: string | null
  bookmarks: unknown[]
}

interface Queue<TInput, TProjection> {
  running: boolean
  projection: TProjection | null
  pending: { input: TInput; waiters: Waiter[] } | null
  idleWaiters: Array<() => void>
}

interface Waiter {
  resolve: () => void
  reject: (error: Error) => void
}

const browserQueues = new Map<string, Queue<BrowserSyncInput, WorkbenchBrowserStateSnapshot>>()
const bookmarkQueues = new Map<string, Queue<BookmarkSyncInput, WorkbenchBrowserBookmarkSnapshot>>()

export function syncWorkbenchBrowserState(input: BrowserSyncInput): void {
  void syncWorkbenchBrowserStateNow(input).catch(() => undefined)
}

export function syncWorkbenchBrowserStateNow(input: BrowserSyncInput): Promise<void> {
  if (!window.cclinkStudio?.workbenchTabs) return Promise.resolve()
  const normalized = normalize<BrowserSyncInput>(input)
  return enqueue(browserQueues, normalized, drainBrowserQueue)
}

export function syncWorkbenchBookmarks(input: BookmarkSyncInput): void {
  void syncWorkbenchBookmarksNow(input).catch(() => undefined)
}

export function syncWorkbenchBookmarksNow(input: BookmarkSyncInput): Promise<void> {
  if (!window.cclinkStudio?.workbenchTabs) return Promise.resolve()
  const normalized = normalize<BookmarkSyncInput>(input)
  return enqueue(bookmarkQueues, normalized, drainBookmarkQueue)
}

export async function flushPendingWorkbenchBrowserWrites(): Promise<void> {
  await Promise.all([flushQueues(browserQueues), flushQueues(bookmarkQueues)])
}

function enqueue<
  TInput extends { workspaceKey: string | null; ownerKey: string | null },
  TProjection,
>(
  queues: Map<string, Queue<TInput, TProjection>>,
  input: TInput,
  drain: (key: string, queue: Queue<TInput, TProjection>) => Promise<void>,
): Promise<void> {
  const key = queueKey(input.workspaceKey, input.ownerKey)
  const queue = queues.get(key) ?? {
    running: false,
    projection: null,
    pending: null,
    idleWaiters: [],
  }
  queues.set(key, queue)
  const completion = new Promise<void>((resolve, reject) => {
    if (queue.pending) {
      queue.pending.input = input
      queue.pending.waiters.push({ resolve, reject })
    } else {
      queue.pending = { input, waiters: [{ resolve, reject }] }
    }
  })
  if (!queue.running) void drain(key, queue)
  return completion
}

async function drainBrowserQueue(
  key: string,
  queue: Queue<BrowserSyncInput, WorkbenchBrowserStateSnapshot>,
): Promise<void> {
  queue.running = true
  try {
    while (queue.pending) {
      const pending = queue.pending
      queue.pending = null
      try {
        queue.projection ??= await window.cclinkStudio.workbenchTabs.getBrowserProjection({
          workspaceKey: pending.input.workspaceKey,
          ownerKey: pending.input.ownerKey,
        })
        let result = await applyBrowserInput(queue.projection, pending.input)
        if (!result.success && result.error.code === 'stale-revision') {
          queue.projection = await window.cclinkStudio.workbenchTabs.getBrowserProjection({
            workspaceKey: pending.input.workspaceKey,
            ownerKey: pending.input.ownerKey,
          })
          result = await applyBrowserInput(queue.projection, pending.input)
        }
        if (!result.success) throw new Error(result.error.message)
        queue.projection = result.projection
        pending.waiters.forEach((waiter) => waiter.resolve())
      } catch (error) {
        rejectWaiters(pending.waiters, error, 'Browser projection 同步失败')
      }
    }
  } finally {
    finishQueue(browserQueues, key, queue, drainBrowserQueue)
  }
}

async function drainBookmarkQueue(
  key: string,
  queue: Queue<BookmarkSyncInput, WorkbenchBrowserBookmarkSnapshot>,
): Promise<void> {
  queue.running = true
  try {
    while (queue.pending) {
      const pending = queue.pending
      queue.pending = null
      try {
        queue.projection ??= await window.cclinkStudio.workbenchTabs.getBookmarks({
          workspaceKey: pending.input.workspaceKey,
          ownerKey: pending.input.ownerKey,
        })
        let result = await applyBookmarkInput(queue.projection, pending.input)
        if (!result.success && result.error.code === 'stale-revision') {
          queue.projection = await window.cclinkStudio.workbenchTabs.getBookmarks({
            workspaceKey: pending.input.workspaceKey,
            ownerKey: pending.input.ownerKey,
          })
          result = await applyBookmarkInput(queue.projection, pending.input)
        }
        if (!result.success) throw new Error(result.error.message)
        queue.projection = result.projection
        pending.waiters.forEach((waiter) => waiter.resolve())
      } catch (error) {
        rejectWaiters(pending.waiters, error, 'Bookmark 同步失败')
      }
    }
  } finally {
    finishQueue(bookmarkQueues, key, queue, drainBookmarkQueue)
  }
}

function applyBrowserInput(projection: WorkbenchBrowserStateSnapshot, input: BrowserSyncInput) {
  const tabs = input.tabs as Record<string, WorkbenchBrowserProjection>
  const upserts = Object.entries(tabs).flatMap(([tabId, candidate]) => {
    const current = projection.tabs[tabId]
    return current && JSON.stringify(current) === JSON.stringify(candidate)
      ? []
      : [{ tabId, projection: { ...candidate, ready: false } }]
  })
  const removedTabIds = Object.keys(projection.tabs).filter((tabId) => !(tabId in tabs))
  if (upserts.length === 0 && removedTabIds.length === 0) {
    return Promise.resolve({ success: true as const, projection })
  }
  return window.cclinkStudio.workbenchTabs.applyBrowserDelta({
    workspaceKey: input.workspaceKey,
    ownerKey: input.ownerKey,
    expectedRevision: projection.revision,
    upserts,
    removedTabIds,
  })
}

function applyBookmarkInput(
  projection: WorkbenchBrowserBookmarkSnapshot,
  input: BookmarkSyncInput,
) {
  const bookmarks = input.bookmarks as WorkbenchBrowserBookmark[]
  if (JSON.stringify(bookmarks) === JSON.stringify(projection.bookmarks)) {
    return Promise.resolve({ success: true as const, projection })
  }
  return window.cclinkStudio.workbenchTabs.replaceBookmarks({
    workspaceKey: input.workspaceKey,
    ownerKey: input.ownerKey,
    expectedRevision: projection.revision,
    bookmarks,
  })
}

function finishQueue<TInput, TProjection>(
  queues: Map<string, Queue<TInput, TProjection>>,
  key: string,
  queue: Queue<TInput, TProjection>,
  drain: (key: string, queue: Queue<TInput, TProjection>) => Promise<void>,
): void {
  queue.running = false
  if (queue.pending) {
    void drain(key, queue)
    return
  }
  if (queues.get(key) === queue) queues.delete(key)
  queue.idleWaiters.splice(0).forEach((resolve) => resolve())
}

async function flushQueues<TInput, TProjection>(
  queues: Map<string, Queue<TInput, TProjection>>,
): Promise<void> {
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

function rejectWaiters(waiters: Waiter[], error: unknown, fallback: string): void {
  const normalized = error instanceof Error ? error : new Error(fallback)
  waiters.forEach((waiter) => waiter.reject(normalized))
}

function normalize<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T
}

function queueKey(workspaceKey: string | null, ownerKey: string | null): string {
  return JSON.stringify([ownerKey, workspaceKey])
}
