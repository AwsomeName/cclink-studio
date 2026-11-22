import { isValidKeyChord, type KeyChord, type ShortcutModifier } from '../keybindings'
import { defineIpcInvoke, defineNoArgsIpc } from './contract'
import { isBoundedIpcEventPayload } from './event-payload'

export interface WindowOperationResult {
  success: boolean
}

export interface ToggleFullscreenResult extends WindowOperationResult {
  fullscreen?: boolean
}

export interface SetFullscreenResult extends ToggleFullscreenResult {
  /** Window state before this call, so a caller can restore what the user had. */
  previous?: boolean
}

export interface ShortcutCaptureGuardInput {
  sessionId: string
  active: boolean
  timeoutMs: number
}

export interface ShortcutCaptureInputEvent {
  sessionId: string
  chord: KeyChord
}

export function parseShortcutCaptureInputEvent(value: unknown): ShortcutCaptureInputEvent | null {
  if (
    !isBoundedIpcEventPayload(value) ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null
  }
  const input = value as { sessionId?: unknown; chord?: unknown }
  if (typeof input.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.sessionId)) {
    return null
  }
  if (!input.chord || typeof input.chord !== 'object' || Array.isArray(input.chord)) return null
  const chord = input.chord as { code?: unknown; modifiers?: unknown }
  if (
    typeof chord.code !== 'string' ||
    !Array.isArray(chord.modifiers) ||
    chord.modifiers.some((modifier) => typeof modifier !== 'string')
  ) {
    return null
  }
  const parsedChord: KeyChord = {
    code: chord.code,
    modifiers: chord.modifiers as ShortcutModifier[],
  }
  if (!isValidKeyChord(parsedChord)) return null
  return value as ShortcutCaptureInputEvent
}

export interface WindowApiContract {
  toggleFullscreen: () => Promise<ToggleFullscreenResult>
  setFullscreen: (fullscreen: boolean) => Promise<SetFullscreenResult>
  toggleDevtools: () => Promise<WindowOperationResult>
  reload: () => Promise<WindowOperationResult>
  requestClose: () => Promise<WindowOperationResult>
  isForeground: () => Promise<boolean>
  onFullscreenExit: (callback: () => void) => () => void
  onForegroundChanged: (callback: (active: boolean) => void) => () => void
  focusRenderer: () => Promise<WindowOperationResult>
  setShortcutCaptureGuard: (input: ShortcutCaptureGuardInput) => Promise<WindowOperationResult>
  onShortcutCaptureInput: (callback: (event: ShortcutCaptureInputEvent) => void) => () => void
}

export const windowIpc = {
  toggleFullscreen: defineNoArgsIpc<ToggleFullscreenResult>('window:toggleFullscreen'),
  setFullscreen: defineIpcInvoke<[boolean], SetFullscreenResult>('window:setFullscreen', (args) => {
    if (args.length !== 1 || typeof args[0] !== 'boolean') {
      throw new Error('window:setFullscreen 需要 1 个布尔参数')
    }
    return [args[0]]
  }),
  toggleDevtools: defineNoArgsIpc<WindowOperationResult>('window:toggleDevtools'),
  reload: defineNoArgsIpc<WindowOperationResult>('window:reload'),
  requestClose: defineNoArgsIpc<WindowOperationResult>('window:requestClose'),
  isForeground: defineNoArgsIpc<boolean>('window:isForeground'),
  focusRenderer: defineNoArgsIpc<WindowOperationResult>('window:focusRenderer'),
  setShortcutCaptureGuard: defineIpcInvoke<[ShortcutCaptureGuardInput], WindowOperationResult>(
    'window:setShortcutCaptureGuard',
    (args) => {
      if (args.length !== 1) throw new Error('window:setShortcutCaptureGuard 需要 1 个参数')
      const input = args[0]
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('快捷键录制保护参数无效')
      }
      const candidate = input as Partial<ShortcutCaptureGuardInput>
      if (
        typeof candidate.sessionId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(candidate.sessionId) ||
        typeof candidate.active !== 'boolean' ||
        typeof candidate.timeoutMs !== 'number' ||
        !Number.isInteger(candidate.timeoutMs) ||
        candidate.timeoutMs < 1_000 ||
        candidate.timeoutMs > 60_000
      ) {
        throw new Error('快捷键录制保护参数无效')
      }
      return [candidate as ShortcutCaptureGuardInput]
    },
  ),
} as const

export const windowIpcEvents = {
  fullscreenExit: 'window:fullscreenExit',
  foregroundChanged: 'window:foregroundChanged',
  shortcutCaptureInput: 'window:shortcutCaptureInput',
} as const
