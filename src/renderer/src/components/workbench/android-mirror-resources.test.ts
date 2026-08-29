import { describe, expect, it, vi } from 'vitest'
import { cleanupAndroidMirrorResources } from './android-mirror-resources'

describe('cleanupAndroidMirrorResources', () => {
  it('releases listeners, stream and decoder once across repeated cleanup', () => {
    const offVideo = vi.fn()
    const offError = vi.fn()
    const close = vi.fn()
    const dispose = vi.fn()
    const resources = {
      videoFrameUnsubscribeRef: { current: offVideo as (() => void) | null },
      mirrorErrorUnsubscribeRef: { current: offError as (() => void) | null },
      streamControllerRef: { current: { close } as { close(): void } | null },
      decoderRef: { current: { dispose } as { dispose(): void } | null },
    }

    cleanupAndroidMirrorResources(resources)
    cleanupAndroidMirrorResources(resources)

    expect(offVideo).toHaveBeenCalledOnce()
    expect(offError).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(Object.values(resources).every((ref) => ref.current === null)).toBe(true)
  })

  it('continues cleanup when closing the old stream throws', () => {
    const dispose = vi.fn()
    const resources = {
      videoFrameUnsubscribeRef: { current: null },
      mirrorErrorUnsubscribeRef: { current: null },
      streamControllerRef: {
        current: {
          close: vi.fn(() => {
            throw new Error('already closed')
          }),
        } as {
          close(): void
        } | null,
      },
      decoderRef: { current: { dispose } as { dispose(): void } | null },
    }

    cleanupAndroidMirrorResources(resources)

    expect(dispose).toHaveBeenCalledOnce()
    expect(resources.streamControllerRef.current).toBeNull()
    expect(resources.decoderRef.current).toBeNull()
  })
})
