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
  activeSessionsRef: RemoteWorkspaceRef | null
  pendingPermissions: Array<{
    serverId: string
    requestId: string
    path: string
    operation: string
  }>
  initialized: boolean
  loading: boolean
  error: string | null
  initialize(): Promise<void>
  connectRealtime(): Promise<boolean>
  sendCode(phone: string): Promise<{ success: boolean; error?: string }>
  login(phone: string, code: string): Promise<boolean>
  logout(): Promise<void>
  refreshServers(): Promise<void>
  loadSessions(ref: RemoteWorkspaceRef): Promise<void>
  createSession(
    ref: RemoteWorkspaceRef,
    name?: string,
    options?: { select?: boolean },
  ): Promise<CclinkRemoteSession>
  setSessionArchived(sessionId: string, archived: boolean): Promise<boolean>
  selectSession(sessionId: string | null): void
  loadMessages(sessionId: string): Promise<void>
  sendAgentMessage(ref: RemoteWorkspaceRef, sessionId: string, content: string): Promise<boolean>
  respondPermission(serverId: string, requestId: string, approved: boolean): Promise<void>
  handleRealtimeEvent(event: CclinkRealtimeEvent): void
}

let initializePromise: Promise<void> | null = null
let eventsInstalled = false
let sessionsRequestGeneration = 0

export const useCclinkStore = create<CclinkState>((set, get) => ({
  service: null,
  session: { loggedIn: false, user: null },
  realtime: { state: 'idle' },
  servers: [],
  sessions: [],
  messages: {},
  selectedSessionId: null,
  activeSessionsRef: null,
  pendingPermissions: [],
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
        // 恢复登录状态本身不启动腾讯 IM；显式远程入口和已打开远程项目由生命周期控制器决定连接。
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

  connectRealtime: async () => {
    await get().initialize()
    const state = get()
    if (!state.service?.configured || !state.session.loggedIn || state.session.offline) return false
    if (state.realtime.state === 'online') return true
    set({ loading: true, error: null })
    try {
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
      return get().connectRealtime()
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
      activeSessionsRef: null,
      pendingPermissions: [],
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
    const generation = ++sessionsRequestGeneration
    set({ activeSessionsRef: ref })
    set({ loading: true, error: null })
    try {
      const sessions = await window.cclinkStudio.cclink.listSessions(ref)
      if (generation !== sessionsRequestGeneration) return
      const selectedSessionId = sessions.some((item) => item.id === get().selectedSessionId)
        ? get().selectedSessionId
        : (sessions[0]?.id ?? null)
      set({ sessions, selectedSessionId })
      if (selectedSessionId) await get().loadMessages(selectedSessionId)
    } catch (error) {
      if (generation === sessionsRequestGeneration) set({ error: message(error) })
    } finally {
      if (generation === sessionsRequestGeneration) set({ loading: false })
    }
  },

  createSession: async (ref, name, options) => {
    set({ loading: true, error: null })
    try {
      const session = await window.cclinkStudio.cclink.createSession({ ref, name })
      set((state) => ({
        sessions: [session, ...state.sessions.filter((item) => item.id !== session.id)],
        selectedSessionId: options?.select === false ? state.selectedSessionId : session.id,
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
      return true
    } catch (error) {
      set({ error: message(error) })
      return false
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

  respondPermission: async (serverId, requestId, approved) => {
    const result = await window.cclinkStudio.cclink.respondPermission({
      serverId,
      requestId,
      approved,
      remember: false,
    })
    if (!result.success) {
      set({ error: result.error || '远程权限响应失败' })
      return
    }
    set((state) => ({
      pendingPermissions: state.pendingPermissions.filter(
        (permission) => permission.requestId !== requestId,
      ),
    }))
  },

  handleRealtimeEvent: (event) => {
    if (event.type === 'permission' && event.permission) {
      set((state) => ({
        pendingPermissions: [
          ...state.pendingPermissions.filter(
            (permission) => permission.requestId !== event.permission!.requestId,
          ),
          { serverId: event.serverId, ...event.permission! },
        ],
      }))
      return
    }
    if (event.type === 'sessions') {
      const ref = get().activeSessionsRef
      if (!ref || ref.endpointId !== event.serverId || !event.sessions) return
      const sessions = event.sessions.filter((session) => session.workspaceId === ref.workspaceId)
      set((state) => ({
        sessions,
        selectedSessionId: sessions.some((session) => session.id === state.selectedSessionId)
          ? state.selectedSessionId
          : (sessions[0]?.id ?? null),
      }))
      return
    }
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
