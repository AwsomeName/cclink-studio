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
import {
  createRemoteThreadContextCommands,
  remoteThreadMenuContributions,
} from './domains/remote-thread-context-actions'
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
import {
  createImagePreviewContextCommands,
  imagePreviewMenuContributions,
} from './domains/image-preview-context-actions'

export const contextActionCommands = [
  ...createTabContextCommands(),
  ...createFileContextCommands(),
  ...createProjectContextCommands(),
  ...createSelectionContextCommands(),
  ...createThreadContextCommands(),
  ...createRemoteThreadContextCommands(),
  ...createShellContextCommands(),
  ...createEditorContextCommands(),
  ...createTerminalContextCommands(),
  ...createMessageContextCommands(),
  ...createDataSourceContextCommands(),
  ...createOperationsContextCommands(),
  ...createProductionContextCommands(),
  ...createAndroidContextCommands(),
  ...createSettingsContextCommands(),
  ...createImagePreviewContextCommands(),
]

export const contextActionContributions = [
  ...tabMenuContributions,
  ...fileMenuContributions,
  ...projectMenuContributions,
  ...selectionMenuContributions,
  ...threadMenuContributions,
  ...remoteThreadMenuContributions,
  ...shellMenuContributions,
  ...editorMenuContributions,
  ...terminalMenuContributions,
  ...messageMenuContributions,
  ...dataSourceMenuContributions,
  ...operationsMenuContributions,
  ...productionMenuContributions,
  ...androidMenuContributions,
  ...settingsMenuContributions,
  ...imagePreviewMenuContributions,
]

export const contextActionExternalCommandIds = new Set([
  'workbench.moveTabToNewWindow',
  'workbench.closeTab',
  'workbench.find',
  'workbench.toggleSidebar',
  'diagnostics.copyWorkspaceState',
])
