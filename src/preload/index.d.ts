import type { AgentApiContract } from '../shared/ipc/agent'
import type { AndroidApiContract } from '../shared/ipc/android'
import type { BrowserApiContract, BrowserWorkbenchBounds } from '../shared/ipc/browser'
import type { CadApiContract } from '../shared/ipc/cad'
import type { DataSourceApiContract } from '../shared/ipc/data-source'
import type { DiagnosticsApiContract } from '../shared/ipc/diagnostics'
import type { CredentialsApiContract } from '../shared/ipc/credentials'
import type { DialogApiContract } from '../shared/ipc/dialog'
import type { EditorApiContract } from '../shared/ipc/editor'
import type { FsApiContract } from '../shared/ipc/fs'
import type { GitBackupApiContract } from '../shared/ipc/git-backup'
import type { GitApiContract } from '../shared/git'
import type { HardwareApiContract } from '../shared/ipc/hardware'
import type { IdentityApiContract } from '../shared/ipc/identity'
import type { OfficialApiContract } from '../shared/ipc/official'
import type { ProjectOpsApiContract } from '../shared/ipc/project-ops'
import type { SettingsApiContract } from '../shared/ipc/settings'
import type { TerminalApiContract } from '../shared/ipc/terminal'
import type { UpdateApiContract } from '../shared/ipc/update'
import type { WechatApiContract } from '../shared/ipc/wechat'
import type { WindowApiContract } from '../shared/ipc/window'
import type { WorkspaceStateApiContract } from '../shared/ipc/workspace-state'
import type { ScheduledTasksApiContract } from '../shared/scheduled-task/scheduled-task-types'
import type { WebResourcesApiContract } from '../shared/web-resources/web-resource'
import type { WebAffairsApiContract } from '../shared/web-affairs/web-affair'
import type { RuntimeComponentsApiContract } from '../shared/ipc/runtime-components'
import type { AuthApiContract } from '../shared/ipc/auth'
import type { CclinkApiContract } from '../shared/ipc/cclink'
import type { RemoteApiContract } from '../shared/ipc/remote'
import type { MediaProjectsApiContract } from '../shared/media-production/media-project-types'
import type { MediaVideoApiContract } from '../shared/media-production/video-generation-types'
import type { MediaRenderApiContract } from '../shared/media-production/media-render-types'
import type { WorkbenchTabStateApiContract } from '../shared/ipc/workbench-tab-model'
import type {
  WorkbenchMainWindowApiContract,
  WorkbenchWindowApiContract,
} from '../shared/ipc/workbench-window'

export interface CCLinkStudioAPI {
  reportWorkbenchBounds: (bounds: BrowserWorkbenchBounds) => void

  window: WindowApiContract

  auth: AuthApiContract

  cclink: CclinkApiContract

  remote: RemoteApiContract

  browser: BrowserApiContract

  cad: CadApiContract

  dataSource: DataSourceApiContract

  diagnostics: DiagnosticsApiContract

  credentials: CredentialsApiContract

  identity: IdentityApiContract

  official: OfficialApiContract

  agent: AgentApiContract

  android: AndroidApiContract

  fs: FsApiContract

  git: GitApiContract

  gitBackup: GitBackupApiContract

  projectOps: ProjectOpsApiContract

  webResources: WebResourcesApiContract

  webAffairs: WebAffairsApiContract

  hardware: HardwareApiContract

  dialog: DialogApiContract

  editor: EditorApiContract

  terminal: TerminalApiContract

  settings: SettingsApiContract

  runtimeComponents: RuntimeComponentsApiContract

  workspaceState: WorkspaceStateApiContract

  workbenchTabs: WorkbenchTabStateApiContract

  workbenchWindow: WorkbenchMainWindowApiContract

  scheduledTasks: ScheduledTasksApiContract

  mediaProjects: MediaProjectsApiContract

  mediaVideo: MediaVideoApiContract

  mediaRender: MediaRenderApiContract

  wechat: WechatApiContract

  update: UpdateApiContract
}

declare global {
  interface Window {
    cclinkStudio: CCLinkStudioAPI
    cclinkAuxiliary?: WorkbenchWindowApiContract
  }
}
