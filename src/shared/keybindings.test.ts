import { describe, expect, it } from 'vitest'
import {
  formatKeyChord,
  isReservedKeyChord,
  keyChordFromKeyboardEvent,
  normalizeKeybindingOverrides,
} from './keybindings'

describe('keybindings contract', () => {
  it('normalizes valid overrides and rejects reserved or malformed chords', () => {
    expect(
      normalizeKeybindingOverrides([
        {
          commandId: 'workbench.find',
          bindings: [
            { code: 'KeyG', modifiers: ['shift', 'primary', 'primary'] },
            { code: 'KeyQ', modifiers: ['primary'] },
            { code: 'KeyG', modifiers: ['primary', 'shift'] },
          ],
        },
        { commandId: '../bad', bindings: [{ code: 'KeyF', modifiers: ['primary'] }] },
      ]),
    ).toEqual([
      {
        commandId: 'workbench.find',
        bindings: [{ code: 'KeyG', modifiers: ['primary', 'shift'] }],
      },
    ])
  })

  it('maps the platform primary modifier without making Ctrl and Cmd equivalent on macOS', () => {
    expect(
      keyChordFromKeyboardEvent(
        { code: 'KeyF', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        true,
      ),
    ).toEqual({ code: 'KeyF', modifiers: ['primary'] })
    expect(
      keyChordFromKeyboardEvent(
        { code: 'KeyF', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        true,
      ),
    ).toEqual({ code: 'KeyF', modifiers: ['control'] })
  })

  it('reserves quit but allows recording the close-tab chord under main-process guard', () => {
    expect(isReservedKeyChord({ code: 'KeyQ', modifiers: ['primary'] })).toBe(true)
    expect(isReservedKeyChord({ code: 'KeyW', modifiers: ['primary'] })).toBe(false)
    expect(formatKeyChord({ code: 'KeyF', modifiers: ['primary', 'shift'] }, true)).toBe('⌘⇧F')
  })
})
