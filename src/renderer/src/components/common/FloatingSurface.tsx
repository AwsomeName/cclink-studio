import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  resolveFloatingSurfacePosition,
  type FloatingSurfacePlacement,
  type FloatingSurfacePosition,
} from './floating-surface-position'
import { registerFloatingSurface } from './floating-surface-registry'

interface FloatingSurfaceProps {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  children: ReactNode
  className?: string
  placement?: FloatingSurfacePlacement
  gap?: number
  viewportPadding?: number
  role?: string
  style?: CSSProperties
  matchAnchorWidth?: boolean
  onRequestClose: () => void
}

export function FloatingSurface({
  anchorRef,
  open,
  children,
  className,
  placement = 'bottom-start',
  gap = 8,
  viewportPadding = 8,
  role,
  style,
  matchAnchorWidth = false,
  onRequestClose,
}: FloatingSurfaceProps): ReactElement | null {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<FloatingSurfacePosition | null>(null)
  const [anchorWidth, setAnchorWidth] = useState<number | null>(null)

  const updatePosition = useCallback((): void => {
    const anchor = anchorRef.current
    const surface = surfaceRef.current
    if (!anchor || !surface || !anchor.isConnected) return

    const anchorRect = anchor.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    if (matchAnchorWidth) {
      setAnchorWidth((current) => (current === anchorRect.width ? current : anchorRect.width))
    }
    const next = resolveFloatingSurfacePosition({
      anchor: anchorRect,
      surface: surfaceRect,
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      placement,
      gap,
      viewportPadding,
    })

    setPosition((current) =>
      current &&
      current.top === next.top &&
      current.left === next.left &&
      current.placement === next.placement
        ? current
        : next,
    )
  }, [anchorRef, gap, matchAnchorWidth, placement, viewportPadding])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    const animationFrame = window.requestAnimationFrame(updatePosition)
    const resizeObserver = new ResizeObserver(updatePosition)
    if (anchorRef.current) resizeObserver.observe(anchorRef.current)
    if (surfaceRef.current) resizeObserver.observe(surfaceRef.current)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, open, updatePosition])

  useEffect(() => {
    if (!open) return

    return registerFloatingSurface()
  }, [open])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || surfaceRef.current?.contains(target)) return
      onRequestClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onRequestClose()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchorRef, onRequestClose, open])

  if (!open) return null

  return createPortal(
    <div
      ref={surfaceRef}
      className={['floating-surface', className].filter(Boolean).join(' ')}
      data-placement={position?.placement ?? placement}
      role={role}
      style={{
        ...style,
        position: 'fixed',
        top: position?.top ?? 0,
        right: 'auto',
        bottom: 'auto',
        left: position?.left ?? 0,
        width: matchAnchorWidth && anchorWidth !== null ? anchorWidth : style?.width,
        maxWidth: style?.maxWidth ?? `calc(100vw - ${viewportPadding * 2}px)`,
        maxHeight: style?.maxHeight ?? `calc(100vh - ${viewportPadding * 2}px)`,
        zIndex: style?.zIndex ?? 10060,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
