import { describe, expect, it, vi } from 'vitest'
import { createCclinkEnvelope, type CclinkIdentity } from '../../shared/cclink'
import { TimTransport, type TimAdapter } from './tim-transport'

describe('TimTransport realtime status', () => {
  it('把 SDK 断线和重连事件传给上层生命周期', async () => {
    let emitStatus: ((status: 'online' | 'offline') => void) | undefined
    const adapter: TimAdapter = {
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      sendCustomMessage: vi.fn().mockResolvedValue(undefined),
      onCustomMessage: vi.fn().mockReturnValue(() => undefined),
      onStatus: vi.fn((listener) => {
        emitStatus = listener
        return () => undefined
      }),
    }
    const transport = new TimTransport(adapter)
    const listener = vi.fn()
    transport.onStatus(listener)
    await transport.login({
      accountUserId: 'user-1',
      imUserId: 'user-im-1',
      clientImUserId: 'client-im-1',
      imUserSig: 'memory-only',
      authToken: 'memory-only',
      sdkAppId: 1,
      deviceId: 'device-1',
      deviceName: 'Studio',
      updatedAt: Date.now(),
    } satisfies CclinkIdentity)

    emitStatus?.('offline')
    emitStatus?.('online')

    expect(listener.mock.calls).toEqual([['offline'], ['online']])
    transport.destroy()
  })

  it('uploads images to the peer resolved from the Agent metadata', async () => {
    let receive: ((message: { from: string; payload: string }) => void) | undefined
    const uploadImage = vi.fn().mockResolvedValue('https://cos.example/screen.png')
    const adapter: TimAdapter = {
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      sendCustomMessage: vi.fn().mockResolvedValue(undefined),
      uploadImage,
      onCustomMessage: vi.fn((listener) => {
        receive = listener
        return () => undefined
      }),
      onStatus: vi.fn().mockReturnValue(() => undefined),
    }
    const transport = new TimTransport(adapter)
    await transport.login({
      accountUserId: 'user-1',
      imUserId: 'user-im-1',
      clientImUserId: 'client-im-1',
      imUserSig: 'memory-only',
      authToken: 'memory-only',
      sdkAppId: 1,
      deviceId: 'device-1',
      deviceName: 'Studio',
      updatedAt: Date.now(),
    })
    receive?.({
      from: 'peer-im-1',
      payload: JSON.stringify({
        ...createCclinkEnvelope('server_meta'),
        agent_id: 'agent-1',
        hostname: 'agent',
        os: 'linux',
        agent_version: '0.8.48',
      }),
    })
    const image = {
      id: 'image-1',
      name: 'screen.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }

    const controller = new AbortController()
    const onProgress = vi.fn()
    await expect(
      transport.uploadImage('agent-1', image, { signal: controller.signal, onProgress }),
    ).resolves.toBe('https://cos.example/screen.png')
    expect(uploadImage).toHaveBeenCalledWith('peer-im-1', image, {
      signal: controller.signal,
      onProgress,
    })
    transport.destroy()
  })
})
