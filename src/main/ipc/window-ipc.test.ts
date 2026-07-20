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
    const webContents = { focus: vi.fn() }
    const mainWindow = createMainWindow(webContents)
    registerWindowIpc(mainWindow as never)

    const handler = mockIpcMain.handlers.get('window:focusRenderer')
    expect(handler?.({ sender: webContents })).toEqual({ success: true })
    expect(webContents.focus).toHaveBeenCalledOnce()
  })

  it('rejects focus requests from another webContents', () => {
    const webContents = { focus: vi.fn() }
    const mainWindow = createMainWindow(webContents)
    registerWindowIpc(mainWindow as never)

    const handler = mockIpcMain.handlers.get('window:focusRenderer')
    expect(handler?.({ sender: {} })).toEqual({ success: false })
    expect(webContents.focus).not.toHaveBeenCalled()
  })
})

function createMainWindow(webContents: { focus: () => void }) {
  return {
    webContents,
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    setFullScreen: vi.fn(),
    reload: vi.fn(),
  }
}
