import { describe, expect, it } from 'vitest'
import {
  browserBoundsSchema,
  browserCreateViewOptionsSchema,
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

  it('rejects non-finite or implausible workbench bounds', () => {
    expect(() => browserBoundsSchema.parse({ x: 0, y: 0, width: Infinity, height: 100 })).toThrow()
    expect(() => browserBoundsSchema.parse({ x: 0, y: 0, width: 100_001, height: 100 })).toThrow()
  })
})
