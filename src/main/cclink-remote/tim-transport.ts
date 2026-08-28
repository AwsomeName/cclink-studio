import type { CclinkIdentity, CclinkProtocolMessage } from '../../shared/cclink'
import { isCclinkMessage } from '../../shared/cclink'
import type { CclinkTransport, CclinkTransportEvent, ImageUploadOptions } from './request-router'
import type { TransientImageAttachment } from '../../shared/image-attachment'

export interface TimAdapter {
  login(options: { sdkAppId: number; userId: string; userSig: string }): Promise<void>
  logout(): Promise<void>
  sendCustomMessage(peerId: string, payload: string): Promise<void>
  uploadImage?(
    peerId: string,
    image: TransientImageAttachment,
    options?: ImageUploadOptions,
  ): Promise<string>
  onCustomMessage(listener: (message: { from: string; payload: string }) => void): () => void
  onStatus(listener: (status: 'online' | 'offline') => void): () => void
}

export class TimTransport implements CclinkTransport {
  private readonly listeners = new Set<(event: CclinkTransportEvent) => void>()
  private readonly serverToPeer = new Map<string, string>()
  private readonly peerToServer = new Map<string, string>()
  private readonly unsubscribe: () => void
  private readonly unsubscribeStatus: () => void
  private readonly statusListeners = new Set<(status: 'online' | 'offline') => void>()
  private online = false

  constructor(private readonly adapter: TimAdapter) {
    this.unsubscribe = adapter.onCustomMessage((message) =>
      this.receive(message.from, message.payload),
    )
    this.unsubscribeStatus = adapter.onStatus((status) => {
      this.online = status === 'online'
      for (const listener of this.statusListeners) listener(status)
    })
  }

  async login(identity: CclinkIdentity): Promise<void> {
    await this.adapter.login({
      sdkAppId: identity.sdkAppId,
      userId: identity.clientImUserId,
      userSig: identity.imUserSig,
    })
    this.online = true
  }

  async logout(): Promise<void> {
    this.online = false
    await this.adapter.logout()
  }

  async sendMessage(serverId: string, message: CclinkProtocolMessage): Promise<void> {
    if (!this.online) throw new Error('CCLink TIM transport 未登录')
    await this.adapter.sendCustomMessage(
      this.serverToPeer.get(serverId) ?? serverId,
      JSON.stringify(message),
    )
  }

  async uploadImage(
    serverId: string,
    image: TransientImageAttachment,
    options: ImageUploadOptions = {},
  ): Promise<string> {
    if (!this.online) throw new Error('CCLink TIM transport 未登录')
    if (!this.adapter.uploadImage) throw new Error('当前腾讯 IM 适配器不支持图片上传')
    return this.adapter.uploadImage(this.serverToPeer.get(serverId) ?? serverId, image, options)
  }

  onMessage(listener: (event: CclinkTransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onStatus(listener: (status: 'online' | 'offline') => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  destroy(): void {
    this.unsubscribe()
    this.unsubscribeStatus()
    this.listeners.clear()
    this.statusListeners.clear()
  }

  private receive(peerId: string, payload: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    if (!isCclinkMessage(parsed)) return
    const message = parsed as CclinkProtocolMessage
    const metaAgentId =
      message.cc_type === 'server_meta'
        ? String((message as { agent_id?: unknown }).agent_id ?? '')
        : ''
    if (metaAgentId) {
      this.serverToPeer.set(metaAgentId, peerId)
      this.peerToServer.set(peerId, metaAgentId)
    }
    const serverId = metaAgentId || this.peerToServer.get(peerId) || peerId
    for (const listener of this.listeners) listener({ serverId, message })
  }
}
