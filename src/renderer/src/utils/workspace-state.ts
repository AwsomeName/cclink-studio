import type { WorkspaceStateSection } from '@shared/ipc/workspace-state'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import { workspaceRefKey } from '../../../shared/workspace-ref'

let activeWorkspaceKey: string | null = null
let activeOwnerKey: string | null = null
let restoreDepth = 0
const sectionWriteQueues = new Map<string, Promise<void>>()

function normalizeWorkspaceStateValue(value: unknown): unknown {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('工作空间状态必须是可序列化 JSON')
  return JSON.parse(serialized) as unknown
}

/** 设置后续 WorkspaceState 镜像写入的默认身份 key。 */
export function setWorkspaceStateOwnerKey(ownerKey: string | null | undefined): void {
  activeOwnerKey = ownerKey || null
}

export function getWorkspaceStateOwnerKey(): string | null {
  return activeOwnerKey
}

/** 设置后续 WorkspaceState 镜像写入的默认工作空间 key。null 表示未归档/全局状态。 */
export function setWorkspaceStateKey(workspaceKey: string | null | undefined): void {
  activeWorkspaceKey = workspaceKey || null
}

export function getWorkspaceStateKey(): string | null {
  return activeWorkspaceKey
}

/** 从 WorkspaceRef 设置默认状态 key。 */
export function setWorkspaceStateRef(workspaceRef: WorkspaceRef): void {
  activeWorkspaceKey = workspaceRefKey(workspaceRef)
}

/** 设置本地 workspacePath；当前本地路径也是 workspaceKey。 */
export function setWorkspaceStatePath(workspacePath: string | null | undefined): void {
  setWorkspaceStateKey(workspacePath)
}

/** 获取当前本地 workspacePath。 */
export function getWorkspaceStatePath(): string | null {
  return getWorkspaceStateKey()
}

/** 进入工作台状态恢复事务；事务期间 store 自动订阅不应写回持久化层。 */
export function beginWorkspaceStateRestore(): void {
  restoreDepth += 1
}

/** 结束工作台状态恢复事务。 */
export function endWorkspaceStateRestore(): void {
  restoreDepth = Math.max(0, restoreDepth - 1)
}

export function isWorkspaceStateRestoring(): boolean {
  return restoreDepth > 0
}

/** 渐进式把 renderer 状态镜像到 main process；失败不影响 UI 当前会话。 */
export function persistWorkspaceSection(
  section: WorkspaceStateSection,
  value: unknown,
  workspaceKey?: string | null,
  ownerKey?: string | null,
): void {
  void persistWorkspaceSectionNow(section, value, workspaceKey, ownerKey).catch(() => {})
}

/** 立即提交写入，并等待此前与本次主进程写入确认。 */
export function persistWorkspaceSectionNow(
  section: WorkspaceStateSection,
  value: unknown,
  workspaceKey?: string | null,
  ownerKey?: string | null,
): Promise<void> {
  try {
    if (isWorkspaceStateRestoring()) return Promise.resolve()
    if (typeof window === 'undefined' || !window.cclinkStudio?.workspaceState) {
      return Promise.resolve()
    }
    const targetWorkspaceKey = workspaceKey === undefined ? activeWorkspaceKey : workspaceKey
    const targetOwnerKey = ownerKey === undefined ? activeOwnerKey : ownerKey
    const queueKey = JSON.stringify([targetOwnerKey, targetWorkspaceKey, section])
    const previous = sectionWriteQueues.get(queueKey)
    const run = async (): Promise<void> => {
      const normalizedValue = normalizeWorkspaceStateValue(value)
      const result = await window.cclinkStudio.workspaceState.setSection(
        targetWorkspaceKey,
        section,
        normalizedValue,
        targetOwnerKey,
      )
      if (!result.success) {
        throw new Error(result.error || `保存 ${section} 失败`)
      }
    }
    const next = previous ? previous.catch(() => {}).then(run) : run()
    sectionWriteQueues.set(queueKey, next)
    const clearQueue = (): void => {
      if (sectionWriteQueues.get(queueKey) === next) sectionWriteQueues.delete(queueKey)
    }
    void next.then(clearQueue, clearQueue)
    return next
  } catch {
    return Promise.reject(new Error(`保存 ${section} 失败`))
  }
}
