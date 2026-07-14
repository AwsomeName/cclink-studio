import type { AgentApiContract } from '../shared/ipc/agent'
import type { AndroidApiContract } from '../shared/ipc/android'
import type { AuthApiContract } from '../shared/ipc/auth'
import type { BrowserApiContract } from '../shared/ipc/browser'
import type { CclinkApiContract } from '../shared/ipc/cclink'
import type { DialogApiContract } from '../shared/ipc/dialog'
import type { EditorApiContract } from '../shared/ipc/editor'
import type { FsApiContract } from '../shared/ipc/fs'
import type { IdentityApiContract } from '../shared/ipc/identity'
import type { MeshyApiContract } from '../shared/ipc/meshy'
import type { ProjectOpsApiContract } from '../shared/ipc/project-ops'
import type { SettingsApiContract } from '../shared/ipc/settings'
import type { SubscriptionApiContract } from '../shared/ipc/subscription'
import type { SyncApiContract } from '../shared/ipc/sync'
import type { TerminalApiContract } from '../shared/ipc/terminal'
import type { UpdateApiContract } from '../shared/ipc/update'
import type { WechatApiContract } from '../shared/ipc/wechat'
import type { WindowApiContract } from '../shared/ipc/window'
import type { WorkspaceStateApiContract } from '../shared/ipc/workspace-state'

export interface DeepinkAPI {
  reportWorkbenchBounds: (bounds: {
    x: number
    y: number
    width: number
    height: number
  }) => void

  window: WindowApiContract

  browser: BrowserApiContract

  auth: AuthApiContract

  identity: IdentityApiContract

  agent: AgentApiContract

  cclink: CclinkApiContract

  android: AndroidApiContract

  fs: FsApiContract

  projectOps: ProjectOpsApiContract

  dialog: DialogApiContract

  editor: EditorApiContract

  sync: SyncApiContract

  terminal: TerminalApiContract

  settings: SettingsApiContract

  workspaceState: WorkspaceStateApiContract

  meshy: MeshyApiContract

  subscription: SubscriptionApiContract

  wechat: WechatApiContract

  update: UpdateApiContract
}

declare global {
  interface Window {
    deepink: DeepinkAPI
  }
}
