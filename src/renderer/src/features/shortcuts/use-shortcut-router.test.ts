import { describe, expect, it } from 'vitest'
import type { EffectiveKeybinding } from './keybinding-resolver'
import { selectShortcutBinding, shouldSuppressShortcutForUi } from './use-shortcut-router'

const chord = { code: 'KeyB', modifiers: ['primary'] as const }

describe('selectShortcutBinding', () => {
  it('prefers the active Markdown command over a global command on the same chord', () => {
    const bindings: EffectiveKeybinding[] = [
      {
        commandId: 'view.toggleSidebar',
        chord: { code: chord.code, modifiers: [...chord.modifiers] },
        scope: 'global',
        inputPolicy: 'deny',
      },
      {
        commandId: 'markdown.bold',
        chord: { code: chord.code, modifiers: [...chord.modifiers] },
        scope: 'markdown',
        inputPolicy: 'allow',
      },
    ]
    expect(
      selectShortcutBinding(bindings, 'primary:KeyB', new Set(['global', 'markdown']), true)
        ?.commandId,
    ).toBe('markdown.bold')
  })

  it('does not run a deny-input command while typing', () => {
    const bindings: EffectiveKeybinding[] = [
      {
        commandId: 'view.toggleSidebar',
        chord: { code: chord.code, modifiers: [...chord.modifiers] },
        scope: 'global',
        inputPolicy: 'deny',
      },
    ]
    expect(
      selectShortcutBinding(bindings, 'primary:KeyB', new Set(['global']), true),
    ).toBeUndefined()
  })
})

describe('shortcut UI suppression', () => {
  it('does not route application shortcuts through an open dialog', () => {
    expect(
      shouldSuppressShortcutForUi({
        commandId: 'markdown.bold',
        paletteOpen: false,
        contextMenuOpen: false,
        floatingSurfaceOpen: false,
        dialogOpen: true,
      }),
    ).toBe(true)
  })

  it('lets the command-palette shortcut close the open palette', () => {
    expect(
      shouldSuppressShortcutForUi({
        commandId: 'workbench.showCommands',
        paletteOpen: true,
        contextMenuOpen: false,
        floatingSurfaceOpen: false,
        dialogOpen: false,
      }),
    ).toBe(false)
  })
})
