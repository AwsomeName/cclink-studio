import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserNewTabContent } from './BrowserNewTabPage'

beforeEach(() => {
  vi.stubGlobal('React', React)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BrowserNewTabContent', () => {
  it('renders recent addresses as reusable navigation buttons', () => {
    const markup = renderToStaticMarkup(
      <BrowserNewTabContent
        history={[
          {
            id: 'history-1',
            url: 'https://example.com/docs',
            title: 'Example Docs',
            visitedAt: 1,
          },
        ]}
        loading={false}
        error={false}
        onOpenUrl={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(markup).toContain('最近访问')
    expect(markup).toContain('Example Docs')
    expect(markup).toContain('example.com/docs')
    expect(markup).toContain('最近访问的网址')
  })

  it('shows an empty state and a recoverable load failure', () => {
    const emptyMarkup = renderToStaticMarkup(
      <BrowserNewTabContent
        history={[]}
        loading={false}
        error={false}
        onOpenUrl={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    const errorMarkup = renderToStaticMarkup(
      <BrowserNewTabContent
        history={[]}
        loading={false}
        error
        onOpenUrl={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(emptyMarkup).toContain('访问过的网址会显示在这里')
    expect(errorMarkup).toContain('最近访问加载失败，点击重试')
  })
})
