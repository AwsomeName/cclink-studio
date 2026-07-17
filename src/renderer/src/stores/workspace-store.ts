import { create } from 'zustand'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import {
  globalWorkspaceRef,
  localWorkspaceRef,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../shared/workspace-ref'
import { setWorkspaceStateRef } from '../utils/workspace-state'
import {
  applyWorkspaceRuntimeTransition,
  beginWorkspaceRuntimeTransition,
  isWorkspaceRuntimeTransitionCurrent,
  prepareWorkspaceRuntimeTransition,
} from '../utils/workspace-transition'

interface WorkspaceState {
  activeWorkspaceRef: WorkspaceRef
  activating: boolean
  error: string | null
  activateLocalWorkspace: (path: string) => void
  activateGlobalWorkspace: () => void
  switchToGlobalWorkspace: () => Promise<void>
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspaceRef: globalWorkspaceRef(),
  activating: false,
  error: null,

  activateLocalWorkspace: (path) => {
    const ref = localWorkspaceRef(path)
    setWorkspaceStateRef(ref)
    set({ activeWorkspaceRef: ref, activating: false, error: null })
  },

  activateGlobalWorkspace: () => {
    const ref = globalWorkspaceRef()
    setWorkspaceStateRef(ref)
    set({ activeWorkspaceRef: ref, activating: false, error: null })
  },

  switchToGlobalWorkspace: async () => {
    const ref = globalWorkspaceRef()
    set({ activating: true, error: null })

    try {
      const generation = beginWorkspaceRuntimeTransition()
      const transition = await prepareWorkspaceRuntimeTransition(ref, { generation })
      if (
        !isWorkspaceRuntimeTransitionCurrent(generation) ||
        !applyWorkspaceRuntimeTransition(transition)
      ) {
        return
      }
      set({ activeWorkspaceRef: ref, activating: false, error: null })
    } catch (error) {
      set({ activating: false, error: describeError(error) })
    }
  },
}))

export function getWorkspaceDisplayTitle(ref: WorkspaceRef): string {
  return workspaceRefLabel(ref)
}

export function getWorkspaceDisplayMeta(ref: WorkspaceRef): string {
  return workspaceRefSourceLabel(ref)
}
