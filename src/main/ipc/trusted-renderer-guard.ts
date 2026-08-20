import {
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import type { IpcInvokeContract } from '../../shared/ipc/contract'
import type { WorkbenchWindowRole } from '../../shared/ipc/workbench-window'

type TrustedRendererEvent = IpcMainInvokeEvent | IpcMainEvent

export class UntrustedIpcSenderError extends Error {
  readonly code = 'UNTRUSTED_IPC_SENDER'

  constructor() {
    super('IPC 调用方不是受信任的工作台主页面')
    this.name = 'UntrustedIpcSenderError'
  }
}

export interface TrustedRendererGuard {
  assert(event: TrustedRendererEvent): void
  isTrusted(event: TrustedRendererEvent): boolean
  readonly ipcRegistrations?: TrustedIpcRegistrationScope
}

export interface TrustedRendererIdentity {
  windowId: string
  role: WorkbenchWindowRole
  webContents: WebContents
}

export interface TrustedRendererRegistry extends TrustedRendererGuard {
  register(input: {
    windowId: string
    role: WorkbenchWindowRole
    webContents: WebContents
    rendererEntryUrl: string
    isHostDestroyed?: () => boolean
  }): () => void
  resolve(event: TrustedRendererEvent): TrustedRendererIdentity | null
  assertRole(
    event: TrustedRendererEvent,
    allowedRoles: readonly WorkbenchWindowRole[],
  ): TrustedRendererIdentity
}

export interface TrustedIpcRegistrar {
  handle<Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
  ): void
}

export class TrustedIpcRegistrationScope {
  private readonly handlerChannels = new Set<string>()
  private readonly disposers: Array<() => void> = []
  private disposed = false

  handle<Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
  ): void {
    this.assertActive()
    if (this.handlerChannels.has(channel)) {
      throw new Error(`IPC handler 重复注册: ${channel}`)
    }
    ipcMain.handle(channel, handler)
    this.handlerChannels.add(channel)
    this.disposers.push(() => {
      ipcMain.removeHandler(channel)
      this.handlerChannels.delete(channel)
    })
  }

  on<Args extends unknown[]>(
    channel: string,
    listener: (event: IpcMainEvent, ...args: Args) => void,
  ): void {
    this.assertActive()
    ipcMain.on(channel, listener)
    this.disposers.push(() => ipcMain.removeListener(channel, listener))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of [...this.disposers].reverse()) {
      try {
        dispose()
      } catch (error) {
        console.warn('[CCLink Studio] IPC registration 清理出错:', error)
      }
    }
    this.disposers.length = 0
    this.handlerChannels.clear()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('IPC registration scope 已释放')
  }
}

export function createTrustedRendererRegistry(): TrustedRendererRegistry {
  const ipcRegistrations = new TrustedIpcRegistrationScope()
  const entriesByWebContents = new Map<
    WebContents,
    TrustedRendererIdentity & {
      rendererEntryUrl: string
      isHostDestroyed?: () => boolean
    }
  >()
  const entriesByWindowId = new Map<string, WebContents>()
  const resolve = (event: TrustedRendererEvent): TrustedRendererIdentity | null => {
    const entry = entriesByWebContents.get(event.sender)
    if (!entry || entry.isHostDestroyed?.()) return null
    if (entry.webContents.isDestroyed()) return null
    if (!event.senderFrame || event.senderFrame !== entry.webContents.mainFrame) return null
    if (!isAllowedMainRendererUrl(event.senderFrame.url, entry.rendererEntryUrl)) return null
    return {
      windowId: entry.windowId,
      role: entry.role,
      webContents: entry.webContents,
    }
  }
  const isTrusted = (event: TrustedRendererEvent): boolean => {
    return resolve(event)?.role === 'main'
  }
  return {
    ipcRegistrations,
    register(input): () => void {
      if (entriesByWindowId.has(input.windowId)) {
        throw new Error(`可信窗口 ID 重复注册: ${input.windowId}`)
      }
      if (entriesByWebContents.has(input.webContents)) {
        throw new Error(`可信 WebContents 重复注册: ${input.windowId}`)
      }
      const entry = { ...input }
      entriesByWebContents.set(input.webContents, entry)
      entriesByWindowId.set(input.windowId, input.webContents)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        if (entriesByWebContents.get(input.webContents) === entry) {
          entriesByWebContents.delete(input.webContents)
        }
        if (entriesByWindowId.get(input.windowId) === input.webContents) {
          entriesByWindowId.delete(input.windowId)
        }
      }
    },
    resolve,
    assertRole(event, allowedRoles): TrustedRendererIdentity {
      const identity = resolve(event)
      if (!identity || !allowedRoles.includes(identity.role)) throw new UntrustedIpcSenderError()
      return identity
    },
    isTrusted,
    assert(event): void {
      if (!isTrusted(event)) throw new UntrustedIpcSenderError()
    },
  }
}

