import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { RemoteMarkdownPreview, resolveRemoteFileDefaultViewMode } from './RemoteFileViewer'

beforeAll(() => {
  vi.stubGlobal('React', React)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('RemoteFileViewer', () => {
  it('opens Markdown files in rendered preview and keeps other files in source mode', () => {
    expect(resolveRemoteFileDefaultViewMode('/workspace/README.md')).toBe('preview')
    expect(resolveRemoteFileDefaultViewMode('C:\\workspace\\notes.MARKDOWN')).toBe('preview')
    expect(resolveRemoteFileDefaultViewMode('/workspace/config.toml')).toBe('source')
  })

  it('renders remote Markdown as safe semantic React content', () => {
    const html = renderToStaticMarkup(
      <RemoteMarkdownPreview
        title="README.md"
        source={
          '<!-- cclink-document: {"version":1,"resources":"README.assets/manifest.json"} -->\n\n# 标题\n\n这是 **重点**。\n\n| 列 | 值 |\n| --- | --- |\n| A | 1 |\n\n<script>alert(1)</script>'
        }
      />,
    )

    expect(html).toContain('role="document"')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<table>')
    expect(html).not.toContain('cclink-document')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
