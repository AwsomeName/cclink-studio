import { create } from 'zustand'
import { getWorkspaceStateOwnerKey, persistWorkspaceSection } from '../utils/workspace-state'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import { workspaceRefKey } from '@shared/workspace-ref'

export interface ProjectStripSnapshot {
  version: 2
  openProjectPaths: string[]
  openRemoteWorkspaceRefs?: RemoteWorkspaceRef[]
  recentRemoteWorkspaceRefs?: RemoteWorkspaceRef[]
}

type DropPlacement = 'before' | 'after'

interface OpenProjectsState {
  openProjectPaths: string[]
  openRemoteWorkspaceRefs: RemoteWorkspaceRef[]
  recentRemoteWorkspaceRefs: RemoteWorkspaceRef[]
  hydrated: boolean
  hydrate: (paths: string[]) => void
  addProject: (path: string) => void
  addRemoteProject: (ref: RemoteWorkspaceRef) => void
  replaceRemoteProject: (current: RemoteWorkspaceRef, confirmed: RemoteWorkspaceRef) => void
  removeRemoteProject: (ref: RemoteWorkspaceRef) => void
  removeProject: (path: string) => void
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
  recentRemoteRefs = useOpenProjectsStore.getState().recentRemoteWorkspaceRefs,
): void {
  const snapshot: ProjectStripSnapshot = {
    version: 2,
    openProjectPaths: paths,
    ...(remoteRefs.length > 0 ? { openRemoteWorkspaceRefs: remoteRefs } : {}),
    ...(recentRemoteRefs.length > 0
      ? { recentRemoteWorkspaceRefs: recentRemoteRefs }
      : {}),
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

export const useOpenProjectsStore = create<OpenProjectsState>((set, get) => ({
  openProjectPaths: [],
  openRemoteWorkspaceRefs: [],
  recentRemoteWorkspaceRefs: [],
  hydrated: false,

  hydrate: (paths) => {
    set({ openProjectPaths: normalizeOpenProjectPaths(paths), hydrated: true })
  },

  addProject: (path) => {
    const normalized = normalizeProjectPath(path)
    if (!normalized || get().openProjectPaths.includes(normalized)) return
    const openProjectPaths = [...get().openProjectPaths, normalized]
    set({ openProjectPaths })
    persistOpenProjects(openProjectPaths)
  },

  addRemoteProject: (ref) => {
    const key = workspaceRefKey(ref)
    const openRemoteWorkspaceRefs = get().openRemoteWorkspaceRefs.some(
      (item) => workspaceRefKey(item) === key,
    )
      ? get().openRemoteWorkspaceRefs
      : [...get().openRemoteWorkspaceRefs, ref]
    const recentRemoteWorkspaceRefs = [
      ref,
      ...get().recentRemoteWorkspaceRefs.filter((item) => workspaceRefKey(item) !== key),
    ]
    set({ openRemoteWorkspaceRefs, recentRemoteWorkspaceRefs })
    persistOpenProjects(
      get().openProjectPaths,
      openRemoteWorkspaceRefs,
      recentRemoteWorkspaceRefs,
    )
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
    const recentRemoteWorkspaceRefs = [
      confirmed,
      ...get().recentRemoteWorkspaceRefs.filter((item) => {
        const key = workspaceRefKey(item)
        return key !== currentKey && key !== confirmedKey
      }),
    ]
    set({ openRemoteWorkspaceRefs, recentRemoteWorkspaceRefs })
    persistOpenProjects(
      get().openProjectPaths,
      openRemoteWorkspaceRefs,
      recentRemoteWorkspaceRefs,
    )
  },

  removeRemoteProject: (ref) => {
    const key = workspaceRefKey(ref)
    const openRemoteWorkspaceRefs = get().openRemoteWorkspaceRefs.filter(
      (item) => workspaceRefKey(item) !== key,
    )
    if (openRemoteWorkspaceRefs.length === get().openRemoteWorkspaceRefs.length) return
    set({ openRemoteWorkspaceRefs })
    persistOpenProjects(
      get().openProjectPaths,
      openRemoteWorkspaceRefs,
      get().recentRemoteWorkspaceRefs,
    )
  },

  removeProject: (path) => {
    const openProjectPaths = get().openProjectPaths.filter((item) => item !== path)
    if (openProjectPaths.length === get().openProjectPaths.length) return
    set({ openProjectPaths })
    persistOpenProjects(openProjectPaths)
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

export async function restoreOpenProjects(currentWorkspacePath: string | null): Promise<void> {
  const snapshot = await window.cclinkStudio.workspaceState.get(null, null).catch(() => null)
  let persistedPaths = readProjectStripSnapshot(snapshot?.sections.projectStrip)
  let persistedRemoteRefs = readRemoteProjectStripSnapshot(snapshot?.sections.projectStrip)
  let persistedRecentRemoteRefs = readRecentRemoteProjectStripSnapshot(
    snapshot?.sections.projectStrip,
  )
  const snapshotVersion = (snapshot?.sections.projectStrip as { version?: unknown } | undefined)
    ?.version
  let migratedLegacySnapshot = false

  // 迁移旧版按本地身份保存的项目列表；迁移后只维护应用级全局副本。
  if (persistedPaths.length === 0) {
    const legacySnapshot = await window.cclinkStudio.workspaceState
      .get(null, getWorkspaceStateOwnerKey())
      .catch(() => null)
    persistedPaths = readProjectStripSnapshot(legacySnapshot?.sections.projectStrip)
    persistedRemoteRefs = readRemoteProjectStripSnapshot(legacySnapshot?.sections.projectStrip)
    persistedRecentRemoteRefs = readRecentRemoteProjectStripSnapshot(
      legacySnapshot?.sections.projectStrip,
    )
    migratedLegacySnapshot = persistedPaths.length > 0 || persistedRemoteRefs.length > 0
  }
  const recentRemoteWorkspaceRefs =
    persistedRecentRemoteRefs.length > 0 ? persistedRecentRemoteRefs : persistedRemoteRefs
  const candidatePaths =
    persistedPaths.length > 0 ? persistedPaths : currentWorkspacePath ? [currentWorkspacePath] : []
  const openProjectPaths = await resolveExistingProjectPaths(candidatePaths)

  if (currentWorkspacePath && !openProjectPaths.includes(currentWorkspacePath)) {
    const resolvedCurrent = await resolveExistingProjectPaths([currentWorkspacePath])
    if (resolvedCurrent[0] && !openProjectPaths.includes(resolvedCurrent[0])) {
      openProjectPaths.push(resolvedCurrent[0])
    }
  }

  useOpenProjectsStore.getState().hydrate(openProjectPaths)
  useOpenProjectsStore.setState({
    openRemoteWorkspaceRefs: persistedRemoteRefs,
    recentRemoteWorkspaceRefs,
  })

  if (
    (migratedLegacySnapshot ||
      snapshotVersion !== 2 ||
      JSON.stringify(openProjectPaths) !== JSON.stringify(persistedPaths)) &&
    (persistedPaths.length > 0 ||
      openProjectPaths.length > 0 ||
      persistedRemoteRefs.length > 0 ||
      recentRemoteWorkspaceRefs.length > 0)
  ) {
    persistOpenProjects(openProjectPaths, persistedRemoteRefs, recentRemoteWorkspaceRefs)
  }
}

export function runOpenProjectsBootstrapOnce(currentWorkspacePath: string | null): Promise<void> {
  if (!openProjectsBootstrapPromise) {
    openProjectsBootstrapPromise = restoreOpenProjects(currentWorkspacePath).catch((error) => {
      openProjectsBootstrapPromise = null
      throw error
    })
  }
  return openProjectsBootstrapPromise
}

export function resetOpenProjectsBootstrapForTests(): void {
  openProjectsBootstrapPromise = null
}
