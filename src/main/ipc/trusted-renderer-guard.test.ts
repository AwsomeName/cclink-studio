import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcMain = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))

import {
  createTrustedRendererGuard,
  createTrustedIpcRegistrar,
  disposeTrustedIpcRegistrations,
  isAllowedMainRendererUrl,
  registerTrustedIpcHandler,
  registerTrustedIpcContract,
  registerTrustedIpcListener,
} from './trusted-renderer-guard'
import { defineIpcInvoke, defineNoArgsIpc } from '../../shared/ipc/contract'

beforeEach(() => {
  mockIpcMain.handle.mockReset()
  mockIpcMain.on.mockReset()
  mockIpcMain.removeHandler.mockReset()
  mockIpcMain.removeListener.mockReset()
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

  it('provides integrations only a trusted handler registrar', () => {
    const guard = { assert: vi.fn(() => assertNever()), isTrusted: vi.fn(() => false) }
    const handler = vi.fn()
    createTrustedIpcRegistrar(guard).handle('integration:secure', handler)
    const registered = mockIpcMain.handle.mock.calls[0]?.[1]

    expect(() => registered?.({ sender: {} }, 'value')).toThrow('blocked')
    expect(handler).not.toHaveBeenCalled()
  })

  it('disposes exactly the handlers and listeners registered by one window scope', () => {
    const mainFrame = { url: 'http://localhost:5173/' }
    const webContents = { isDestroyed: () => false, mainFrame }
    const guard = createTrustedRendererGuard(
      { isDestroyed: () => false, webContents } as never,
      'http://localhost:5173/',
    )
    registerTrustedIpcHandler('test:scoped-handler', guard, vi.fn())
    registerTrustedIpcListener('test:scoped-listener', guard, vi.fn())
    const registeredListener = mockIpcMain.on.mock.calls[0]?.[1]

    disposeTrustedIpcRegistrations(guard)
    disposeTrustedIpcRegistrations(guard)

    expect(mockIpcMain.removeHandler).toHaveBeenCalledTimes(1)
    expect(mockIpcMain.removeHandler).toHaveBeenCalledWith('test:scoped-handler')
    expect(mockIpcMain.removeListener).toHaveBeenCalledTimes(1)
    expect(mockIpcMain.removeListener).toHaveBeenCalledWith(
      'test:scoped-listener',
      registeredListener,
    )
  })

  it('rejects duplicate handlers inside the same registration scope', () => {
    const mainFrame = { url: 'http://localhost:5173/' }
    const webContents = { isDestroyed: () => false, mainFrame }
    const guard = createTrustedRendererGuard(
      { isDestroyed: () => false, webContents } as never,
      'http://localhost:5173/',
    )

    registerTrustedIpcHandler('test:duplicate', guard, vi.fn())

    expect(() => registerTrustedIpcHandler('test:duplicate', guard, vi.fn())).toThrow(
      'IPC handler 重复注册',
    )
  })

  it('parses shared contract arguments before invoking a handler', () => {
    const guard = { assert: vi.fn(), isTrusted: vi.fn(() => true) }
    const handler = vi.fn(() => ({ success: true }))
    registerTrustedIpcContract(defineNoArgsIpc('test:contract'), guard, handler)
    const registered = mockIpcMain.handle.mock.calls[0]?.[1]

    expect(() => registered?.({ sender: {} }, 'unexpected')).toThrow('不接受参数')
    expect(handler).not.toHaveBeenCalled()
    expect(registered?.({ sender: {} })).toEqual({ success: true })
  })

  it('maps parser failures without swallowing handler failures', async () => {
    const guard = { assert: vi.fn(), isTrusted: vi.fn(() => true) }
    const contract = defineIpcInvoke<[string], { success: boolean }>(
      'test:mapped-contract',
      (args) => {
        if (typeof args[0] !== 'string') throw new Error('invalid argument')
        return [args[0]]
      },
      async () => ({ success: false }),
    )
    const handler = vi.fn((_event: unknown, _value: string) => {
      throw new Error('handler failed')
    })
    registerTrustedIpcContract(contract, guard, handler)
    const registered = mockIpcMain.handle.mock.calls[0]?.[1]

    await expect(registered?.({ sender: {} }, 42)).resolves.toEqual({ success: false })
    expect(() => registered?.({ sender: {} }, 'valid')).toThrow('handler failed')
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
