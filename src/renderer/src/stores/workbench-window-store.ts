import { create } from 'zustand'
import type { WorkbenchPlacementChanged } from '@shared/ipc/workbench-window'

interface WorkbenchWindowStore {
  placements: Record<string, WorkbenchPlacementChanged>
  applyPlacement: (placement: WorkbenchPlacementChanged) => void
}

export const useWorkbenchWindowStore = create<WorkbenchWindowStore>((set) => ({
  placements: {},
  applyPlacement: (placement) =>
    set((state) => ({ placements: { ...state.placements, [placement.tabId]: placement } })),
}))

export function isDetachedFromMain(placement: WorkbenchPlacementChanged | undefined): boolean {
  return Boolean(placement && placement.windowId !== 'main')
}
