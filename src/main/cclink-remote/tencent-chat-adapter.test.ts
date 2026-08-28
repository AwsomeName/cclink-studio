import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: { data?: unknown }) => void>()
  const registerPlugin = vi.fn()
  const createImageMessage = vi.fn((options: { payload: { file: { files: Buffer[] } } }) => {
    return { kind: 'image', options, payload: { imageInfoArray: [] as unknown[] } }
  })
  const sendMessage = vi.fn(async (message: unknown) => {
    const imageMessage = message as { kind?: string; payload?: { imageInfoArray?: unknown[] } }
    if (imageMessage.kind === 'image') {
      const options = (imageMessage as { options?: { onProgress?(value: unknown): void } }).options
      options?.onProgress?.({ loaded: 2, total: 3, percent: 2 / 3 })
      imageMessage.payload!.imageInfoArray = [
        { imageUrl: 'https://cos.example/screen.png', type: 0 },
      ]
      return { data: { message: imageMessage } }
    }
    return { data: { message } }
  })
  const chat = {
    setLogLevel: vi.fn(),
    on: vi.fn((name: string, handler: (event: { data?: unknown }) => void) => {
      handlers.set(name, handler)
    }),
    off: vi.fn(),
    login: vi.fn(async () => {
      queueMicrotask(() => handlers.get('ready')?.({}))
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    registerPlugin,
    createImageMessage,
    createCustomMessage: vi.fn((options: unknown) => ({ kind: 'custom', options })),
    sendMessage,
  }
  const sdk = {
    create: () => chat,
    EVENT: { SDK_READY: 'ready', SDK_NOT_READY: 'not-ready', MESSAGE_RECEIVED: 'message' },
    TYPES: { CONV_C2C: 'C2C' },
  }
  return { chat, createImageMessage, registerPlugin, sendMessage, sdk }
})

import { TencentChatAdapter } from './tencent-chat-adapter'

afterEach(() => {
  vi.clearAllMocks()
})

describe('TencentChatAdapter image upload', () => {
  it('registers the upload plugin and returns the HTTPS COS URL without retaining image bytes', async () => {
    const originalWindow = (globalThis as unknown as { window?: unknown }).window
    const originalImage = (globalThis as unknown as { Image?: unknown }).Image
    const adapter = new TencentChatAdapter(async () => mocks.sdk)
    await adapter.login({ sdkAppId: 1, userId: 'studio-user', userSig: 'memory-only' })
    const image = {
      id: 'image-1',
      name: 'screen.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }

    const onProgress = vi.fn()
    await expect(adapter.uploadImage('agent-peer', image, { onProgress })).resolves.toBe(
      'https://cos.example/screen.png',
    )

    expect(mocks.registerPlugin).toHaveBeenCalledWith({
      'tim-upload-plugin': expect.any(Function),
    })
    const resource = mocks.createImageMessage.mock.calls[0]?.[0].payload.file.files[0]
    expect(Buffer.isBuffer(resource)).toBe(true)
    expect(resource).toMatchObject({ name: 'cclink-image-1.png', size: 3, type: 'image/png' })
    expect(resource?.toString('base64')).toBe('AQID')
    expect(onProgress).toHaveBeenCalledWith(2, 3)
    expect((globalThis as unknown as { window?: unknown }).window).toBe(originalWindow)
    expect((globalThis as unknown as { Image?: unknown }).Image).toBe(originalImage)
    await adapter.logout()
  })

  it('rejects a renderer-declared size that does not match the decoded bytes', async () => {
    const adapter = new TencentChatAdapter(async () => mocks.sdk)
    await adapter.login({ sdkAppId: 1, userId: 'studio-user', userSig: 'memory-only' })

    await expect(
      adapter.uploadImage('agent-peer', {
        id: 'image-1',
        name: 'screen.png',
        mediaType: 'image/png',
        data: 'AQID',
        size: 4,
      }),
    ).rejects.toThrow('图片数据大小校验失败')
    expect(mocks.createImageMessage).not.toHaveBeenCalled()
    await adapter.logout()
  })
})
