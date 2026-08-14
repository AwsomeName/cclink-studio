import { describe, expect, it, vi } from 'vitest'
import { registerEditorContextSurface } from '../../features/context-actions/editor-context-surface'
import { registerTerminalContextSurface } from '../../features/context-actions/terminal-context-surface'
import { createWorkbenchCommands } from './workbench-commands'

describe('workbench.find', () => {
  it('delegates editor find to the existing editor surface', () => {
    const openFind = vi.fn()
    const unregister = registerEditorContextSurface('editor-1', {
      getSelectionText: () => '',
      cut: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      openFind,
      closeFind: vi.fn(),
    })
    const command = createWorkbenchCommands().find(
      (candidate) => candidate.id === 'workbench.find',
    )!
    const context = {
      source: 'shortcut' as const,
      target: {
        kind: 'editor' as const,
        workspaceKey: null,
        tabId: 'editor-1',
        filePath: '/tmp/example.md',
        editorKind: 'markdown' as const,
        range: null,
        dirty: false,
      },
    }

    expect(command.enabled?.(context)).toMatchObject({ enabled: true })
    command.action(context)
    expect(openFind).toHaveBeenCalledOnce()
    unregister()
  })

  it('delegates terminal find without registering a second terminal.find command', () => {
    const openFind = vi.fn()
    const unregister = registerTerminalContextSurface('terminal-1', {
      getSelectionText: () => '',
      copy: vi.fn(),
      paste: vi.fn(),
      clear: vi.fn(),
      openFind,
      closeFind: vi.fn(),
    } as never)
    const commands = createWorkbenchCommands()
    const context = {
      source: 'context-menu' as const,
      target: {
        kind: 'terminal' as const,
        workspaceKey: null,
        tabId: 'terminal-tab-1',
        sessionId: 'terminal-1',
        status: 'running' as const,
        selectionText: '',
      },
    }

    expect(commands.some((command) => command.id === 'terminal.find')).toBe(false)
    commands.find((command) => command.id === 'workbench.find')?.action(context)
    expect(openFind).toHaveBeenCalledOnce()
    unregister()
  })
})
