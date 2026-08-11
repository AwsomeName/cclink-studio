import { describe, expect, it } from 'vitest'
import {
  browserBoundsSchema,
  browserCreateViewOptionsSchema,
  browserPopupCreatedSchema,
  browserReconcileViewsSchema,
  browserRuntimeTabClosedSchema,
  browserUrlSchema,
} from './browser-ipc-schema'

describe('browser IPC schemas', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:test@example.com',
  ])('rejects executable or unsupported URL %s', (url) =>
    expect(() => browserUrlSchema.parse(url)).toThrow(),
  )

  it.each([
    'https://example.com/path',
    'http://localhost:5173',
    'file:///tmp/page.html',
    'about:blank',
  ])('accepts supported URL %s', (url) => expect(browserUrlSchema.parse(url)).toBe(url))

  it('rejects unknown create-view fields and oversized history', () => {
    expect(() => browserCreateViewOptionsSchema.parse({ unexpected: true })).toThrow()
    expect(() =>
      browserCreateViewOptionsSchema.parse({
        restore: {
          viewMode: 'desktop',
          zoomMode: 'manual',
          manualZoom: 1,
          history: Array.from({ length: 501 }, () => 'https://example.com'),
        },
      }),
    ).toThrow()
  })

  it('uses one bounded profile rule for view creation and reconciliation', () => {
    expect(browserCreateViewOptionsSchema.parse({ profileId: 'operations.eu-west' })).toEqual({
      profileId: 'operations.eu-west',
    })
    expect(() => browserCreateViewOptionsSchema.parse({ profileId: 'x'.repeat(65) })).toThrow()
    expect(
      browserReconcileViewsSchema.parse({
        workspaceKey: '/workspace/a',
        views: [{ tabId: 'browser-a', profileId: 'v2ex' }],
        activeTabId: 'browser-a',
      }),
    ).toEqual({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'browser-a', profileId: 'v2ex' }],
      activeTabId: 'browser-a',
    })
    expect(() =>
      browserReconcileViewsSchema.parse({
        workspaceKey: '/workspace/a',
        views: [
          { tabId: 'browser-a', profileId: 'v2ex' },
          { tabId: 'browser-a', profileId: 'zhihu' },
        ],
        activeTabId: null,
      }),
    ).toThrow()
  })

  it('rejects non-finite or implausible workbench bounds', () => {
    expect(() => browserBoundsSchema.parse({ x: 0, y: 0, width: Infinity, height: 100 })).toThrow()
    expect(() => browserBoundsSchema.parse({ x: 0, y: 0, width: 100_001, height: 100 })).toThrow()
  })

  it('bounds popup lifecycle event payloads', () => {
    expect(
      browserPopupCreatedSchema.parse({
        tabId: 'browser-popup-1',
        url: 'https://example.com/',
        workspaceKey: '/workspace/a',
        profileId: 'operations',
        disposition: 'foreground-tab',
        activate: true,
      }),
    ).toMatchObject({ tabId: 'browser-popup-1', disposition: 'foreground-tab' })
    expect(() =>
      browserPopupCreatedSchema.parse({
        tabId: 'browser-popup-1',
        url: 'javascript:alert(1)',
        workspaceKey: '/workspace/a',
        profileId: null,
        disposition: 'foreground-tab',
        activate: true,
      }),
    ).toThrow()
    expect(() =>
      browserRuntimeTabClosedSchema.parse({
        tabId: '',
        workspaceKey: '/workspace/a',
      }),
    ).toThrow()
  })
})
