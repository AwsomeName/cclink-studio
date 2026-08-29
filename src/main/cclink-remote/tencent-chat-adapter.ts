import type { TimAdapter } from './tim-transport'
import type { TransientImageAttachment } from '../../shared/image-attachment'
import { SafeTimUploadPlugin, TIM_UPLOAD_ABORT_SIGNAL } from './safe-tim-upload-plugin'
import { loadIsolatedTencentChatSdk, type TencentChatSdkStatic } from './tencent-chat-sdk-context'

process.env.WS_NO_BUFFER_UTIL ??= '1'
process.env.WS_NO_UTF_8_VALIDATE ??= '1'

type ChatStatic = Omit<TencentChatSdkStatic, 'create'> & {
  create(options: { SDKAppID: number }): ChatInstance
}

type ChatInstance = {
  setLogLevel?(level: number): void
  on(name: string, handler: (event: { data?: unknown }) => void): void
  off(name: string, handler: (event: { data?: unknown }) => void): void
  login(options: { userID: string; userSig: string }): Promise<unknown>
  logout(): Promise<unknown>
  destroy?(): Promise<unknown> | void
  registerPlugin(options: Record<string, unknown>): void
  createImageMessage(options: {
    to: string
    conversationType: string
    payload: { file: { files: Buffer[] } }
    onProgress?(progress: unknown): void
  }): unknown
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
  private imageUploadTail: Promise<void> = Promise.resolve()
  private readonly readyStatus = (): void => this.emitStatus('online')
  private readonly notReadyStatus = (): void => this.emitStatus('offline')

  constructor(
    private readonly sdkLoader: () => Promise<ChatStatic> = async () =>
      (await loadIsolatedTencentChatSdk()) as ChatStatic,
  ) {}
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
    this.chat.registerPlugin({ 'tim-upload-plugin': SafeTimUploadPlugin })
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
    const chat = this.chat
    const sdk = this.sdk
    this.chat = null
    this.sdk = null
    chat.off(sdk.EVENT.MESSAGE_RECEIVED, this.receive)
    chat.off(sdk.EVENT.SDK_READY, this.readyStatus)
    chat.off(sdk.EVENT.SDK_NOT_READY, this.notReadyStatus)
    try {
      await chat.logout()
    } catch {
      // Login may have failed before the SDK considered the instance online.
    }
    try {
      await chat.destroy?.()
    } catch {
      // Failed/partial SDK instances are still considered disposed by the Studio lifecycle.
    }
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

  async uploadImage(
    peerId: string,
    image: TransientImageAttachment,
    options: { signal?: AbortSignal; onProgress?(loaded: number, total: number): void } = {},
  ): Promise<string> {
    const upload = this.imageUploadTail.then(() => this.performImageUpload(peerId, image, options))
    this.imageUploadTail = upload.then(
      () => undefined,
      () => undefined,
    )
    return upload
  }

  private async performImageUpload(
    peerId: string,
    image: TransientImageAttachment,
    options: { signal?: AbortSignal; onProgress?(loaded: number, total: number): void },
  ): Promise<string> {
    options.signal?.throwIfAborted()
    if (!this.chat || !this.sdk) throw new Error('腾讯 IM 尚未连接')
    const bytes = Buffer.from(image.data, 'base64')
    if (bytes.length !== image.size) throw new Error('图片数据大小校验失败')
    const extension = image.mediaType === 'image/jpeg' ? 'jpg' : image.mediaType.slice(6)
    const resource = Object.assign(bytes, {
      name: `cclink-${image.id}.${extension}`,
      size: bytes.length,
      type: image.mediaType,
    })
    Object.defineProperty(resource, TIM_UPLOAD_ABORT_SIGNAL, {
      value: options.signal,
      enumerable: false,
    })
    const message = this.chat.createImageMessage({
      to: peerId,
      conversationType: this.sdk.TYPES.CONV_C2C,
      payload: { file: { files: [resource] } },
      onProgress: (progress) => {
        const normalized = normalizeUploadProgress(progress, image.size)
        options.onProgress?.(normalized.loaded, normalized.total)
      },
    })
    options.signal?.throwIfAborted()
    const result = await this.chat.sendMessage(message)
    options.signal?.throwIfAborted()
    const url = uploadedImageUrl(result) || uploadedImageUrl(message)
    if (!url) throw new Error('腾讯 IM 图片上传成功但未返回图片地址')
    return url
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
    const sdk = await this.sdkLoader()
    if (!sdk?.create || !sdk.EVENT || !sdk.TYPES) throw new Error('腾讯 IM SDK 加载失败')
    return sdk
  }
}

function normalizeUploadProgress(
  value: unknown,
  fallbackTotal: number,
): {
  loaded: number
  total: number
} {
  const progress = value as { loaded?: unknown; total?: unknown; percent?: unknown }
  const total =
    typeof progress?.total === 'number' && progress.total > 0 ? progress.total : fallbackTotal
  const loaded =
    typeof progress?.loaded === 'number' && progress.loaded >= 0
      ? progress.loaded
      : typeof progress?.percent === 'number'
        ? progress.percent <= 1
          ? progress.percent * total
          : (progress.percent / 100) * total
        : 0
  return { loaded: Math.min(total, loaded), total }
}

function uploadedImageUrl(value: unknown): string | null {
  const candidate = value as {
    data?: { message?: { payload?: { imageInfoArray?: unknown[] } } }
    payload?: { imageInfoArray?: unknown[] }
  }
  const imageInfoArray =
    candidate?.data?.message?.payload?.imageInfoArray ?? candidate?.payload?.imageInfoArray
  if (!Array.isArray(imageInfoArray)) return null
  for (const imageInfo of imageInfoArray) {
    if (!imageInfo || typeof imageInfo !== 'object') continue
    const record = imageInfo as { imageUrl?: unknown; url?: unknown }
    const url = typeof record.imageUrl === 'string' ? record.imageUrl : record.url
    if (typeof url === 'string' && /^https:\/\//u.test(url)) return url
  }
  return null
}
