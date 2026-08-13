import XMLHttpRequest from 'xhr2'
import type { TimAdapter } from './tim-transport'

const globals = globalThis as unknown as Record<string, unknown>
globals.XMLHttpRequest ??= XMLHttpRequest
process.env.WS_NO_BUFFER_UTIL ??= '1'
process.env.WS_NO_UTF_8_VALIDATE ??= '1'

type ChatStatic = {
  create(options: { SDKAppID: number }): ChatInstance
  EVENT: { SDK_READY: string; SDK_NOT_READY: string; MESSAGE_RECEIVED: string }
  TYPES: { CONV_C2C: string }
}

type ChatInstance = {
  setLogLevel?(level: number): void
  on(name: string, handler: (event: { data?: unknown }) => void): void
  off(name: string, handler: (event: { data?: unknown }) => void): void
  login(options: { userID: string; userSig: string }): Promise<unknown>
  logout(): Promise<unknown>
  destroy?(): Promise<unknown> | void
  createCustomMessage(options: {
    to: string
    conversationType: string
    payload: { data: string; description: string; extension: string }
  }): unknown | Promise<unknown>
  sendMessage(message: unknown): Promise<unknown>
}

export class TencentChatAdapter implements TimAdapter {
  private sdk: ChatStatic | null = null
  private chat: ChatInstance | null = null
  private readonly listeners = new Set<(message: { from: string; payload: string }) => void>()
  private readonly statusListeners = new Set<(status: 'online' | 'offline') => void>()
  private readonly readyStatus = (): void => this.emitStatus('online')
  private readonly notReadyStatus = (): void => this.emitStatus('offline')
  private readonly receive = (event: { data?: unknown }): void => {
    const messages = Array.isArray(event.data) ? event.data : []
    for (const raw of messages) {
      const message = raw as { from?: unknown; payload?: { data?: unknown } }
      if (typeof message.from !== 'string' || typeof message.payload?.data !== 'string') continue
      for (const listener of this.listeners)
        listener({ from: message.from, payload: message.payload.data })
    }
  }

  async login(options: { sdkAppId: number; userId: string; userSig: string }): Promise<void> {
    this.sdk = await this.loadSdk()
    this.chat = this.sdk.create({ SDKAppID: options.sdkAppId })
    this.chat.setLogLevel?.(1)
    this.chat.on(this.sdk.EVENT.MESSAGE_RECEIVED, this.receive)
    this.chat.on(this.sdk.EVENT.SDK_READY, this.readyStatus)
    this.chat.on(this.sdk.EVENT.SDK_NOT_READY, this.notReadyStatus)
    await new Promise<void>((resolve, reject) => {
      const ready = (): void => {
        clearTimeout(timer)
        this.chat?.off(this.sdk!.EVENT.SDK_READY, ready)
        resolve()
      }
      const timer = setTimeout(() => {
        this.chat?.off(this.sdk!.EVENT.SDK_READY, ready)
        reject(new Error('腾讯 IM 连接超时'))
      }, 30_000)
      this.chat!.on(this.sdk!.EVENT.SDK_READY, ready)
      void this.chat!.login({ userID: options.userId, userSig: options.userSig }).catch(
        (error: unknown) => {
          clearTimeout(timer)
          this.chat?.off(this.sdk!.EVENT.SDK_READY, ready)
          reject(error)
        },
      )
    })
  }

  async logout(): Promise<void> {
    if (!this.chat || !this.sdk) return
    this.chat.off(this.sdk.EVENT.MESSAGE_RECEIVED, this.receive)
    this.chat.off(this.sdk.EVENT.SDK_READY, this.readyStatus)
    this.chat.off(this.sdk.EVENT.SDK_NOT_READY, this.notReadyStatus)
    await this.chat.logout().catch(() => undefined)
    await this.chat.destroy?.()
    this.chat = null
    this.emitStatus('offline')
  }

  async sendCustomMessage(peerId: string, payload: string): Promise<void> {
    if (!this.chat || !this.sdk) throw new Error('腾讯 IM 尚未连接')
    const message = await this.chat.createCustomMessage({
      to: peerId,
      conversationType: this.sdk.TYPES.CONV_C2C,
      payload: { data: payload, description: 'CCLink Studio', extension: 'cclink/studio' },
    })
    await this.chat.sendMessage(message)
  }

  onCustomMessage(listener: (message: { from: string; payload: string }) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onStatus(listener: (status: 'online' | 'offline') => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private emitStatus(status: 'online' | 'offline'): void {
    for (const listener of this.statusListeners) listener(status)
  }

  private async loadSdk(): Promise<ChatStatic> {
    const websocket = await import('ws')
    globals.WebSocket = websocket.default ?? websocket
    const module = (await import('@tencentcloud/chat')) as unknown as {
      default?: ChatStatic
    } & ChatStatic
    const sdk = module.default ?? module
    if (!sdk?.create || !sdk.EVENT || !sdk.TYPES) throw new Error('腾讯 IM SDK 加载失败')
    return sdk
  }
}
