import { describe, expect, it, vi } from 'vitest'
import { BrowserRecoveryHostRegistry } from './browser-recovery-host-registry'

function createHarness() {
  const host = {
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
  const browserManager = {
    registerRecoveryHost: vi.fn(),
    recoverViewToHost: vi.fn(),
    transferViewToHost: vi.fn(),
    unregisterHost: vi.fn(),
  }
  return {
    host,
    browserManager,
    registry: new BrowserRecoveryHostRegistry(browserManager as never, () => host as never),
  }
}

describe('BrowserRecoveryHostRegistry', () => {
  it('keeps one renderer-less native host per recovering view and releases it after restore', () => {
    const { registry, browserManager, host } = createHarness()

    expect(registry.recover('browser-1', 'aux-1', '/workspace/a')).toBe('recovery:browser-1')
    expect(registry.recover('browser-1', 'aux-1', '/workspace/a')).toBe('recovery:browser-1')
    expect(browserManager.registerRecoveryHost).toHaveBeenCalledOnce()
    expect(browserManager.recoverViewToHost).toHaveBeenCalledWith(
      'browser-1',
      'aux-1',
      'recovery:browser-1',
    )

    registry.restore('browser-1', 'main')

    expect(browserManager.transferViewToHost).toHaveBeenCalledWith(
      'browser-1',
      'recovery:browser-1',
      'main',
    )
    expect(browserManager.unregisterHost).toHaveBeenCalledWith('recovery:browser-1')
    expect(host.destroy).toHaveBeenCalledOnce()
    expect(registry.has('browser-1')).toBe(false)
  })

  it('destroys a newly created host when emergency attachment fails', () => {
    const { registry, browserManager, host } = createHarness()
    browserManager.recoverViewToHost.mockImplementationOnce(() => {
      throw new Error('attach failed')
    })

    expect(() => registry.recover('browser-1', 'aux-1', null)).toThrow('attach failed')
    expect(browserManager.unregisterHost).toHaveBeenCalledWith('recovery:browser-1')
    expect(host.destroy).toHaveBeenCalledOnce()
    expect(registry.has('browser-1')).toBe(false)
  })
})
