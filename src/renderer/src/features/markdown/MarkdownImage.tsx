import { useEffect, useRef, useState } from 'react'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { decodeMarkdownPath, splitMarkdownDestinationSuffix } from '@shared/markdown-document'
import {
  MARKDOWN_IMAGE_VIEWPORT_MARGIN,
  formatImageSize,
  markdownImageLoadQueue,
  shouldAutoLoadMarkdownImage,
} from './markdown-image-budget'

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
  const { path } = splitMarkdownDestinationSuffix(source)
  if (path.startsWith('file://')) return decodeMarkdownPath(path.slice('file://'.length))
  const decodedPath = decodeMarkdownPath(path)
  if (decodedPath.startsWith('/')) return decodedPath
  if (!documentPath) return decodedPath
  const directory = documentPath.slice(0, Math.max(0, documentPath.lastIndexOf('/')))
  const parts = `${directory}/${decodedPath}`.split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return `/${normalized.join('/')}`
}

type LocalImageState =
  | { phase: 'waiting' }
  | { phase: 'loading' }
  | { phase: 'loaded'; src: string }
  | { phase: 'oversize'; size: number }
  | { phase: 'error'; message: string }

function MarkdownImageNodeView({ node, selected, extension }: NodeViewProps): React.ReactElement {
  const documentPath = (extension.options as MarkdownImageOptions).documentPath
  const source = resolveMarkdownImageSource(String(node.attrs.src ?? ''), documentPath)
  const alt = String(node.attrs.alt ?? '')
  const title = node.attrs.title ? String(node.attrs.title) : undefined
  const remote = /^(?:https?:|data:|blob:)/i.test(source)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [forced, setForced] = useState(false)
  const [local, setLocal] = useState<LocalImageState>({ phase: 'waiting' })

  // Local images load only once they come near the viewport.
  useEffect(() => {
    setVisible(false)
    setForced(false)
    setLocal({ phase: 'waiting' })
    if (remote) return
    const element = frameRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: MARKDOWN_IMAGE_VIEWPORT_MARGIN },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [remote, source])

  useEffect(() => {
    if (remote || !visible) return
    if (!source.startsWith('/')) {
      setLocal({ phase: 'error', message: '无法定位本地图片' })
      return
    }
    let cancelled = false
    let cancelQueued: (() => void) | undefined
    void (async () => {
      try {
        if (!forced) {
          const { size } = await window.cclinkStudio.fs.stat(source)
          if (cancelled) return
          if (!shouldAutoLoadMarkdownImage(size)) {
            setLocal({ phase: 'oversize', size })
            return
          }
        }
        setLocal({ phase: 'loading' })
        const job = markdownImageLoadQueue.enqueue(() => window.cclinkStudio.fs.renderFile(source))
        cancelQueued = job.cancel
        const result = await job.promise
        if (cancelled) return
        if (result.kind !== 'image') throw new Error('文件不是受支持的图片')
        setLocal({ phase: 'loaded', src: `data:${result.mimeType};base64,${result.content}` })
      } catch (reason) {
        if (cancelled) return
        setLocal({
          phase: 'error',
          message: reason instanceof Error ? reason.message : '图片加载失败',
        })
      }
    })()
    return () => {
      cancelled = true
      cancelQueued?.()
    }
  }, [forced, remote, source, visible])

  const imageSource = remote ? source : local.phase === 'loaded' ? local.src : ''

  return (
    <NodeViewWrapper
      as="figure"
      className={`markdown-image-node${selected ? ' selected' : ''}`}
      data-markdown-image
    >
      <div ref={frameRef} className="markdown-image-frame">
        {imageSource ? (
          <img src={imageSource} alt={alt} title={title} draggable={false} decoding="async" />
        ) : local.phase === 'oversize' ? (
          <div className="markdown-image-placeholder" data-image-state="oversize">
            <span>图片较大（{formatImageSize(local.size)}），为保持编辑流畅未自动加载</span>
            <button type="button" contentEditable={false} onClick={() => setForced(true)}>
              加载此图片
            </button>
          </div>
        ) : local.phase === 'error' ? (
          <div className="markdown-image-error">{local.message}</div>
        ) : (
          <div className="markdown-image-placeholder" data-image-state={local.phase}>
            {local.phase === 'loading' ? '正在加载图片...' : '图片将在滚动到附近时加载'}
          </div>
        )}
      </div>
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
