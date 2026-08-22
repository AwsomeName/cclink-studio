import type { ReactNode } from 'react'
import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { openHttpUrlInNewBrowserTab } from '../../features/browser/browser-link-navigation'
import { copyTextToClipboard } from '../../utils/clipboard'
import { IconClipboard } from './Icons'
import { useToastStore } from './Toast'

const conversationMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
})

const containerTags = new Map<string, keyof React.JSX.IntrinsicElements>([
  ['paragraph_open', 'p'],
  ['heading_open', 'h2'],
  ['blockquote_open', 'blockquote'],
  ['bullet_list_open', 'ul'],
  ['ordered_list_open', 'ol'],
  ['list_item_open', 'li'],
  ['table_open', 'table'],
  ['thead_open', 'thead'],
  ['tbody_open', 'tbody'],
  ['tr_open', 'tr'],
  ['th_open', 'th'],
  ['td_open', 'td'],
  ['strong_open', 'strong'],
  ['em_open', 'em'],
  ['s_open', 'del'],
])

export function ConversationMarkdown({ source }: { source: string }): React.ReactElement {
  const tokens = conversationMarkdown.parse(source, {})
  return <div className="conversation-markdown">{renderTokens(tokens)}</div>
}

export function markdownPreviewText(source: string): string {
  const tokens = conversationMarkdown.parseInline(source, {})
  const text = tokens.flatMap((token) => collectTokenText(token)).join(' ')
  return text
    .replace(/[*~`]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function collectTokenText(token: Token): string[] {
  if (token.type === 'image') return token.content ? [`图片：${token.content}`] : []
  if (token.children?.length) return token.children.flatMap((child) => collectTokenText(child))
  return token.content ? [token.content] : []
}

function renderTokens(tokens: Token[]): ReactNode[] {
  const nodes: ReactNode[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token.type === 'inline') {
      nodes.push(...renderTokens(token.children ?? []))
      continue
    }

    if (token.nesting === 1) {
      const closeIndex = findMatchingClose(tokens, index)
      const children = renderTokens(tokens.slice(index + 1, closeIndex))
      nodes.push(renderContainerToken(token, children, index))
      index = closeIndex
      continue
    }

    if (token.nesting === -1) continue
    nodes.push(renderLeafToken(token, index))
  }

  return nodes
}

function findMatchingClose(tokens: Token[], openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < tokens.length; index += 1) {
    depth += tokens[index].nesting
    if (depth === 0) return index
  }
  return tokens.length - 1
}

function renderContainerToken(token: Token, children: ReactNode[], key: number): ReactNode {
  if (token.type === 'link_open') {
    const href = normalizeConversationHttpUrl(token.attrGet('href'))
    if (!href) return <span key={key}>{children}</span>
    return (
      <a
        key={key}
        href={href}
        title={token.attrGet('title') ?? undefined}
        onClick={(event) => {
          event.preventDefault()
          void openHttpUrlInNewBrowserTab({
            url: href,
            title: linkTitle(children),
          })
        }}
      >
        {children}
      </a>
    )
  }

  const tag =
    token.type === 'heading_open' ? safeHeadingTag(token.tag) : containerTags.get(token.type)
  if (!tag) return <span key={key}>{children}</span>

  if (token.type === 'table_open') {
    return (
      <div className="conversation-markdown-table" key={key}>
        <table>{children}</table>
      </div>
    )
  }

  if (token.type === 'ordered_list_open') {
    const start = Number(token.attrGet('start'))
    return (
      <ol key={key} start={Number.isFinite(start) && start > 1 ? start : undefined}>
        {children}
      </ol>
    )
  }

  const Tag = tag
  return <Tag key={key}>{children}</Tag>
}

function renderLeafToken(token: Token, key: number): ReactNode {
  switch (token.type) {
    case 'text':
      return token.content
    case 'softbreak':
    case 'hardbreak':
      return <br key={key} />
    case 'code_inline':
      return <code key={key}>{token.content}</code>
    case 'fence':
    case 'code_block': {
      const language = token.info.trim().split(/\s+/, 1)[0]
      return <ConversationCodeBlock key={key} code={token.content} language={language} />
    }
    case 'hr':
      return <hr key={key} />
    case 'image':
      return (
        <span className="conversation-markdown-image-alt" key={key}>
          图片：{token.content || '未命名图片'}
        </span>
      )
    case 'html_block':
    case 'html_inline':
      return token.content
    default:
      return token.content || null
  }
}

function ConversationCodeBlock({
  code,
  language,
}: {
  code: string
  language: string
}): React.ReactElement {
  const copyLabel = language ? `复制 ${language} 代码块` : '复制代码块'

  const handleCopy = async (): Promise<void> => {
    try {
      await copyTextToClipboard(code)
      useToastStore.getState().show('代码块已复制', 'success')
    } catch (error) {
      useToastStore.getState().show(`复制失败: ${String(error)}`, 'error')
    }
  }

  return (
    <div className="conversation-markdown-code-block">
      <button
        type="button"
        className="conversation-markdown-code-copy"
        onClick={() => void handleCopy()}
        title={copyLabel}
        aria-label={copyLabel}
      >
        <IconClipboard size={12} />
        <span>复制</span>
      </button>
      <pre>
        <code className={language ? `language-${safeCssName(language)}` : undefined}>{code}</code>
      </pre>
    </div>
  )
}

export function normalizeConversationHttpUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function safeHeadingTag(tag: string): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  return /^h[1-6]$/.test(tag) ? (tag as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') : 'h2'
}

function safeCssName(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '').slice(0, 40)
}

function linkTitle(children: ReactNode[]): string {
  const title = children
    .filter((child): child is string => typeof child === 'string')
    .join('')
    .trim()
  return title.slice(0, 40) || '链接'
}
