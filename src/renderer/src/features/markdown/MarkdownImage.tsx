import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Extension } from '@tiptap/core'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import {
  MIN_MARKDOWN_IMAGE_WIDTH,
  formatMarkdownSizedImage,
  matchMarkdownSizedImageAtStart,
} from '@shared/markdown-sized-image'
import { resolveMarkdownImageSource } from './markdown-image-source'
import {
  MARKDOWN_IMAGE_VIEWPORT_MARGIN,
  formatImageSize,
  markdownImageLoadQueue,
  shouldAutoLoadMarkdownImage,
} from './markdown-image-budget'

export { resolveMarkdownImageSource }

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
    const width = imageWidthAttribute(node.attrs?.width)
    // A display width is the one thing plain image syntax cannot hold; only then use the strict
    // `<img src alt width>` form (a title, if any, is dropped from that form by design).
    if (width) {
      return formatMarkdownSizedImage({ src: source, alt: String(node.attrs?.alt ?? ''), width })
    }
    const alt = String(node.attrs?.alt ?? '').replace(/[[\]\\]/g, '\\$&')
    const title = node.attrs?.title ? ` "${String(node.attrs.title)}"` : ''
    return `![${alt}](${source}${title})`
  },

  addExtensions() {
    return [MarkdownSizedImageBlockSyntax, MarkdownSizedImageInlineSyntax]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MarkdownImageNodeView)
  },
})

export function imageWidthAttribute(value: unknown): number | null {
  const width = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(width) && width >= MIN_MARKDOWN_IMAGE_WIDTH ? Math.round(width) : null
}

function sizedImageNode(
  token: object,
  createNode: (type: string, attrs?: Record<string, unknown>) => unknown,
) {
  const fields = token as { src?: unknown; alt?: unknown; width?: unknown }
  const source = String(fields.src ?? '')
  return createNode('image', {
    src: source,
    markdownSrc: source,
    alt: String(fields.alt ?? '') || null,
    width: imageWidthAttribute(fields.width),
  })
}

/** `<img src alt width>` alone on a line (otherwise marked would read it as an HTML block). */
const MarkdownSizedImageBlockSyntax = Extension.create({
  name: 'markdownSizedImageBlock',
  markdownTokenName: 'cclinkSizedImageBlock',
  markdownTokenizer: {
    name: 'cclinkSizedImageBlock',
    level: 'block',
    start: (src: string) => src.search(/^ {0,3}<img\s/im),
    tokenize(src: string) {
      const indent = /^ {0,3}/.exec(src)?.[0] ?? ''
      const image = matchMarkdownSizedImageAtStart(src.slice(indent.length))
      if (!image) return undefined
      const rest = src.slice(indent.length + image.raw.length)
      const lineEnd = /^[ \t]*(?:\n|$)/.exec(rest)
      if (!lineEnd) return undefined
      return {
        type: 'cclinkSizedImageBlock',
        raw: indent + image.raw + lineEnd[0],
        src: image.src,
        alt: image.alt,
        width: image.width,
      }
    },
  },
  parseMarkdown: (token, helpers) => sizedImageNode(token, helpers.createNode) as never,
})

/** `<img src alt width>` inside a paragraph or a table cell. */
const MarkdownSizedImageInlineSyntax = Extension.create({
  name: 'markdownSizedImageInline',
  markdownTokenName: 'cclinkSizedImage',
  markdownTokenizer: {
    name: 'cclinkSizedImage',
    level: 'inline',
    start: (src: string) => src.search(/<img\s/i),
    tokenize(src: string) {
      const image = matchMarkdownSizedImageAtStart(src)
      if (!image) return undefined
      return {
        type: 'cclinkSizedImage',
        raw: image.raw,
        src: image.src,
        alt: image.alt,
        width: image.width,
      }
    },
  },
  parseMarkdown: (token, helpers) => sizedImageNode(token, helpers.createNode) as never,
})

type LocalImageState =
  | { phase: 'waiting' }
  | { phase: 'loading' }
  | { phase: 'loaded'; src: string }
  | { phase: 'oversize'; size: number }
  | { phase: 'error'; message: string }

