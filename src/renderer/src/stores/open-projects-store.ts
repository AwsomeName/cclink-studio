import { create } from 'zustand'
import { getWorkspaceStateOwnerKey, persistWorkspaceSection } from '../utils/workspace-state'
import type { LocalWorkspaceRef, RemoteWorkspaceRef } from '@shared/workspace-ref'
import { localWorkspaceRef, workspaceRefKey } from '@shared/workspace-ref'

type OpenableWorkspaceRef = LocalWorkspaceRef | RemoteWorkspaceRef
const MAX_RECENT_WORKSPACES = 12

export interface ProjectStripSnapshot {
  version: 3
  openProjectPaths: string[]
  openRemoteWorkspaceRefs?: RemoteWorkspaceRef[]
  recentWorkspaceRefs?: OpenableWorkspaceRef[]
  /** version 2 兼容读取，version 3 不再写入。 */
  recentRemoteWorkspaceRefs?: RemoteWorkspaceRef[]
}

type DropPlacement = 'before' | 'after'

interface OpenProjectsState {
  openProjectPaths: string[]
  openRemoteWorkspaceRefs: RemoteWorkspaceRef[]
  recentWorkspaceRefs: OpenableWorkspaceRef[]
  hydrated: boolean
  hydrate: (paths: string[]) => void
  addProject: (path: string) => void
  addRemoteProject: (ref: RemoteWorkspaceRef) => void
  replaceRemoteProject: (current: RemoteWorkspaceRef, confirmed: RemoteWorkspaceRef) => void
  removeRemoteProject: (ref: RemoteWorkspaceRef) => void
  removeProject: (path: string) => void
  forgetLocalProject: (path: string) => void
  reorderProject: (sourcePath: string, targetPath: string, placement: DropPlacement) => void
}

let openProjectsBootstrapPromise: Promise<void> | null = null

function normalizeProjectPath(path: unknown): string | null {
  if (typeof path !== 'string') return null
  const normalized = path.trim()
  return normalized.length > 0 ? normalized : null
}

export function normalizeOpenProjectPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  const result: string[] = []
  for (const value of paths) {
    const path = normalizeProjectPath(value)
    if (path && !result.includes(path)) result.push(path)
  }
  return result
}

export function reorderOpenProjectPaths(
  paths: string[],
  sourcePath: string,
  targetPath: string,
  placement: DropPlacement,
): string[] {
  if (sourcePath === targetPath) return paths
  const sourceIndex = paths.indexOf(sourcePath)
  const targetIndex = paths.indexOf(targetPath)
  if (sourceIndex < 0 || targetIndex < 0) return paths

  const next = paths.filter((path) => path !== sourcePath)
  const targetIndexAfterRemoval = next.indexOf(targetPath)
  const insertionIndex =
    placement === 'after' ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval
  next.splice(insertionIndex, 0, sourcePath)
  return next
}

export function getProjectCloseSuccessor(paths: string[], closingPath: string): string | null {
  const index = paths.indexOf(closingPath)
  if (index < 0) return null
  return paths[index + 1] ?? paths[index - 1] ?? null
}

function persistOpenProjects(
  paths: string[],
  remoteRefs = useOpenProjectsStore.getState().openRemoteWorkspaceRefs,
  recentRefs = useOpenProjectsStore.getState().recentWorkspaceRefs,
): void {
  const snapshot: ProjectStripSnapshot = {
    version: 3,
    openProjectPaths: paths,
    ...(remoteRefs.length > 0 ? { openRemoteWorkspaceRefs: remoteRefs } : {}),
    ...(recentRefs.length > 0 ? { recentWorkspaceRefs: recentRefs } : {}),
  }
  persistWorkspaceSection('projectStrip', snapshot, null, null)
}

function readProjectStripSnapshot(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const snapshot = value as Partial<ProjectStripSnapshot>
  return normalizeOpenProjectPaths(snapshot.openProjectPaths)
}

