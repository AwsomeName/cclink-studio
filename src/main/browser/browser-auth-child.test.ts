import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BIGMODEL_AUTH_COOKIE, type BrowserAuthChildOptions } from './browser-auth-contract'

const state = vi.hoisted(() => ({ windows: [] as any[], session: null as any }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url,
      getUserAgent: () => 'Mozilla/5.0 Chrome/150.0 Electron/43.1.1',
      setUserAgent: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    })
    url = ''
    show = vi.fn()
    focus = vi.fn()
    constructor(readonly options: unknown) {
      super()
      state.windows.push(this)
    }
    isDestroyed() {
      return this.destroyed
    }
    async loadURL(url: string) {
      this.url = url
    }
    close() {
      if (!this.destroyed) {
        this.destroyed = true
        this.emit('closed')
      }
    }
  }
  return { BrowserWindow: Window, session: { fromPartition: vi.fn(() => state.session) } }
})

import { runBrowserAuthChild } from './browser-auth-child'

const options: BrowserAuthChildOptions = {
  requestId: 'auth-child-request',
  tabId: 'account-tab',
  profileId: 'web-account-a',
  runtimeGeneration: 4,
  provider: 'bigmodel',
  url: 'https://bigmodel.cn/login',
  userDataPath: '/tmp/unused-child-test',
}
const token = {
  name: BIGMODEL_AUTH_COOKIE,
  value: 'fixture-auth-state',
  domain: '.bigmodel.cn',
  path: '/',
  secure: true,
  httpOnly: false,
  session: false,
  sameSite: 'no_restriction' as const,
  expirationDate: Date.now() / 1000 + 3600,
}

let previousSend: PropertyDescriptor | undefined
let previousListeners: unknown[]
let send: ReturnType<typeof vi.fn>

beforeEach(() => {
  state.windows.length = 0
  const cookies = Object.assign(new EventEmitter(), {
    get: vi.fn().mockResolvedValue([token]),
    flushStore: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  })
  state.session = { cookies, flushStorageData: vi.fn().mockResolvedValue(undefined) }
  send = vi.fn()
  previousSend = Object.getOwnPropertyDescriptor(process, 'send')
  Object.defineProperty(process, 'send', { configurable: true, value: send })
  previousListeners = process.listeners('message')
})
afterEach(() => {
  for (const window of state.windows) window.close()
  for (const listener of process.listeners('message')) {
    if (!previousListeners.includes(listener)) process.removeListener('message', listener)
  }
  if (previousSend) Object.defineProperty(process, 'send', previousSend)
  else Reflect.deleteProperty(process, 'send')
  vi.restoreAllMocks()
})

async function control(value: unknown) {
  const handler = process
    .listeners('message')
    .find((listener) => !previousListeners.includes(listener))
  if (!handler) throw new Error('Authentication control listener missing')
  return handler(value, undefined)
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

describe('BigModel authentication child', () => {
  it('opens an isolated native window and does not report a token while still on /login', async () => {
    await runBrowserAuthChild(options)
    const window = state.windows[0]
    expect(window.options).toMatchObject({
      title: '登录智谱 BigModel',
      webPreferences: {
        session: state.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    expect(window.options.webPreferences).not.toHaveProperty('preload')
    expect(send).not.toHaveBeenCalled()
    window.emit('ready-to-show')
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    await control({ type: 'browser-auth-focus', requestId: options.requestId })
    expect(window.focus).toHaveBeenCalledTimes(2)
  })

  it('sends one bounded result after login and clears its token only after the matching ACK', async () => {
    await runBrowserAuthChild(options)
    const window = state.windows[0]
    await window.loadURL('https://bigmodel.cn/console')
    window.webContents.emit('did-navigate-in-page')
    state.session.cookies.emit('changed', {}, token, 'explicit', false)
    await settle()
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0]).toMatchObject({
      requestId: options.requestId,
      provider: 'bigmodel',
      runtimeGeneration: options.runtimeGeneration,
      type: 'browser-auth-complete',
      returnUrl: 'https://bigmodel.cn/console',
      cookies: [token],
    })
    await control({ type: 'browser-auth-ack', requestId: 'old-request' })
    await settle()
    expect(state.session.cookies.remove).not.toHaveBeenCalled()
    await control({ type: 'browser-auth-ack', requestId: options.requestId })
    await settle()
    expect(state.session.cookies.remove).toHaveBeenCalledWith(
      'https://bigmodel.cn/',
      BIGMODEL_AUTH_COOKIE,
    )
    expect(window.isDestroyed()).toBe(true)
  })

  it('does not accept an expired token or an unrelated top-level page as a successful login', async () => {
    state.session.cookies.get.mockResolvedValue([{ ...token, expirationDate: 1 }])
    await runBrowserAuthChild(options)
    const window = state.windows[0]
    await window.loadURL('https://bigmodel.cn/console')
    window.webContents.emit('did-navigate-in-page')
    await settle()
    expect(send).not.toHaveBeenCalled()
    state.session.cookies.get.mockResolvedValue([token])
    await window.loadURL('https://unrelated.example/')
    window.webContents.emit('did-navigate-in-page')
    await settle()
    expect(send).not.toHaveBeenCalled()
    window.close()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'browser-auth-cancelled', requestId: options.requestId }),
    )
  })
})