export function createTrustedRendererGuard(
  mainWindow: BrowserWindow,
  rendererEntryUrl: string,
): TrustedRendererRegistry {
  const registry = createTrustedRendererRegistry()
  registry.register({
    windowId: 'main',
    role: 'main',
    webContents: mainWindow.webContents,
    rendererEntryUrl,
    isHostDestroyed: () => mainWindow.isDestroyed(),
  })
  return registry
}

export function registerTrustedIpcHandler<Args extends unknown[], Result>(
  channel: string,
  guard: TrustedRendererGuard,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
): void {
  const guardedHandler = (event: IpcMainInvokeEvent, ...args: Args): Result => {
    guard.assert(event)
    return handler(event, ...args)
  }
  if (guard.ipcRegistrations) guard.ipcRegistrations.handle(channel, guardedHandler)
  else ipcMain.handle(channel, guardedHandler)
}

export function registerTrustedIpcContract<Args extends unknown[], Result>(
  contract: IpcInvokeContract<Args, Result>,
  guard: TrustedRendererGuard,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
): void {
  registerTrustedIpcHandler<unknown[], Result | Promise<Result>>(
    contract.channel,
    guard,
    (event, ...args) => {
      let parsedArgs: Args
      try {
        parsedArgs = contract.parseArgs(args)
      } catch (error) {
        if (contract.mapParseError) return contract.mapParseError(error)
        throw error
      }
      return handler(event, ...parsedArgs)
    },
  )
}

export function createTrustedIpcRegistrar(guard: TrustedRendererGuard): TrustedIpcRegistrar {
  return {
    handle: (channel, handler) => registerTrustedIpcHandler(channel, guard, handler),
  }
}

export function registerTrustedIpcListener<Args extends unknown[]>(
  channel: string,
  guard: TrustedRendererGuard,
  listener: (event: IpcMainEvent, ...args: Args) => void,
): void {
  const guardedListener = (event: IpcMainEvent, ...args: Args): void => {
    if (!guard.isTrusted(event)) {
      console.warn(`[IPC] 已拒绝非受信任 renderer 的单向事件: ${channel}`)
      return
    }
    listener(event, ...args)
  }
  if (guard.ipcRegistrations) guard.ipcRegistrations.on(channel, guardedListener)
  else ipcMain.on(channel, guardedListener)
}

export function disposeTrustedIpcRegistrations(guard: TrustedRendererGuard | null): void {
  guard?.ipcRegistrations?.dispose()
}

export function isAllowedMainRendererUrl(candidateUrl: string, rendererEntryUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl)
    const entry = new URL(rendererEntryUrl)
    if (entry.protocol === 'http:' || entry.protocol === 'https:') {
      return candidate.origin === entry.origin
    }
    if (entry.protocol === 'file:') {
      candidate.hash = ''
      candidate.search = ''
      entry.hash = ''
      entry.search = ''
      return candidate.href === entry.href
    }
    return false
  } catch {
    return false
  }
}
