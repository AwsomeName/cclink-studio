import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ConversationMarkdown,
  markdownPreviewText,
  normalizeConversationHttpUrl,
} from './ConversationMarkdown'

beforeAll(() => {
  vi.stubGlobal('React', React)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('ConversationMarkdown', () => {
  it('Agent 消息链接必须通过统一路由打开普通 Browser Tab', () => {
    const source = readFileSync(new URL('./ConversationMarkdown.tsx', import.meta.url), 'utf8')
    expect(source).toContain('openHttpUrlInNewBrowserTab')
    expect(source).not.toContain('useTabStore.getState().openTab')
  })

  it('renders common Markdown structures as semantic React elements', () => {
    const html = renderToStaticMarkup(
      <ConversationMarkdown
        source={
          '## 结论\n\n这是 **重点** 和 `code`。\n\n- 第一项\n- 第二项\n\n```ts\nconst ok = true\n```'
        }
      />,
    )

    expect(html).toContain('<h2>结论</h2>')
    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<pre><code class="language-ts">const ok = true')
    expect(html).toContain('class="conversation-markdown-code-copy"')
    expect(html).toContain('aria-label="复制 ts 代码块"')
    expect(html).not.toContain('```')
  })

  it('adds a dedicated copy action only to block code', () => {
    const html = renderToStaticMarkup(
      <ConversationMarkdown source={'行内 `code`\n\n    block command'} />,
    )

    expect(html.match(/conversation-markdown-code-copy/g)).toHaveLength(1)
    expect(html).toContain('aria-label="复制代码块"')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<pre><code>block command')
  })

  it('keeps raw HTML inert and never loads Markdown images', () => {
    const html = renderToStaticMarkup(
      <ConversationMarkdown
        source={
          '<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n![远程图](https://example.com/a.png)'
        }
      />,
    )

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;')
    expect(html).toContain('图片：远程图')
  })

  it('renders incomplete streaming fences without throwing', () => {
    const html = renderToStaticMarkup(
      <ConversationMarkdown source={'```sh\necho still-streaming'} />,
    )

    expect(html).toContain('<pre><code class="language-sh">echo still-streaming')
  })

  it('only accepts HTTP and HTTPS links', () => {
    expect(normalizeConversationHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeConversationHttpUrl('http://example.com')).toBe('http://example.com/')
    expect(normalizeConversationHttpUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeConversationHttpUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeConversationHttpUrl('/relative')).toBeNull()
  })

  it('removes Markdown punctuation from collapsed thinking previews', () => {
    expect(markdownPreviewText('**结论**：使用 `npm pack`。')).toBe('结论 ：使用 npm pack 。')
    expect(markdownPreviewText('**第一步****第二步**')).toBe('第一步 第二步')
  })
})
