import { create } from 'zustand'

export interface BrowserFindSession {
  open: boolean
  query: string
  matches: number
  activeMatchOrdinal: number
  requestToken: string | null
  runtimeGeneration: number | null
  error: string | null
}

interface BrowserFindState {
  sessions: Record<string, BrowserFindSession>
  shortcutSync: {
    status: 'pending' | 'synced' | 'error'
    configVersion: number | null
    message: string | null
  }
  shortcutSyncRevision: number
  open: (tabId: string) => void
  close: (tabId: string) => void
  remove: (tabId: string) => void
  setQuery: (tabId: string, query: string) => void
  beginRequest: (tabId: string, requestToken: string, runtimeGeneration: number) => void
  applyResult: (
    tabId: string,
    input: {
      requestToken: string
      runtimeGeneration: number
      matches: number
      activeMatchOrdinal: number
    },
  ) => void
  setError: (tabId: string, message: string) => void
  setShortcutSync: (state: BrowserFindState['shortcutSync']) => void
  retryShortcutSync: () => void
}

const emptySession = (): BrowserFindSession => ({
  open: false,
  query: '',
  matches: 0,
  activeMatchOrdinal: 0,
  requestToken: null,
  runtimeGeneration: null,
  error: null,
})

export const useBrowserFindStore = create<BrowserFindState>((set) => ({
  sessions: {},
  shortcutSync: { status: 'pending', configVersion: null, message: null },
  shortcutSyncRevision: 0,
  open: (tabId) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [tabId]: { ...(state.sessions[tabId] ?? emptySession()), open: true, error: null },
      },
    })),
  close: (tabId) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [tabId]: { ...(state.sessions[tabId] ?? emptySession()), open: false, error: null },
      },
    })),
  remove: (tabId) =>
    set((state) => {
      const { [tabId]: _removed, ...sessions } = state.sessions
      return { sessions }
    }),
  setQuery: (tabId, query) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [tabId]: {
          ...(state.sessions[tabId] ?? emptySession()),
          query,
          matches: query ? (state.sessions[tabId]?.matches ?? 0) : 0,
          activeMatchOrdinal: query ? (state.sessions[tabId]?.activeMatchOrdinal ?? 0) : 0,
          error: null,
        },
      },
    })),
  beginRequest: (tabId, requestToken, runtimeGeneration) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [tabId]: {
          ...(state.sessions[tabId] ?? emptySession()),
          requestToken,
          runtimeGeneration,
          error: null,
        },
      },
    })),
  applyResult: (tabId, input) =>
    set((state) => {
      const session = state.sessions[tabId]
      if (
        !session?.open ||
        session.requestToken !== input.requestToken ||
        session.runtimeGeneration !== input.runtimeGeneration
      ) {
        return state
      }
      return {
        sessions: {
          ...state.sessions,
          [tabId]: {
            ...session,
            matches: input.matches,
            activeMatchOrdinal: input.activeMatchOrdinal,
          },
        },
      }
    }),
  setError: (tabId, message) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [tabId]: { ...(state.sessions[tabId] ?? emptySession()), error: message },
      },
    })),
  setShortcutSync: (shortcutSync) => set({ shortcutSync }),
  retryShortcutSync: () =>
    set((state) => ({ shortcutSyncRevision: state.shortcutSyncRevision + 1 })),
}))
