import { create } from 'zustand'
import type { CclinkRemoteMessage, CclinkRemoteSession, CclinkServer } from '@shared/cclink'
import type { AuthServiceStatus, AuthSession } from '@shared/ipc/auth'
import type { CclinkRealtimeEvent, CclinkRealtimeStatus } from '@shared/ipc/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'

interface CclinkState {
  service: AuthServiceStatus | null
  session: AuthSession
  realtime: CclinkRealtimeStatus
  servers: CclinkServer[]
  sessions: CclinkRemoteSession[]
  messages: Record<string, CclinkRemoteMessage[]>
  selectedSessionId: string | null
  initialized: boolean
  loading: boolean
  error: string | null
  initialize(): Promise<void>
  sendCode(phone: string): Promise<{ success: boolean; error?: string }>
  login(phone: string, code: string): Promise<boolean>
  logout(): Promise<void>
  refreshServers(): Promise<void>
  loadSessions(ref: RemoteWorkspaceRef): Promise<void>
  createSession(ref: RemoteWorkspaceRef, name?: string): Promise<CclinkRemoteSession>
  setSessionArchived(sessionId: string, archived: boolean): Promise<void>
  selectSession(sessionId: string | null): void
  loadMessages(sessionId: string): Promise<void>
  sendAgentMessage(ref: RemoteWorkspaceRef, sessionId: string, content: string): Promise<boolean>
  handleRealtimeEvent(event: CclinkRealtimeEvent): void
}

let initializePromise: Promise<void> | null = null
let eventsInstalled = false

export const useCclinkStore = create<CclinkState>((set, get) => ({
  service: null,
  session: { loggedIn: false, user: null },
  realtime: { state: 'idle' },
  servers: [],
  sessions: [],
  messages: {},
  selectedSessionId: null,
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
      window.cclinkStudio.cclink.onRealtimeEvent((event) => get().handleRealtimeEvent(event))
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
      sessions: [],
      messages: {},
      selectedSessionId: null,
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

  loadSessions: async (ref) => {
    set({ loading: true, error: null })
    try {
      const sessions = await window.cclinkStudio.cclink.listSessions(ref)
      const selectedSessionId = sessions.some((item) => item.id === get().selectedSessionId)
        ? get().selectedSessionId
        : (sessions[0]?.id ?? null)
      set({ sessions, selectedSessionId })
      if (selectedSessionId) await get().loadMessages(selectedSessionId)
    } catch (error) {
      set({ error: message(error) })
    } finally {
      set({ loading: false })
    }
  },

  createSession: async (ref, name) => {
    set({ loading: true, error: null })
    try {
      const session = await window.cclinkStudio.cclink.createSession({ ref, name })
      set((state) => ({
        sessions: [session, ...state.sessions.filter((item) => item.id !== session.id)],
        selectedSessionId: session.id,
      }))
      return session
    } catch (error) {
      set({ error: message(error) })
      throw error
    } finally {
      set({ loading: false })
    }
  },

  setSessionArchived: async (sessionId, archived) => {
    try {
      const session = await window.cclinkStudio.cclink.setSessionArchived({
        sessionId,
        archived,
      })
      set((state) => ({
        sessions: state.sessions.map((item) => (item.id === sessionId ? session : item)),
        selectedSessionId:
          archived && state.selectedSessionId === sessionId ? null : state.selectedSessionId,
      }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  selectSession: (selectedSessionId) => set({ selectedSessionId }),

  loadMessages: async (sessionId) => {
    try {
      const messages = await window.cclinkStudio.cclink.listMessages(sessionId)
      set((state) => ({ messages: { ...state.messages, [sessionId]: messages } }))
    } catch (error) {
      set({ error: message(error) })
    }
  },

  sendAgentMessage: async (ref, sessionId, content) => {
    set({ error: null })
    try {
      const result = await window.cclinkStudio.cclink.sendAgentMessage({ ref, sessionId, content })
      if (!result.success) {
        set({ error: result.error || '远程消息发送失败' })
        return false
      }
      return true
    } catch (error) {
      set({ error: message(error) })
      return false
    }
  },

  handleRealtimeEvent: (event) => {
    if (event.type === 'sessions') return
    if (event.type !== 'conversation' || !event.sessionId) return
    set((state) => {
      const sessionId = event.sessionId!
      const current = state.messages[sessionId] ?? []
      const nextMessages = event.message
        ? [...current.filter((item) => item.id !== event.message!.id), event.message]
        : current
      const active = event.phase === 'started' || event.phase === 'streaming'
      return {
        messages: event.message ? { ...state.messages, [sessionId]: nextMessages } : state.messages,
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                status: active ? ('active' as const) : ('idle' as const),
                updatedAt: event.message?.timestamp ?? session.updatedAt,
                messageCount: nextMessages.length,
              }
            : session,
        ),
      }
    })
  },
}))

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
