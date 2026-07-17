import { useEffect, useState } from 'react'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'

interface MarkdownImageOptions extends ImageOptions {
  documentPath?: string
}

export const MarkdownImage = Image.extend<MarkdownImageOptions>({
  addOptions() {
    const parent = this.parent?.()
    return {
      inline: parent?.inline ?? false,
      allowBase64: parent?.allowBase64 ?? true,
      HTMLAttributes: parent?.HTMLAttributes ?? {},
      resize: parent?.resize ?? false,
      documentPath: undefined,
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      markdownSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute('src'),
        renderHTML: () => ({}),
      },
    }
  },

  parseMarkdown(token, helpers) {
    const source = String(token.href ?? '')
    return helpers.createNode('image', {
      src: source,
      markdownSrc: source,
      alt: token.text ?? null,
      title: token.title ?? null,
    })
  },

  renderMarkdown(node) {
    const source = String(node.attrs?.markdownSrc ?? node.attrs?.src ?? '')
    const alt = String(node.attrs?.alt ?? '').replace(/[[\]\\]/g, '\\$&')
    const title = node.attrs?.title ? ` "${String(node.attrs.title)}"` : ''
    return `![${alt}](${source}${title})`
  },

  addNodeView() {
    return ReactNodeViewRenderer(MarkdownImageNodeView)
  },
})

export function resolveMarkdownImageSource(source: string, documentPath?: string): string {
  if (!source || /^(?:https?:|data:|blob:)/i.test(source)) return source
  if (source.startsWith('file://')) return decodeURI(source.slice('file://'.length))
  if (source.startsWith('/')) return source
  if (!documentPath) return source
  const directory = documentPath.slice(0, Math.max(0, documentPath.lastIndexOf('/')))
  const parts = `${directory}/${source}`.split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return `/${normalized.join('/')}`
}

function MarkdownImageNodeView({ node, selected, extension }: NodeViewProps): React.ReactElement {
  const documentPath = (extension.options as MarkdownImageOptions).documentPath
  const source = resolveMarkdownImageSource(String(node.attrs.src ?? ''), documentPath)
  const alt = String(node.attrs.alt ?? '')
  const title = node.attrs.title ? String(node.attrs.title) : undefined
  const [previewSource, setPreviewSource] = useState(() =>
    /^(?:https?:|data:|blob:)/i.test(source) ? source : '',
  )
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (/^(?:https?:|data:|blob:)/i.test(source)) {
      setPreviewSource(source)
      setError('')
      return
    }
    if (!source.startsWith('/')) {
      setPreviewSource('')
      setError('无法定位本地图片')
      return
    }
    void window.cclinkStudio.fs
      .renderFile(source)
      .then((result) => {
        if (cancelled) return
        if (result.kind !== 'image') throw new Error('文件不是受支持的图片')
        setPreviewSource(`data:${result.mimeType};base64,${result.content}`)
        setError('')
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setPreviewSource('')
        setError(reason instanceof Error ? reason.message : '图片加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [source])

  return (
    <NodeViewWrapper
      as="figure"
      className={`markdown-image-node${selected ? ' selected' : ''}`}
      data-markdown-image
    >
      {previewSource ? (
        <img src={previewSource} alt={alt} title={title} draggable={false} />
      ) : (
        <div className="markdown-image-error">{error || '正在加载图片...'}</div>
      )}
      {(alt || title) && (
        <figcaption>
          {alt}
          {alt && title ? ' · ' : ''}
          {title}
        </figcaption>
      )}
    </NodeViewWrapper>
  )
}
