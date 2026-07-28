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
    const offResult = window.cclinkStudio.android.onStoreInstallResult((result) => {
      if (result.status === 'failed') {
        setStoreInstall({ phase: 'failed', message: result.message })
      } else {
        setStoreInstall({
          phase: 'done',
          message:
            result.status === 'installed'
              ? `已安装 ${result.displayName}`
              : `${result.displayName} 已就绪`,
        })
        setTimeout(() => setStoreInstall({ phase: 'idle' }), 4000)
      }
    })
    return () => {
      offProgress()
      offResult()
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
