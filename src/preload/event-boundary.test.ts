import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentIpcEvents } from '../shared/ipc/agent'
import { authIpcEvents, type AuthApiContract } from '../shared/ipc/auth'
import { browserIpcEvents } from '../shared/ipc/browser'
import { cclinkIpcEvents, type CclinkApiContract } from '../shared/ipc/cclink'
import { fsIpcEvents, type FsApiContract } from '../shared/ipc/fs'
import { windowIpcEvents, type WindowApiContract } from '../shared/ipc/window'
import {
  mediaProjectsIpcEvents,
  type MediaProjectsApiContract,
} from '../shared/media-production/media-project-contract'
import {
  scheduledTasksIpcEvents,
  type ScheduledTasksApiContract,
} from '../shared/scheduled-task/scheduled-task-contract'

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
    ipcRenderer.invoke.mockReset()
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

  it('drops malformed events from the aggregate preload before invoking renderer callbacks', async () => {
    await import('./index')
    const [, exposed] = exposeInMainWorld.mock.calls.at(-1) as [
      string,
      {
        auth: AuthApiContract
        cclink: CclinkApiContract
        fs: FsApiContract
        window: WindowApiContract
        scheduledTasks: ScheduledTasksApiContract
        mediaProjects: MediaProjectsApiContract
      },
    ]
    const authCallback = vi.fn()
    const statusCallback = vi.fn()
    const realtimeCallback = vi.fn()
    const progressCallback = vi.fn()
    const shortcutCallback = vi.fn()
    const scheduledCallback = vi.fn()
    const mediaCallback = vi.fn()
    const fsCallback = vi.fn()
    exposed.auth.onSessionChanged(authCallback)
    exposed.cclink.onRealtimeStatus(statusCallback)
    exposed.cclink.onRealtimeEvent(realtimeCallback)
    exposed.cclink.onImageUploadProgress(progressCallback)
    exposed.window.onShortcutCaptureInput(shortcutCallback)
    exposed.scheduledTasks.onChanged(scheduledCallback)
    exposed.mediaProjects.onChanged(mediaCallback)
    ipcRenderer.invoke.mockResolvedValueOnce('watch-1')
    await exposed.fs.watchDir('/workspace', fsCallback)

    listeners.get(authIpcEvents.sessionChanged)?.({}, { loggedIn: true, user: { id: 'user-1' } })
    listeners.get(cclinkIpcEvents.realtimeStatus)?.({}, { state: 'connected' })
    listeners.get(cclinkIpcEvents.realtimeEvent)?.({}, { type: 'server', serverId: '' })
    listeners.get(cclinkIpcEvents.imageUploadProgress)?.({}, { uploadId: 'upload-1' })
    listeners.get(windowIpcEvents.shortcutCaptureInput)?.({}, { sessionId: 'capture-1' })
    listeners.get(scheduledTasksIpcEvents.changed)?.({}, '')
    listeners.get(mediaProjectsIpcEvents.changed)?.({}, 42)
    listeners.get(fsIpcEvents.watchDirChanged)?.({}, { watchId: 'watch-1', event: 'rename' })
    expect(authCallback).not.toHaveBeenCalled()
    expect(statusCallback).not.toHaveBeenCalled()
    expect(realtimeCallback).not.toHaveBeenCalled()
    expect(progressCallback).not.toHaveBeenCalled()
    expect(shortcutCallback).not.toHaveBeenCalled()
    expect(scheduledCallback).not.toHaveBeenCalled()
    expect(mediaCallback).not.toHaveBeenCalled()
    expect(fsCallback).not.toHaveBeenCalled()

    const session = { loggedIn: false, user: null }
    const status = { state: 'online' as const }
    const realtime = { type: 'server' as const, serverId: 'server-1' }
    const progress = {
      uploadId: 'upload-1',
      imageIndex: 0,
      imageCount: 1,
      loadedBytes: 1,
      totalBytes: 1,
      percent: 100,
      phase: 'completed' as const,
    }
    const shortcut = {
      sessionId: 'capture-1',
      chord: { code: 'KeyK', modifiers: ['primary' as const] },
    }
    const fsChange = { watchId: 'watch-1', event: 'change' as const, filePath: '/workspace/a.md' }
    listeners.get(authIpcEvents.sessionChanged)?.({}, session)
    listeners.get(cclinkIpcEvents.realtimeStatus)?.({}, status)
    listeners.get(cclinkIpcEvents.realtimeEvent)?.({}, realtime)
    listeners.get(cclinkIpcEvents.imageUploadProgress)?.({}, progress)
    listeners.get(windowIpcEvents.shortcutCaptureInput)?.({}, shortcut)
    listeners.get(scheduledTasksIpcEvents.changed)?.({}, '/workspace')
    listeners.get(mediaProjectsIpcEvents.changed)?.({}, '/workspace')
    listeners.get(fsIpcEvents.watchDirChanged)?.({}, fsChange)
    expect(authCallback).toHaveBeenCalledWith(session)
    expect(statusCallback).toHaveBeenCalledWith(status)
    expect(realtimeCallback).toHaveBeenCalledWith(realtime)
    expect(progressCallback).toHaveBeenCalledWith(progress)
    expect(shortcutCallback).toHaveBeenCalledWith(shortcut)
    expect(scheduledCallback).toHaveBeenCalledWith('/workspace')
    expect(mediaCallback).toHaveBeenCalledWith('/workspace')
    expect(fsCallback).toHaveBeenCalledWith(fsChange)
  })
})
