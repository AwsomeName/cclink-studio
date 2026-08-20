import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import {
  workbenchBrowserBookmarkSchema,
  type WorkbenchBrowserBookmark,
  type WorkbenchBrowserBookmarkSnapshot,
} from '../../shared/ipc/workbench-tab-model'
import { WorkbenchTabModelError } from './workbench-tab-model'

interface BookmarkState {
  workspaceKey: string | null
  ownerKey: string | null
  revision: number
  bookmarks: WorkbenchBrowserBookmark[]
}

/** Main-process semantic owner and writer for workspace Browser bookmarks. */
export class BrowserBookmarkModel {
  private readonly states = new Map<string, BookmarkState>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly workspaceStateService: WorkspaceStateService) {}

  getProjection(
    workspaceKey: string | null,
    ownerKey: string | null = null,
  ): Promise<WorkbenchBrowserBookmarkSnapshot> {
    return this.enqueue(workspaceKey, ownerKey, async () =>
      this.toProjection(await this.load(workspaceKey, ownerKey)),
    )
  }

  replace(input: {
    workspaceKey: string | null
    ownerKey: string | null
    expectedRevision: number
    bookmarks: WorkbenchBrowserBookmark[]
  }): Promise<WorkbenchBrowserBookmarkSnapshot> {
    return this.enqueue(input.workspaceKey, input.ownerKey, async () => {
      const current = await this.load(input.workspaceKey, input.ownerKey)
      if (current.revision !== input.expectedRevision) {
        throw new WorkbenchTabModelError(
          'stale-revision',
          `Bookmark revision 已过期，expected=${input.expectedRevision} actual=${current.revision}`,
        )
      }
      const bookmarks = input.bookmarks.map((bookmark) =>
        workbenchBrowserBookmarkSchema.parse(bookmark),
      )
      if (new Set(bookmarks.map((bookmark) => bookmark.id)).size !== bookmarks.length) {
        throw new WorkbenchTabModelError('invalid-delta', 'Bookmark ID 不能重复')
      }
      try {
        await this.workspaceStateService.setSection(
          input.workspaceKey,
          'browserBookmarks',
          { bookmarks },
          input.ownerKey,
        )
      } catch (error) {
        throw new WorkbenchTabModelError(
          'persist-failed',
          `Bookmark 持久化失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      const next = { ...current, revision: current.revision + 1, bookmarks }
      this.states.set(keyOf(input.workspaceKey, input.ownerKey), next)
      return this.toProjection(next)
    })
  }

  invalidate(workspaceKey: string | null, ownerKey: string | null = null): void {
    this.states.delete(keyOf(workspaceKey, ownerKey))
  }

  private async load(workspaceKey: string | null, ownerKey: string | null): Promise<BookmarkState> {
    const key = keyOf(workspaceKey, ownerKey)
    const existing = this.states.get(key)
    if (existing) return existing
    const snapshot = await this.workspaceStateService.getSnapshot(workspaceKey, ownerKey)
    const current = normalizeBookmarks(snapshot.sections.browserBookmarks)
    const legacy = normalizeBookmarks(snapshot.sections.browserTabs)
    const state: BookmarkState = {
      workspaceKey,
      ownerKey,
      revision: 0,
      bookmarks: current.length > 0 ? current : legacy,
    }
    this.states.set(key, state)
    return state
  }

  private toProjection(state: BookmarkState): WorkbenchBrowserBookmarkSnapshot {
    return {
      workspaceKey: state.workspaceKey,
      ownerKey: state.ownerKey,
      revision: state.revision,
      bookmarks: structuredClone(state.bookmarks),
    }
  }

  private enqueue<T>(
    workspaceKey: string | null,
    ownerKey: string | null,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = keyOf(workspaceKey, ownerKey)
    const previous = this.queues.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.queues.set(key, current)
    const release = (): void => {
      if (this.queues.get(key) === current) this.queues.delete(key)
    }
    void current.then(release, release)
    return current
  }
}

function normalizeBookmarks(value: unknown): WorkbenchBrowserBookmark[] {
  if (!value || typeof value !== 'object') return []
  const raw = (value as { bookmarks?: unknown }).bookmarks
  if (!Array.isArray(raw)) return []
  return raw.flatMap((bookmark) => {
    const parsed = workbenchBrowserBookmarkSchema.safeParse(bookmark)
    return parsed.success ? [parsed.data] : []
  })
}

function keyOf(workspaceKey: string | null, ownerKey: string | null): string {
  return JSON.stringify([ownerKey, workspaceKey])
}
