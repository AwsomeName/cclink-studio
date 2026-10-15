import { useCallback, useEffect, useRef } from 'react'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import {
  captureActiveWorkspaceTarget,
  isWorkspaceTargetCurrent,
  useWorkspaceStore,
} from '../../stores/workspace-store'
import { workspaceRefKey } from '@shared/workspace-ref'
import {
  cancelActivePanelResize,
  registerPanelResizeCancel,
} from '../../utils/panel-layout-drag-lifecycle'

export interface PanelResizeEnd {
  reason: 'commit' | 'cancel'
  delta: number
}

interface ResizeHandleProps {
  /** 拖拽时回调，参数为本次拖拽从起点到当前的宽度变化量 (px) */
  onResize: (delta: number) => void
  /** 拖拽开始回调。 */
  onResizeStart?: () => void
  /** 拖拽结束回调 */
  onResizeEnd?: (result: PanelResizeEnd) => void
  /** 被调整的面板位置：左侧面板向右拖变宽，右侧面板向左拖变宽 */
  side?: 'left' | 'right'
  area: 'sidebar' | 'agent'
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
  area,
}: ResizeHandleProps): React.ReactElement {
  const cancelRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelRef.current?.(), [])
  const showContextMenu = useContextMenuStore((state) => state.show)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const target = {
    kind: 'layout' as const,
    workspaceKey: workspaceRefKey(activeWorkspaceRef),
    area,
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      cancelActivePanelResize()
      const startX = e.clientX
      const workspaceTarget = captureActiveWorkspaceTarget()
      let dragging = true
      const pointerId = e.pointerId
      const handle = e.currentTarget
      handle.setPointerCapture(pointerId)
      document.body.classList.add('is-resizing-panels')
      onResizeStart?.()

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        if (!dragging || moveEvent.pointerId !== pointerId) return
        if (!isWorkspaceTargetCurrent(workspaceTarget)) {
          cancel()
          return
        }
        const delta = moveEvent.clientX - startX
        // side='left' 时，向右拖 = 正值 = 增大宽度
        // side='right' 时，向右拖 = 正值 = 减小宽度
        onResize(side === 'left' ? delta : -delta)
      }

      const finishResize = (upEvent: PointerEvent): void => {
        if (!dragging || upEvent.pointerId !== pointerId) return
        const delta = upEvent.clientX - startX
        cleanup({
          reason: isWorkspaceTargetCurrent(workspaceTarget) ? 'commit' : 'cancel',
          delta: side === 'left' ? delta : -delta,
        })
      }

      const cancel = (): void => cleanup({ reason: 'cancel', delta: 0 })
      const cancelPointer = (event: PointerEvent): void => {
        if (event.pointerId === pointerId) cancel()
      }
      const cleanup = (result: PanelResizeEnd): void => {
        if (!dragging) return
        dragging = false
        unregister()
        cancelRef.current = null
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        document.body.classList.remove('is-resizing-panels')
        window.removeEventListener('pointermove', handlePointerMove, true)
        window.removeEventListener('pointerup', finishResize, true)
        window.removeEventListener('pointercancel', cancelPointer, true)
        window.removeEventListener('blur', cancel)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onResizeEnd?.(result)
      }
      const unregister = registerPanelResizeCancel(cancel)
      cancelRef.current = cancel

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', handlePointerMove, true)
      window.addEventListener('pointerup', finishResize, true)
      window.addEventListener('pointercancel', cancelPointer, true)
      window.addEventListener('blur', cancel)
    },
    [onResize, onResizeEnd, onResizeStart, side],
  )

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={area === 'sidebar' ? '侧栏宽度' : 'Agent 面板宽度'}
      tabIndex={0}
      data-layout-area={area}
      onPointerDown={handlePointerDown}
      onContextMenu={(event) => {
        event.preventDefault()
        showContextMenu({
          target,
          x: event.clientX,
          y: event.clientY,
          focusReturn: event.currentTarget,
        })
      }}
      onKeyDown={(event) => {
        if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
        event.preventDefault()
        showContextMenu(buildKeyboardContextMenuInput(target, event.currentTarget))
      }}
    />
  )
}