function normalizeRemoteWorkspaceRefs(refs: unknown): RemoteWorkspaceRef[] {
  if (!Array.isArray(refs)) return []
  const seen = new Set<string>()
  return refs.filter((ref): ref is RemoteWorkspaceRef => {
    if (!ref || ref.kind !== 'remote' || ref.transport !== 'cclink') return false
    if (
      ![ref.endpointId, ref.workspaceId, ref.path].every(
        (item) => typeof item === 'string' && item.length > 0 && item.length <= 4096,
      )
    )
      return false
    const key = workspaceRefKey(ref)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeRecentWorkspaceRefs(refs: unknown): OpenableWorkspaceRef[] {
  if (!Array.isArray(refs)) return []
  const result: OpenableWorkspaceRef[] = []
  const seen = new Set<string>()
  for (const value of refs) {
    let ref: OpenableWorkspaceRef | null = null
    if (value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'local') {
      const path = normalizeProjectPath((value as { path?: unknown }).path)
      if (path) ref = localWorkspaceRef(path)
    } else {
      ref = normalizeRemoteWorkspaceRefs([value])[0] ?? null
    }
    if (!ref) continue
    const key = workspaceRefKey(ref)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(ref)
    if (result.length >= MAX_RECENT_WORKSPACES) break
  }
  return result
}

function promoteRecentWorkspace(
  recentRefs: OpenableWorkspaceRef[],
  ref: OpenableWorkspaceRef,
): OpenableWorkspaceRef[] {
  const key = workspaceRefKey(ref)
  return [ref, ...recentRefs.filter((item) => workspaceRefKey(item) !== key)].slice(
    0,
    MAX_RECENT_WORKSPACES,
  )
}

function readRemoteProjectStripSnapshot(value: unknown): RemoteWorkspaceRef[] {
  if (!value || typeof value !== 'object') return []
  return normalizeRemoteWorkspaceRefs(
    (value as Partial<ProjectStripSnapshot>).openRemoteWorkspaceRefs,
  )
}

function readRecentRemoteProjectStripSnapshot(value: unknown): RemoteWorkspaceRef[] {
  if (!value || typeof value !== 'object') return []
  return normalizeRemoteWorkspaceRefs(
    (value as Partial<ProjectStripSnapshot>).recentRemoteWorkspaceRefs,
  )
}

function readRecentProjectStripSnapshot(value: unknown): OpenableWorkspaceRef[] {
  if (!value || typeof value !== 'object') return []
  return normalizeRecentWorkspaceRefs((value as Partial<ProjectStripSnapshot>).recentWorkspaceRefs)
}

export const useOpenProjectsStore = create<OpenProjectsState>((set, get) => ({
  openProjectPaths: [],
  openRemoteWorkspaceRefs: [],
  recentWorkspaceRefs: [],
  hydrated: false,

  hydrate: (paths) => {
    set({ openProjectPaths: normalizeOpenProjectPaths(paths), hydrated: true })
  },

  addProject: (path) => {
    const normalized = normalizeProjectPath(path)
    if (!normalized) return
    const openProjectPaths = get().openProjectPaths.includes(normalized)
      ? get().openProjectPaths
      : [...get().openProjectPaths, normalized]
    const recentWorkspaceRefs = promoteRecentWorkspace(
      get().recentWorkspaceRefs,
      localWorkspaceRef(normalized),
    )
    set({ openProjectPaths, recentWorkspaceRefs })
    persistOpenProjects(openProjectPaths, get().openRemoteWorkspaceRefs, recentWorkspaceRefs)
  },

  addRemoteProject: (ref) => {
    const key = workspaceRefKey(ref)
    const openRemoteWorkspaceRefs = get().openRemoteWorkspaceRefs.some(
      (item) => workspaceRefKey(item) === key,
    )
      ? get().openRemoteWorkspaceRefs
      : [...get().openRemoteWorkspaceRefs, ref]
    const recentWorkspaceRefs = promoteRecentWorkspace(get().recentWorkspaceRefs, ref)
    set({ openRemoteWorkspaceRefs, recentWorkspaceRefs })
    persistOpenProjects(get().openProjectPaths, openRemoteWorkspaceRefs, recentWorkspaceRefs)
  },

  replaceRemoteProject: (current, confirmed) => {
    const currentKey = workspaceRefKey(current)
    if (!get().openRemoteWorkspaceRefs.some((item) => workspaceRefKey(item) === currentKey)) return
    const seen = new Set<string>()
    const openRemoteWorkspaceRefs = get().openRemoteWorkspaceRefs.flatMap((item) => {
      const candidate = workspaceRefKey(item) === currentKey ? confirmed : item
      const key = workspaceRefKey(candidate)
      if (!key || seen.has(key)) return []
      seen.add(key)
      return [candidate]
    })
    const confirmedKey = workspaceRefKey(confirmed)
    const recentWorkspaceRefs = [
      confirmed,
      ...get().recentWorkspaceRefs.filter((item) => {
        const key = workspaceRefKey(item)
        return key !== currentKey && key !== confirmedKey
      }),
    ].slice(0, MAX_RECENT_WORKSPACES)
    set({ openRemoteWorkspaceRefs, recentWorkspaceRefs })
    persistOpenProjects(get().openProjectPaths, openRemoteWorkspaceRefs, recentWorkspaceRefs)
  },

  removeRemoteProject: (ref) => {
    const key = workspaceRefKey(ref)
    const openRemoteWorkspaceRefs = get().openRemoteWorkspaceRefs.filter(
      (item) => workspaceRefKey(item) !== key,
    )
    if (openRemoteWorkspaceRefs.length === get().openRemoteWorkspaceRefs.length) return
    set({ openRemoteWorkspaceRefs })
    persistOpenProjects(get().openProjectPaths, openRemoteWorkspaceRefs, get().recentWorkspaceRefs)
  },

  removeProject: (path) => {
    const openProjectPaths = get().openProjectPaths.filter((item) => item !== path)
    if (openProjectPaths.length === get().openProjectPaths.length) return
    set({ openProjectPaths })
    persistOpenProjects(openProjectPaths)
  },

  forgetLocalProject: (path) => {
    const normalized = normalizeProjectPath(path)
    if (!normalized) return
    const openProjectPaths = get().openProjectPaths.filter((item) => item !== normalized)
    const recentWorkspaceRefs = get().recentWorkspaceRefs.filter(
      (item) => item.kind !== 'local' || item.path !== normalized,
    )
    if (
      openProjectPaths.length === get().openProjectPaths.length &&
      recentWorkspaceRefs.length === get().recentWorkspaceRefs.length
    )
      return
    set({ openProjectPaths, recentWorkspaceRefs })
    persistOpenProjects(openProjectPaths, get().openRemoteWorkspaceRefs, recentWorkspaceRefs)
  },

  reorderProject: (sourcePath, targetPath, placement) => {
    const current = get().openProjectPaths
    const openProjectPaths = reorderOpenProjectPaths(current, sourcePath, targetPath, placement)
    if (
      openProjectPaths === current ||
      openProjectPaths.every((path, index) => path === current[index])
    )
      return
    set({ openProjectPaths })
    persistOpenProjects(openProjectPaths)
  },
}))

async function resolveExistingProjectPaths(paths: string[]): Promise<string[]> {
  const resolved = await Promise.all(
    paths.map(async (path) => {
      const result = await window.cclinkStudio.workspaceState
        .resolveLocalWorkspace(path)
        .catch(() => ({ valid: false, workspacePath: null }))
      return result.valid ? result.workspacePath : null
    }),
  )
  return normalizeOpenProjectPaths(resolved)
}

async function resolveRecentWorkspaceRefs(
  refs: OpenableWorkspaceRef[],
): Promise<OpenableWorkspaceRef[]> {
  const resolved = await Promise.all(
    refs.map(async (ref) => {
      if (ref.kind === 'remote') return ref
      const result = await window.cclinkStudio.workspaceState
        .resolveLocalWorkspace(ref.path)
        .catch(() => ({ valid: false, workspacePath: null }))
      return result.valid && result.workspacePath ? localWorkspaceRef(result.workspacePath) : null
    }),
  )
  return normalizeRecentWorkspaceRefs(resolved)
}

export async function restoreOpenProjects(
  currentWorkspacePath: string | null,
  recentLocalPaths: string[] = [],
): Promise<void> {
  const snapshot = await window.cclinkStudio.workspaceState.get(null, null).catch(() => null)
  let persistedPaths = readProjectStripSnapshot(snapshot?.sections.projectStrip)
  let persistedRemoteRefs = readRemoteProjectStripSnapshot(snapshot?.sections.projectStrip)
  let persistedRecentRefs = readRecentProjectStripSnapshot(snapshot?.sections.projectStrip)
  let persistedRecentRemoteRefs = readRecentRemoteProjectStripSnapshot(
    snapshot?.sections.projectStrip,
  )
  let snapshotVersion = (snapshot?.sections.projectStrip as { version?: unknown } | undefined)
    ?.version
  let migratedLegacySnapshot = false

  // 迁移旧版按本地身份保存的项目列表；迁移后只维护应用级全局副本。
  if (
    persistedPaths.length === 0 &&
    persistedRemoteRefs.length === 0 &&
    persistedRecentRefs.length === 0 &&
    persistedRecentRemoteRefs.length === 0
  ) {
    const legacySnapshot = await window.cclinkStudio.workspaceState
      .get(null, getWorkspaceStateOwnerKey())
      .catch(() => null)
    persistedPaths = readProjectStripSnapshot(legacySnapshot?.sections.projectStrip)
    persistedRemoteRefs = readRemoteProjectStripSnapshot(legacySnapshot?.sections.projectStrip)
    persistedRecentRefs = readRecentProjectStripSnapshot(legacySnapshot?.sections.projectStrip)
    persistedRecentRemoteRefs = readRecentRemoteProjectStripSnapshot(
      legacySnapshot?.sections.projectStrip,
    )
    snapshotVersion = (legacySnapshot?.sections.projectStrip as { version?: unknown } | undefined)
      ?.version
    migratedLegacySnapshot =
      persistedPaths.length > 0 ||
      persistedRemoteRefs.length > 0 ||
      persistedRecentRefs.length > 0 ||
      persistedRecentRemoteRefs.length > 0
  }
  const candidatePaths =
    persistedPaths.length > 0 ? persistedPaths : currentWorkspacePath ? [currentWorkspacePath] : []
  const openProjectPaths = await resolveExistingProjectPaths(candidatePaths)

  if (currentWorkspacePath && !openProjectPaths.includes(currentWorkspacePath)) {
    const resolvedCurrent = await resolveExistingProjectPaths([currentWorkspacePath])
    if (resolvedCurrent[0] && !openProjectPaths.includes(resolvedCurrent[0])) {
      openProjectPaths.push(resolvedCurrent[0])
    }
  }

  const migrationRecentRefs = normalizeRecentWorkspaceRefs([
    ...normalizeOpenProjectPaths(
      recentLocalPaths.length > 0 ? recentLocalPaths : persistedPaths,
    ).map(localWorkspaceRef),
    ...(persistedRecentRemoteRefs.length > 0 ? persistedRecentRemoteRefs : persistedRemoteRefs),
  ])
  // The local settings list remains the compatibility/recovery source for
  // installations that predate the unified v3 project-strip snapshot. Merge it
  // before validating paths: a v3 snapshot can contain only stale temporary or
  // deleted paths, and choosing it solely because it is non-empty would hide a
  // still-valid local project from History.
  let recentWorkspaceRefs = await resolveRecentWorkspaceRefs(
    normalizeRecentWorkspaceRefs([...migrationRecentRefs, ...persistedRecentRefs]),
  )
  if (currentWorkspacePath && openProjectPaths.includes(currentWorkspacePath)) {
    recentWorkspaceRefs = promoteRecentWorkspace(
      recentWorkspaceRefs,
      localWorkspaceRef(currentWorkspacePath),
    )
  }

  useOpenProjectsStore.getState().hydrate(openProjectPaths)
  useOpenProjectsStore.setState({
    openRemoteWorkspaceRefs: persistedRemoteRefs,
    recentWorkspaceRefs,
  })

  if (
    (migratedLegacySnapshot ||
      snapshotVersion !== 3 ||
      JSON.stringify(openProjectPaths) !== JSON.stringify(persistedPaths) ||
      JSON.stringify(recentWorkspaceRefs) !== JSON.stringify(persistedRecentRefs)) &&
    (persistedPaths.length > 0 ||
      openProjectPaths.length > 0 ||
      persistedRemoteRefs.length > 0 ||
      recentWorkspaceRefs.length > 0)
  ) {
    persistOpenProjects(openProjectPaths, persistedRemoteRefs, recentWorkspaceRefs)
  }
}

export function runOpenProjectsBootstrapOnce(
  currentWorkspacePath: string | null,
  recentLocalPaths: string[] = [],
): Promise<void> {
  if (!openProjectsBootstrapPromise) {
    openProjectsBootstrapPromise = restoreOpenProjects(
      currentWorkspacePath,
      recentLocalPaths,
    ).catch((error) => {
      openProjectsBootstrapPromise = null
      throw error
    })
  }
  return openProjectsBootstrapPromise
}

export function resetOpenProjectsBootstrapForTests(): void {
  openProjectsBootstrapPromise = null
}
