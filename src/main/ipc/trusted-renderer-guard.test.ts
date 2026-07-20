import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn() }))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import {
  createTrustedRendererGuard,
  isAllowedMainRendererUrl,
  registerTrustedIpcHandler,
  registerTrustedIpcListener,
} from './trusted-renderer-guard'

beforeEach(() => {
  mockIpcMain.handle.mockReset()
  mockIpcMain.on.mockReset()
})

describe('TrustedRendererGuard', () => {
  it('accepts only the main frame of the configured renderer WebContents', () => {
    const mainFrame = { url: 'http://localhost:5173/settings' }
    const webContents = { isDestroyed: () => false, mainFrame }
    const guard = createTrustedRendererGuard(
      { isDestroyed: () => false, webContents } as never,
      'http://localhost:5173/',
    )

    expect(guard.isTrusted({ sender: webContents, senderFrame: mainFrame } as never)).toBe(true)
    expect(guard.isTrusted({ sender: {}, senderFrame: mainFrame } as never)).toBe(false)
    expect(
      guard.isTrusted({ sender: webContents, senderFrame: { url: mainFrame.url } } as never),
    ).toBe(false)
  })

  it('rejects a trusted WebContents after navigation to another origin', () => {
    const mainFrame = { url: 'https://example.com/' }
    const webContents = { isDestroyed: () => false, mainFrame }
    const guard = createTrustedRendererGuard(
      { isDestroyed: () => false, webContents } as never,
      'http://localhost:5173/',
    )

    expect(() => guard.assert({ sender: webContents, senderFrame: mainFrame } as never)).toThrow(
      'IPC 调用方不是受信任的工作台主页面',
    )
  })

  it('checks the guard before invoking a registered handler', () => {
    const guard = { assert: vi.fn(() => assertNever()), isTrusted: vi.fn(() => false) }
    const handler = vi.fn()
    registerTrustedIpcHandler('test:secure', guard, handler)
    const registered = mockIpcMain.handle.mock.calls[0]?.[1]

    expect(() => registered?.({ sender: {} }, 'value')).toThrow('blocked')
    expect(handler).not.toHaveBeenCalled()
  })

  it('drops an untrusted one-way event before invoking its listener', () => {
    const guard = { assert: vi.fn(), isTrusted: vi.fn(() => false) }
    const listener = vi.fn()
    registerTrustedIpcListener('test:event', guard, listener)
    const registered = mockIpcMain.on.mock.calls[0]?.[1]

    registered?.({ sender: {} }, 'value')
    expect(listener).not.toHaveBeenCalled()

    guard.isTrusted.mockReturnValue(true)
    registered?.({ sender: {} }, 'value')
    expect(listener).toHaveBeenCalledWith({ sender: {} }, 'value')
  })
})

describe('isAllowedMainRendererUrl', () => {
  it('allows same-origin development routes and exact production files', () => {
    expect(
      isAllowedMainRendererUrl('http://localhost:5173/settings', 'http://localhost:5173/'),
    ).toBe(true)
    expect(isAllowedMainRendererUrl('http://127.0.0.1:5173/', 'http://localhost:5173/')).toBe(false)
    expect(
      isAllowedMainRendererUrl('file:///app/index.html#settings', 'file:///app/index.html'),
    ).toBe(true)
    expect(isAllowedMainRendererUrl('file:///app/other.html', 'file:///app/index.html')).toBe(false)
  })
})

function assertNever(): never {
  throw new Error('blocked')
}
