import { create } from 'zustand'
import type { UpdateCommandResult, UpdateSnapshot } from '@shared/update'

const initialSnapshot: UpdateSnapshot = {
  schemaVersion: 1,
  phase: 'idle',
  operationId: null,
  currentVersion: '未知',
  availableRelease: null,
  progress: null,
  lastCheckedAt: null,
  ignoredVersion: null,
  error: null,
}

interface UpdateState {
  snapshot: UpdateSnapshot
  panelOpen: boolean
  hydrated: boolean
  setSnapshot: (snapshot: UpdateSnapshot) => void
  openPanel: () => void
  closePanel: () => void
  hydrate: () => Promise<void>
  check: () => Promise<UpdateCommandResult>
  startDownload: () => Promise<UpdateCommandResult>
  cancelDownload: () => Promise<UpdateCommandResult>
  defer: () => Promise<UpdateCommandResult>
  ignoreVersion: () => Promise<UpdateCommandResult>
}

export const useUpdateStore = create<UpdateState>((set) => {
  const apply = (result: UpdateCommandResult): UpdateCommandResult => {
    set({ snapshot: result.snapshot })
    return result
  }
  return {
    snapshot: initialSnapshot,
    panelOpen: false,
    hydrated: false,
    setSnapshot: (snapshot) => set({ snapshot, hydrated: true }),
    openPanel: () => set({ panelOpen: true }),
    closePanel: () => set({ panelOpen: false }),
    hydrate: async () => {
      const snapshot = await window.cclinkStudio.update.getSnapshot()
      set({ snapshot, hydrated: true })
    },
    check: async () => apply(await window.cclinkStudio.update.check()),
    startDownload: async () => apply(await window.cclinkStudio.update.startDownload()),
    cancelDownload: async () => apply(await window.cclinkStudio.update.cancelDownload()),
    defer: async () => apply(await window.cclinkStudio.update.defer()),
    ignoreVersion: async () => apply(await window.cclinkStudio.update.ignoreVersion()),
  }
})
