export type ShortcutModifier = 'primary' | 'control' | 'alt' | 'shift'

export type ShortcutScope = 'global' | 'workbench' | 'editor' | 'markdown' | 'terminal' | 'browser'

export type ShortcutInputPolicy = 'allow' | 'deny'

export interface KeyChord {
  code: string
  modifiers: ShortcutModifier[]
}

export interface CommandShortcutPolicy {
  scope: ShortcutScope
  inputPolicy: ShortcutInputPolicy
  defaultBindings: KeyChord[]
}

export interface KeybindingOverride {
  commandId: string
  bindings: KeyChord[]
}

export const MAX_KEYBINDING_OVERRIDES = 256
export const MAX_BINDINGS_PER_COMMAND = 4

const MODIFIER_ORDER: ShortcutModifier[] = ['primary', 'control', 'alt', 'shift']
const MODIFIER_CODES = new Set([
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
])

export function normalizeKeyChord(chord: KeyChord): KeyChord {
  const unique = new Set(chord.modifiers)
  return {
    code: chord.code,
    modifiers: MODIFIER_ORDER.filter((modifier) => unique.has(modifier)),
  }
}

export function keyChordId(chord: KeyChord): string {
  const normalized = normalizeKeyChord(chord)
  return `${normalized.modifiers.join('+')}:${normalized.code}`
}

export function isValidKeyChord(chord: KeyChord): boolean {
  if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(chord.code) || MODIFIER_CODES.has(chord.code)) {
    return false
  }
  if (chord.modifiers.some((modifier) => !MODIFIER_ORDER.includes(modifier))) return false
  return chord.modifiers.length > 0 || /^F(?:[1-9]|1[0-2])$/.test(chord.code)
}

export function isReservedKeyChord(chord: KeyChord): boolean {
  const normalized = normalizeKeyChord(chord)
  const modifiers = new Set(normalized.modifiers)
  if (!modifiers.has('primary') || modifiers.size !== 1) return false
  return normalized.code === 'KeyQ' || normalized.code === 'Space' || normalized.code === 'Tab'
}

export function normalizeKeybindingOverrides(value: unknown): KeybindingOverride[] {
  if (!Array.isArray(value)) return []
  const normalized = new Map<string, KeybindingOverride>()
  for (const candidate of value.slice(0, MAX_KEYBINDING_OVERRIDES)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = candidate as { commandId?: unknown; bindings?: unknown }
    if (
      typeof record.commandId !== 'string' ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(record.commandId) ||
      !Array.isArray(record.bindings)
    ) {
      continue
    }
    const bindings: KeyChord[] = []
    const ids = new Set<string>()
    for (const binding of record.bindings.slice(0, MAX_BINDINGS_PER_COMMAND)) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) continue
      const chord = binding as { code?: unknown; modifiers?: unknown }
      if (
        typeof chord.code !== 'string' ||
        !Array.isArray(chord.modifiers) ||
        chord.modifiers.some((modifier) => typeof modifier !== 'string')
      ) {
        continue
      }
      const next = normalizeKeyChord({
        code: chord.code,
        modifiers: chord.modifiers as ShortcutModifier[],
      })
      const id = keyChordId(next)
      if (!isValidKeyChord(next) || isReservedKeyChord(next) || ids.has(id)) continue
      ids.add(id)
      bindings.push(next)
    }
    normalized.set(record.commandId, { commandId: record.commandId, bindings })
  }
  return [...normalized.values()]
}

export function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform)
}

export function keyChordFromKeyboardEvent(
  event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  mac: boolean,
): KeyChord | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null
  const modifiers: ShortcutModifier[] = []
  if (mac ? event.metaKey : event.ctrlKey) modifiers.push('primary')
  if (mac && event.ctrlKey) modifiers.push('control')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey) modifiers.push('shift')
  const chord = normalizeKeyChord({ code: event.code, modifiers })
  return isValidKeyChord(chord) ? chord : null
}

export function formatKeyChord(chord: KeyChord, mac: boolean): string {
  const labels: Record<ShortcutModifier, string> = mac
    ? { primary: '⌘', control: '⌃', alt: '⌥', shift: '⇧' }
    : { primary: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift' }
  const key = chord.code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('Arrow', '')
    .replace('BracketLeft', '[')
    .replace('BracketRight', ']')
    .replace('Comma', ',')
    .replace('Period', '.')
    .replace('Slash', '/')
    .replace('Backslash', '\\')
    .replace('Minus', '-')
    .replace('Equal', '=')
    .replace('Space', 'Space')
  const parts = normalizeKeyChord(chord).modifiers.map((modifier) => labels[modifier])
  return mac ? `${parts.join('')}${key}` : [...parts, key].join('+')
}
