import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerWindowIpc } from './window-ipc'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
}))

describe('registerWindowIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.handle.mockClear()
  })

  it('moves native focus back to the trusted workbench renderer', () => {
    const webContents = createWebContents()
    const mainWindow = createMainWindow(webContents)
    registerWindowIpc(mainWindow as never, createGuard(webContents) as never)

    const handler = mockIpcMain.handlers.get('window:focusRenderer')
    expect(handler?.({ sender: webContents })).toEqual({ success: true })
    expect(webContents.focus).toHaveBeenCalledOnce()
  })

  it('rejects focus requests from another webContents', () => {
    const webContents = createWebContents()
    const mainWindow = createMainWindow(webContents)
    registerWindowIpc(mainWindow as never, createGuard(webContents) as never)

    const handler = mockIpcMain.handlers.get('window:focusRenderer')
    expect(() => handler?.({ sender: {} })).toThrow('untrusted')
    expect(webContents.focus).not.toHaveBeenCalled()
  })

  it('routes a trusted close request through BrowserWindow.close', () => {
    const webContents = createWebContents()
    const mainWindow = createMainWindow(webContents)
    registerWindowIpc(mainWindow as never, createGuard(webContents) as never)

    const handler = mockIpcMain.handlers.get('window:requestClose')
    expect(handler?.({ sender: webContents })).toEqual({ success: true })
    expect(mainWindow.close).toHaveBeenCalledOnce()
  })

  it('intercepts Cmd+W while recording and forwards the captured chord', () => {
    const webContents = createWebContents()
    const mainWindow = createMainWindow(webContents)
    registerWindowIpc(mainWindow as never, createGuard(webContents) as never)

    const guardHandler = mockIpcMain.handlers.get('window:setShortcutCaptureGuard')
    expect(
      guardHandler?.(
        { sender: webContents },
        { sessionId: 'capture-1', active: true, timeoutMs: 30_000 },
      ),
    ).toEqual({ success: true })

    const event = { preventDefault: vi.fn() }
    webContents.listeners.get('before-input-event')?.(event, {
      type: 'keyDown',
      code: 'KeyW',
      meta: process.platform === 'darwin',
      control: process.platform !== 'darwin',
      alt: false,
      shift: false,
    })

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(webContents.send).toHaveBeenCalledWith('window:shortcutCaptureInput', {
      sessionId: 'capture-1',
      chord: { code: 'KeyW', modifiers: ['primary'] },
    })
  })
})

function createWebContents() {
  return {
    focus: vi.fn(),
    send: vi.fn(),
    toggleDevTools: vi.fn(),
    listeners: new Map<string, (...args: any[]) => void>(),
    on: vi.fn(function (
      this: { listeners: Map<string, (...args: any[]) => void> },
      channel,
      listener,
    ) {
      this.listeners.set(channel, listener)
    }),
  }
}

function createMainWindow(webContents = createWebContents()) {
  return {
    webContents,
    on: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    setFullScreen: vi.fn(),
    reload: vi.fn(),
    close: vi.fn(),
  }
}

function createGuard(webContents: object) {
  return {
    assert: (event: { sender: object }) => {
      if (event.sender !== webContents) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: object }) => event.sender === webContents,
  }
}
