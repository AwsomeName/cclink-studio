import type { RemoteWorkspaceRef } from '@shared/workspace-ref'

export interface RemoteFileDraftController {
  save(): Promise<boolean>
  discard(): void
}

export interface RemoteFileDraftSnapshot {
  ref: RemoteWorkspaceRef
  path: string
  content: string
  savedContent: string
  sha256: string
}

const controllers = new Map<string, RemoteFileDraftController>()
const snapshots = new Map<string, RemoteFileDraftSnapshot>()
const persistenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function registerRemoteFileDraft(
  tabId: string,
  controller: RemoteFileDraftController,
): () => void {
  controllers.set(tabId, controller)
  return () => {
    if (controllers.get(tabId) === controller) controllers.delete(tabId)
  }
}

export function getRemoteFileDraft(tabId: string): RemoteFileDraftController | undefined {
  return controllers.get(tabId)
}

export function rememberRemoteFileDraft(tabId: string, snapshot: RemoteFileDraftSnapshot): void {
  snapshots.set(tabId, snapshot)
  const currentTimer = persistenceTimers.get(tabId)
  if (currentTimer) clearTimeout(currentTimer)
  persistenceTimers.set(
    tabId,
    setTimeout(() => {
      persistenceTimers.delete(tabId)
      void window.cclinkStudio.remote
        .saveDraft({ ...snapshot, updatedAt: Date.now() })
        .catch((error: unknown) => console.error('[RemoteDraftPersistence] save failed', error))
    }, 150),
  )
}

export async function flushRemoteFileDrafts(): Promise<void> {
  for (const timer of persistenceTimers.values()) clearTimeout(timer)
  persistenceTimers.clear()
  await Promise.all(
    [...snapshots.values()].map((snapshot) =>
      window.cclinkStudio.remote.saveDraft({ ...snapshot, updatedAt: Date.now() }),
    ),
  )
}

export async function restoreRemoteFileDraft(
  tabId: string,
  ref: RemoteWorkspaceRef,
  path: string,
): Promise<RemoteFileDraftSnapshot | undefined> {
  const memory = snapshots.get(tabId)
  if (memory && sameWorkspace(memory.ref, ref) && memory.path === path) return memory
  const persisted = await window.cclinkStudio.remote.getDraft({ ref, path })
  if (!persisted) return undefined
  const snapshot: RemoteFileDraftSnapshot = {
    ref: persisted.ref,
    path: persisted.path,
    content: persisted.content,
    savedContent: persisted.savedContent,
    sha256: persisted.sha256,
  }
  snapshots.set(tabId, snapshot)
  return snapshot
}

export function clearRemoteFileDraft(tabId: string): void {
  const timer = persistenceTimers.get(tabId)
  if (timer) clearTimeout(timer)
  persistenceTimers.delete(tabId)
  const snapshot = snapshots.get(tabId)
  snapshots.delete(tabId)
  if (snapshot) {
    void window.cclinkStudio.remote.deleteDraft({ ref: snapshot.ref, path: snapshot.path })
  }
}

export function rebaseRemoteFileDraftPaths(
  ref: RemoteWorkspaceRef,
  oldPrefix: string,
  newPrefix: string,
): void {
  for (const [tabId, snapshot] of snapshots) {
    if (!sameWorkspace(snapshot.ref, ref) || !isPathWithin(snapshot.path, oldPrefix)) continue
    snapshots.set(tabId, {
      ...snapshot,
      path: `${newPrefix}${snapshot.path.slice(oldPrefix.length)}`,
    })
  }
  void window.cclinkStudio.remote.rebaseDraftPrefix({ ref, oldPrefix, newPrefix })
}

export function clearRemoteFileDraftPaths(ref: RemoteWorkspaceRef, pathPrefix: string): void {
  for (const [tabId, snapshot] of snapshots) {
    if (sameWorkspace(snapshot.ref, ref) && isPathWithin(snapshot.path, pathPrefix)) {
      snapshots.delete(tabId)
    }
  }
  void window.cclinkStudio.remote.deleteDraftPrefix({ ref, pathPrefix })
}

function sameWorkspace(left: RemoteWorkspaceRef, right: RemoteWorkspaceRef): boolean {
  return (
    left.transport === right.transport &&
    left.endpointId === right.endpointId &&
    left.workspaceId === right.workspaceId &&
    left.path === right.path
  )
}

function isPathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`)
}
