import { create } from 'zustand'
import type { WorkspaceSettingsSnapshot } from '@shared/workspace-settings'
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
  settingsSnapshot: WorkspaceSettingsSnapshot | null
  refreshSettings: () => Promise<void>
  generation: number
  commitActiveWorkspace: (ref: WorkspaceRef) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeWorkspaceRef: globalWorkspaceRef(),
  generation: 0,
  settingsSnapshot: null,
  refreshSettings: async () => {
    const { activeWorkspaceRef: ref, generation } = get()
    if (ref.kind !== 'local') return
    try {
      const snapshot = await window.cclinkStudio.workspaceState.getSettings?.(ref.path)
      if (snapshot && get().generation === generation) set({ settingsSnapshot: snapshot })
    } catch (error) {
      if (get().generation === generation)
        set({
          settingsSnapshot: {
            workspacePath: ref.path,
            settings: { version: 1, name: workspaceRefLabel(ref), type: 'general' },
            revision: null,
            status: 'unavailable',
            error: String(error),
          },
        })
    }
  },

  commitActiveWorkspace: (ref) => {
    setWorkspaceStateRef(ref)
    set((state) => ({
      activeWorkspaceRef: ref,
      generation: state.generation + 1,
      settingsSnapshot: null,
    }))
    void get().refreshSettings()
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
