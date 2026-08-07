import type {
  WorkspaceStateSection,
  WorkspaceStateSetSectionOptions,
} from '@shared/ipc/workspace-state'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import { workspaceRefKey } from '../../../shared/workspace-ref'

let activeWorkspaceKey: string | null = null
let activeOwnerKey: string | null = null
let restoreDepth = 0

interface SectionWriteRequest {
  workspaceKey: string | null
  ownerKey: string | null
  section: WorkspaceStateSection
  value: unknown
  options?: WorkspaceStateSetSectionOptions
  waiters: Array<{
    resolve: () => void
    reject: (error: Error) => void
  }>
}

interface SectionWriteQueue {
  running: boolean
  pending: SectionWriteRequest | null
  idleWaiters: Array<() => void>
}

const sectionWriteQueues = new Map<string, SectionWriteQueue>()

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
  options?: WorkspaceStateSetSectionOptions,
): void {
  void persistWorkspaceSectionNow(section, value, workspaceKey, ownerKey, options).catch(() => {})
}

/** 立即提交写入，并等待此前与本次主进程写入确认。 */
export function persistWorkspaceSectionNow(
  section: WorkspaceStateSection,
  value: unknown,
  workspaceKey?: string | null,
  ownerKey?: string | null,
  options?: WorkspaceStateSetSectionOptions,
): Promise<void> {
  try {
    if (isWorkspaceStateRestoring()) return Promise.resolve()
    if (typeof window === 'undefined' || !window.cclinkStudio?.workspaceState) {
      return Promise.resolve()
    }
    const targetWorkspaceKey = workspaceKey === undefined ? activeWorkspaceKey : workspaceKey
    const targetOwnerKey = ownerKey === undefined ? activeOwnerKey : ownerKey
    const queueKey = JSON.stringify([targetOwnerKey, targetWorkspaceKey, section])
    const queue = sectionWriteQueues.get(queueKey) ?? {
      running: false,
      pending: null,
      idleWaiters: [],
    }
    sectionWriteQueues.set(queueKey, queue)

    const completion = new Promise<void>((resolve, reject) => {
      if (queue.pending) {
        // WorkspaceState 是快照而非事件流。正在写盘时只需保留最新快照，所有等待者
        // 在该最新值落盘后一起完成，避免 Agent 流式增量制造无界磁盘写队列。
        queue.pending.value = value
        queue.pending.options = options
        queue.pending.waiters.push({ resolve, reject })
        return
      }
      queue.pending = {
        workspaceKey: targetWorkspaceKey,
        ownerKey: targetOwnerKey,
        section,
        value,
        options,
        waiters: [{ resolve, reject }],
      }
    })

    if (!queue.running) void drainSectionWriteQueue(queueKey, queue)
    return completion
  } catch {
    return Promise.reject(new Error(`保存 ${section} 失败`))
  }
}

async function drainSectionWriteQueue(queueKey: string, queue: SectionWriteQueue): Promise<void> {
  queue.running = true
  try {
    while (queue.pending) {
      const request = queue.pending
      queue.pending = null
      try {
        const normalizedValue = normalizeWorkspaceStateValue(request.value)
        const result = request.options
          ? await window.cclinkStudio.workspaceState.setSection(
              request.workspaceKey,
              request.section,
              normalizedValue,
              request.ownerKey,
              request.options,
            )
          : await window.cclinkStudio.workspaceState.setSection(
              request.workspaceKey,
              request.section,
              normalizedValue,
              request.ownerKey,
            )
        if (!result.success) {
          throw new Error(result.error || `保存 ${request.section} 失败`)
        }
        for (const waiter of request.waiters) waiter.resolve()
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error(`保存 ${request.section} 失败`)
        for (const waiter of request.waiters) waiter.reject(normalizedError)
      }
    }
  } finally {
    queue.running = false
    if (queue.pending) {
      void drainSectionWriteQueue(queueKey, queue)
    } else if (sectionWriteQueues.get(queueKey) === queue) {
      sectionWriteQueues.delete(queueKey)
      for (const resolve of queue.idleWaiters.splice(0)) resolve()
    }
  }
}

/** 等待 renderer 内所有尚未送达 main process 的工作空间快照完成写盘。 */
export async function flushPendingWorkspaceStateWrites(): Promise<void> {
  while (sectionWriteQueues.size > 0) {
    await Promise.all(
      Array.from(sectionWriteQueues.values()).map(
        (queue) =>
          new Promise<void>((resolve) => {
            if (!queue.running && !queue.pending) resolve()
            else queue.idleWaiters.push(resolve)
          }),
      ),
    )
  }
}
