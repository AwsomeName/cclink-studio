import { describe, expect, it, vi } from 'vitest'
import { createMarkdownCommands } from './markdown-commands'
import { registerEditorContextSurface } from '../../features/context-actions/editor-context-surface'
import { useTabStore } from '../../stores/tab-store'

describe('Markdown configurable commands', () => {
  it('declares every migrated formatting shortcut in the fixed Markdown scope', () => {
    const commands = createMarkdownCommands()
    expect(commands).toHaveLength(22)
    expect(commands.every((command) => command.configurable)).toBe(true)
    expect(commands.every((command) => command.shortcutPolicy?.scope === 'markdown')).toBe(true)
    expect(
      commands.find((command) => command.id === 'markdown.bold')?.shortcutPolicy,
    ).toMatchObject({
      inputPolicy: 'allow',
      defaultBindings: [{ code: 'KeyB', modifiers: ['primary'] }],
    })
    expect(
      commands.find((command) => command.id === 'markdown.heading3')?.shortcutPolicy,
    ).toMatchObject({ defaultBindings: [{ code: 'Digit3', modifiers: ['primary', 'alt'] }] })
  })

  it('delegates the action to the active Markdown editor surface', async () => {
    const runMarkdownAction = vi.fn(() => true)
    const unregister = registerEditorContextSurface('markdown-1', {
      getSelectionText: () => '',
      cut: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      openFind: vi.fn(),
      closeFind: vi.fn(),
      runMarkdownAction,
    })
    const getState = vi.spyOn(useTabStore, 'getState').mockReturnValue({
      getActiveTab: () => ({ id: 'markdown-1', type: 'editor' }),
    } as never)
    try {
      await createMarkdownCommands()
        .find((command) => command.id === 'markdown.bold')
        ?.action()
      expect(runMarkdownAction).toHaveBeenCalledWith('bold')
    } finally {
      unregister()
      getState.mockRestore()
    }
  })
})
