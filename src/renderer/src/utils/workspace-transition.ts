import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import { workspaceRefKey } from '../../../shared/workspace-ref'
import {
  getWorkspaceStateKey,
  getWorkspaceStateOwnerKey,
  setWorkspaceStateRef,
} from './workspace-state'
import {
  hydrateRuntimeSections,
  persistRuntimeSections,
  reconcileAgentRuntimeStatuses,
} from './workspace-runtime'

export interface WorkspaceRuntimeTransition {
  ref: WorkspaceRef
  key: string | null
  snapshot: WorkspaceStateSnapshot | null
  generation: number
}

let workspaceTransitionGeneration = 0

export function beginWorkspaceRuntimeTransition(): number {
  workspaceTransitionGeneration += 1
  return workspaceTransitionGeneration
}

export function isWorkspaceRuntimeTransitionCurrent(generation: number): boolean {
  return generation === workspaceTransitionGeneration
}

export async function prepareWorkspaceRuntimeTransition(
  ref: WorkspaceRef,
  options: { persistCurrent?: boolean; generation?: number } = {},
): Promise<WorkspaceRuntimeTransition> {
  const generation = options.generation ?? beginWorkspaceRuntimeTransition()
  const key = workspaceRefKey(ref)
  const currentKey = getWorkspaceStateKey()

  if (options.persistCurrent !== false && key !== currentKey) {
    await persistRuntimeSections(currentKey)
  }

  const snapshot = await window.cclinkStudio.workspaceState.get(key, getWorkspaceStateOwnerKey())

  return { ref, key, snapshot, generation }
}

export function applyWorkspaceRuntimeTransition(
  transition: WorkspaceRuntimeTransition,
  options: { hydrate?: boolean; flush?: boolean } = {},
): boolean {
  if (!isWorkspaceRuntimeTransitionCurrent(transition.generation)) return false
  setWorkspaceStateRef(transition.ref)

  if (options.hydrate !== false) {
    hydrateRuntimeSections(transition.snapshot)
    void reconcileAgentRuntimeStatuses(transition.key)
  }

  if (options.flush !== false) {
    void persistRuntimeSections(transition.key)
  }
  return true
}
