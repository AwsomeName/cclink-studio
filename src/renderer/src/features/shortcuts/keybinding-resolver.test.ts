import { describe, expect, it, vi } from 'vitest'
import type { Command } from '../../stores/command-store'
import {
  effectiveBindingsForCommand,
  findKeybindingConflicts,
  setKeybindingOverride,
} from './keybinding-resolver'

const commands: Command[] = [
  {
    id: 'workbench.find',
    label: '查找',
    action: vi.fn(),
    shortcutPolicy: {
      scope: 'workbench',
      inputPolicy: 'allow',
      defaultBindings: [{ code: 'KeyF', modifiers: ['primary'] }],
    },
  },
  {
    id: 'markdown.findLike',
    label: 'Markdown 命令',
    action: vi.fn(),
    shortcutPolicy: {
      scope: 'markdown',
      inputPolicy: 'allow',
      defaultBindings: [{ code: 'KeyM', modifiers: ['primary'] }],
    },
  },
  {
    id: 'global.findLike',
    label: '全局命令',
    action: vi.fn(),
    shortcutPolicy: {
      scope: 'global',
      inputPolicy: 'deny',
      defaultBindings: [{ code: 'KeyM', modifiers: ['primary'] }],
    },
  },
  {
    id: 'workbench.other',
    label: '另一个命令',
    action: vi.fn(),
    shortcutPolicy: {
      scope: 'workbench',
      inputPolicy: 'deny',
      defaultBindings: [{ code: 'KeyG', modifiers: ['primary'] }],
    },
  },
]

describe('keybinding resolver', () => {
  it('uses an override as the sole source so the old default stops working', () => {
    const overrides = setKeybindingOverride([], 'workbench.find', [
      { code: 'KeyK', modifiers: ['primary'] },
    ])
    expect(effectiveBindingsForCommand(commands[0], overrides)).toEqual([
      { code: 'KeyK', modifiers: ['primary'] },
    ])
  })

  it('treats an empty override as an intentionally disabled shortcut', () => {
    expect(
      effectiveBindingsForCommand(commands[0], [{ commandId: 'workbench.find', bindings: [] }]),
    ).toEqual([])
  })

  it('reports conflicts only inside the command fixed scope', () => {
    expect(
      findKeybindingConflicts(commands, [], 'workbench.find', {
        code: 'KeyG',
        modifiers: ['primary'],
      }).map((command) => command.id),
    ).toEqual(['workbench.other'])
  })

  it('reports overlapping workbench/Markdown scopes but permits global specificity reuse', () => {
    expect(
      findKeybindingConflicts(commands, [], 'workbench.find', {
        code: 'KeyM',
        modifiers: ['primary'],
      }).map((command) => command.id),
    ).toEqual(['markdown.findLike'])
  })
})
