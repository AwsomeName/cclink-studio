import { useEffect, useRef, useState } from 'react'
import {
  GlobalWorkerOptions,
  RenderingCancelledException,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { decodePdfBase64 } from './pdf-preview-data'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface PdfPreviewProps {
  content: string
  fileName: string
  onOpenExternal: () => void
}

type PdfDocumentState =
  | { status: 'loading' }
  | { status: 'ready'; document: PDFDocumentProxy }
  | { status: 'error'; message: string }

type PdfPageState = 'idle' | 'loading' | 'ready' | 'error'

const MIN_SCALE = 0.5
const MAX_SCALE = 2
const SCALE_STEP = 0.25

export function PdfPreview({
  content,
  fileName,
  onOpenExternal,
}: PdfPreviewProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [documentState, setDocumentState] = useState<PdfDocumentState>({ status: 'loading' })
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1)
  const [pageState, setPageState] = useState<PdfPageState>('idle')

  useEffect(() => {
    let cancelled = false
    setDocumentState({ status: 'loading' })
    setPageNumber(1)
    setScale(1)
    setPageState('idle')

    const loadingTask = getDocument({
      data: decodePdfBase64(content),
      stopAtErrors: true,
    })
    loadingTask.onPassword = () => {
      if (!cancelled) {
        setDocumentState({
          status: 'error',
          message: '该 PDF 需要密码，请用系统应用打开。',
        })
      }
      void loadingTask.destroy()
    }
    void loadingTask.promise
      .then((document) => {
        if (!cancelled) setDocumentState({ status: 'ready', document })
      })
      .catch((error) => {
        if (!cancelled) {
          setDocumentState({ status: 'error', message: describePdfError(error) })
        }
      })

    return () => {
      cancelled = true
      void loadingTask.destroy()
    }
  }, [content])

  const document = documentState.status === 'ready' ? documentState.document : null

  useEffect(() => {
    if (!document) return
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    let renderTask: RenderTask | null = null
    setPageState('loading')

    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        })
        return renderTask.promise.finally(() => page.cleanup())
      })
      .then(() => {
        if (!cancelled) setPageState('ready')
      })
      .catch((error) => {
        if (cancelled || error instanceof RenderingCancelledException) return
        setPageState('error')
      })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [document, pageNumber, scale])

  if (documentState.status === 'loading') {
    return (
      <div className="file-preview-pdf-message" data-pdf-preview-status="loading">
        正在加载 PDF...
      </div>
    )
  }

  if (documentState.status === 'error') {
    return (
      <div className="file-preview-message" data-pdf-preview-status="error">
        <div className="file-preview-message-title">PDF 加载失败</div>
        <div className="file-preview-message-detail">{documentState.message}</div>
        <button type="button" onClick={onOpenExternal}>
          用系统应用打开
        </button>
      </div>
    )
  }

  const pageCount = documentState.document.numPages
  const canZoomOut = scale > MIN_SCALE
  const canZoomIn = scale < MAX_SCALE

  return (
    <div
      className="file-preview-pdf-viewer"
      data-pdf-preview-status={pageState}
      aria-label={`PDF 预览：${fileName}`}
    >
      <div className="file-preview-pdf-controls">
        <button
          type="button"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
        >
          上一页
        </button>
        <span>
          {pageNumber} / {pageCount}
        </span>
        <button
          type="button"
          disabled={pageNumber >= pageCount}
          onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
        >
          下一页
        </button>
        <span className="file-preview-pdf-control-divider" aria-hidden="true" />
        <button
          type="button"
          aria-label="缩小 PDF"
          disabled={!canZoomOut}
          onClick={() => setScale((current) => Math.max(MIN_SCALE, current - SCALE_STEP))}
        >
          −
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          type="button"
          aria-label="放大 PDF"
          disabled={!canZoomIn}
          onClick={() => setScale((current) => Math.min(MAX_SCALE, current + SCALE_STEP))}
        >
          ＋
        </button>
      </div>
      <div className="file-preview-pdf-stage">
        {pageState === 'loading' && <div className="file-preview-pdf-page-status">渲染中...</div>}
        {pageState === 'error' && (
          <div className="file-preview-pdf-page-status error">当前页面渲染失败</div>
        )}
        <canvas ref={canvasRef} aria-label={`第 ${pageNumber} 页`} />
      </div>
    </div>
  )
}

function describePdfError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/invalid pdf|missing pdf|unexpected server response/i.test(message)) {
    return '文件不是有效的 PDF，或内容已经损坏。'
  }
  return '无法解析该 PDF，请用系统应用打开。'
}
