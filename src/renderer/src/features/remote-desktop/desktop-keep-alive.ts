import { create } from 'zustand'
import type { Tab } from '../../types'
import { isDesktopSessionLive, useDesktopSessionStore } from './desktop-session-store'

/** How long a live remote desktop survives after its project is switched away. */
export const DESKTOP_KEEP_ALIVE_MS = 10 * 60_000

/**
 * Remote desktop Tabs whose project was switched away while connected. The Workbench keeps
 * their component mounted (hidden, view-only) so the VNC session survives; switching back
 * restores the same Tab id and the same connection. Closing a Tab is not parking: it still
 * unmounts and disconnects at once. Nothing here is persisted.
 */
interface DesktopKeepAliveState {
  parked: Record<string, Tab>
}

export const useDesktopKeepAliveStore = create<DesktopKeepAliveState>(() => ({ parked: {} }))

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function release(ids: string[]): void {
  const { parked } = useDesktopKeepAliveStore.getState()
  const gone = ids.filter((id) => id in parked)
  for (const id of ids) {
    clearTimeout(timers.get(id))
    timers.delete(id)
  }
  if (gone.length === 0) return
  const next = { ...parked }
  for (const id of gone) delete next[id]
  useDesktopKeepAliveStore.setState({ parked: next })
}

/** Park the live remote desktop Tabs among `leaving`; idle or ended ones are simply dropped. */
export function parkLiveDesktopTabs(leaving: readonly Tab[], ttlMs = DESKTOP_KEEP_ALIVE_MS): void {
  const sessions = useDesktopSessionStore.getState().sessions
  const live = leaving.filter(
    (tab) => tab.type === 'remote-desktop' && isDesktopSessionLive(sessions[tab.id]),
  )
  if (live.length === 0) return
  const next = { ...useDesktopKeepAliveStore.getState().parked }
  for (const tab of live) {
    clearTimeout(timers.get(tab.id))
    timers.set(
      tab.id,
      setTimeout(() => release([tab.id]), ttlMs),
    )
    next[tab.id] = tab
  }
  useDesktopKeepAliveStore.setState({ parked: next })
}

/** Unpark Tabs that are back in the Workbench; their component stays mounted throughout. */
export function unparkDesktopTabs(presentIds: Iterable<string>): void {
  release([...presentIds])
}

/** Remote desktop Tabs to mount: the current ones plus parked ones from other projects. */
export function mountedDesktopTabs(tabs: readonly Tab[], parked: Record<string, Tab>): Tab[] {
  const current = tabs.filter((tab) => tab.type === 'remote-desktop')
  const ids = new Set(current.map((tab) => tab.id))
  return [...current, ...Object.values(parked).filter((tab) => !ids.has(tab.id))]
}
