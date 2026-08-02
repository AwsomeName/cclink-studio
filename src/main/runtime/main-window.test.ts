import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const webRequest = { onHeadersReceived: vi.fn() }
  const webContents = {
    session: { webRequest },
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    setZoomLevel: vi.fn(),
  }
  const window = {
    webContents,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    isDestroyed: vi.fn(() => false),
    show: vi.fn(),
  }
  return {
    webRequest,
    webContents,
    window,
    BrowserWindow: vi.fn(() => window),
  }
})

vi.mock('electron', () => ({
  BrowserWindow: electronMocks.BrowserWindow,
  ipcMain: { handle: vi.fn() },
}))

import { buildMainRendererCsp, createMainWindow } from './main-window'

describe('createMainWindow security boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates the privileged renderer with isolation and Chromium sandboxing', () => {
    createMainWindow({
      isDev: false,
      preloadPath: '/tmp/preload.js',
      rendererHtmlPath: '/tmp/index.html',
    })

    expect(electronMocks.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: {
          preload: '/tmp/preload.js',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      }),
    )
    expect(electronMocks.window.loadFile).toHaveBeenCalledWith('/tmp/index.html')
    expect(electronMocks.webContents.setWindowOpenHandler).toHaveBeenCalledOnce()
    expect(electronMocks.webContents.setZoomLevel).toHaveBeenCalledWith(0)
  })

  it('applies the persisted app zoom before loading the renderer', () => {
    createMainWindow({
      isDev: false,
      preloadPath: '/tmp/preload.js',
      rendererHtmlPath: '/tmp/index.html',
      appZoomLevel: -1,
    })

    expect(electronMocks.webContents.setZoomLevel).toHaveBeenCalledWith(-1)
    expect(electronMocks.webContents.setZoomLevel.mock.invocationCallOrder[0]).toBeLessThan(
      electronMocks.window.loadFile.mock.invocationCallOrder[0],
    )
  })

  it('injects a production CSP without development script or network exceptions', () => {
    createMainWindow({
      isDev: false,
      preloadPath: '/tmp/preload.js',
      rendererHtmlPath: '/tmp/index.html',
    })

    const listener = electronMocks.webRequest.onHeadersReceived.mock.calls[0]?.[1]
    const callback = vi.fn()
    listener?.(
      {
        resourceType: 'mainFrame',
        url: 'file:///tmp/index.html',
        responseHeaders: { Existing: ['value'] },
      },
      callback,
    )

    const csp = callback.mock.calls[0]?.[0].responseHeaders['Content-Security-Policy'][0]
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('localhost')
    expect(csp).not.toContain('ws:')
  })

  it('allows only the configured Vite origin in development CSP', () => {
    const csp = buildMainRendererCsp('http://localhost:5173/', true)

    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain('connect-src')
    expect(csp).toContain('http://localhost:5173')
    expect(csp).toContain('ws://localhost:5173')
    expect(csp).not.toContain('unsafe-eval')
  })

  it('blocks main renderer navigation away from its configured entry', () => {
    createMainWindow({
      isDev: true,
      preloadPath: '/tmp/preload.js',
      rendererUrl: 'http://localhost:5173/',
      rendererHtmlPath: '/tmp/index.html',
    })
    const listener = electronMocks.webContents.on.mock.calls.find(
      ([eventName]) => eventName === 'will-navigate',
    )?.[1]
    const blockedEvent = { preventDefault: vi.fn() }
    const allowedEvent = { preventDefault: vi.fn() }

    listener?.(blockedEvent, 'https://example.com/')
    listener?.(allowedEvent, 'http://localhost:5173/settings')

    expect(blockedEvent.preventDefault).toHaveBeenCalledOnce()
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled()
  })
})
