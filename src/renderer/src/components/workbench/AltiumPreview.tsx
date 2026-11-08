import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AltiumDrawingPreview,
  AltiumPreview as AltiumPreviewResult,
} from '@shared/altium-preview'
import { useTabStore } from '../../stores/tab-store'
import './altium-preview.css'

interface Props {
  result: AltiumPreviewResult
  onOpenExternal: () => void
}

export function AltiumPreview({ result, onOpenExternal }: Props): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  if (result.kind === 'altium-project') {
    return (
      <div className="file-preview altium-preview" data-testid="altium-project">
        <div className="file-preview-toolbar">
          <div>
            <div className="file-preview-title">{result.fileName} · 工程 · 只读</div>
            <div className="file-preview-path">{result.path}</div>
          </div>
          <button type="button" onClick={onOpenExternal}>
            系统打开
          </button>
        </div>
        <div className="altium-project-documents">
          <p>选择原理图或 PCB 查看图纸。</p>
          {result.documents.length === 0 && <p>此工程没有图纸引用。</p>}
          {result.documents.map((entry, index) => (
            <div className="altium-project-document" key={`${entry.name}-${index}`}>
              <div>
                <strong>{entry.name}</strong>
                <span>{entry.reason ?? '可预览'}</span>
              </div>
              <button
                type="button"
                disabled={entry.status !== 'ready' || !entry.path}
                onClick={() => {
                  if (entry.path)
                    openTab({
                      type: 'file-preview',
                      icon: '▧',
                      title: entry.path.split('/').pop() ?? entry.name,
                      filePath: entry.path,
                    })
                }}
              >
                查看图纸
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return <AltiumDrawing key={result.path} initial={result} onOpenExternal={onOpenExternal} />
}

function AltiumDrawing({
  initial,
  onOpenExternal,
}: {
  initial: AltiumDrawingPreview
  onOpenExternal: () => void
}): React.ReactElement {
  const [drawing, setDrawing] = useState(initial)
  const [selectedLayer, setSelectedLayer] = useState(initial.selectedLayer ?? '')
  const [showHidden, setShowHidden] = useState(initial.showHidden)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const request = useRef(0)
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )

  const loadLayer = async (layer: string, hidden = showHidden): Promise<void> => {
    const generation = ++request.current
    setSelectedLayer(layer)
    setShowHidden(hidden)
    setLoading(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.fs.renderFile(initial.path, {
        altiumLayer: layer || undefined,
        altiumShowHidden: hidden,
      })
      if (request.current !== generation) return
      if (result.kind !== 'altium-drawing') throw new Error('文件类型已变化，请重新打开')
      setDrawing(result)
    } catch (reason) {
      if (request.current === generation)
        setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (request.current === generation) setLoading(false)
    }
  }

  const zoom = useCallback((factor: number, x = 0, y = 0): void => {
    setView((current) => {
      const scale = Math.max(0.25, Math.min(16, current.scale * factor))
      const ratio = scale / current.scale
      return { scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio }
    })
  }, [])
  useEffect(() => {
    const element = stage.current
    if (!element) return
    // React delegates wheel events passively; a native listener can stop page/pinch scrolling.
    const onWheel = (event: WheelEvent): void => {
      if (!event.deltaY) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      zoom(
        event.deltaY < 0 ? 1.15 : 1 / 1.15,
        event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2,
      )
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoom])
  const fit = (): void => setView({ scale: 1, x: 0, y: 0 })

  return (
    <div
      className="file-preview altium-preview"
      data-testid="altium-drawing"
      data-kind={drawing.documentKind}
    >
      <div className="file-preview-toolbar">
        <div>
          <div className="file-preview-title">
            {initial.fileName} · {drawing.documentKind === 'pcb' ? 'PCB' : '原理图'} · 只读
          </div>
          <div className="file-preview-path">{initial.path}</div>
        </div>
        <div className="file-preview-toolbar-actions">
          <button type="button" disabled={loading} onClick={() => void loadLayer(selectedLayer)}>
            重新加载
          </button>
          <button type="button" onClick={onOpenExternal}>
            系统打开
          </button>
        </div>
      </div>
      <div className="altium-controls">
        {drawing.documentKind === 'pcb' && (
          <label>
            PCB 层{' '}
            <select
              aria-label="PCB 层"
              value={selectedLayer}
              disabled={loading}
              onChange={(event) => void loadLayer(event.target.value)}
            >
              <option value="">全部层</option>
              {drawing.layers.map((layer) => (
                <option key={layer} value={layer}>
                  {layer}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={showHidden}
            disabled={loading}
            onChange={(event) => void loadLayer(selectedLayer, event.target.checked)}
          />
          显示隐藏文字
        </label>
        <button type="button" aria-label="缩小图纸" onClick={() => zoom(1 / 1.25)}>
          −
        </button>
        <output aria-label="图纸缩放">{Math.round(view.scale * 100)}%</output>
        <button type="button" aria-label="放大图纸" onClick={() => zoom(1.25)}>
          +
        </button>
        <button type="button" onClick={fit}>
          适合窗口
        </button>
        <span className="altium-counts">
          {drawing.counts
            .map((count) => `${count.label} ${count.value.toLocaleString()}`)
            .join(' · ')}
        </span>
      </div>
      <div
        className="altium-stage"
        ref={stage}
        tabIndex={0}
        aria-label="Altium 图纸，滚轮缩放，拖动平移"
        aria-busy={loading}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, y: event.clientY, offsetX: view.x, offsetY: view.y }
        }}
        onPointerMove={(event) => {
          const origin = drag.current
          if (origin)
            setView((current) => ({
              ...current,
              x: origin.offsetX + event.clientX - origin.x,
              y: origin.offsetY + event.clientY - origin.y,
            }))
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onKeyDown={(event) => {
          if (
            ['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
              event.key,
            )
          )
            event.preventDefault()
          if (event.key === '+' || event.key === '=') zoom(1.25)
          if (event.key === '-') zoom(1 / 1.25)
          if (event.key === '0') fit()
          if (event.key.startsWith('Arrow'))
            setView((current) => ({
              ...current,
              x:
                current.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0),
              y: current.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0),
            }))
        }}
      >
        {loading ? (
          <div className="altium-stage-message" role="status">
            正在读取{selectedLayer || '图纸'}…
          </div>
        ) : error ? (
          <div className="altium-stage-message" role="alert">
            <strong>无法预览</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void loadLayer(selectedLayer)}>
              重试
            </button>
          </div>
        ) : (
          <img
            alt={`${initial.fileName} ${selectedLayer || '全部层'}只读图纸`}
            draggable={false}
            src={`data:image/svg+xml;base64,${drawing.content}`}
            onError={() => setError('图纸图像无法显示，请重新加载或用系统应用打开')}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          />
        )}
      </div>
      {drawing.warnings.length > 0 && (
        <details className="altium-warnings">
          <summary>解析提示 {drawing.warnings.length} 项，显示可能不完整</summary>
          <ul>
            {drawing.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="altium-footer">
        滚轮缩放 · 拖动平移 · 0 适合窗口 · 只读预览，不执行电气规则或制造检查
      </div>
    </div>
  )
}
