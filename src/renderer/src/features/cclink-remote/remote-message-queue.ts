import { useCclinkStore } from '../../stores/cclink-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

/** One application subscription; both panel layouts only project the CCLink-owned queue. */
export function installRemoteMessageQueue(): () => void {
  let disposed = false
  let scheduled = false
  const lifecycle = new AbortController()
  const schedule = (): void => {
    if (disposed || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (disposed) return
      for (const key of Object.keys(useCclinkStore.getState().remoteMessageQueues)) {
        void useCclinkStore.getState().dispatchRemoteMessage(key, lifecycle.signal)
      }
    })
  }
  const unsubscribe = useCclinkStore.subscribe((state, previous) => {
    if (state.realtime.state !== 'online' && previous.realtime.state === 'online') {
      for (const key of Object.keys(state.remoteMessageQueues)) {
        state.pauseRemoteMessageQueue(key, '远程连接已中断，请恢复连接并核对执行结果后继续队列')
      }
    }
    schedule()
  })
  const unsubscribeWorkspace = useWorkspaceStore.subscribe(schedule)
  const unsubscribeUpload = window.cclinkStudio.cclink.onImageUploadProgress((progress) => {
    useCclinkStore.setState((state) => {
      const entry = Object.entries(state.remoteMessageQueues).find(
        ([, queue]) => queue.dispatchId === progress.uploadId,
      )
      if (!entry) return state
      return {
        remoteMessageQueues: {
          ...state.remoteMessageQueues,
          [entry[0]]: { ...entry[1], uploadProgress: progress },
        },
      }
    })
  })
  schedule()
  return () => {
    disposed = true
    lifecycle.abort()
    unsubscribe()
    unsubscribeWorkspace()
    unsubscribeUpload()
  }
}
