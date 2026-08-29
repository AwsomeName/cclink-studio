import { isValidKeyChord, type KeyChord, type ShortcutModifier } from '../keybindings'
import { defineIpcInvoke, defineNoArgsIpc } from './contract'
import { isBoundedIpcEventPayload } from './event-payload'

export interface WindowOperationResult {
  success: boolean
}

export interface ToggleFullscreenResult extends WindowOperationResult {
  fullscreen?: boolean
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
  toggleDevtools: () => Promise<WindowOperationResult>
  reload: () => Promise<WindowOperationResult>
  requestClose: () => Promise<WindowOperationResult>
  focusRenderer: () => Promise<WindowOperationResult>
  setShortcutCaptureGuard: (input: ShortcutCaptureGuardInput) => Promise<WindowOperationResult>
  onShortcutCaptureInput: (callback: (event: ShortcutCaptureInputEvent) => void) => () => void
}

export const windowIpc = {
  toggleFullscreen: defineNoArgsIpc<ToggleFullscreenResult>('window:toggleFullscreen'),
  toggleDevtools: defineNoArgsIpc<WindowOperationResult>('window:toggleDevtools'),
  reload: defineNoArgsIpc<WindowOperationResult>('window:reload'),
  requestClose: defineNoArgsIpc<WindowOperationResult>('window:requestClose'),
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
  shortcutCaptureInput: 'window:shortcutCaptureInput',
} as const
