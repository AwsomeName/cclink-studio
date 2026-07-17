import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'path'
import type {
  WorkspaceStateDiagnostics,
  WorkspaceStateLocalWorkspaceSummary,
  WorkspaceStateResolveResult,
  WorkspaceStateSnapshot,
} from '../../shared/ipc/workspace-state'
import { getUserDataPathDiagnostics } from '../runtime/user-data-path'

interface WorkspaceStateIndexEntry extends WorkspaceStateLocalWorkspaceSummary {
  storage: 'project' | 'fallback'
  projectId: string | null
}

interface WorkspaceStateFile {
  version: number
  /** 全局/非本地状态，以及只读项目的 fallback。 */
  workspaces: Record<string, WorkspaceStateSnapshot>
  /** 本地项目只保留定位索引，不保存项目现场。 */
  localWorkspaces: Record<string, WorkspaceStateIndexEntry>
}

interface ProjectManifest {
  version: 1
  projectId: string
  createdAt: number
  forkedFromProjectId?: string
}

interface ProjectWorkspaceStateFile {
  version: 1
  projectId: string
  snapshot: WorkspaceStateSnapshot
}

interface ProjectContext {
  workspacePath: string
  projectId: string | null
  writable: boolean
  ignoredProjectId?: string
}

type FileReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'invalid'; error: unknown }
  | { status: 'unavailable'; error: unknown }

const CURRENT_FILE_VERSION = 2
const PROJECT_FILE_VERSION = 1
const GLOBAL_WORKSPACE_ID = 'global'
const PROJECT_METADATA_DIR = '.cclink-studio'
const PROJECT_MANIFEST_FILE = 'project.json'
const PROJECT_STATE_DIR = 'state'
const INDEX_TOUCH_INTERVAL_MS = 5_000

type FileMigrator = (input: unknown) => WorkspaceStateFile
const FILE_MIGRATIONS: Partial<Record<number, FileMigrator>> = {
  1: (raw) => {
    const input = (raw ?? {}) as Partial<WorkspaceStateFile>
    return {
      version: 2,
      workspaces: typeof input.workspaces === 'object' && input.workspaces ? input.workspaces : {},
      localWorkspaces: {},
    }
  },
}

function migrateWorkspaceStateFile(raw: unknown): WorkspaceStateFile {
  const input = (raw ?? {}) as Partial<WorkspaceStateFile>
  let version = typeof input.version === 'number' ? input.version : 1
  let current: unknown = input

  while (version < CURRENT_FILE_VERSION) {
    const migrator = FILE_MIGRATIONS[version]
    if (!migrator) break
    current = migrator(current)
    version = (current as WorkspaceStateFile).version
  }

  const file = current as Partial<WorkspaceStateFile>
  return {
    version,
    workspaces: typeof file.workspaces === 'object' && file.workspaces ? file.workspaces : {},
    localWorkspaces:
      typeof file.localWorkspaces === 'object' && file.localWorkspaces ? file.localWorkspaces : {},
  }
}

function removeLegacyGlobalBrowserRestores(file: WorkspaceStateFile): boolean {
  let changed = false

  for (const snapshot of Object.values(file.workspaces)) {
    const tabsSection = snapshot.sections.tabs
    if (!tabsSection || typeof tabsSection !== 'object') continue
    const parsedTabs = tabsSection as { tabs?: unknown[]; activeTabId?: unknown }
    if (!Array.isArray(parsedTabs.tabs)) continue

    const legacyIds = new Set(
      parsedTabs.tabs.flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const tab = value as {
          id?: unknown
          type?: unknown
          title?: unknown
          initialUrl?: unknown
          restore?: unknown
        }
        return tab.type === 'browser' &&
          tab.title === '恢复的页面' &&
          typeof tab.id === 'string' &&
          typeof tab.initialUrl === 'string' &&
          tab.restore &&
          typeof tab.restore === 'object'
          ? [tab.id]
          : []
      }),
    )
    if (legacyIds.size === 0) continue

    const tabs = parsedTabs.tabs.filter((value) => {
      if (!value || typeof value !== 'object') return true
      return !legacyIds.has(String((value as { id?: unknown }).id ?? ''))
    })
    snapshot.sections.tabs = {
      ...parsedTabs,
      tabs,
      activeTabId:
        typeof parsedTabs.activeTabId === 'string' && legacyIds.has(parsedTabs.activeTabId)
          ? ((tabs[0] as { id?: string } | undefined)?.id ?? null)
          : (parsedTabs.activeTabId ?? null),
    }

    const browserTabsSection = snapshot.sections.browserTabs
    if (browserTabsSection && typeof browserTabsSection === 'object') {
      const parsedBrowserTabs = browserTabsSection as { tabs?: Record<string, unknown> }
      if (parsedBrowserTabs.tabs && typeof parsedBrowserTabs.tabs === 'object') {
        const browserTabs = { ...parsedBrowserTabs.tabs }
        for (const id of legacyIds) delete browserTabs[id]
        snapshot.sections.browserTabs = { ...parsedBrowserTabs, tabs: browserTabs }
      }
    }
    changed = true
  }

  return changed
}

