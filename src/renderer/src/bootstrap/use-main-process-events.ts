import { useEffect } from 'react'
import { useAndroidStore } from '../stores/android-store'
import { useUpdateStore } from '../stores/update-store'

/** 订阅主进程推送事件，并写入 renderer stores。 */
export function useMainProcessEvents(): void {
  useEffect(() => {
    const setStoreInstall = useAndroidStore.getState().setStoreInstall
    const offProgress = window.cclinkStudio.android.onStoreInstallProgress((msg) => {
      setStoreInstall({ phase: 'installing', message: msg })
    })
    return () => {
      offProgress()
    }
  }, [])

  useEffect(() => {
    const store = useUpdateStore.getState()
    void store.hydrate()
    const offUpdate = window.cclinkStudio.update.onSnapshotChanged((event) => {
      useUpdateStore.getState().setSnapshot(event.snapshot)
    })
    return () => {
      offUpdate()
    }
  }, [])
}
