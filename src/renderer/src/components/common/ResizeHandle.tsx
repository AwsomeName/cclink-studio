import { useCallback, useRef } from 'react'

interface ResizeHandleProps {
  /** 拖拽时回调，参数为本次拖拽从起点到当前的宽度变化量 (px) */
  onResize: (delta: number) => void
  /** 拖拽开始回调。 */
  onResizeStart?: () => void
  /** 拖拽结束回调 */
  onResizeEnd?: () => void
  /** 被调整的面板位置：左侧面板向右拖变宽，右侧面板向左拖变宽 */
  side?: 'left' | 'right'
}

/**
 * 面板宽度拖拽调整手柄
 *
 * 渲染一个 4px 宽的透明可拖拽区域，hover 时显示蓝色高亮条。
 * 拖拽时实时回调 onResize(delta)，由父组件控制实际宽度。
 */
export function ResizeHandle({
  onResize,
  onResizeStart,
  onResizeEnd,
  side = 'right',
}: ResizeHandleProps): React.ReactElement {
  const dragStartXRef = useRef(0)
  const draggingRef = useRef(false)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      dragStartXRef.current = e.clientX
      draggingRef.current = true
      const pointerId = e.pointerId
      const handle = e.currentTarget
      handle.setPointerCapture(pointerId)
      document.body.classList.add('is-resizing-panels')
      onResizeStart?.()

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        if (!draggingRef.current || moveEvent.pointerId !== pointerId) return
        const delta = moveEvent.clientX - dragStartXRef.current
        // side='left' 时，向右拖 = 正值 = 增大宽度
        // side='right' 时，向右拖 = 正值 = 减小宽度
        onResize(side === 'left' ? delta : -delta)
      }

      const finishResize = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== pointerId) return
        draggingRef.current = false
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        document.body.classList.remove('is-resizing-panels')
        onResizeEnd?.()
        window.removeEventListener('pointermove', handlePointerMove, true)
        window.removeEventListener('pointerup', finishResize, true)
        window.removeEventListener('pointercancel', finishResize, true)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', handlePointerMove, true)
      window.addEventListener('pointerup', finishResize, true)
      window.addEventListener('pointercancel', finishResize, true)
    },
    [onResize, onResizeEnd, onResizeStart, side],
  )

  return <div className="resize-handle" onPointerDown={handlePointerDown} />
}