function getWorkspaceId(workspaceKey?: string | null, ownerKey?: string | null): string {
  if (!workspaceKey && !ownerKey) return GLOBAL_WORKSPACE_ID
  return createHash('sha256')
    .update(`${ownerKey}\0${workspaceKey || GLOBAL_WORKSPACE_ID}`)
    .digest('hex')
    .slice(0, 16)
}

function getOwnerStateFileName(ownerKey?: string | null): string {
  if (!ownerKey) return 'unowned.json'
  return `${createHash('sha256').update(ownerKey).digest('hex').slice(0, 16)}.json`
}

function createEmptySnapshot(
  workspaceKey?: string | null,
  ownerKey?: string | null,
): WorkspaceStateSnapshot {
  return {
    version: 1,
    workspaceId: getWorkspaceId(workspaceKey, ownerKey),
    ownerKey: ownerKey || null,
    workspaceKey: workspaceKey || null,
    workspacePath: workspaceKey || null,
    updatedAt: Date.now(),
    sections: {},
  }
}

function normalizeSnapshot(
  snapshot: WorkspaceStateSnapshot,
  ownerKey?: string | null,
  workspaceKeyOverride?: string | null,
): WorkspaceStateSnapshot {
  const workspaceKey = snapshot.workspaceKey ?? snapshot.workspacePath ?? null
  return {
    ...snapshot,
    workspaceId: getWorkspaceId(
      workspaceKeyOverride ?? workspaceKey,
      ownerKey ?? snapshot.ownerKey,
    ),
    ownerKey: ownerKey ?? snapshot.ownerKey ?? null,
    workspaceKey: workspaceKeyOverride ?? workspaceKey,
    workspacePath: workspaceKeyOverride ?? snapshot.workspacePath ?? workspaceKey,
    sections: { ...snapshot.sections },
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

/** 项目现场以项目目录为事实源；userData 只保留全局状态、项目索引和只读 fallback。 */
export class WorkspaceStateService {
  private readonly stateFilePath: string
  private readonly backupFilePath: string
  private readonly tempFilePath: string
  private state: WorkspaceStateFile = {
    version: CURRENT_FILE_VERSION,
    workspaces: {},
    localWorkspaces: {},
  }
  private stateLoadError: Error | null = null
  private saveQueue: Promise<void> = Promise.resolve()
  private readonly workspaceQueues = new Map<string, Promise<unknown>>()
  private readonly pendingOperations = new Set<Promise<unknown>>()

  constructor() {
    this.stateFilePath = join(app.getPath('userData'), 'workspace-state.json')
    this.backupFilePath = `${this.stateFilePath}.bak`
    this.tempFilePath = `${this.stateFilePath}.${process.pid}.tmp`
  }

  async loadState(): Promise<void> {
    this.stateLoadError = null
    try {
      this.state = await this.readStateFile(this.stateFilePath)
      if (removeLegacyGlobalBrowserRestores(this.state)) await this.saveState()
      console.log('[WorkspaceStateService] 工作台状态索引已加载')
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        this.state = {
          version: CURRENT_FILE_VERSION,
          workspaces: {},
          localWorkspaces: {},
        }
        return
      }

      console.warn('[WorkspaceStateService] 工作台状态索引读取失败，尝试备份:', error)
      try {
        this.state = await this.readStateFile(this.backupFilePath)
        if (removeLegacyGlobalBrowserRestores(this.state)) await this.saveState()
      } catch (backupError: unknown) {
        if (!isMissingFileError(backupError)) {
          console.warn('[WorkspaceStateService] 工作台状态备份读取失败:', backupError)
        }
        this.state = {
          version: CURRENT_FILE_VERSION,
          workspaces: {},
          localWorkspaces: {},
        }
        this.stateLoadError = new Error('工作台状态索引及备份均不可读取', {
          cause: backupError,
        })
      }
    }
  }

  async resolveLocalWorkspace(workspacePath: string): Promise<WorkspaceStateResolveResult> {
    try {
      const resolvedPath = await this.resolveLocalWorkspacePath(workspacePath)
      return { valid: true, workspacePath: resolvedPath }
    } catch (error: unknown) {
      return {
        valid: false,
        workspacePath: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getSnapshot(
    workspaceKey?: string | null,
    ownerKey?: string | null,
  ): Promise<WorkspaceStateSnapshot> {
    if (!workspaceKey || !isAbsolute(workspaceKey)) {
      this.assertCentralStateAvailable()
      return this.getCentralSnapshot(workspaceKey, ownerKey)
    }

    const workspacePath = await this.resolveLocalWorkspacePath(workspaceKey)

    await this.workspaceQueues.get(getWorkspaceId(workspacePath, ownerKey))?.catch(() => {})
    return this.getLocalSnapshot(workspacePath, ownerKey, workspaceKey)
  }

  async setSection(
    workspaceKey: string | null | undefined,
    section: string,
    value: unknown,
    ownerKey?: string | null,
  ): Promise<WorkspaceStateSnapshot> {
    if (!workspaceKey || !isAbsolute(workspaceKey)) {
      this.assertCentralStateAvailable()
      return this.trackOperation(
        this.enqueueWorkspaceMutation(getWorkspaceId(workspaceKey, ownerKey), async () => {
          const current = this.getCentralSnapshot(workspaceKey, ownerKey)
          const next = this.withSection(current, workspaceKey, ownerKey, section, value)
          this.state.workspaces[next.workspaceId] = next
          await this.saveState()
          return next
        }),
      )
    }

    const inputQueueKey = `input:${getWorkspaceId(workspaceKey, ownerKey)}`
    const operation = this.enqueueWorkspaceMutation(inputQueueKey, async () => {
      const workspacePath = await this.resolveLocalWorkspacePath(workspaceKey)
      return this.enqueueWorkspaceMutation(getWorkspaceId(workspacePath, ownerKey), async () => {
        const current = await this.getLocalSnapshot(workspacePath, ownerKey, workspaceKey)
        const next = this.withSection(current, workspacePath, ownerKey, section, value)
        await this.persistLocalSnapshot(workspacePath, ownerKey, next)
        return next
      })
    })
    return this.trackOperation(operation)
  }

  async clear(workspaceKey?: string | null, ownerKey?: string | null): Promise<void> {
    if (!workspaceKey || !isAbsolute(workspaceKey)) {
      this.assertCentralStateAvailable()
      await this.trackOperation(
        this.enqueueWorkspaceMutation(getWorkspaceId(workspaceKey, ownerKey), async () => {
          delete this.state.workspaces[getWorkspaceId(workspaceKey, ownerKey)]
          await this.saveState()
        }),
      )
      return
    }

    const operation = (async (): Promise<void> => {
      const workspacePath = await this.resolveLocalWorkspacePath(workspaceKey)
      await this.enqueueWorkspaceMutation(getWorkspaceId(workspacePath, ownerKey), async () => {
        const context = await this.ensureProjectContext(workspacePath)
        if (context.projectId) {
          const stateFilePath = this.getProjectStateFilePath(workspacePath, ownerKey)
          await Promise.all([
            rm(stateFilePath, { force: true }),
            rm(`${stateFilePath}.bak`, { force: true }),
          ])
        }
        delete this.state.workspaces[getWorkspaceId(workspacePath, ownerKey)]
        delete this.state.workspaces[getWorkspaceId(workspaceKey, ownerKey)]
        this.recordLocalWorkspace(
          workspacePath,
          ownerKey,
          Date.now(),
          context.writable ? 'project' : 'fallback',
          context.projectId,
        )
        await this.saveState()
      })
    })()
    await this.trackOperation(operation)
  }

  async flush(): Promise<void> {
    while (this.pendingOperations.size > 0) {
      await Promise.all(
        Array.from(this.pendingOperations.values()).map((operation) => operation.catch(() => {})),
      )
    }
    await Promise.all(
      Array.from(this.workspaceQueues.values()).map((queue) => queue.catch(() => {})),
    )
    await this.saveQueue
  }

  listLocalWorkspaces(ownerKey?: string | null): WorkspaceStateLocalWorkspaceSummary[] {
    const normalizedOwnerKey = ownerKey || null
    const byPath = new Map<string, WorkspaceStateLocalWorkspaceSummary>()

    const add = (entry: WorkspaceStateLocalWorkspaceSummary): void => {
      if (entry.ownerKey !== normalizedOwnerKey && entry.ownerKey !== null) return
      const current = byPath.get(entry.workspacePath)
      if (
        !current ||
        (current.ownerKey !== normalizedOwnerKey && entry.ownerKey === normalizedOwnerKey) ||
        entry.updatedAt > current.updatedAt
      ) {
        byPath.set(entry.workspacePath, entry)
      }
    }

    Object.values(this.state.localWorkspaces).forEach(add)

    for (const snapshot of Object.values(this.state.workspaces)) {
      const workspacePath = snapshot.workspacePath ?? snapshot.workspaceKey
      if (!workspacePath || !isAbsolute(workspacePath)) continue
      add({
        workspaceKey: workspacePath,
        workspacePath,
        ownerKey: snapshot.ownerKey ?? null,
        updatedAt: snapshot.updatedAt,
        storage: 'fallback',
        projectId: null,
      })
    }

    return Array.from(byPath.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getDiagnostics(): WorkspaceStateDiagnostics {
    const workspaceIds = new Set([
      ...Object.keys(this.state.workspaces),
      ...Object.keys(this.state.localWorkspaces),
    ])
    return {
      userDataPath: app.getPath('userData'),
      stateFilePath: this.stateFilePath,
      backupFilePath: this.backupFilePath,
      workspaceCount: workspaceIds.size,
      fileVersion: this.state.version,
      userData: getUserDataPathDiagnostics(),
    }
  }

  private getCentralSnapshot(
    workspaceKey?: string | null,
    ownerKey?: string | null,
  ): WorkspaceStateSnapshot {
    const snapshot = this.state.workspaces[getWorkspaceId(workspaceKey, ownerKey)]
    if (snapshot) return normalizeSnapshot(snapshot, ownerKey, workspaceKey)
    return createEmptySnapshot(workspaceKey, ownerKey)
  }

  private async getLocalSnapshot(
    workspacePath: string,
    ownerKey?: string | null,
    legacyWorkspaceKey?: string,
  ): Promise<WorkspaceStateSnapshot> {
    const context = await this.ensureProjectContext(workspacePath)
    if (context.projectId) {
      const projectSnapshot = await this.readProjectSnapshot(workspacePath, ownerKey, context)
      if (projectSnapshot) {
        const normalized = normalizeSnapshot(projectSnapshot, ownerKey, workspacePath)
        const changed = this.recordLocalWorkspace(
          workspacePath,
          ownerKey,
          normalized.updatedAt,
          'project',
          context.projectId,
        )
        if (changed) await this.saveState()
        return normalized
      }
    }
    if (!context.projectId) this.assertCentralStateAvailable()

    const canonicalId = getWorkspaceId(workspacePath, ownerKey)
    const legacyId = getWorkspaceId(legacyWorkspaceKey ?? workspacePath, ownerKey)
    const legacy = this.state.workspaces[canonicalId] ?? this.state.workspaces[legacyId]
    if (legacy) {
      const normalized = normalizeSnapshot(legacy, ownerKey, workspacePath)
      if (context.projectId && context.writable) {
        try {
          await this.writeProjectSnapshot(workspacePath, ownerKey, context.projectId, normalized)
          delete this.state.workspaces[canonicalId]
          delete this.state.workspaces[legacyId]
          this.recordLocalWorkspace(
            workspacePath,
            ownerKey,
            normalized.updatedAt,
            'project',
            context.projectId,
          )
          await this.saveState()
          return normalized
        } catch (error: unknown) {
          console.warn('[WorkspaceStateService] 项目状态迁移失败，使用 fallback:', error)
        }
      }

      this.state.workspaces[canonicalId] = normalized
      if (legacyId !== canonicalId) delete this.state.workspaces[legacyId]
      this.recordLocalWorkspace(
        workspacePath,
        ownerKey,
        normalized.updatedAt,
        'fallback',
        context.projectId,
      )
      await this.saveState()
      return normalized
    }

    const empty = createEmptySnapshot(workspacePath, ownerKey)
    const changed = this.recordLocalWorkspace(
      workspacePath,
      ownerKey,
      empty.updatedAt,
      context.writable ? 'project' : 'fallback',
      context.projectId,
    )
    if (changed) await this.saveState()
    return empty
  }

  private async persistLocalSnapshot(
    workspacePath: string,
    ownerKey: string | null | undefined,
    snapshot: WorkspaceStateSnapshot,
  ): Promise<void> {
    const context = await this.ensureProjectContext(workspacePath)
    const workspaceId = getWorkspaceId(workspacePath, ownerKey)

    if (context.projectId && context.writable) {
      try {
        await this.writeProjectSnapshot(workspacePath, ownerKey, context.projectId, snapshot)
        const removedFallback = Boolean(this.state.workspaces[workspaceId])
        delete this.state.workspaces[workspaceId]
        const indexChanged = this.recordLocalWorkspace(
          workspacePath,
          ownerKey,
          snapshot.updatedAt,
          'project',
          context.projectId,
        )
        if (removedFallback || indexChanged) await this.saveState()
        return
      } catch (error: unknown) {
        console.warn('[WorkspaceStateService] 项目目录不可写，切换到全局 fallback:', error)
      }
    }

    this.assertCentralStateAvailable()
    this.state.workspaces[workspaceId] = snapshot
    this.recordLocalWorkspace(
      workspacePath,
      ownerKey,
      snapshot.updatedAt,
      'fallback',
      context.projectId,
    )
    await this.saveState()
  }

  private withSection(
    current: WorkspaceStateSnapshot,
    workspaceKey: string | null | undefined,
    ownerKey: string | null | undefined,
    section: string,
    value: unknown,
  ): WorkspaceStateSnapshot {
    return {
      ...current,
      workspaceId: getWorkspaceId(workspaceKey, ownerKey),
      ownerKey: ownerKey || null,
      workspaceKey: workspaceKey || null,
      workspacePath: workspaceKey || null,
      updatedAt: Date.now(),
      sections: {
        ...current.sections,
        [section]: value,
      },
    }
  }

  private async resolveLocalWorkspacePath(workspacePath: string): Promise<string> {
    if (!isAbsolute(workspacePath)) throw new Error('工作区路径必须是绝对路径')
    const resolvedPath = await realpath(workspacePath)
    const homePath = await realpath(app.getPath('home'))
    if (resolvedPath !== homePath && !resolvedPath.startsWith(`${homePath}${sep}`)) {
      throw new Error('工作区路径不在用户主目录下')
    }
    const info = await stat(resolvedPath)
    if (!info.isDirectory()) throw new Error('工作区路径不是目录')
    return resolvedPath
  }

  private async ensureProjectContext(workspacePath: string): Promise<ProjectContext> {
    const manifestPath = join(workspacePath, PROJECT_METADATA_DIR, PROJECT_MANIFEST_FILE)
    const manifestResult = await this.readProjectManifest(manifestPath)
    let manifest = manifestResult.status === 'ok' ? manifestResult.value : null

    if (!manifest) {
      if (manifestResult.status === 'unavailable') {
        return { workspacePath, projectId: null, writable: false }
      }

      const recoveredProjectId = await this.recoverProjectIdFromStateFiles(workspacePath)
      if (recoveredProjectId) {
        manifest = {
          version: PROJECT_FILE_VERSION,
          projectId: recoveredProjectId,
          createdAt: Date.now(),
        }
        try {
          await this.writeProjectManifest(manifestPath, manifest, false)
          return { workspacePath, projectId: manifest.projectId, writable: true }
        } catch {
          return { workspacePath, projectId: manifest.projectId, writable: false }
        }
      }

      if (manifestResult.status === 'invalid') {
        throw new Error('项目身份文件损坏，且无法从项目状态中恢复')
      }

      manifest = {
        version: PROJECT_FILE_VERSION,
        projectId: randomUUID(),
        createdAt: Date.now(),
      }
      try {
        await this.writeProjectManifest(manifestPath, manifest)
        return { workspacePath, projectId: manifest.projectId, writable: true }
      } catch {
        return { workspacePath, projectId: null, writable: false }
      }
    }

    const conflictingPath = await this.findExistingProjectIdConflict(
      manifest.projectId,
      workspacePath,
    )
    if (conflictingPath) {
      const forkedManifest: ProjectManifest = {
        version: PROJECT_FILE_VERSION,
        projectId: randomUUID(),
        createdAt: Date.now(),
        forkedFromProjectId: manifest.projectId,
      }
      try {
        await this.writeProjectManifest(manifestPath, forkedManifest)
        return {
          workspacePath,
          projectId: forkedManifest.projectId,
          writable: true,
          ignoredProjectId: manifest.projectId,
        }
      } catch {
        return { workspacePath, projectId: null, writable: false }
      }
    }

    return {
      workspacePath,
      projectId: manifest.projectId,
      writable: true,
      ignoredProjectId: manifest.forkedFromProjectId,
    }
  }

  private async readProjectManifest(filePath: string): Promise<FileReadResult<ProjectManifest>> {
    const primary = await this.readProjectManifestFile(filePath)
    if (primary.status === 'ok') return primary

    const backup = await this.readProjectManifestFile(`${filePath}.bak`)
    if (backup.status === 'ok') {
      await this.writeProjectManifest(filePath, backup.value, false).catch(() => {})
      return backup
    }
    if (primary.status === 'unavailable') return primary
    if (backup.status === 'unavailable') return backup
    if (primary.status === 'invalid') return primary
    if (backup.status === 'invalid') return backup
    return { status: 'missing' }
  }

  private async readProjectManifestFile(
    filePath: string,
  ): Promise<FileReadResult<ProjectManifest>> {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as Partial<ProjectManifest>
      if (
        parsed.version !== PROJECT_FILE_VERSION ||
        typeof parsed.projectId !== 'string' ||
        typeof parsed.createdAt !== 'number' ||
        (parsed.forkedFromProjectId !== undefined && typeof parsed.forkedFromProjectId !== 'string')
      ) {
        return { status: 'invalid', error: new Error('项目身份文件格式无效') }
      }
      return { status: 'ok', value: parsed as ProjectManifest }
    } catch (error: unknown) {
      if (isMissingFileError(error)) return { status: 'missing' }
      if (error instanceof SyntaxError) return { status: 'invalid', error }
      return { status: 'unavailable', error }
    }
  }

  private async recoverProjectIdFromStateFiles(workspacePath: string): Promise<string | null> {
    const stateDir = join(workspacePath, PROJECT_METADATA_DIR, PROJECT_STATE_DIR)
    let fileNames: string[]
    try {
      fileNames = await readdir(stateDir)
    } catch (error: unknown) {
      if (isMissingFileError(error)) return null
      return null
    }

    const projectIds = new Set<string>()
    for (const fileName of fileNames) {
      if (!fileName.endsWith('.json') && !fileName.endsWith('.json.bak')) continue
      const result = await this.readProjectStateFile(join(stateDir, fileName))
      if (result.status === 'ok') projectIds.add(result.value.projectId)
    }
    return projectIds.size === 1 ? Array.from(projectIds)[0] : null
  }

  private async findExistingProjectIdConflict(
    projectId: string,
    workspacePath: string,
  ): Promise<string | null> {
    const candidates = Object.values(this.state.localWorkspaces).filter(
      (entry) => entry.projectId === projectId && entry.workspacePath !== workspacePath,
    )
    for (const candidate of candidates) {
      try {
        const candidatePath = await realpath(candidate.workspacePath)
        const info = await stat(candidatePath)
        if (info.isDirectory() && candidatePath !== workspacePath) return candidatePath
      } catch {
        // 原路径不存在时视为项目移动，不视为复制。
      }
    }
    return null
  }

  private getProjectStateFilePath(workspacePath: string, ownerKey?: string | null): string {
    return join(
      workspacePath,
      PROJECT_METADATA_DIR,
      PROJECT_STATE_DIR,
      getOwnerStateFileName(ownerKey),
    )
  }

  private async readProjectSnapshot(
    workspacePath: string,
    ownerKey: string | null | undefined,
    context: ProjectContext,
  ): Promise<WorkspaceStateSnapshot | null> {
    const stateFilePath = this.getProjectStateFilePath(workspacePath, ownerKey)
    const primary = await this.readProjectStateFile(stateFilePath)
    const backup = await this.readProjectStateFile(`${stateFilePath}.bak`)
    const candidates = [primary, backup]

    const matching = candidates.find(
      (candidate) => candidate.status === 'ok' && candidate.value.projectId === context.projectId,
    )
    if (matching?.status === 'ok') return matching.value.snapshot
    const inherited = candidates.some(
      (candidate) =>
        candidate.status === 'ok' && candidate.value.projectId === context.ignoredProjectId,
    )
    if (inherited) return null
    if (candidates.some((candidate) => candidate.status === 'ok')) {
      throw new Error('项目状态身份与项目清单不匹配')
    }

    if (candidates.every((candidate) => candidate.status === 'missing')) return null
    const error = candidates.find(
      (
        candidate,
      ): candidate is Extract<
        FileReadResult<ProjectWorkspaceStateFile>,
        { status: 'invalid' | 'unavailable' }
      > => candidate.status === 'invalid' || candidate.status === 'unavailable',
    )
    throw new Error('项目状态及备份均不可读取', { cause: error?.error })
  }

  private async readProjectStateFile(
    filePath: string,
  ): Promise<FileReadResult<ProjectWorkspaceStateFile>> {
    try {
      const parsed = JSON.parse(
        await readFile(filePath, 'utf-8'),
      ) as Partial<ProjectWorkspaceStateFile>
      const snapshot = parsed.snapshot as Partial<WorkspaceStateSnapshot> | undefined
      if (
        parsed.version !== PROJECT_FILE_VERSION ||
        typeof parsed.projectId !== 'string' ||
        !snapshot ||
        snapshot.version !== 1 ||
        typeof snapshot.workspaceId !== 'string' ||
        typeof snapshot.updatedAt !== 'number' ||
        !snapshot.sections ||
        typeof snapshot.sections !== 'object' ||
        Array.isArray(snapshot.sections)
      ) {
        return { status: 'invalid', error: new Error('项目状态文件格式无效') }
      }
      return { status: 'ok', value: parsed as ProjectWorkspaceStateFile }
    } catch (error: unknown) {
      if (isMissingFileError(error)) return { status: 'missing' }
      if (error instanceof SyntaxError) return { status: 'invalid', error }
      return { status: 'unavailable', error }
    }
  }

  private async writeProjectSnapshot(
    workspacePath: string,
    ownerKey: string | null | undefined,
    projectId: string,
    snapshot: WorkspaceStateSnapshot,
  ): Promise<void> {
    const stateFilePath = this.getProjectStateFilePath(workspacePath, ownerKey)
    const tempFilePath = `${stateFilePath}.${process.pid}.tmp`
    const backupFilePath = `${stateFilePath}.bak`
    const payload: ProjectWorkspaceStateFile = {
      version: PROJECT_FILE_VERSION,
      projectId,
      snapshot: normalizeSnapshot(snapshot, ownerKey, workspacePath),
    }

    await this.ensureProjectStateGitExclude(workspacePath)
    await mkdir(dirname(stateFilePath), { recursive: true })
    await writeFile(tempFilePath, JSON.stringify(payload, null, 2), 'utf-8')
    const primary = await this.readProjectStateFile(stateFilePath)
    if (primary.status === 'ok' && primary.value.projectId === projectId) {
      await copyFile(stateFilePath, backupFilePath)
    }
    await rename(tempFilePath, stateFilePath)
  }

  private async writeProjectManifest(
    filePath: string,
    manifest: ProjectManifest,
    preserveCurrent = true,
  ): Promise<void> {
    const tempFilePath = `${filePath}.${process.pid}.tmp`
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(tempFilePath, JSON.stringify(manifest, null, 2), 'utf-8')
    if (preserveCurrent) {
      const current = await this.readProjectManifestFile(filePath)
      if (current.status === 'ok') await copyFile(filePath, `${filePath}.bak`)
    }
    await rename(tempFilePath, filePath)
  }

  private async ensureProjectStateGitExclude(workspacePath: string): Promise<void> {
    try {
      const gitDir = await this.resolveGitDirectory(workspacePath)
      if (!gitDir) return
      const commonGitDir = await this.resolveGitCommonDirectory(gitDir)
      const excludePath = join(commonGitDir, 'info', 'exclude')
      const rules = [
        `/${PROJECT_METADATA_DIR}/${PROJECT_MANIFEST_FILE}`,
        `/${PROJECT_METADATA_DIR}/${PROJECT_STATE_DIR}/`,
      ]
      const current = await readFile(excludePath, 'utf-8').catch((error: unknown) => {
        if (isMissingFileError(error)) return ''
        throw error
      })
      const existingRules = new Set(current.split(/\r?\n/))
      const missingRules = rules.filter((rule) => !existingRules.has(rule))
      if (missingRules.length === 0) return
      await mkdir(dirname(excludePath), { recursive: true })
      const prefix = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`
      await writeFile(excludePath, `${prefix}${missingRules.join('\n')}\n`, 'utf-8')
    } catch {
      // Git 本地排除失败不阻断项目状态保存。
    }
  }

  private async resolveGitDirectory(workspacePath: string): Promise<string | null> {
    const markerPath = join(workspacePath, '.git')
    const marker = await stat(markerPath)
    if (marker.isDirectory()) return markerPath
    if (!marker.isFile()) return null

    const content = await readFile(markerPath, 'utf-8')
    const match = /^gitdir:\s*(.+)\s*$/im.exec(content)
    return match?.[1] ? resolve(workspacePath, match[1]) : null
  }

  private async resolveGitCommonDirectory(gitDir: string): Promise<string> {
    try {
      const commonDir = (await readFile(join(gitDir, 'commondir'), 'utf-8')).trim()
      return commonDir ? resolve(gitDir, commonDir) : gitDir
    } catch (error: unknown) {
      if (isMissingFileError(error)) return gitDir
      throw error
    }
  }

  private recordLocalWorkspace(
    workspacePath: string,
    ownerKey: string | null | undefined,
    updatedAt: number,
    storage: 'project' | 'fallback',
    projectId: string | null,
  ): boolean {
    const normalizedOwnerKey = ownerKey || null
    let changed = false

    if (projectId) {
      for (const [id, entry] of Object.entries(this.state.localWorkspaces)) {
        if (
          entry.projectId === projectId &&
          entry.ownerKey === normalizedOwnerKey &&
          entry.workspacePath !== workspacePath
        ) {
          delete this.state.localWorkspaces[id]
          changed = true
        }
      }
    }

    const id = getWorkspaceId(workspacePath, ownerKey)
    const previous = this.state.localWorkspaces[id]
    const next: WorkspaceStateIndexEntry = {
      workspaceKey: workspacePath,
      workspacePath,
      ownerKey: normalizedOwnerKey,
      updatedAt,
      storage,
      projectId,
    }
    const structuralChange =
      !previous ||
      previous.workspaceKey !== next.workspaceKey ||
      previous.workspacePath !== next.workspacePath ||
      previous.ownerKey !== next.ownerKey ||
      previous.storage !== next.storage ||
      previous.projectId !== next.projectId
    const shouldPersistTouch =
      !previous || Math.abs(next.updatedAt - previous.updatedAt) >= INDEX_TOUCH_INTERVAL_MS
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      this.state.localWorkspaces[id] = next
    }
    return changed || structuralChange || shouldPersistTouch
  }

  private enqueueWorkspaceMutation<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.workspaceQueues.get(key)
    const next = (previous ? previous.catch(() => {}) : Promise.resolve()).then(task)
    this.workspaceQueues.set(key, next)
    const clearQueue = (): void => {
      if (this.workspaceQueues.get(key) === next) this.workspaceQueues.delete(key)
    }
    void next.then(clearQueue, clearQueue)
    return next
  }

  private trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.pendingOperations.add(operation)
    const clearOperation = (): void => {
      this.pendingOperations.delete(operation)
    }
    void operation.then(clearOperation, clearOperation)
    return operation
  }

  private async saveState(): Promise<void> {
    if (this.stateLoadError) return
    this.saveQueue = this.saveQueue.catch(() => {}).then(() => this.writeStateFile())
    await this.saveQueue
  }

  private assertCentralStateAvailable(): void {
    if (this.stateLoadError) throw this.stateLoadError
  }

  private async readStateFile(filePath: string): Promise<WorkspaceStateFile> {
    return migrateWorkspaceStateFile(JSON.parse(await readFile(filePath, 'utf-8')))
  }

  private async writeStateFile(): Promise<void> {
    await mkdir(dirname(this.stateFilePath), { recursive: true })
    await writeFile(this.tempFilePath, JSON.stringify(this.state, null, 2), 'utf-8')
    await copyFile(this.stateFilePath, this.backupFilePath).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error
    })
    await rename(this.tempFilePath, this.stateFilePath)
  }
}
