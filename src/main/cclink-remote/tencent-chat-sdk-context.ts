import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createContext, runInContext } from 'node:vm'
import XMLHttpRequest from 'xhr2'
import WebSocket from 'ws'

export interface TencentChatSdkStatic {
  create(options: { SDKAppID: number }): unknown
  EVENT: { SDK_READY: string; SDK_NOT_READY: string; MESSAGE_RECEIVED: string }
  TYPES: { CONV_C2C: string }
}

/** Loads the Web SDK inside its own VM realm so browser shims never touch Electron main globals. */
export async function loadIsolatedTencentChatSdk(): Promise<TencentChatSdkStatic> {
  const require = createRequire(import.meta.url)
  const entryPath = require.resolve('@tencentcloud/chat')
  const source = await readFile(entryPath, 'utf8')
  const module = { exports: {} as unknown }
  const sandbox: Record<string, unknown> = {
    module,
    exports: {},
    XMLHttpRequest,
    WebSocket,
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    console: SILENT_CONSOLE,
  }
  const context = createContext(sandbox, { name: 'cclink-tencent-chat' })
  sandbox.global = context
  sandbox.self = context
  runInContext(source, context, { filename: entryPath })
  sandbox.window = { URL: { createObjectURL: () => '' } }
  sandbox.Image = IsolatedImageFallback

  const sdk = module.exports as TencentChatSdkStatic
  if (!sdk?.create || !sdk.EVENT || !sdk.TYPES) throw new Error('腾讯 IM SDK 隔离加载失败')
  return sdk
}

class IsolatedImageFallback {
  width = 0
  height = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onerror?.())
  }
}

const SILENT_CONSOLE = Object.freeze({
  log: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
})
