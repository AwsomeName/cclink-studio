import { create } from 'zustand'
import type { UpdateCommandResult, UpdateSnapshot, UpdateInstallPreparation } from '@shared/update'

const initialSnapshot: UpdateSnapshot = {
  schemaVersion: 1,
  phase: 'idle',
  operationId: null,
  currentVersion: '未知',
  track: 'stable',
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
  manualInstallerBusy: boolean
  manualInstallerError: string | null
  installPreparation: UpdateInstallPreparation | null
  installBusy: boolean
  prepareInstall: () => Promise<void>
  confirmInstall: () => Promise<void>
  setSnapshot: (snapshot: UpdateSnapshot) => void
  openPanel: () => void
  closePanel: () => void
  hydrate: () => Promise<void>
  check: () => Promise<UpdateCommandResult>
  startDownload: () => Promise<UpdateCommandResult>
  startDownloadInBackground: () => Promise<UpdateCommandResult>
  cancelDownload: () => Promise<UpdateCommandResult>
  defer: () => Promise<UpdateCommandResult>
  ignoreVersion: () => Promise<UpdateCommandResult>
  openManualInstaller: () => Promise<boolean>
}

export const useUpdateStore = create<UpdateState>((set, get) => {
  const apply = (result: UpdateCommandResult): UpdateCommandResult => {
    set({ snapshot: result.snapshot })
    return result
  }
  return {
    snapshot: initialSnapshot,
    panelOpen: false,
    hydrated: false,
    manualInstallerBusy: false,
    manualInstallerError: null,
    installPreparation: null,
    installBusy: false,
    setSnapshot: (snapshot) =>
      set({
        snapshot,
        hydrated: true,
        ...(snapshot.phase === 'installing' ? { panelOpen: true } : {}),
      }),
    openPanel: () => set({ panelOpen: true, manualInstallerError: null }),
    closePanel: () => {
      if (!get().installBusy && get().snapshot.phase !== 'installing') {
        const hadConfirmation = Boolean(get().installPreparation?.confirmationToken)
        set({ panelOpen: false, manualInstallerError: null, installPreparation: null })
        if (hadConfirmation) void window.cclinkStudio.update.defer().catch(() => undefined)
      }
    },
    prepareInstall: async () => {
      if (get().installBusy) return
      set({ installBusy: true, installPreparation: null, manualInstallerError: null })
      try {
        const preparation = await window.cclinkStudio.update.prepareInstall()
        set({ snapshot: preparation.snapshot, installPreparation: preparation })
      } catch {
        set({ manualInstallerError: '无法确认安装条件，请稍后重试' })
      } finally {
        set({ installBusy: false })
      }
    },
    confirmInstall: async () => {
      const token = get().installPreparation?.confirmationToken
      if (!token || get().installBusy) return
      set({ installBusy: true, installPreparation: null, manualInstallerError: null })
      try {
        const result = await window.cclinkStudio.update.installAndRestart({
          confirmationToken: token,
        })
        set({
          snapshot: result.snapshot,
          manualInstallerError: result.ok
            ? null
            : (result.snapshot.error?.userMessage ?? '安装确认已过期或条件已变化，请重新确认'),
        })
      } catch {
        set({ manualInstallerError: '安装请求失败，请稍后重试' })
      } finally {
        set({ installBusy: false })
      }
    },
    hydrate: async () => {
      const snapshot = await window.cclinkStudio.update.getSnapshot()
      set({ snapshot, hydrated: true })
    },
    check: async () => apply(await window.cclinkStudio.update.check()),
    startDownload: async () => apply(await window.cclinkStudio.update.startDownload()),
    startDownloadInBackground: async () => {
      set({ panelOpen: false, manualInstallerError: null })
      return apply(await window.cclinkStudio.update.startDownload())
    },
    cancelDownload: async () => apply(await window.cclinkStudio.update.cancelDownload()),
    defer: async () => apply(await window.cclinkStudio.update.defer()),
    ignoreVersion: async () => apply(await window.cclinkStudio.update.ignoreVersion()),
    openManualInstaller: async () => {
      set({ manualInstallerBusy: true, manualInstallerError: null })
      try {
        const result = await window.cclinkStudio.update.openManualInstaller()
        set({
          snapshot: result.snapshot,
          manualInstallerError:
            result.snapshot.phase === 'readyToInstall' ? (result.error?.userMessage ?? null) : null,
        })
        return result.ok
      } finally {
        set({ manualInstallerBusy: false })
      }
    },
  }
})
