import { create } from 'zustand'
import { getWorkspaceStateOwnerKey, persistWorkspaceSection } from '../utils/workspace-state'

export interface ProjectStripSnapshot {
  version: 1
  openProjectPaths: string[]
}

type DropPlacement = 'before' | 'after'

interface OpenProjectsState {
  openProjectPaths: string[]
  hydrated: boolean
  hydrate: (paths: string[]) => void
  addProject: (path: string) => void
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

function persistOpenProjects(paths: string[]): void {
  const snapshot: ProjectStripSnapshot = {
    version: 1,
    openProjectPaths: paths,
  }
  persistWorkspaceSection('projectStrip', snapshot, null, null)
}

function readProjectStripSnapshot(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const snapshot = value as Partial<ProjectStripSnapshot>
  return normalizeOpenProjectPaths(snapshot.openProjectPaths)
}

export const useOpenProjectsStore = create<OpenProjectsState>((set, get) => ({
  openProjectPaths: [],
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
  let migratedLegacySnapshot = false

  // 迁移旧版按本地身份保存的项目列表；迁移后只维护应用级全局副本。
  if (persistedPaths.length === 0) {
    const legacySnapshot = await window.cclinkStudio.workspaceState
      .get(null, getWorkspaceStateOwnerKey())
      .catch(() => null)
    persistedPaths = readProjectStripSnapshot(legacySnapshot?.sections.projectStrip)
    migratedLegacySnapshot = persistedPaths.length > 0
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

  useOpenProjectsStore.getState().hydrate(openProjectPaths)

  if (
    (migratedLegacySnapshot ||
      JSON.stringify(openProjectPaths) !== JSON.stringify(persistedPaths)) &&
    (persistedPaths.length > 0 || openProjectPaths.length > 0)
  ) {
    persistOpenProjects(openProjectPaths)
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