function MarkdownImageNodeView({
  node,
  selected,
  extension,
  editor,
  updateAttributes,
}: NodeViewProps): React.ReactElement {
  const documentPath = (extension.options as MarkdownImageOptions).documentPath
  const source = resolveMarkdownImageSource(String(node.attrs.src ?? ''), documentPath)
  const alt = String(node.attrs.alt ?? '')
  const title = node.attrs.title ? String(node.attrs.title) : undefined
  const remote = /^(?:https?:|data:|blob:)/i.test(source)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [forced, setForced] = useState(false)
  const [local, setLocal] = useState<LocalImageState>({ phase: 'waiting' })
  const imageRef = useRef<HTMLImageElement | null>(null)
  const width = imageWidthAttribute(node.attrs.width)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)

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

  // Drag the corner handle: proportional, from the minimum up to the available width. Ending at
  // the image's natural (or full available) width means "default" and writes plain `![]()` back.
  const startResize = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const image = imageRef.current
      const frame = frameRef.current
      if (!image || !frame || !editor.isEditable) return
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      const startWidth = image.getBoundingClientRect().width
      const available = Math.floor(frame.getBoundingClientRect().width)
      const fullWidth = Math.min(available, image.naturalWidth || available)
      let current = Math.round(startWidth)
      const move = (moveEvent: PointerEvent): void => {
        current = Math.max(
          MIN_MARKDOWN_IMAGE_WIDTH,
          Math.min(available, Math.round(startWidth + moveEvent.clientX - startX)),
        )
        setDragWidth(current)
      }
      const finish = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        setDragWidth(null)
        if (Math.abs(current - startWidth) < 1) return
        updateAttributes({ width: current >= fullWidth - 2 ? null : current })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    [editor, updateAttributes],
  )

  const openViewer = useCallback(() => {
    if (!remote && local.phase === 'oversize') setForced(true)
    setViewerOpen(true)
  }, [local.phase, remote])

  const shownWidth = dragWidth ?? width

  return (
    <NodeViewWrapper
      as="figure"
      className={`markdown-image-node${selected ? ' selected' : ''}`}
      data-markdown-image
    >
      <div ref={frameRef} className="markdown-image-frame" onDoubleClick={openViewer}>
        {imageSource ? (
          <span
            className="markdown-image-sizer"
            style={shownWidth ? { width: `${shownWidth}px` } : undefined}
          >
            <img
              ref={imageRef}
              src={imageSource}
              alt={alt}
              title={title}
              draggable={false}
              decoding="async"
            />
            {selected && editor.isEditable && (
              <button
                type="button"
                className="markdown-image-resize-handle"
                aria-label="拖动调整图片宽度"
                contentEditable={false}
                onPointerDown={startResize}
              />
            )}
            {dragWidth !== null && (
              <span className="markdown-image-width-badge">{dragWidth} px</span>
            )}
          </span>
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
      {viewerOpen && (
        <MarkdownImageViewer
          source={imageSource}
          localPath={remote ? null : source}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </NodeViewWrapper>
  )
}

/** Double-click: the original image over the window. Read-only; Esc or a click outside closes. */
function MarkdownImageViewer({
  source,
  localPath,
  onClose,
}: {
  source: string
  localPath: string | null
  onClose: () => void
}): React.ReactElement {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [size, setSize] = useState<number | null>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  useEffect(() => {
    if (!localPath) return
    let cancelled = false
    void window.cclinkStudio.fs
      .stat(localPath)
      .then((result) => {
        if (!cancelled) setSize(result.size)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [localPath])
  const name = (localPath ?? source).split(/[/?#]/).filter(Boolean).pop() ?? '图片'
  return createPortal(
    <div
      className="markdown-image-viewer"
      role="dialog"
      aria-label="查看原图"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <button
        type="button"
        className="markdown-image-viewer-close"
        aria-label="关闭"
        onClick={onClose}
      >
        ✕
      </button>
      {source ? (
        <img
          src={source}
          alt={name}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
      ) : (
        <div className="markdown-image-viewer-loading">正在加载原图...</div>
      )}
      <div className="markdown-image-viewer-meta">
        {[
          name,
          natural ? `${natural.width}×${natural.height}` : null,
          size !== null ? formatImageSize(size) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </div>,
    document.body,
  )
}
