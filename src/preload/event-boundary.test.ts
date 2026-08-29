import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentIpcEvents } from '../shared/ipc/agent'
import { authIpcEvents, type AuthApiContract } from '../shared/ipc/auth'
import { browserIpcEvents } from '../shared/ipc/browser'

const listeners = new Map<string, (...args: unknown[]) => void>()
const exposeInMainWorld = vi.fn()
const ipcRenderer = {
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    listeners.set(channel, listener)
  }),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
}

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer,
}))

describe('preload event boundaries', () => {
  beforeEach(() => {
    listeners.clear()
    exposeInMainWorld.mockClear()
    ipcRenderer.on.mockClear()
  })

  it('drops malformed Agent and Browser events before invoking renderer callbacks', async () => {
    const { agentApi } = await import('./agent-api')
    const { browserApi } = await import('./browser-api')
    const onAgentError = vi.fn()
    const onBrowserUrl = vi.fn()
    agentApi.onError(onAgentError)
    browserApi.onUrlChanged(onBrowserUrl)

    listeners.get(agentIpcEvents.error)?.({}, { message: 42 })
    listeners.get(browserIpcEvents.urlChanged)?.({}, { tabId: 'tab-1' })
    expect(onAgentError).not.toHaveBeenCalled()
    expect(onBrowserUrl).not.toHaveBeenCalled()

    const agentError = { message: 'failed' }
    const browserUrl = { tabId: 'tab-1', url: 'https://example.com' }
    listeners.get(agentIpcEvents.error)?.({}, agentError)
    listeners.get(browserIpcEvents.urlChanged)?.({}, browserUrl)
    expect(onAgentError).toHaveBeenCalledWith(agentError)
    expect(onBrowserUrl).toHaveBeenCalledWith(browserUrl)
  })

  it('drops malformed Auth sessions before invoking renderer callbacks', async () => {
    await import('./index')
    const [, exposed] = exposeInMainWorld.mock.calls.at(-1) as [string, { auth: AuthApiContract }]
    const callback = vi.fn()
    exposed.auth.onSessionChanged(callback)

    listeners.get(authIpcEvents.sessionChanged)?.({}, { loggedIn: true, user: { id: 'user-1' } })
    expect(callback).not.toHaveBeenCalled()

    const session = { loggedIn: false, user: null }
    listeners.get(authIpcEvents.sessionChanged)?.({}, session)
    expect(callback).toHaveBeenCalledWith(session)
  })
})
