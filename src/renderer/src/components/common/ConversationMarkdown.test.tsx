import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ConversationMarkdown,
  markdownPreviewText,
  normalizeConversationMarkdownFilePath,
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

  it('makes Markdown file paths clickable only when a file opener is available', () => {
    const html = renderToStaticMarkup(
      <ConversationMarkdown
        source={'`docs/design/需求描述.md` 和 [交付物](docs/delivery.markdown) 以及 `pnpm test`'}
        onOpenFilePath={() => undefined}
      />,
    )

    expect(html.match(/conversation-markdown-file-link/g)).toHaveLength(2)
    expect(html).toContain('<code>docs/design/需求描述.md</code>')
    expect(html).toContain('title="打开 docs/delivery.markdown"')
    expect(html).toContain('<code>pnpm test</code>')
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

  it('recognizes only bounded Markdown file path candidates', () => {
    expect(normalizeConversationMarkdownFilePath(' docs/readme.md ')).toBe('docs/readme.md')
    expect(normalizeConversationMarkdownFilePath('docs/readme.markdown')).toBe(
      'docs/readme.markdown',
    )
    expect(normalizeConversationMarkdownFilePath('C:\\project\\readme.md')).toBe(
      'C:\\project\\readme.md',
    )
    expect(normalizeConversationMarkdownFilePath('docs/%E9%9C%80%E6%B1%82.md')).toBe('docs/需求.md')
    expect(normalizeConversationMarkdownFilePath('pnpm test')).toBeNull()
    expect(normalizeConversationMarkdownFilePath('https://example.com/readme.md')).toBeNull()
  })

  it('removes Markdown punctuation from collapsed thinking previews', () => {
    expect(markdownPreviewText('**结论**：使用 `npm pack`。')).toBe('结论 ：使用 npm pack 。')
    expect(markdownPreviewText('**第一步****第二步**')).toBe('第一步 第二步')
  })
})
