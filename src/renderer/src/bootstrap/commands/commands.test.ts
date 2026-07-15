import { describe, expect, it } from 'vitest'
import type { Command } from '../../stores/command-store'
import { createAgentCommands } from './agent-commands'
import { createBrowserCommands } from './browser-commands'
import { createDiagnosticsCommands } from './diagnostics-commands'
import { createFileCommands } from './file-commands'
import { createSettingsCommands } from './settings-commands'
import { createTabCommands } from './tab-commands'
import { createViewCommands } from './view-commands'
import { createWindowCommands } from './window-commands'

function createAllCommands(): Command[] {
  return [
    ...createViewCommands({
      toggleSidebar: () => undefined,
      toggleAgentPanel: () => undefined,
      focusAgentPanel: () => undefined,
      resetAgentLayout: () => undefined,
    }),
    ...createTabCommands(),
    ...createFileCommands(),
    ...createSettingsCommands(),
    ...createAgentCommands(),
    ...createBrowserCommands(),
    ...createDiagnosticsCommands(),
    ...createWindowCommands(),
  ]
}

describe('bootstrap command modules', () => {
  it('注册命令 ID 不重复', () => {
    const ids = createAllCommands().map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('保留核心工作台命令', () => {
    const ids = new Set(createAllCommands().map((command) => command.id))
    expect(ids).toContain('workbench.newTab')
    expect(ids).toContain('browser.newTab')
    expect(ids).toContain('workbench.closeTab')
    expect(ids).toContain('workbench.focusAgentPanel')
    expect(ids).toContain('agent.newConversation')
    expect(ids).toContain('agent.resetSession')
    expect(ids).toContain('diagnostics.copyWorkspaceState')
    expect(ids).toContain('window.reload')
  })
})
