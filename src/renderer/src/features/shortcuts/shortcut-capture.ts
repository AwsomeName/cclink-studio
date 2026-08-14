import type { KeyChord } from '@shared/keybindings'
import { isMacPlatform, isReservedKeyChord, keyChordFromKeyboardEvent } from '@shared/keybindings'

export type ShortcutCaptureResult =
  | { kind: 'binding'; chord: KeyChord }
  | { kind: 'clear' }
  | { kind: 'cancel' }
  | { kind: 'invalid'; message: string }

interface CaptureSession {
  id: string
  expiresAt: number
  onResult: (result: ShortcutCaptureResult) => void
  timer: number
}

let activeSession: CaptureSession | null = null

export function startShortcutCapture(
  id: string,
  onResult: (result: ShortcutCaptureResult) => void,
  timeoutMs = 30_000,
): () => void {
  stopShortcutCapture()
  const timer = window.setTimeout(() => {
    if (activeSession?.id !== id) return
    const callback = activeSession.onResult
    activeSession = null
    callback({ kind: 'cancel' })
  }, timeoutMs)
  activeSession = { id, expiresAt: Date.now() + timeoutMs, onResult, timer }
  return () => {
    if (activeSession?.id === id) stopShortcutCapture()
  }
}

export function stopShortcutCapture(): void {
  if (!activeSession) return
  window.clearTimeout(activeSession.timer)
  activeSession = null
}

export function consumeShortcutCaptureEvent(event: KeyboardEvent): boolean {
  const session = activeSession
  if (!session) return false
  if (Date.now() >= session.expiresAt) {
    stopShortcutCapture()
    session.onResult({ kind: 'cancel' })
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  if (event.repeat) return true
  // IME composition keystrokes are not stable shortcut input. Keep the capture
  // session active, but do not turn an in-progress composition into a binding.
  if (event.isComposing || event.keyCode === 229) return true

  if (event.key === 'Escape') {
    stopShortcutCapture()
    session.onResult({ kind: 'cancel' })
    return true
  }
  if (
    (event.key === 'Backspace' || event.key === 'Delete') &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    stopShortcutCapture()
    session.onResult({ kind: 'clear' })
    return true
  }

  const chord = keyChordFromKeyboardEvent(event, isMacPlatform(navigator.platform))
  if (!chord) return true
  if (isReservedKeyChord(chord)) {
    session.onResult({ kind: 'invalid', message: '该组合键由系统保留，请换一个' })
    return true
  }
  stopShortcutCapture()
  session.onResult({ kind: 'binding', chord })
  return true
}

export function consumeExternalShortcutCapture(id: string, chord: KeyChord): boolean {
  const session = activeSession
  if (!session || session.id !== id) return false
  if (isReservedKeyChord(chord)) {
    session.onResult({ kind: 'invalid', message: '该组合键由系统保留，请换一个' })
    return true
  }
  stopShortcutCapture()
  session.onResult({ kind: 'binding', chord })
  return true
}
