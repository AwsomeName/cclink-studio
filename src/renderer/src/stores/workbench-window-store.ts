import { create } from 'zustand'
import type { WorkbenchPlacementChanged } from '@shared/ipc/workbench-window'

interface WorkbenchWindowStore {
  placements: Record<string, WorkbenchPlacementChanged>
  applyPlacement: (placement: WorkbenchPlacementChanged) => void
  hydratePlacements: (placements: WorkbenchPlacementChanged[]) => void
}

export const useWorkbenchWindowStore = create<WorkbenchWindowStore>((set) => ({
  placements: {},
  applyPlacement: (placement) =>
    set((state) => {
      const current = state.placements[placement.tabId]
      if (current && current.generation > placement.generation) return state
      return { placements: { ...state.placements, [placement.tabId]: placement } }
    }),
  hydratePlacements: (placements) =>
    set((state) => {
      const next = { ...state.placements }
      for (const placement of placements) {
        const current = next[placement.tabId]
        if (!current || current.generation <= placement.generation)
          next[placement.tabId] = placement
      }
      return { placements: next }
    }),
}))

export function isDetachedFromMain(placement: WorkbenchPlacementChanged | undefined): boolean {
  return Boolean(placement && placement.windowId !== 'main')
}
