import { beforeEach, describe, expect, it, vi } from 'vitest'

const exposeInMainWorld = vi.fn()
const ipcRenderer = {
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
}

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer,
}))

describe('preload API surface', () => {
  beforeEach(() => {
    exposeInMainWorld.mockClear()
  })

  it('exposes the stable workbench capabilities without retired renderer channels', async () => {
    await import('./index')

    expect(exposeInMainWorld).toHaveBeenCalledOnce()
    const [name, api] = exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('cclinkStudio')
    expect(api).toEqual(
      expect.objectContaining({
        reportWorkbenchBounds: expect.any(Function),
        window: expect.any(Object),
        browser: expect.any(Object),
        android: expect.any(Object),
        dataSource: expect.any(Object),
      }),
    )
    expect(api).not.toHaveProperty('meshy')

    expect(api.window).toEqual(
      expect.objectContaining({
        toggleFullscreen: expect.any(Function),
        focusRenderer: expect.any(Function),
      }),
    )
    expect(api.android).not.toHaveProperty('shell')
    expect(api.android).not.toHaveProperty('pushFile')
    expect(api.android).not.toHaveProperty('uninstallPackage')
    expect(api.dataSource).not.toHaveProperty('updateSource')
    expect(api.dataSource).not.toHaveProperty('deleteSource')
    expect(api.dataSource).not.toHaveProperty('getRecord')
  })
})
