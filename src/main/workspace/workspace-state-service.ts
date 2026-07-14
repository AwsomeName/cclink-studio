import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { WorkspaceStateSnapshot } from '../../shared/ipc/workspace-state'

interface WorkspaceStateFile {
  version: number
  workspaces: Record<string, WorkspaceStateSnapshot>
}

const CURRENT_FILE_VERSION = 1
const GLOBAL_WORKSPACE_ID = 'global'
const LEGACY_OWNER_KEY: string | null = null

/**
 * 文件级 migration 注册表：key 为源版本号，value 为「该版本 → 下一版本」的升级函数。
 * 未来引入 V2 时：
 *   1) 在此注册 `1: (raw) => migrateV1ToV2(raw)`；
 *   2) 将 CURRENT_FILE_VERSION 提到 2。
 * 遇到中间版本未注册 migrator 时停止升级，避免错误降级。
 */
type FileMigrator = (input: unknown) => WorkspaceStateFile
const FILE_MIGRATIONS: Partial<Record<number, FileMigrator>> = {
  // 1: (raw) => ({ version: 2, workspaces: migrateV1WorkspacesToV2(raw.workspaces) }),
}

function migrateWorkspaceStateFile(raw: unknown): WorkspaceStateFile {
  const input = (raw ?? {}) as Partial<WorkspaceStateFile>
  const initialVersion = typeof input.version === 'number' ? input.version : 1
  let version = initialVersion
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
  }
}

function getLegacyWorkspaceId(workspaceKey?: string | null): string {
  if (!workspaceKey) return GLOBAL_WORKSPACE_ID
  return createHash('sha256').update(workspaceKey).digest('hex').slice(0, 16)
}

function getWorkspaceId(workspaceKey?: string | null, ownerKey?: string | null): string {
  if (!ownerKey) return getLegacyWorkspaceId(workspaceKey)
  return createHash('sha256')
    .update(`${ownerKey}\0${workspaceKey || GLOBAL_WORKSPACE_ID}`)
    .digest('hex')
    .slice(0, 16)
}

function createEmptySnapshot(
  workspaceKey?: string | null,
  ownerKey?: string | null,
): WorkspaceStateSnapshot {
  return {
    version: 1,
    workspaceId: getWorkspaceId(workspaceKey, ownerKey),
    ownerKey: ownerKey || LEGACY_OWNER_KEY,
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
    workspaceId: getWorkspaceId(workspaceKeyOverride ?? workspaceKey, ownerKey ?? snapshot.ownerKey),
    ownerKey: ownerKey ?? snapshot.ownerKey ?? LEGACY_OWNER_KEY,
    workspaceKey: workspaceKeyOverride ?? workspaceKey,
    workspacePath: workspaceKeyOverride ?? snapshot.workspacePath ?? workspaceKey,
    sections: { ...snapshot.sections },
  }
}

/** WorkspaceStateService 持有可跨重启恢复的工作台状态，逐步替代 renderer localStorage。 */
export class WorkspaceStateService {
  private readonly stateFilePath: string
  private state: WorkspaceStateFile = { version: CURRENT_FILE_VERSION, workspaces: {} }

  constructor() {
    this.stateFilePath = join(app.getPath('userData'), 'workspace-state.json')
  }

  async loadState(): Promise<void> {
    try {
      const raw = await readFile(this.stateFilePath, 'utf-8')
      const parsed = JSON.parse(raw)
      this.state = migrateWorkspaceStateFile(parsed)
      console.log('[WorkspaceStateService] 工作台状态已加载')
    } catch (error: unknown) {
      const isEnoent = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
      if (!isEnoent) {
        console.warn('[WorkspaceStateService] 工作台状态读取失败，使用空状态:', error)
      }
      this.state = { version: CURRENT_FILE_VERSION, workspaces: {} }
    }
  }

  getSnapshot(workspaceKey?: string | null, ownerKey?: string | null): WorkspaceStateSnapshot {
    const id = getWorkspaceId(workspaceKey, ownerKey)
    const snapshot = this.state.workspaces[id]
    if (snapshot) return normalizeSnapshot(snapshot, ownerKey, workspaceKey)

    if (ownerKey) {
      const legacySnapshot = this.state.workspaces[getLegacyWorkspaceId(workspaceKey)]
      if (legacySnapshot) {
        return normalizeSnapshot(legacySnapshot, ownerKey, workspaceKey)
      }
    }

    return createEmptySnapshot(workspaceKey, ownerKey)
  }

  async setSection(
    workspaceKey: string | null | undefined,
    section: string,
    value: unknown,
    ownerKey?: string | null,
  ): Promise<WorkspaceStateSnapshot> {
    const current = this.getSnapshot(workspaceKey, ownerKey)
    const next: WorkspaceStateSnapshot = {
      ...current,
      workspaceId: getWorkspaceId(workspaceKey, ownerKey),
      ownerKey: ownerKey || LEGACY_OWNER_KEY,
      workspaceKey: workspaceKey || null,
      workspacePath: workspaceKey || null,
      updatedAt: Date.now(),
      sections: {
        ...current.sections,
        [section]: value,
      },
    }
    this.state.workspaces[next.workspaceId] = next
    await this.saveState()
    return { ...next, sections: { ...next.sections } }
  }

  async clear(workspaceKey?: string | null, ownerKey?: string | null): Promise<void> {
    delete this.state.workspaces[getWorkspaceId(workspaceKey, ownerKey)]
    await this.saveState()
  }

  private async saveState(): Promise<void> {
    await mkdir(dirname(this.stateFilePath), { recursive: true })
    await writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8')
  }
}
