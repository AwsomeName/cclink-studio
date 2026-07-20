import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerBrowserIpc } from './browser-ipc'

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
  on: vi.fn((channel: string, listener: (...args: any[]) => any) => {
    mockIpcMain.listeners.set(channel, listener)
  }),
}))

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: { showSaveDialog: vi.fn() },
}))

describe('registerBrowserIpc', () => {
  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.listeners.clear()
    mockIpcMain.handle.mockClear()
    mockIpcMain.on.mockClear()
  })

  it('rejects an untrusted sender before navigation', () => {
    const browserManager = createBrowserManager()
    registerBrowserIpc(browserManager as never, createGuard('trusted') as never)

    expect(() =>
      mockIpcMain.handlers.get('browser:navigate')?.(
        { sender: 'other' },
        'tab-1',
        'https://example.com',
      ),
    ).toThrow('untrusted')
    expect(browserManager.navigate).not.toHaveBeenCalled()
  })

  it('blocks executable protocols before navigation', async () => {
    const browserManager = createBrowserManager()
    registerBrowserIpc(browserManager as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('browser:navigate')?.(
        { sender: 'trusted' },
        'tab-1',
        'javascript:alert(1)',
      ),
    ).rejects.toThrow('不允许的浏览器协议')
    expect(browserManager.navigate).not.toHaveBeenCalled()
  })

  it('accepts a trusted bounded navigation request', async () => {
    const browserManager = createBrowserManager()
    registerBrowserIpc(browserManager as never, createGuard('trusted') as never)

    await expect(
      mockIpcMain.handlers.get('browser:navigate')?.(
        { sender: 'trusted' },
        'tab-1',
        'https://example.com',
      ),
    ).resolves.toBeUndefined()
    expect(browserManager.navigate).toHaveBeenCalledWith('tab-1', 'https://example.com')
  })

  it('drops untrusted and malformed workbench bounds', () => {
    const browserManager = createBrowserManager()
    registerBrowserIpc(browserManager as never, createGuard('trusted') as never)
    const listener = mockIpcMain.listeners.get('workbench:bounds')

    listener?.({ sender: 'other' }, { x: 0, y: 0, width: 100, height: 100 })
    listener?.({ sender: 'trusted' }, { x: 0, y: 0, width: Infinity, height: 100 })
    expect(browserManager.updateBounds).not.toHaveBeenCalled()

    listener?.({ sender: 'trusted' }, { x: 0, y: 0, width: 100, height: 100 })
    expect(browserManager.updateBounds).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
  })
})

function createBrowserManager() {
  return {
    navigate: vi.fn(async () => undefined),
    updateBounds: vi.fn(),
  }
}

function createGuard(trustedSender: string) {
  return {
    assert: (event: { sender: string }) => {
      if (event.sender !== trustedSender) throw new Error('untrusted')
    },
    isTrusted: (event: { sender: string }) => event.sender === trustedSender,
  }
}
