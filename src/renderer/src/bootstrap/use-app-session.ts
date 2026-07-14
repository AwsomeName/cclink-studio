import { useEffect } from 'react'
import { useAuthStore } from '../stores/auth-store'
import { useSubscriptionStore } from '../stores/subscription-store'
import { setWorkspaceStateOwnerKey } from '../utils/workspace-state'

/** 初始化认证 session，并监听主进程 session 变化。 */
export function useAppSession(deepinkApiAvailable: boolean): void {
  useEffect(() => {
    if (!deepinkApiAvailable) return

    async function bootstrapSession(): Promise<void> {
      try {
        const localIdentity = await window.deepink.identity.getLocalIdentity()
        useAuthStore.getState().setLocalIdentity(localIdentity)
        setWorkspaceStateOwnerKey(`local:${localIdentity.localId}`)

        const session = await window.deepink.auth
          .checkSession()
          .catch(() => ({ loggedIn: false, user: null }))
        useAuthStore.getState().setLoggedIn(session.loggedIn, session.user)
        if (session.loggedIn) {
          useSubscriptionStore.getState().loadStatus()
        }
      } catch {
        useAuthStore.getState().setChecking(false)
      }
    }

    void bootstrapSession()

    window.deepink.auth.onSessionChanged((session) => {
      useAuthStore.getState().setLoggedIn(session.loggedIn, session.user)
      if (session.loggedIn) {
        useSubscriptionStore.getState().loadStatus()
      }
    })
  }, [deepinkApiAvailable])
}
