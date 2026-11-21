import { describe, expect, it, vi } from 'vitest'
import {
  desktopStatusLabel,
  getDesktopController,
  isDesktopSessionLive,
  registerDesktopController,
  useDesktopSessionStore,
  type DesktopSessionView,
} from './desktop-session-store'

const view = (patch: Partial<DesktopSessionView> = {}): DesktopSessionView => ({
  phase: 'connected',
  deviceName: '美国 Mac',
  endpoint: '10.0.0.8:5900',
  interrupted: false,
  fullscreen: false,
  ...patch,
})

describe('desktop session store', () => {
  it('publishes, skips identical updates, and removes a Tab projection', () => {
    const store = useDesktopSessionStore
    store.getState().publish('tab-1', view())
    const first = store.getState().sessions
    store.getState().publish('tab-1', view())
    expect(store.getState().sessions).toBe(first)
    store.getState().publish('tab-1', view({ fullscreen: true }))
    expect(store.getState().sessions['tab-1']?.fullscreen).toBe(true)
    store.getState().publish('tab-1', null)
    expect(store.getState().sessions['tab-1']).toBeUndefined()
  })

  it('labels phases and treats only in-progress or connected sessions as live', () => {
    expect(isDesktopSessionLive(view({ phase: 'credentials' }))).toBe(true)
    expect(isDesktopSessionLive(view({ phase: 'ended', interrupted: true }))).toBe(false)
    expect(desktopStatusLabel(view({ phase: 'ended', interrupted: true }))).toBe('已中断')
    expect(desktopStatusLabel(view({ phase: 'ended' }))).toBe('已断开')
  })

  it('only removes the controller that is still registered for the Tab', () => {
    const a = { setView: vi.fn(), setFullscreen: vi.fn(), reconnect: vi.fn(), disconnect: vi.fn() }
    const b = { ...a, disconnect: vi.fn() }
    const releaseA = registerDesktopController('tab-2', a)
    registerDesktopController('tab-2', b)
    releaseA()
    expect(getDesktopController('tab-2')).toBe(b)
  })
})
