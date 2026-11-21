// Bounded remote desktop trail for the Framework Log panel (console.log/warn are
// captured by renderer-diagnostic-log). Printable characters are never recorded,
// only that one was typed, so passwords typed into the remote stay out of logs.

const MAX_INPUT_LINES = 80
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'])

export interface DesktopDiagnostics {
  stage(message: string): void
  keysymSent(keysym: number, down: boolean): void
  wheelSteps(steps: number): void
  watchInput(screen: HTMLElement, isActive: () => boolean): () => void
  summary(reason: string): void
}

function describeKey(e: KeyboardEvent): string {
  if (e.key === 'Process' || e.keyCode === 229) return 'ime-process'
  if (e.key.length === 1) return 'printable'
  if (MODIFIERS.has(e.key)) return `modifier:${e.key}`
  return `named:${e.key}`
}

function describeTarget(node: EventTarget | null, screen: HTMLElement): string {
  if (!(node instanceof Element)) return 'none'
  const where = screen.contains(node) ? 'screen' : 'outside'
  const editable =
    node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    (node instanceof HTMLElement && node.isContentEditable)
  return `${node.tagName.toLowerCase()}@${where}${editable ? '(editable)' : ''}`
}

export function createDesktopDiagnostics(endpoint: string): DesktopDiagnostics {
  const started = performance.now()
  const counts = {
    keydownScreen: 0,
    keydownOutside: 0,
    imeOrComposing: 0,
    sentDown: 0,
    sentUp: 0,
    wheelSteps: 0,
  }
  let inputLines = 0
  const log = (...values: unknown[]): void => {
    const t = ((performance.now() - started) / 1000).toFixed(1)
    console.log('[RemoteDesktop]', `+${t}s`, ...values)
  }
  const inputLog = (...values: unknown[]): void => {
    if (inputLines === MAX_INPUT_LINES) log('input trail truncated; see summary')
    if (inputLines++ < MAX_INPUT_LINES) log(...values)
  }

  return {
    stage(message) {
      log(endpoint, message)
    },
    keysymSent(keysym, down) {
      if (down) counts.sentDown++
      else counts.sentUp++
      const kind = keysym < 0xff00 ? 'char' : `0x${keysym.toString(16)}`
      inputLog('sent', down ? 'down' : 'up', kind)
    },
    wheelSteps(steps) {
      counts.wheelSteps += steps
    },
    watchInput(screen, isActive) {
      const onKey = (e: KeyboardEvent): void => {
        if (!isActive()) return
        const where = describeTarget(e.target, screen)
        if (e.type === 'keydown') {
          if (where.includes('@screen')) counts.keydownScreen++
          else counts.keydownOutside++
          if (e.isComposing || e.keyCode === 229) counts.imeOrComposing++
        }
        inputLog(
          e.type,
          describeKey(e),
          `target=${where}`,
          `focus=${describeTarget(document.activeElement, screen)}`,
          e.isComposing ? 'composing' : '',
          e.metaKey || e.ctrlKey || e.altKey ? 'with-modifier' : '',
        )
      }
      const onComposition = (e: CompositionEvent): void => {
        if (isActive()) inputLog(e.type, `target=${describeTarget(e.target, screen)}`)
      }
      const onFocus = (e: FocusEvent): void => {
        if (e.target instanceof Element && screen.contains(e.target)) {
          inputLog(e.type, describeTarget(e.target, screen))
        }
      }
      // Capture phase on window: sees keys even if focus never reached the canvas.
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('keyup', onKey, true)
      window.addEventListener('compositionstart', onComposition, true)
      window.addEventListener('compositionend', onComposition, true)
      screen.addEventListener('focusin', onFocus)
      screen.addEventListener('focusout', onFocus)
      return () => {
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('keyup', onKey, true)
        window.removeEventListener('compositionstart', onComposition, true)
        window.removeEventListener('compositionend', onComposition, true)
        screen.removeEventListener('focusin', onFocus)
        screen.removeEventListener('focusout', onFocus)
      }
    },
    summary(reason) {
      log(endpoint, 'summary', reason, JSON.stringify(counts))
    },
  }
}
