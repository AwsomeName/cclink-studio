import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeShortcutCaptureEvent,
  startShortcutCapture,
  stopShortcutCapture,
} from './shortcut-capture'

beforeEach(() => {
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  })
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
})

afterEach(() => {
  stopShortcutCapture()
  vi.unstubAllGlobals()
})

function keyboardEvent(input: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: '',
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...input,
  } as unknown as KeyboardEvent
}

describe('shortcut capture', () => {
  it('consumes Cmd+B before editor-native bold handling and records it', () => {
    const onResult = vi.fn()
    startShortcutCapture('capture-1', onResult)
    const event = keyboardEvent({ code: 'KeyB', key: 'b', metaKey: true })

    expect(consumeShortcutCaptureEvent(event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith({
      kind: 'binding',
      chord: { code: 'KeyB', modifiers: ['primary'] },
    })
  })

  it('uses Escape to cancel and unmodified Delete to clear', () => {
    const cancel = vi.fn()
    startShortcutCapture('capture-escape', cancel)
    consumeShortcutCaptureEvent(keyboardEvent({ code: 'Escape', key: 'Escape' }))
    expect(cancel).toHaveBeenCalledWith({ kind: 'cancel' })

    const clear = vi.fn()
    startShortcutCapture('capture-delete', clear)
    consumeShortcutCaptureEvent(keyboardEvent({ code: 'Delete', key: 'Delete' }))
    expect(clear).toHaveBeenCalledWith({ kind: 'clear' })
  })

  it('rejects Cmd+Q and keeps recording for a safer replacement', () => {
    const onResult = vi.fn()
    startShortcutCapture('capture-quit', onResult)
    consumeShortcutCaptureEvent(keyboardEvent({ code: 'KeyQ', key: 'q', metaKey: true }))
    consumeShortcutCaptureEvent(keyboardEvent({ code: 'KeyK', key: 'k', metaKey: true }))

    expect(onResult).toHaveBeenNthCalledWith(1, {
      kind: 'invalid',
      message: '该组合键由系统保留，请换一个',
    })
    expect(onResult).toHaveBeenNthCalledWith(2, {
      kind: 'binding',
      chord: { code: 'KeyK', modifiers: ['primary'] },
    })
  })
})
