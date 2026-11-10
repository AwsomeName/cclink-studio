import { useEffect } from 'react'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useCclinkStore } from '../stores/cclink-store'
import { useWorkspaceStore } from '../stores/workspace-store'

/** Remote history belongs to the app lifecycle, not the visibility of a navigation panel. */
export function installRemoteConversationRestore(): () => void {
  let disposed = false
  let generation = 0

  const restore = (): void => {
    const currentGeneration = ++generation
    const ref = useWorkspaceStore.getState().activeWorkspaceRef
    if (ref.kind !== 'remote') return

    void useCclinkStore
      .getState()
      .initialize()
      .then(async () => {
        if (disposed || currentGeneration !== generation) return
        // listSessions also returns the main process's saved history when the remote
        // connection is unavailable. A successful connection is not a read prerequisite.
        await useCclinkStore.getState().loadSessions(ref)
      })
      .catch((error: unknown) => {
        if (!disposed) console.warn('[RemoteConversationRestore] 远程历史加载失败:', error)
      })
  }

  const unsubscribeWorkspace = useWorkspaceStore.subscribe((state, previous) => {
    if (
      workspaceRefKey(state.activeWorkspaceRef) !== workspaceRefKey(previous.activeWorkspaceRef)
    ) {
      restore()
    }
  })
  const unsubscribeCclink = useCclinkStore.subscribe((state, previous) => {
    if (
      (state.realtime.state === 'online' && previous.realtime.state !== 'online') ||
      (state.session.loggedIn &&
        (!previous.session.loggedIn || state.session.user?.id !== previous.session.user?.id))
    ) {
      restore()
    }
  })

  restore()
  return () => {
    disposed = true
    generation += 1
    unsubscribeWorkspace()
    unsubscribeCclink()
  }
}

export function useRemoteConversationRestore(enabled: boolean): void {
  useEffect(() => {
    if (enabled) return installRemoteConversationRestore()
  }, [enabled])
}
