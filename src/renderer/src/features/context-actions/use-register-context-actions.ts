import { useEffect } from 'react'
import { useCommandStore } from '../../stores/command-store'
import { createTabContextCommands, tabMenuContributions } from './domains/tab-context-actions'
import { createFileContextCommands, fileMenuContributions } from './domains/file-context-actions'
import {
  createProjectContextCommands,
  projectMenuContributions,
} from './domains/project-context-actions'
import {
  createSelectionContextCommands,
  selectionMenuContributions,
} from './domains/selection-context-actions'
import {
  createThreadContextCommands,
  threadMenuContributions,
} from './domains/thread-context-actions'
import { useMenuContributionRegistry } from './menu-contribution-registry'
import { createShellContextCommands, shellMenuContributions } from './domains/shell-context-actions'
import {
  createEditorContextCommands,
  editorMenuContributions,
} from './domains/editor-context-actions'
import {
  createTerminalContextCommands,
  terminalMenuContributions,
} from './domains/terminal-context-actions'
import {
  createMessageContextCommands,
  messageMenuContributions,
} from './domains/message-context-actions'
import {
  createDataSourceContextCommands,
  dataSourceMenuContributions,
} from './domains/data-source-context-actions'
import {
  createOperationsContextCommands,
  operationsMenuContributions,
} from './domains/operations-context-actions'
import {
  createProductionContextCommands,
  productionMenuContributions,
} from './domains/production-context-actions'
import {
  androidMenuContributions,
  createAndroidContextCommands,
} from './domains/android-context-actions'
import {
  createSettingsContextCommands,
  settingsMenuContributions,
} from './domains/settings-context-actions'

const commands = [
  ...createTabContextCommands(),
  ...createFileContextCommands(),
  ...createProjectContextCommands(),
  ...createSelectionContextCommands(),
  ...createThreadContextCommands(),
  ...createShellContextCommands(),
  ...createEditorContextCommands(),
  ...createTerminalContextCommands(),
  ...createMessageContextCommands(),
  ...createDataSourceContextCommands(),
  ...createOperationsContextCommands(),
  ...createProductionContextCommands(),
  ...createAndroidContextCommands(),
  ...createSettingsContextCommands(),
]
const contributions = [
  ...tabMenuContributions,
  ...fileMenuContributions,
  ...projectMenuContributions,
  ...selectionMenuContributions,
  ...threadMenuContributions,
  ...shellMenuContributions,
  ...editorMenuContributions,
  ...terminalMenuContributions,
  ...messageMenuContributions,
  ...dataSourceMenuContributions,
  ...operationsMenuContributions,
  ...productionMenuContributions,
  ...androidMenuContributions,
  ...settingsMenuContributions,
]

export function useRegisterContextActions(): void {
  const registerCommands = useCommandStore((state) => state.registerCommands)
  const unregisterCommand = useCommandStore((state) => state.unregisterCommand)
  const registerContributions = useMenuContributionRegistry((state) => state.registerContributions)
  const unregisterContributions = useMenuContributionRegistry(
    (state) => state.unregisterContributions,
  )

  useEffect(() => {
    registerCommands(commands)
    registerContributions(contributions)
    return () => {
      commands.forEach((command) => unregisterCommand(command.id))
      unregisterContributions(contributions.map((item) => item.id))
    }
  }, [registerCommands, registerContributions, unregisterCommand, unregisterContributions])
}
