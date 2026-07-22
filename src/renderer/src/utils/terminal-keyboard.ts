export interface TerminalKeyEventLike {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

const ESC = '\u001b'

export function resolveTerminalAltArrowSequence(
  event: TerminalKeyEventLike,
  applicationCursorKeysMode = false,
): string | null {
  if (
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    applicationCursorKeysMode
  ) {
    return null
  }

  switch (event.key) {
    case 'ArrowLeft':
      return `${ESC}b`
    case 'ArrowRight':
      return `${ESC}f`
    case 'ArrowUp':
      return `${ESC}[A`
    case 'ArrowDown':
      return `${ESC}[B`
    default:
      return null
  }
}
