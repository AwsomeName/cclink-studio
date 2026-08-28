import { describe, expect, it } from 'vitest'
import { loadIsolatedTencentChatSdk } from './tencent-chat-sdk-context'

describe('isolated Tencent Chat SDK context', () => {
  it('loads the real SDK without adding or replacing Electron main globals', async () => {
    const keys = ['window', 'Image', 'XMLHttpRequest', 'WebSocket'] as const
    const before = Object.fromEntries(
      keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    )

    const sdk = await loadIsolatedTencentChatSdk()

    expect(sdk.create).toBeTypeOf('function')
    expect(sdk.EVENT.SDK_READY).toBeTypeOf('string')
    expect(sdk.TYPES.CONV_C2C).toBeTypeOf('string')
    for (const key of keys) {
      expect(Object.getOwnPropertyDescriptor(globalThis, key)).toEqual(before[key])
    }
  })
})
