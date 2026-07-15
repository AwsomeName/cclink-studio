import type { AgentApiContract } from '../shared/ipc/agent'
import type { AndroidApiContract } from '../shared/ipc/android'
import type { BrowserApiContract } from '../shared/ipc/browser'
import type { CadApiContract } from '../shared/ipc/cad'
import type { DataSourceApiContract } from '../shared/ipc/data-source'
import type { DialogApiContract } from '../shared/ipc/dialog'
import type { EditorApiContract } from '../shared/ipc/editor'
import type { FsApiContract } from '../shared/ipc/fs'
import type { HardwareApiContract } from '../shared/ipc/hardware'
import type { IdentityApiContract } from '../shared/ipc/identity'
import type { MeshyApiContract } from '../shared/ipc/meshy'
import type { ProjectOpsApiContract } from '../shared/ipc/project-ops'
import type { SettingsApiContract } from '../shared/ipc/settings'
import type { TerminalApiContract } from '../shared/ipc/terminal'
import type { UpdateApiContract } from '../shared/ipc/update'
import type { WechatApiContract } from '../shared/ipc/wechat'
import type { WindowApiContract } from '../shared/ipc/window'
import type { WorkspaceStateApiContract } from '../shared/ipc/workspace-state'

export interface DeepinkAPI {
  reportWorkbenchBounds: (bounds: { x: number; y: number; width: number; height: number }) => void

  window: WindowApiContract

  browser: BrowserApiContract

  cad: CadApiContract

  dataSource: DataSourceApiContract

  identity: IdentityApiContract

  agent: AgentApiContract

  android: AndroidApiContract

  fs: FsApiContract

  projectOps: ProjectOpsApiContract

  hardware: HardwareApiContract

  dialog: DialogApiContract

  editor: EditorApiContract

  terminal: TerminalApiContract

  settings: SettingsApiContract

  workspaceState: WorkspaceStateApiContract

  meshy: MeshyApiContract

  wechat: WechatApiContract

  update: UpdateApiContract
}

declare global {
  interface Window {
    deepink: DeepinkAPI
  }
}
