import { useEffect } from 'react'
import { useCommandStore } from '../stores/command-store'
import { useUIStore } from '../stores/ui-store'
import { createAgentCommands } from './commands/agent-commands'
import { createBrowserCommands } from './commands/browser-commands'
import { createDiagnosticsCommands } from './commands/diagnostics-commands'
import { createFileCommands } from './commands/file-commands'
import { createSettingsCommands } from './commands/settings-commands'
import { createTabCommands } from './commands/tab-commands'
import { createViewCommands } from './commands/view-commands'
import { createWindowCommands } from './commands/window-commands'

/** 注册核心命令。 */
export function useRegisterCommands(): void {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleAgentPanel = useUIStore((s) => s.toggleAgentPanel)
  const setAgentPanelMode = useUIStore((s) => s.setAgentPanelMode)
  const resetAgentLayout = useUIStore((s) => s.resetAgentLayout)
  const registerCommands = useCommandStore((s) => s.registerCommands)

  useEffect(() => {
    registerCommands([
      ...createViewCommands({
        toggleSidebar,
        toggleAgentPanel,
        focusAgentPanel: () => setAgentPanelMode('center', 'user'),
        resetAgentLayout,
      }),
      ...createTabCommands(),
      ...createFileCommands(),
      ...createSettingsCommands(),
      ...createAgentCommands(),
      ...createBrowserCommands(),
      ...createDiagnosticsCommands(),
      ...createWindowCommands(),
    ])
  }, [registerCommands, toggleSidebar, toggleAgentPanel, setAgentPanelMode, resetAgentLayout])
}
