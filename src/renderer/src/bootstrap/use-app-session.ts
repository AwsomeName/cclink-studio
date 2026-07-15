import { useEffect } from 'react'
import { setWorkspaceStateOwnerKey } from '../utils/workspace-state'

/** 初始化本地身份；开源壳不依赖 CCLink 登录/订阅 session。 */
export function useAppSession(deepinkApiAvailable: boolean): void {
  useEffect(() => {
    if (!deepinkApiAvailable) return

    async function bootstrapLocalIdentity(): Promise<void> {
      try {
        const localIdentity = await window.deepink.identity.getLocalIdentity()
        setWorkspaceStateOwnerKey(`local:${localIdentity.localId}`)
      } catch (error) {
        console.warn('[AppSession] 初始化本地身份失败:', error)
      }
    }

    void bootstrapLocalIdentity()
  }, [deepinkApiAvailable])
}
