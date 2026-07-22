import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../components/common/Toast'
import { createDiagnosticsCommands } from './diagnostics-commands'
import { formatWorkspaceDiagnosticsMarkdown } from '../../utils/workspace-diagnostics'
import {
  formatContextActionDiagnosticsMarkdown,
  useContextActionDiagnosticsStore,
} from '../../features/context-actions/context-action-diagnostics'

describe('diagnostics commands', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useToastStore.setState({ message: '', type: 'info', visible: false })
    useContextActionDiagnosticsStore.getState().clear()
  })

  it('copies workspace state diagnostics to the clipboard', async () => {
    const diagnostics = {
      userDataPath: '/Users/me/Library/Application Support/CCLink Studio',
      stateFilePath: '/Users/me/Library/Application Support/CCLink Studio/workspace-state.json',
      backupFilePath:
        '/Users/me/Library/Application Support/CCLink Studio/workspace-state.json.bak',
      workspaceCount: 2,
      fileVersion: 1,
      userData: {
        fixedUserDataPath: '/Users/me/Library/Application Support/CCLink Studio',
      },
    }
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('window', {
      cclinkStudio: {
        workspaceState: {
          diagnostics: vi.fn().mockResolvedValue(diagnostics),
        },
      },
    })

    createDiagnosticsCommands()[0]!.action()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled())

    expect(window.cclinkStudio.workspaceState.diagnostics).toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(
      `${formatWorkspaceDiagnosticsMarkdown(diagnostics)}${formatContextActionDiagnosticsMarkdown([])}`,
    )
    expect(useToastStore.getState().message).toContain('2 个工作空间')
    expect(useToastStore.getState().type).toBe('success')
  })
})
