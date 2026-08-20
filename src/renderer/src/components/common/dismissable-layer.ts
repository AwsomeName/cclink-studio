import { useEffect, useLayoutEffect, useRef } from 'react'

type EscapeDismissHandler = () => void

interface EscapeLayer {
  id: symbol
  dismiss: EscapeDismissHandler
}

const escapeLayers: EscapeLayer[] = []
let listening = false

/**
 * Registers one dismissable UI layer. Escape is always delivered to the most
 * recently registered layer so nested menus do not close their parents too.
 */
export function registerEscapeDismissLayer(dismiss: EscapeDismissHandler): () => void {
  const layer: EscapeLayer = { id: Symbol('escape-layer'), dismiss }
  escapeLayers.push(layer)
  syncGlobalListener()

  return () => {
    const index = escapeLayers.findIndex((candidate) => candidate.id === layer.id)
    if (index >= 0) escapeLayers.splice(index, 1)
    syncGlobalListener()
  }
}

export function useEscapeDismiss(open: boolean, dismiss: EscapeDismissHandler): void {
  const dismissRef = useRef(dismiss)

  useLayoutEffect(() => {
    dismissRef.current = dismiss
  }, [dismiss])

  useEffect(() => {
    if (!open) return
    return registerEscapeDismissLayer(() => dismissRef.current())
  }, [open])
}

export function dismissTopEscapeLayer(): boolean {
  const layer = escapeLayers.at(-1)
  if (!layer) return false
  layer.dismiss()
  return true
}

function handleGlobalEscape(event: KeyboardEvent): void {
  if (
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229
  ) {
    return
  }
  if (!dismissTopEscapeLayer()) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function syncGlobalListener(): void {
  if (typeof document === 'undefined') return
  if (escapeLayers.length > 0 && !listening) {
    document.addEventListener('keydown', handleGlobalEscape, true)
    listening = true
    return
  }
  if (escapeLayers.length === 0 && listening) {
    document.removeEventListener('keydown', handleGlobalEscape, true)
    listening = false
  }
}
