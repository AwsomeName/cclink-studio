import { describe, expect, it } from 'vitest'
import { toWorkbenchBrowserProjection } from './workbench-browser-state'

describe('toWorkbenchBrowserProjection', () => {
  it('removes transient navigation feedback before the strict main-process projection', () => {
    expect(
      toWorkbenchBrowserProjection({
        url: 'https://example.com',
        urlInput: 'https://pending.example',
        viewMode: 'desktop',
        zoomMode: 'fit',
        zoomFactor: 1,
        history: ['https://example.com'],
        historyIndex: 0,
        ready: true,
        navigation: {
          targetUrl: 'https://pending.example',
          status: 'loading',
          error: null,
        },
      }),
    ).toEqual({
      url: 'https://example.com',
      urlInput: 'https://pending.example',
      viewMode: 'desktop',
      zoomMode: 'fit',
      zoomFactor: 1,
      history: ['https://example.com'],
      historyIndex: 0,
      ready: false,
    })
  })
})
