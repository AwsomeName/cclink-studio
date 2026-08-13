import { create } from 'zustand'
import type { CclinkServer } from '@shared/cclink'
import type { AuthServiceStatus, AuthSession } from '@shared/ipc/auth'
import type { CclinkRealtimeStatus } from '@shared/ipc/cclink'

interface CclinkState {
  service: AuthServiceStatus | null
  session: AuthSession
  realtime: CclinkRealtimeStatus
  servers: CclinkServer[]
  initialized: boolean
  loading: boolean
  error: string | null
  initialize(): Promise<void>
  sendCode(phone: string): Promise<{ success: boolean; error?: string }>
  login(phone: string, code: string): Promise<boolean>
  logout(): Promise<void>
  refreshServers(): Promise<void>
}

let initializePromise: Promise<void> | null = null
let eventsInstalled = false

export const useCclinkStore = create<CclinkState>((set, get) => ({
  service: null,
  session: { loggedIn: false, user: null },
  realtime: { state: 'idle' },
  servers: [],
  initialized: false,
  loading: false,
  error: null,

  initialize: async () => {
    if (get().initialized) return
    if (initializePromise) return initializePromise
    if (!eventsInstalled) {
      eventsInstalled = true
      window.cclinkStudio.auth.onSessionChanged((session) => set({ session }))
      window.cclinkStudio.cclink.onRealtimeStatus((realtime) => set({ realtime }))
    }
    initializePromise = (async () => {
      set({ loading: true, error: null })
      try {
        const service = await window.cclinkStudio.auth.getServiceStatus()
        if (!service.configured) {
          set({ service, initialized: true, loading: false })
          return
        }
        const session = await window.cclinkStudio.auth.checkSession()
        set({ service, session })
        if (session.loggedIn && !session.offline) {
          const realtime = await window.cclinkStudio.cclink.connectRealtime()
          set({ realtime })
          if (realtime.state === 'online') await get().refreshServers()
        }
        set({ initialized: true })
      } catch (error) {
        set({ error: message(error), initialized: true })
      } finally {
        set({ loading: false })
      }
    })()
    try {
      await initializePromise
    } finally {
      initializePromise = null
    }
  },

  sendCode: (phone) => window.cclinkStudio.auth.phoneSendCode(phone),

  login: async (phone, code) => {
    set({ loading: true, error: null })
    try {
      const result = await window.cclinkStudio.auth.phoneLogin(phone, code)
      if (!result.success || !result.user) {
        set({ error: result.error || '登录失败' })
        return false
      }
      set({ session: { loggedIn: true, user: result.user } })
      const realtime = await window.cclinkStudio.cclink.connectRealtime()
      set({ realtime })
      if (realtime.state !== 'online') {
        set({ error: realtime.error || '远程连接失败' })
        return false
      }
      await get().refreshServers()
      return true
    } catch (error) {
      set({ error: message(error) })
      return false
    } finally {
      set({ loading: false })
    }
  },

  logout: async () => {
    await window.cclinkStudio.auth.logout()
    set({
      session: { loggedIn: false, user: null },
      realtime: { state: 'offline' },
      servers: [],
      error: null,
    })
  },

  refreshServers: async () => {
    try {
      const servers = await window.cclinkStudio.cclink.listServers()
      set({ servers, error: null })
    } catch (error) {
      set({ error: message(error) })
    }
  },
}))

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
