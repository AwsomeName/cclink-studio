import { articlePublishingIpc } from '../../shared/article-publishing/article-publishing'
import { gitIpc } from '../../shared/git/git-contract'
import { mediaProjectsIpc } from '../../shared/media-production/media-project-contract'
import { mediaRenderIpc } from '../../shared/media-production/media-render-contract'
import { mediaVideoIpc } from '../../shared/media-production/video-generation-contract'
import { scheduledTasksIpc } from '../../shared/scheduled-task/scheduled-task-contract'
import { updateIpc } from '../../shared/update/update-contract'
import { webAffairsIpc } from '../../shared/web-affairs/web-affair'
import { webResourcesIpc } from '../../shared/web-resources/web-resource'
import { agentIpc, agentMcpIpc } from '../../shared/ipc/agent'
import { androidIpc } from '../../shared/ipc/android'
import { authIpc } from '../../shared/ipc/auth'
import { browserDownloadIpc, browserIpc, browserTaskIpc } from '../../shared/ipc/browser'
import { cadIpc } from '../../shared/ipc/cad'
import { cclinkIpc } from '../../shared/ipc/cclink'
import { credentialsIpc } from '../../shared/ipc/credentials'
import { dataSourceIpc } from '../../shared/ipc/data-source'
import { diagnosticsIpc } from '../../shared/ipc/diagnostics'
import { dialogIpc } from '../../shared/ipc/dialog'
import { editorIpc } from '../../shared/ipc/editor'
import { fsIpc } from '../../shared/ipc/fs'
import { gitBackupIpc } from '../../shared/ipc/git-backup'
import { hardwareIpc } from '../../shared/ipc/hardware'
import { identityIpc } from '../../shared/ipc/identity'
import { officialIpc } from '../../shared/ipc/official'
import { projectOpsIpc } from '../../shared/ipc/project-ops'
import { remoteIpc } from '../../shared/ipc/remote'
import { runtimeComponentsIpc } from '../../shared/ipc/runtime-components'
import { settingsIpc } from '../../shared/ipc/settings'
import { terminalIpc } from '../../shared/ipc/terminal'
import { wechatIpc } from '../../shared/ipc/wechat'
import {
  workbenchBrowserStateIpc,
  workbenchTabModelIpc,
} from '../../shared/ipc/workbench-tab-model'
import { workbenchWindowIpc } from '../../shared/ipc/workbench-window'
import { windowIpc } from '../../shared/ipc/window'
import { workspaceStateIpc } from '../../shared/ipc/workspace-state'

export type IpcMigrationPhase = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'

export interface LegacyIpcNamespaceInventory {
  namespace: string
  owner: string
  targetPhase: IpcMigrationPhase
  producerRoots: readonly string[]
  consumerRoots: readonly string[]
  channels: readonly string[]
}

export interface LegacyIpcEventFlowInventory {
  channel: string
  owner: string
  producerFiles: readonly string[]
  consumerFiles: readonly string[]
  disposition: 'migrate' | 'decide-remove-or-complete'
  targetPhase: IpcMigrationPhase
}

export interface IpcInvokeContractInventory {
  channel: string
  key: string
  owner: string
  definitionFile: string
  definitionName: string
  handlerFiles: readonly string[]
  preloadFiles: readonly string[]
  parser: 'main-runtime-contract'
  lifecycle: 'trusted-registration-scope'
}

export interface IpcEventFlowInventory {
  channel: string
  owner: string
  direction: 'main-to-renderer' | 'renderer-to-main'
  producerFiles: readonly string[]
  bridgeFiles: readonly string[]
  consumerFiles: readonly string[]
  disposerFiles: readonly string[]
  payloadBoundary: 'bounded-preload-parser' | 'bounded-main-parser' | 'no-payload'
  evidenceTerms?: readonly string[]
}

interface InvokeInventoryGroup {
  owner: string
  definitionFile: string
  definitionName: string
  definitions: Record<string, { channel: string }>
  handlerFiles: readonly string[]
  preloadFiles: readonly string[]
}

function expandInvokeGroup(group: InvokeInventoryGroup): IpcInvokeContractInventory[] {
  return Object.entries(group.definitions).map(([key, definition]) => ({
    channel: definition.channel,
    key,
    owner: group.owner,
    definitionFile: group.definitionFile,
    definitionName: group.definitionName,
    handlerFiles: group.handlerFiles,
    preloadFiles: group.preloadFiles,
    parser: 'main-runtime-contract',
    lifecycle: 'trusted-registration-scope',
  }))
}

