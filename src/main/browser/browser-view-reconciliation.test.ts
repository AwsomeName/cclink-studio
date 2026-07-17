import { describe, expect, it } from 'vitest'
import { shouldDestroyBrowserViewDuringReconcile } from './browser-view-reconciliation'

describe('shouldDestroyBrowserViewDuringReconcile', () => {
  it('preserves browser views owned by a background workspace', () => {
    expect(
      shouldDestroyBrowserViewDuringReconcile({
        tabId: 'browser-a',
        viewWorkspaceKey: '/workspace/a',
        activeWorkspaceKey: '/workspace/b',
        validTabIds: new Set(['browser-b']),
      }),
    ).toBe(false)
  })

  it('destroys a removed browser tab in the active workspace', () => {
    expect(
      shouldDestroyBrowserViewDuringReconcile({
        tabId: 'browser-a',
        viewWorkspaceKey: '/workspace/a',
        activeWorkspaceKey: '/workspace/a',
        validTabIds: new Set(),
      }),
    ).toBe(true)
  })
})
