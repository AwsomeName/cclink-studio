import { describe, expect, it, vi } from 'vitest'
import { resetVisualPageScale } from './browser-visual-page-scale'

function createClient(options: { attached?: boolean; scale?: number } = {}) {
  let attached = options.attached ?? false
  let scale = options.scale ?? 0.3
  const client = {
    isAttached: vi.fn(() => attached),
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    sendCommand: vi.fn(async (method: string, params?: unknown) => {
      if (method === 'Runtime.evaluate') return { result: { value: scale } }
      if (method === 'Emulation.setPageScaleFactor') {
        scale = (params as { pageScaleFactor: number }).pageScaleFactor
        return {}
      }
      throw new Error(`unexpected command: ${method}`)
    }),
  }
  return client
}

describe('resetVisualPageScale', () => {
  it('resets Chromium visual zoom and releases a debugger session it attached', async () => {
    const client = createClient({ scale: 0.3 })

    await expect(resetVisualPageScale(client)).resolves.toEqual({ before: 0.3, after: 1 })
    expect(client.attach).toHaveBeenCalledWith('1.3')
    expect(client.sendCommand).toHaveBeenCalledWith('Emulation.setPageScaleFactor', {
      pageScaleFactor: 1,
    })
    expect(client.detach).toHaveBeenCalledOnce()
  })

  it('does not detach a debugger session owned by another caller', async () => {
    const client = createClient({ attached: true })

    await resetVisualPageScale(client)

    expect(client.attach).not.toHaveBeenCalled()
    expect(client.detach).not.toHaveBeenCalled()
  })

  it('serializes overlapping resets for one WebContents debugger', async () => {
    const client = createClient()

    await Promise.all([resetVisualPageScale(client), resetVisualPageScale(client)])

    expect(client.attach).toHaveBeenCalledTimes(2)
    expect(client.detach).toHaveBeenCalledTimes(2)
  })
})
