import { create } from 'zustand'

export type DesktopPhase = 'idle' | 'connecting' | 'credentials' | 'connected' | 'ended'

/**
 * Read-only projection of a remote desktop Tab's live connection. The Tab component is the
 * single writer; the status bar and tab bar only read it and send commands through the Tab's
 * registered controller. Nothing here is persisted.
 */
export interface DesktopSessionView {
  phase: DesktopPhase
  deviceName: string
  endpoint: string
  /** The last connection ended unexpectedly (not by the user). */
  interrupted: boolean
  fullscreen: boolean
}

export interface DesktopSessionController {
  setView(view: 'fit' | 'original'): void
  setFullscreen(fullscreen: boolean): void
  reconnect(): void
  disconnect(): void
}

interface DesktopSessionState {
  sessions: Record<string, DesktopSessionView>
  publish(tabId: string, view: DesktopSessionView | null): void
}

export const useDesktopSessionStore = create<DesktopSessionState>((set) => ({
  sessions: {},
  publish: (tabId, view) =>
    set((state) => {
      if (!view) {
        if (!(tabId in state.sessions)) return state
        const next = { ...state.sessions }
        delete next[tabId]
        return { sessions: next }
      }
      const current = state.sessions[tabId]
      if (
        current &&
        current.phase === view.phase &&
        current.deviceName === view.deviceName &&
        current.endpoint === view.endpoint &&
        current.interrupted === view.interrupted &&
        current.fullscreen === view.fullscreen
      )
        return state
      return { sessions: { ...state.sessions, [tabId]: view } }
    }),
}))

const controllers = new Map<string, DesktopSessionController>()

export function registerDesktopController(
  tabId: string,
  controller: DesktopSessionController,
): () => void {
  controllers.set(tabId, controller)
  return () => {
    if (controllers.get(tabId) === controller) controllers.delete(tabId)
  }
}

export function getDesktopController(tabId: string): DesktopSessionController | undefined {
  return controllers.get(tabId)
}

/** Live = has an active or in-progress connection, which earns the wider tab treatment. */
export function isDesktopSessionLive(view: DesktopSessionView | undefined): boolean {
  return !!view && view.phase !== 'idle' && view.phase !== 'ended'
}

export function desktopStatusLabel(view: DesktopSessionView): string {
  switch (view.phase) {
    case 'connected':
      return '已连接'
    case 'credentials':
      return '等待认证'
    case 'connecting':
      return '正在连接'
    default:
      return view.interrupted ? '已中断' : '已断开'
  }
}
