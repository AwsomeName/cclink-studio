import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelActivePanelResize, registerPanelResizeCancel } from './panel-layout-drag-lifecycle'

afterEach(cancelActivePanelResize)

describe('panel resize cancellation', () => {
  it('replaces an active drag with synchronous cancellation and idempotent cleanup', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unregister = registerPanelResizeCancel(first)
    registerPanelResizeCancel(second)
    expect(first).toHaveBeenCalledOnce()
    unregister()
    cancelActivePanelResize()
    cancelActivePanelResize()
    expect(second).toHaveBeenCalledOnce()
  })
})
