import { describe, expect, it, vi } from 'vitest'
import type { CclinkIdentity } from '../../shared/cclink'
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
})
