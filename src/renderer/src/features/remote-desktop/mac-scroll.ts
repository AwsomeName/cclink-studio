import type RFB from '@novnc/novnc'

// noVNC 1.7.0 sends at most one wheel click per event and only after 50px,
// discarding the remainder. A Mac trackpad swipe therefore loses most of its
// distance and scrolls very slowly on macOS Screen Sharing.
const STEP_PX = 6
const VERTICAL_TRACKPAD_STEP_PX = 4
const LINE_PX = 19
const MAX_STEPS_PER_EVENT = 24

// VNC button masks: 8 up, 16 down, 32 left, 64 right.
const UP = 1 << 3
const DOWN = 1 << 4
const LEFT = 1 << 5
const RIGHT = 1 << 6

interface NoVncInternals {
  _handleMouseButton?: (x: number, y: number, mask: number) => void
  _mouseButtonMask?: number
}

/** Pinned to noVNC 1.7.0 internals; returns undefined when the hook is missing. */
export function installMacWheel(
  rfb: RFB,
  screen: HTMLElement,
  batchPointerInput: (emit: () => void) => void,
  onSteps?: (steps: number) => void,
): (() => void) | undefined {
  const internals = rfb as unknown as NoVncInternals
  if (typeof internals._handleMouseButton !== 'function') return undefined
  const press = internals._handleMouseButton.bind(rfb)
  let accX = 0
  let accY = 0
  const onWheel = (event: WheelEvent): void => {
    const canvas = screen.querySelector('canvas')
    if (!canvas || !(event.target instanceof Node) || !canvas.contains(event.target)) return
    // Capture on the parent runs before noVNC's canvas listener; stop it there.
    event.stopPropagation()
    event.preventDefault()
    if (rfb.viewOnly) return
    const scale = event.deltaMode === 0 ? 1 : LINE_PX
    accX += event.deltaX * scale
    // A previous gesture's partial step should not oppose the user's change of direction.
    if (accY * event.deltaY < 0) accY = 0
    accY += event.deltaY * scale
    const rect = canvas.getBoundingClientRect()
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height)
    const base = internals._mouseButtonMask ?? 0
    let sent = 0
    const emit = (axis: 'x' | 'y', negative: number, positive: number, stepPx: number): void => {
      const acc = axis === 'x' ? accX : accY
      const steps = Math.min(Math.floor(Math.abs(acc) / stepPx), MAX_STEPS_PER_EVENT)
      if (steps === 0) return
      const mask = acc < 0 ? negative : positive
      for (let i = 0; i < steps; i++) {
        press(x, y, base | mask)
        press(x, y, base)
      }
      // Keep the remainder; drop any excess beyond the cap so momentum cannot queue up.
      const kept = acc % stepPx
      if (axis === 'x') accX = kept
      else accY = kept
      sent += steps
    }
    batchPointerInput(() => {
      emit('y', UP, DOWN, event.deltaMode === 0 ? VERTICAL_TRACKPAD_STEP_PX : STEP_PX)
      emit('x', LEFT, RIGHT, STEP_PX)
    })
    if (sent) onSteps?.(sent)
  }
  screen.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => screen.removeEventListener('wheel', onWheel, { capture: true })
}
