export interface RemoteFileDraftController {
  save(): Promise<boolean>
  discard(): void
}

export interface RemoteFileDraftSnapshot {
  path: string
  content: string
  savedContent: string
  sha256: string
}

const controllers = new Map<string, RemoteFileDraftController>()
const snapshots = new Map<string, RemoteFileDraftSnapshot>()

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
}

export function restoreRemoteFileDraft(tabId: string): RemoteFileDraftSnapshot | undefined {
  return snapshots.get(tabId)
}

export function clearRemoteFileDraft(tabId: string): void {
  snapshots.delete(tabId)
}

export function rebaseRemoteFileDraftPaths(oldPrefix: string, newPrefix: string): void {
  for (const [tabId, snapshot] of snapshots) {
    if (!isPathWithin(snapshot.path, oldPrefix)) continue
    snapshots.set(tabId, {
      ...snapshot,
      path: `${newPrefix}${snapshot.path.slice(oldPrefix.length)}`,
    })
  }
}

export function clearRemoteFileDraftPaths(pathPrefix: string): void {
  for (const [tabId, snapshot] of snapshots) {
    if (isPathWithin(snapshot.path, pathPrefix)) snapshots.delete(tabId)
  }
}

function isPathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`)
}
