import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserHistorySection } from './browser-history-section'

beforeEach(() => {
  vi.stubGlobal('React', React)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BrowserHistorySection', () => {
  it('在浏览器侧栏渲染可回访的访问历史', () => {
    const markup = renderToStaticMarkup(
      <BrowserHistorySection
        history={[
          {
            id: 'history-1',
            url: 'https://example.com/docs',
            title: 'Example Docs',
            visitedAt: 1,
          },
        ]}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onClear={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(markup).toContain('访问历史')
    expect(markup).toContain('Example Docs')
    expect(markup).toContain('example.com')
    expect(markup).toContain('清空')
  })

  it('明确呈现空态和加载失败重试入口', () => {
    const emptyMarkup = renderToStaticMarkup(
      <BrowserHistorySection
        history={[]}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onClear={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    const errorMarkup = renderToStaticMarkup(
      <BrowserHistorySection
        history={[]}
        loading={false}
        error="failed"
        onOpen={vi.fn()}
        onClear={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(emptyMarkup).toContain('暂无访问历史')
    expect(errorMarkup).toContain('历史加载失败，点击重试')
  })
})
