import type { CompanyWorkspaceApiContract } from '../shared/company-workspace/company-workspace-contract'
import type { AgentApiContract } from '../shared/ipc/agent'
import type { AndroidApiContract } from '../shared/ipc/android'
import type { BrowserApiContract, BrowserWorkbenchBounds } from '../shared/ipc/browser'
import type { CadApiContract } from '../shared/ipc/cad'
import type { DataSourceApiContract } from '../shared/ipc/data-source'
import type { CompanyAccountsApiContract } from '../shared/ipc/company-accounts'
import type { WebSearchApiContract } from '../shared/ipc/web-search'
import type { TechDailyApiContract } from '../shared/ipc/techdaily'
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
import type { ArticlePublishingApiContract } from '../shared/article-publishing/article-publishing-types'
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
  remoteDesktop: import('../shared/ipc/remote-desktop').DesktopApi
  localTts: import('../shared/local-tts').LocalTtsApi
  reportWorkbenchBounds: (bounds: BrowserWorkbenchBounds) => void

  window: WindowApiContract

  auth: AuthApiContract

  cclink: CclinkApiContract

  remote: RemoteApiContract

  browser: BrowserApiContract

  cad: CadApiContract

  dataSource: DataSourceApiContract

  companyAccounts: CompanyAccountsApiContract
  webSearch: WebSearchApiContract
  techDaily: TechDailyApiContract
  companyWorkspace: CompanyWorkspaceApiContract

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

  articlePublishing: ArticlePublishingApiContract

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
  ownerDirectories: {
    list: () => Promise<{ items: import('../shared/owner/affair').Affair[]; errors: string[] }>
    save: (
      a: import('../shared/owner/affair').Affair,
      revision: number,
    ) => Promise<import('../shared/owner/affair').Affair>
    confirm: (id: string, revision: number) => Promise<import('../shared/owner/affair').Affair>
    upgrade: (id: string, revision: number) => Promise<import('../shared/owner/affair').Affair>
    retry: (id: string) => Promise<import('../shared/owner/affair').Affair>
    reveal: (id: string) => Promise<void>
    preview: (id: string, name: string) => Promise<string>
  }
  ownerPreferences: {
    get: () => Promise<import('../shared/ipc/owner-preferences').OwnerPreferencesView>
    register: (
      purpose: 'reference' | 'output',
    ) => Promise<import('../shared/ipc/owner-preferences').OwnerPreferencesView | null>
    remove: (id: string) => Promise<import('../shared/ipc/owner-preferences').OwnerPreferencesView>
    setDefaultParent: (
      id: string | null,
    ) => Promise<import('../shared/ipc/owner-preferences').OwnerPreferencesView>
    update: (
      change: import('../shared/ipc/owner-preferences').OwnerPreferenceUpdate,
    ) => Promise<import('../shared/ipc/owner-preferences').OwnerPreferencesView>
  }
  ownerSources: {
    list: (id: string) => Promise<import('../shared/ipc/owner-source').OwnerSourceGrant[]>
    prepare: (
      id: string,
      rootId: string | null,
    ) => Promise<import('../shared/ipc/owner-source').OwnerSourceCandidate | null>
    confirm: (
      id: string,
      token: string,
    ) => Promise<import('../shared/ipc/owner-source').OwnerSourceGrant[]>
    revoke: (
      id: string,
      grantId: string,
    ) => Promise<import('../shared/ipc/owner-source').OwnerSourceGrant[]>
    entries: (
      id: string,
      grantId: string,
      rel: string,
    ) => Promise<import('../shared/ipc/owner-source').OwnerSourceEntry[]>
    read: (
      id: string,
      grantId: string,
      rel: string,
    ) => Promise<import('../shared/ipc/owner-source').OwnerSourceFile>
    find: (
      id: string,
      grantId: string,
      terms: string[],
    ) => Promise<import('../shared/ipc/owner-source').OwnerSourcePaths>
    excerpt: (
      id: string,
      grantId: string,
      rel: string,
      anchor: string,
    ) => Promise<import('../shared/ipc/owner-research').ReadmeResult>
    requestFile: (
      id: string,
      conversationId: string,
      path: string,
    ) => Promise<import('../shared/ipc/owner-source').OwnerFileRequestResult>
    grantFile: (
      id: string,
      path: string,
    ) => Promise<import('../shared/ipc/owner-source').OwnerFileGrantResult>
    fileExcerpt: (
      id: string,
      grantId: string,
      anchor: string,
    ) => Promise<import('../shared/ipc/owner-research').ReadmeResult>
  }
  ownerResearch: {
    selectAgent: (
      type?: import('../shared/ipc/owner-preferences').OwnerWorkType,
    ) => Promise<import('../shared/ipc/owner-research').OwnerAgentChoice>
    findPaths: (
      repo: string,
      terms: string[],
      ref: string,
    ) => Promise<{ ok: true; paths: string[]; truncated: boolean } | { ok: false; error: string }>
    readFile: (
      repo: string,
      path: string,
      anchor: string,
      ref: string,
    ) => Promise<import('../shared/ipc/owner-research').ReadmeResult>
    readReadme: (repo: string) => Promise<import('../shared/ipc/owner-research').ReadmeResult>
  }
  modelUsage: ModelUsageApiContract

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
import type { ModelUsageApiContract } from '../shared/ipc/model-usage'
