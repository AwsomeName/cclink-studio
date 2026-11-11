import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSER_HTTP_AUTH_RESPONSE_CHANNEL,
  type BrowserHttpAuthChildOptions,
} from '../../shared/ipc/browser-http-auth'

const state = vi.hoisted(() => ({
  windows: [] as any[],
  handlers: new Map<string, (...args: any[]) => Promise<void>>(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {},
      setWindowOpenHandler: vi.fn(),
    })
    show = vi.fn()
    loadURL = vi.fn().mockResolvedValue(undefined)
    constructor() {
      super()
      state.windows.push(this)
    }
    isDestroyed() {
      return this.destroyed
    }
    close() {
      if (!this.destroyed) {
        this.destroyed = true
        this.emit('closed')
      }
    }
  }
  return {
    BrowserWindow: Window,
    session: { fromPartition: vi.fn() },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => Promise<void>) =>
        state.handlers.set(channel, handler),
      removeHandler: (channel: string) => state.handlers.delete(channel),
    },
  }
})
import { runBrowserHttpAuthChild } from './browser-http-auth-child'

const options: BrowserHttpAuthChildOptions = {
  requestId: 'r1',
  tabId: 'tab1',
  runtimeGeneration: 1,
  url: 'https://example.test/',
  origin: 'https://example.test',
  realm: 'Restricted',
  transport: 'https',
  attempt: 1,
  userDataPath: '/tmp/unused-http-child-test',
  canRemember: true,
}
const response = {
  action: 'submit',
  requestId: 'r1',
  username: 'user',
  password: 'secret',
  remember: true,
  allowInsecure: false,
  allowInsecureAutoLogin: false,
}
let previousSend: PropertyDescriptor | undefined
let previousMessageListeners: unknown[]
let previousDisconnectListeners: unknown[]
let send: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  state.windows.length = 0
  send = vi.fn()
  previousSend = Object.getOwnPropertyDescriptor(process, 'send')
  Object.defineProperty(process, 'send', { configurable: true, value: send })
  previousMessageListeners = process.listeners('message')
  previousDisconnectListeners = process.listeners('disconnect')
})
afterEach(() => {
  state.windows.forEach((window) => window.close())
  for (const listener of process.listeners('message'))
    if (!previousMessageListeners.includes(listener)) process.removeListener('message', listener)
  for (const listener of process.listeners('disconnect'))
    if (!previousDisconnectListeners.includes(listener))
      process.removeListener('disconnect', listener)
  if (previousSend) Object.defineProperty(process, 'send', previousSend)
  else Reflect.deleteProperty(process, 'send')
  vi.useRealTimers()
})
async function setup() {
  await runBrowserHttpAuthChild(options)
  const window = state.windows[0]
  const handler = state.handlers.get(BROWSER_HTTP_AUTH_RESPONSE_CHANNEL)!
  return {
    window,
    respond: (input: unknown) =>
      handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, input),
  }
}
function ack(error?: string) {
  const listener = process
    .listeners('message')
    .find((value) => !previousMessageListeners.includes(value))!
  listener(
    { type: 'browser-http-auth-ack', requestId: 'r1', ...(error ? { error } : {}) },
    undefined,
  )
}

describe('HTTP auth dialog acknowledgement lifecycle', () => {
  it('keeps a slow save pending until the owning main process acknowledges it', async () => {
    const { window, respond } = await setup()
    let settled = false
    const pending = respond(response).then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await vi.advanceTimersByTimeAsync(10_001)
    expect(settled).toBe(false)
    expect(window.isDestroyed()).toBe(false)
    ack()
    await pending
    expect(window.isDestroyed()).toBe(true)
  })

  it('allows cancellation during a save and releases all pending handlers', async () => {
    const { window, respond } = await setup()
    const pending = respond(response)
    await respond({ action: 'cancel', requestId: 'r1' })
    await pending
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'browser-http-auth-cancelled' }),
    )
    expect(window.isDestroyed()).toBe(true)
    expect(state.handlers.size).toBe(0)
    expect(process.listeners('message')).toEqual(previousMessageListeners)
    expect(process.listeners('disconnect')).toEqual(previousDisconnectListeners)
  })

  it('allows retry only after an explicit save failure acknowledgement', async () => {
    const { window, respond } = await setup()
    const pending = respond(response)
    ack('credential-save-failed')
    await expect(pending).rejects.toThrow('凭证保存或提交失败')
    expect(window.isDestroyed()).toBe(false)
    const retry = respond({ ...response, remember: false })
    ack()
    await retry
    expect(window.isDestroyed()).toBe(true)
  })

  it('closes a pending submission on parent disconnect without sending into a closed channel', async () => {
    const { window, respond } = await setup()
    const pending = respond(response)
    const previousConnected = Object.getOwnPropertyDescriptor(process, 'connected')
    try {
      Object.defineProperty(process, 'connected', { configurable: true, value: false })
      const disconnect = process
        .listeners('disconnect')
        .find((value) => !previousDisconnectListeners.includes(value))!
      disconnect()
      await pending
      expect(window.isDestroyed()).toBe(true)
      expect(send).toHaveBeenCalledTimes(1)
      expect(process.listeners('message')).toEqual(previousMessageListeners)
    } finally {
      if (previousConnected) Object.defineProperty(process, 'connected', previousConnected)
      else Reflect.deleteProperty(process, 'connected')
    }
  })
})
