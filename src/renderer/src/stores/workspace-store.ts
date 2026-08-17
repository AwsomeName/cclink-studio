import { create } from 'zustand'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import {
  globalWorkspaceRef,
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../shared/workspace-ref'
import { setWorkspaceStateRef } from '../utils/workspace-state'

export interface WorkspaceTarget {
  readonly ref: WorkspaceRef
  readonly generation: number
}

interface WorkspaceState {
  activeWorkspaceRef: WorkspaceRef
  generation: number
  commitActiveWorkspace: (ref: WorkspaceRef) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspaceRef: globalWorkspaceRef(),
  generation: 0,

  commitActiveWorkspace: (ref) => {
    setWorkspaceStateRef(ref)
    set((state) => ({ activeWorkspaceRef: ref, generation: state.generation + 1 }))
  },
}))

export function captureActiveWorkspaceTarget(): WorkspaceTarget {
  const state = useWorkspaceStore.getState()
  return { ref: state.activeWorkspaceRef, generation: state.generation }
}

export function isWorkspaceTargetCurrent(target: WorkspaceTarget): boolean {
  const state = useWorkspaceStore.getState()
  return (
    state.generation === target.generation &&
    workspaceRefKey(state.activeWorkspaceRef) === workspaceRefKey(target.ref)
  )
}

export function getWorkspaceDisplayTitle(ref: WorkspaceRef): string {
  return workspaceRefLabel(ref)
}

export function getWorkspaceDisplayMeta(ref: WorkspaceRef): string {
  return workspaceRefSourceLabel(ref)
}