/** P0-P4 收敛范围的现行 invoke 库存；不能用下面的 legacy allowlist 替代。 */
export const ipcInvokeContractInventory: readonly IpcInvokeContractInventory[] = [
  ...expandInvokeGroup({
    owner: 'Settings',
    definitionFile: 'src/shared/ipc/settings.ts',
    definitionName: 'settingsIpc',
    definitions: settingsIpc,
    handlerFiles: ['src/main/settings/settings-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Dialog',
    definitionFile: 'src/shared/ipc/dialog.ts',
    definitionName: 'dialogIpc',
    definitions: dialogIpc,
    handlerFiles: ['src/main/ipc/dialog-ipc.ts'],
    preloadFiles: ['src/preload/renderer-support-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Filesystem',
    definitionFile: 'src/shared/ipc/fs.ts',
    definitionName: 'fsIpc',
    definitions: fsIpc,
    handlerFiles: ['src/main/fs/fs-ipc.ts'],
    preloadFiles: ['src/preload/fs-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Agent',
    definitionFile: 'src/shared/ipc/agent.ts',
    definitionName: 'agentIpc',
    definitions: agentIpc,
    handlerFiles: ['src/main/ipc/agent-ipc.ts'],
    preloadFiles: ['src/preload/agent-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Agent MCP',
    definitionFile: 'src/shared/ipc/agent.ts',
    definitionName: 'agentMcpIpc',
    definitions: agentMcpIpc,
    handlerFiles: ['src/main/ipc/agent-ipc.ts'],
    preloadFiles: ['src/preload/agent-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Browser',
    definitionFile: 'src/shared/ipc/browser.ts',
    definitionName: 'browserIpc',
    definitions: browserIpc,
    handlerFiles: ['src/main/ipc/browser-ipc.ts'],
    preloadFiles: ['src/preload/browser-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'BrowserTask',
    definitionFile: 'src/shared/ipc/browser.ts',
    definitionName: 'browserTaskIpc',
    definitions: browserTaskIpc,
    handlerFiles: ['src/main/ipc/browser-ipc.ts'],
    preloadFiles: ['src/preload/browser-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'BrowserDownload',
    definitionFile: 'src/shared/ipc/browser.ts',
    definitionName: 'browserDownloadIpc',
    definitions: browserDownloadIpc,
    handlerFiles: ['src/main/ipc/browser-ipc.ts'],
    preloadFiles: ['src/preload/browser-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'WebResources',
    definitionFile: 'src/shared/web-resources/web-resource.ts',
    definitionName: 'webResourcesIpc',
    definitions: webResourcesIpc,
    handlerFiles: ['src/main/web-resources/web-resource-ipc.ts'],
    preloadFiles: ['src/preload/web-resources-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'WebAffairs',
    definitionFile: 'src/shared/web-affairs/web-affair.ts',
    definitionName: 'webAffairsIpc',
    definitions: webAffairsIpc,
    handlerFiles: ['src/main/web-affairs/web-affair-ipc.ts'],
    preloadFiles: ['src/preload/web-affairs-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Auth',
    definitionFile: 'src/shared/ipc/auth.ts',
    definitionName: 'authIpc',
    definitions: authIpc,
    handlerFiles: ['src/main/cclink-remote/cclink-remote-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'CCLink Remote',
    definitionFile: 'src/shared/ipc/cclink.ts',
    definitionName: 'cclinkIpc',
    definitions: cclinkIpc,
    handlerFiles: ['src/main/cclink-remote/cclink-remote-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Remote Workspace',
    definitionFile: 'src/shared/ipc/remote.ts',
    definitionName: 'remoteIpc',
    definitions: remoteIpc,
    handlerFiles: ['src/main/cclink-remote/cclink-remote-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Official Integration',
    definitionFile: 'src/shared/ipc/official.ts',
    definitionName: 'officialIpc',
    definitions: officialIpc,
    handlerFiles: ['src/main/ipc/official-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Diagnostics',
    definitionFile: 'src/shared/ipc/diagnostics.ts',
    definitionName: 'diagnosticsIpc',
    definitions: diagnosticsIpc,
    handlerFiles: ['src/main/ipc/diagnostics-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Credentials',
    definitionFile: 'src/shared/ipc/credentials.ts',
    definitionName: 'credentialsIpc',
    definitions: credentialsIpc,
    handlerFiles: ['src/main/credentials/credentials-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Identity',
    definitionFile: 'src/shared/ipc/identity.ts',
    definitionName: 'identityIpc',
    definitions: identityIpc,
    handlerFiles: ['src/main/identity/identity-ipc.ts'],
    preloadFiles: ['src/preload/renderer-support-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Window',
    definitionFile: 'src/shared/ipc/window.ts',
    definitionName: 'windowIpc',
    definitions: windowIpc,
    handlerFiles: ['src/main/ipc/window-ipc.ts'],
    preloadFiles: ['src/preload/renderer-support-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'ScheduledTasks',
    definitionFile: 'src/shared/scheduled-task/scheduled-task-contract.ts',
    definitionName: 'scheduledTasksIpc',
    definitions: scheduledTasksIpc,
    handlerFiles: ['src/main/scheduled-task/scheduled-task-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'MediaProjects',
    definitionFile: 'src/shared/media-production/media-project-contract.ts',
    definitionName: 'mediaProjectsIpc',
    definitions: mediaProjectsIpc,
    handlerFiles: ['src/main/media-production/media-project-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'MediaVideo',
    definitionFile: 'src/shared/media-production/video-generation-contract.ts',
    definitionName: 'mediaVideoIpc',
    definitions: mediaVideoIpc,
    handlerFiles: ['src/main/media-production/video-generation-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'MediaRender',
    definitionFile: 'src/shared/media-production/media-render-contract.ts',
    definitionName: 'mediaRenderIpc',
    definitions: mediaRenderIpc,
    handlerFiles: ['src/main/media-production/media-render-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'WorkbenchTabModel',
    definitionFile: 'src/shared/ipc/workbench-tab-model.ts',
    definitionName: 'workbenchTabModelIpc',
    definitions: workbenchTabModelIpc,
    handlerFiles: ['src/main/workbench/workbench-tab-model-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'WorkbenchBrowserState',
    definitionFile: 'src/shared/ipc/workbench-tab-model.ts',
    definitionName: 'workbenchBrowserStateIpc',
    definitions: workbenchBrowserStateIpc,
    handlerFiles: ['src/main/workbench/workbench-tab-model-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'WorkbenchWindow',
    definitionFile: 'src/shared/ipc/workbench-window.ts',
    definitionName: 'workbenchWindowIpc',
    definitions: workbenchWindowIpc,
    handlerFiles: ['src/main/workbench/detachable-browser-window-controller.ts'],
    preloadFiles: ['src/preload/index.ts', 'src/preload/auxiliary.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Git',
    definitionFile: 'src/shared/git/git-contract.ts',
    definitionName: 'gitIpc',
    definitions: gitIpc,
    handlerFiles: ['src/main/git/git-ipc.ts'],
    preloadFiles: ['src/preload/git-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'ArticlePublishing',
    definitionFile: 'src/shared/article-publishing/article-publishing.ts',
    definitionName: 'articlePublishingIpc',
    definitions: articlePublishingIpc,
    handlerFiles: ['src/main/article-publishing/article-publishing-ipc.ts'],
    preloadFiles: ['src/preload/article-publishing-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'RuntimeComponents',
    definitionFile: 'src/shared/ipc/runtime-components.ts',
    definitionName: 'runtimeComponentsIpc',
    definitions: runtimeComponentsIpc,
    handlerFiles: ['src/main/runtime-components/runtime-components-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Updater',
    definitionFile: 'src/shared/update/update-contract.ts',
    definitionName: 'updateIpc',
    definitions: updateIpc,
    handlerFiles: ['src/main/ipc/updater-ipc.ts'],
    preloadFiles: ['src/preload/renderer-support-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Terminal',
    definitionFile: 'src/shared/ipc/terminal.ts',
    definitionName: 'terminalIpc',
    definitions: terminalIpc,
    handlerFiles: ['src/main/ipc/terminal-ipc.ts'],
    preloadFiles: ['src/preload/index.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Android/Scrcpy',
    definitionFile: 'src/shared/ipc/android.ts',
    definitionName: 'androidIpc',
    definitions: androidIpc,
    handlerFiles: ['src/main/ipc/android-ipc.ts'],
    preloadFiles: ['src/preload/android-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'DataSource',
    definitionFile: 'src/shared/ipc/data-source.ts',
    definitionName: 'dataSourceIpc',
    definitions: dataSourceIpc,
    handlerFiles: ['src/main/data-source/data-source-ipc.ts'],
    preloadFiles: ['src/preload/data-source-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'WorkspaceState',
    definitionFile: 'src/shared/ipc/workspace-state.ts',
    definitionName: 'workspaceStateIpc',
    definitions: workspaceStateIpc,
    handlerFiles: ['src/main/workspace/workspace-state-ipc.ts'],
    preloadFiles: ['src/preload/local-ops-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'GitBackup',
    definitionFile: 'src/shared/ipc/git-backup.ts',
    definitionName: 'gitBackupIpc',
    definitions: gitBackupIpc,
    handlerFiles: ['src/main/git-backup/git-backup-ipc.ts'],
    preloadFiles: ['src/preload/local-ops-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Hardware',
    definitionFile: 'src/shared/ipc/hardware.ts',
    definitionName: 'hardwareIpc',
    definitions: hardwareIpc,
    handlerFiles: ['src/main/hardware/hardware-ipc.ts'],
    preloadFiles: ['src/preload/local-ops-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'CAD',
    definitionFile: 'src/shared/ipc/cad.ts',
    definitionName: 'cadIpc',
    definitions: cadIpc,
    handlerFiles: ['src/main/cad/cad-ipc.ts'],
    preloadFiles: ['src/preload/local-ops-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'ProjectOps',
    definitionFile: 'src/shared/ipc/project-ops.ts',
    definitionName: 'projectOpsIpc',
    definitions: projectOpsIpc,
    handlerFiles: ['src/main/project-ops/project-ops-ipc.ts'],
    preloadFiles: ['src/preload/local-ops-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'Editor',
    definitionFile: 'src/shared/ipc/editor.ts',
    definitionName: 'editorIpc',
    definitions: editorIpc,
    handlerFiles: ['src/main/ipc/editor-ipc.ts'],
    preloadFiles: ['src/preload/renderer-support-api.ts'],
  }),
  ...expandInvokeGroup({
    owner: 'WeChat',
    definitionFile: 'src/shared/ipc/wechat.ts',
    definitionName: 'wechatIpc',
    definitions: wechatIpc,
    handlerFiles: ['src/main/ipc/wechat-ipc.ts'],
    preloadFiles: ['src/preload/renderer-support-api.ts'],
  }),
]

/** 保留事件的完整生产者、桥接、真实 consumer 与 disposer 库存。 */
export const ipcEventFlowInventory: readonly IpcEventFlowInventory[] = [
  {
    channel: 'terminal:requestCommandConfirmation',
    owner: 'Terminal',
    direction: 'main-to-renderer',
    producerFiles: ['src/main/terminal/terminal-confirmation-service.ts'],
    bridgeFiles: ['src/preload/index.ts'],
    consumerFiles: ['src/renderer/src/bootstrap/use-terminal-events.ts'],
    disposerFiles: ['src/preload/index.ts', 'src/renderer/src/bootstrap/use-terminal-events.ts'],
    payloadBoundary: 'bounded-preload-parser',
  },
  {
    channel: 'terminal:executionEvent',
    owner: 'Terminal',
    direction: 'main-to-renderer',
    producerFiles: ['src/main/ipc/terminal-ipc.ts'],
    bridgeFiles: ['src/preload/index.ts'],
    consumerFiles: [
      'src/renderer/src/bootstrap/use-terminal-events.ts',
      'src/renderer/src/components/workbench/WorkbenchContent.tsx',
    ],
    disposerFiles: [
      'src/main/ipc/terminal-ipc.ts',
      'src/preload/index.ts',
      'src/renderer/src/bootstrap/use-terminal-events.ts',
      'src/renderer/src/components/workbench/WorkbenchContent.tsx',
    ],
    payloadBoundary: 'bounded-preload-parser',
  },
  {
    channel: 'android:storeInstallProgress',
    owner: 'Android',
    direction: 'main-to-renderer',
    producerFiles: ['src/main/ipc/android-ipc.ts'],
    bridgeFiles: ['src/preload/android-api.ts'],
    consumerFiles: ['src/renderer/src/bootstrap/use-main-process-events.ts'],
    disposerFiles: [
      'src/preload/android-api.ts',
      'src/renderer/src/bootstrap/use-main-process-events.ts',
    ],
    payloadBoundary: 'bounded-preload-parser',
  },
  {
    channel: 'scrcpy:touch',
    owner: 'Android/Scrcpy',
    direction: 'renderer-to-main',
    producerFiles: ['src/renderer/src/components/workbench/AndroidDisplay.tsx'],
    bridgeFiles: ['src/preload/android-api.ts'],
    consumerFiles: ['src/main/ipc/android-ipc.ts'],
    disposerFiles: ['src/main/ipc/android-ipc.ts'],
    payloadBoundary: 'bounded-main-parser',
  },
  {
    channel: 'scrcpy:videoFrame',
    owner: 'Android/Scrcpy',
    direction: 'main-to-renderer',
    producerFiles: ['src/main/android/scrcpy-bridge.ts'],
    bridgeFiles: ['src/preload/android-api.ts'],
    consumerFiles: ['src/renderer/src/components/workbench/AndroidDisplay.tsx'],
    disposerFiles: [
      'src/preload/android-api.ts',
      'src/renderer/src/components/workbench/AndroidDisplay.tsx',
    ],
    payloadBoundary: 'bounded-preload-parser',
  },
  {
    channel: 'scrcpy:error',
    owner: 'Android/Scrcpy',
    direction: 'main-to-renderer',
    producerFiles: ['src/main/android/scrcpy-bridge.ts'],
    bridgeFiles: ['src/preload/android-api.ts'],
    consumerFiles: ['src/renderer/src/components/workbench/AndroidDisplay.tsx'],
    disposerFiles: [
      'src/preload/android-api.ts',
      'src/renderer/src/components/workbench/AndroidDisplay.tsx',
    ],
    payloadBoundary: 'bounded-preload-parser',
  },
  {
    channel: 'scrcpy:disconnected',
    owner: 'Android/Scrcpy',
    direction: 'main-to-renderer',
    producerFiles: ['src/main/android/scrcpy-bridge.ts'],
    bridgeFiles: ['src/preload/android-api.ts'],
    consumerFiles: ['src/renderer/src/components/workbench/AndroidDisplay.tsx'],
    disposerFiles: [
      'src/preload/android-api.ts',
      'src/renderer/src/components/workbench/AndroidDisplay.tsx',
    ],
    payloadBoundary: 'no-payload',
  },
  {
    channel: 'editor:readRequest',
    owner: 'Editor',
    direction: 'main-to-renderer',
    producerFiles: ['src/main/mcp/modules/editor/index.ts'],
    bridgeFiles: ['src/preload/renderer-support-api.ts'],
    consumerFiles: [
      'src/renderer/src/components/workbench/MarkdownEditor.tsx',
      'src/renderer/src/components/workbench/SourceTextEditor.tsx',
    ],
    disposerFiles: [
      'src/preload/renderer-support-api.ts',
      'src/renderer/src/components/workbench/MarkdownEditor.tsx',
      'src/renderer/src/components/workbench/SourceTextEditor.tsx',
    ],
    payloadBoundary: 'bounded-preload-parser',
  },
  {
    channel: 'editor:saveRequest',
    owner: 'Editor',
    direction: 'main-to-renderer',
    producerFiles: ['src/main/mcp/modules/editor/index.ts'],
    bridgeFiles: ['src/preload/renderer-support-api.ts'],
    consumerFiles: [
      'src/renderer/src/components/workbench/MarkdownEditor.tsx',
      'src/renderer/src/components/workbench/SourceTextEditor.tsx',
    ],
    disposerFiles: [
      'src/preload/renderer-support-api.ts',
      'src/renderer/src/components/workbench/MarkdownEditor.tsx',
      'src/renderer/src/components/workbench/SourceTextEditor.tsx',
    ],
    payloadBoundary: 'bounded-preload-parser',
  },
  {
    channel: 'workspaceState:flushRequest',
    owner: 'WorkspaceState',
    direction: 'main-to-renderer',
    producerFiles: ['src/main/workspace/renderer-workspace-state-flush.ts'],
    bridgeFiles: ['src/preload/local-ops-api.ts'],
    consumerFiles: ['src/renderer/src/bootstrap/use-workspace-state-flush.ts'],
    disposerFiles: [
      'src/preload/local-ops-api.ts',
      'src/renderer/src/bootstrap/use-workspace-state-flush.ts',
    ],
    payloadBoundary: 'bounded-preload-parser',
  },
  {
    channel: 'workspaceState:flushAcknowledged',
    owner: 'WorkspaceState',
    direction: 'renderer-to-main',
    producerFiles: ['src/renderer/src/bootstrap/use-workspace-state-flush.ts'],
    bridgeFiles: ['src/preload/local-ops-api.ts'],
    consumerFiles: ['src/main/workspace/renderer-workspace-state-flush.ts'],
    disposerFiles: ['src/main/workspace/renderer-workspace-state-flush.ts'],
    payloadBoundary: 'bounded-main-parser',
    evidenceTerms: ['flushAcknowledged', 'acknowledgeFlush'],
  },
]

/** P5 closed state: production preload has no approved raw IPC channel literals. */
export const legacyIpcNamespaceInventory: readonly LegacyIpcNamespaceInventory[] = []

/** All retained pushed events now use shared declarations; no legacy event remains. */
export const legacyIpcEventFlowInventory: readonly LegacyIpcEventFlowInventory[] = []

export const legacyIpcChannels: readonly string[] = []
