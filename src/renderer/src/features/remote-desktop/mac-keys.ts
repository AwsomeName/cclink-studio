import type RFB from '@novnc/novnc'

// noVNC remaps a Mac client's Command to Alt_L and Option to Mode_switch so that
// Linux servers behave like RealVNC/TigerVNC. macOS Screen Sharing instead reads
// Super as Command and Alt as Option, so restore physical modifiers by key code.
const MAC_SERVER_MODIFIERS: Record<string, number> = {
  MetaLeft: 0xffeb, // XK_Super_L → Command
  MetaRight: 0xffec, // XK_Super_R
  AltLeft: 0xffe9, // XK_Alt_L → Option
  AltRight: 0xffea, // XK_Alt_R
}

type KeyHandler = (
  keysym: number,
  code: string,
  down: boolean,
  numlock?: boolean | null,
  capslock?: boolean,
) => void

/** Pinned to noVNC 1.7.0 internals; returns false when the hook is missing. */
export function applyMacServerModifiers(
  rfb: RFB,
  onSent?: (keysym: number, down: boolean) => void,
): boolean {
  const keyboard = (rfb as unknown as { _keyboard?: { onkeyevent?: KeyHandler } })._keyboard
  const forward = keyboard?.onkeyevent
  if (!keyboard || typeof forward !== 'function') return false
  keyboard.onkeyevent = (keysym, code, down, numlock, capslock) => {
    const mapped = MAC_SERVER_MODIFIERS[code] ?? keysym
    onSent?.(mapped, down)
    forward(mapped, code, down, numlock, capslock)
  }
  return true
}
