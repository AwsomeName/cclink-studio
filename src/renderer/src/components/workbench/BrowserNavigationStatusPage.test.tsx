import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserNavigationStatusPage,
  formatBrowserNavigationError,
} from './BrowserNavigationStatusPage'

beforeEach(() => vi.stubGlobal('React', React))
afterEach(() => vi.unstubAllGlobals())

describe('BrowserNavigationStatusPage', () => {
  it('shows immediate feedback while an address is loading', () => {
    const markup = renderToStaticMarkup(
      <BrowserNavigationStatusPage
        navigation={{
          targetUrl: 'https://example.com',
          status: 'loading',
          error: null,
        }}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(markup).toContain('正在打开网页')
    expect(markup).toContain('https://example.com')
  })

  it('shows retry and return actions for a failed address', () => {
    const markup = renderToStaticMarkup(
      <BrowserNavigationStatusPage
        navigation={{
          targetUrl: 'https://invalid.example',
          status: 'failed',
          error: "Error invoking remote method 'browser:navigate': Error: ERR_NAME_NOT_RESOLVED",
        }}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(markup).toContain('无法打开网页')
    expect(markup).toContain('重试')
    expect(markup).toContain('返回')
    expect(markup).not.toContain('Error invoking remote method')
  })

  it('removes the IPC wrapper from renderer-facing errors', () => {
    expect(
      formatBrowserNavigationError(
        "Error invoking remote method 'browser:navigate': Error: ERR_CONNECTION_REFUSED",
      ),
    ).toBe('ERR_CONNECTION_REFUSED')
  })
})
