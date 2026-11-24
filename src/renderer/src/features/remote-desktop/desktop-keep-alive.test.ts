import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../types'
import {
  DESKTOP_KEEP_ALIVE_MS,
  mountedDesktopTabs,
  parkLiveDesktopTabs,
  unparkDesktopTabs,
  useDesktopKeepAliveStore,
} from './desktop-keep-alive'
import { useDesktopSessionStore, type DesktopPhase } from './desktop-session-store'

const desktop = (id: string): Tab => ({
  id,
  type: 'remote-desktop',
  title: '美国 Mac',
  icon: '🖥',
  workspaceRef: { kind: 'local', path: '/projects/a' },
})

function setPhase(id: string, phase: DesktopPhase): void {
  useDesktopSessionStore.getState().publish(id, {
    phase,
    deviceName: '美国 Mac',
    endpoint: '10.0.0.8:5900',
    interrupted: false,
    fullscreen: false,
    pointerSize: 'large',
  })
}

describe('desktop keep-alive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useDesktopSessionStore.setState({ sessions: {} })
  })
  afterEach(() => {
    unparkDesktopTabs(Object.keys(useDesktopKeepAliveStore.getState().parked))
    vi.useRealTimers()
  })

  it('parks only live remote desktops when their project is switched away', () => {
    setPhase('live', 'connected')
    setPhase('auth', 'credentials')
    setPhase('done', 'ended')
    const editor: Tab = { id: 'editor', type: 'editor', title: 'a.md', icon: '📄' }
    parkLiveDesktopTabs([
      desktop('live'),
      desktop('auth'),
      desktop('done'),
      desktop('idle'),
      editor,
    ])
    expect(Object.keys(useDesktopKeepAliveStore.getState().parked).sort()).toEqual(['auth', 'live'])
  })

  it('keeps a parked desktop for ten minutes, then lets it disconnect', () => {
    setPhase('live', 'connected')
    parkLiveDesktopTabs([desktop('live')])
    vi.advanceTimersByTime(DESKTOP_KEEP_ALIVE_MS - 1)
    expect(useDesktopKeepAliveStore.getState().parked.live).toBeDefined()
    vi.advanceTimersByTime(1)
    expect(useDesktopKeepAliveStore.getState().parked.live).toBeUndefined()
  })

  it('returning to the project unparks the Tab and cancels its expiry', () => {
    setPhase('live', 'connected')
    parkLiveDesktopTabs([desktop('live')])
    unparkDesktopTabs(['live', 'other'])
    expect(useDesktopKeepAliveStore.getState().parked).toEqual({})
    // Switching away again starts a fresh window instead of inheriting the old deadline.
    vi.advanceTimersByTime(DESKTOP_KEEP_ALIVE_MS / 2)
    parkLiveDesktopTabs([desktop('live')])
    vi.advanceTimersByTime(DESKTOP_KEEP_ALIVE_MS - 1)
    expect(useDesktopKeepAliveStore.getState().parked.live).toBeDefined()
  })

  it('mounts current desktops first and parked ones once, without duplicates', () => {
    const editor: Tab = { id: 'editor', type: 'editor', title: 'a.md', icon: '📄' }
    const ids = mountedDesktopTabs([desktop('a'), editor], {
      a: desktop('a'),
      b: desktop('b'),
    }).map((tab) => tab.id)
    expect(ids).toEqual(['a', 'b'])
  })
})
