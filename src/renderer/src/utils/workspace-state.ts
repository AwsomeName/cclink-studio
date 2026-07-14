import type { WorkspaceStateSection } from '@shared/ipc/workspace-state'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import { workspaceRefKey } from '../../../shared/workspace-ref'

let activeWorkspaceKey: string | null = null
let activeOwnerKey: string | null = null

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

/** 兼容旧本地路径 API：本地 workspacePath 也是 workspaceKey。 */
export function setWorkspaceStatePath(workspacePath: string | null | undefined): void {
  setWorkspaceStateKey(workspacePath)
}

/** 兼容旧本地路径 API。远程激活后这里返回的是远程 workspaceKey。 */
export function getWorkspaceStatePath(): string | null {
  return getWorkspaceStateKey()
}

/** 渐进式把 renderer 状态镜像到 main process；失败不影响 UI 当前会话。 */
export function persistWorkspaceSection(
  section: WorkspaceStateSection,
  value: unknown,
  workspaceKey?: string | null,
  ownerKey?: string | null,
): void {
  try {
    if (typeof window === 'undefined' || !window.deepink?.workspaceState) return
    void window.deepink.workspaceState
      .setSection(workspaceKey ?? activeWorkspaceKey, section, value, ownerKey ?? activeOwnerKey)
      .catch(() => {})
  } catch {
    // 主进程状态镜像失败不应影响用户当前操作。
  }
}
