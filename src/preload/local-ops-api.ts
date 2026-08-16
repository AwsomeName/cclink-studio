import { ipcRenderer } from 'electron'
import type { CadApiContract } from '../shared/ipc/cad'
import type { GitBackupApiContract } from '../shared/ipc/git-backup'
import type { HardwareApiContract } from '../shared/ipc/hardware'
import type { ProjectOpsApiContract } from '../shared/ipc/project-ops'
import {
  workspaceStateIpcEvents,
  type WorkspaceStateApiContract,
} from '../shared/ipc/workspace-state'

export const projectOpsApi: ProjectOpsApiContract = {
  getAccounts: (workspacePath) => ipcRenderer.invoke('projectOps:getAccounts', workspacePath),
  createAccountsTemplate: (workspacePath) =>
    ipcRenderer.invoke('projectOps:createAccountsTemplate', workspacePath),
  createCopyDraft: (workspacePath, input) =>
    ipcRenderer.invoke('projectOps:createCopyDraft', workspacePath, input),
  appendPublicationRecord: (workspacePath, input) =>
    ipcRenderer.invoke('projectOps:appendPublicationRecord', workspacePath, input),
}

export const gitBackupApi: GitBackupApiContract = {
  getAccountStatus: () => ipcRenderer.invoke('gitBackup:getAccountStatus'),
  saveAccount: (input) => ipcRenderer.invoke('gitBackup:saveAccount', input),
  clearAccount: () => ipcRenderer.invoke('gitBackup:clearAccount'),
  testAccount: (input) => ipcRenderer.invoke('gitBackup:testAccount', input),
  getProjectStatus: (workspacePath) =>
    ipcRenderer.invoke('gitBackup:getProjectStatus', workspacePath),
  backup: (input) => ipcRenderer.invoke('gitBackup:backup', input),
}

export const hardwareApi: HardwareApiContract = {
  scanWorkspace: (workspacePath) => ipcRenderer.invoke('hardware:scanWorkspace', workspacePath),
  inspectProductionPackage: (workspacePath) =>
    ipcRenderer.invoke('hardware:inspectProductionPackage', workspacePath),
  prepareFpcShapeContext: (workspacePath) =>
    ipcRenderer.invoke('hardware:prepareFpcShapeContext', workspacePath),
  readGerberLayerPreview: (workspacePath, packagePath, entry) =>
    ipcRenderer.invoke('hardware:readGerberLayerPreview', workspacePath, packagePath, entry),
  readGerberLayerGeometry: (workspacePath, packagePath, entry) =>
    ipcRenderer.invoke('hardware:readGerberLayerGeometry', workspacePath, packagePath, entry),
  writeProductionReportMarkdown: (workspacePath) =>
    ipcRenderer.invoke('hardware:writeProductionReportMarkdown', workspacePath),
}

export const cadApi: CadApiContract = {
  getBackendStatus: () => ipcRenderer.invoke('cad:getBackendStatus'),
  getModelSupport: (inputPath) => ipcRenderer.invoke('cad:getModelSupport', inputPath),
  inspectModel: (inputPath) => ipcRenderer.invoke('cad:inspectModel', inputPath),
  getCacheStatus: () => ipcRenderer.invoke('cad:getCacheStatus'),
  clearCache: () => ipcRenderer.invoke('cad:clearCache'),
  convertModel: (request) => ipcRenderer.invoke('cad:convertModel', request),
}

export const workspaceStateApi: WorkspaceStateApiContract = {
  resolveLocalWorkspace: (workspacePath) =>
    ipcRenderer.invoke('workspaceState:resolveLocalWorkspace', workspacePath),
  setActiveLocalWorkspace: (workspacePath) =>
    ipcRenderer.invoke('workspaceState:setActiveLocalWorkspace', workspacePath),
  get: (workspacePath, ownerKey) =>
    ipcRenderer.invoke('workspaceState:get', workspacePath, ownerKey),
  setSection: (workspacePath, section, value, ownerKey, options) =>
    options
      ? ipcRenderer.invoke(
          'workspaceState:setSection',
          workspacePath,
          section,
          value,
          ownerKey,
          options,
        )
      : ipcRenderer.invoke('workspaceState:setSection', workspacePath, section, value, ownerKey),
  clear: (workspacePath, ownerKey) =>
    ipcRenderer.invoke('workspaceState:clear', workspacePath, ownerKey),
  listLocalWorkspaces: (ownerKey) =>
    ipcRenderer.invoke('workspaceState:listLocalWorkspaces', ownerKey),
  diagnostics: () => ipcRenderer.invoke('workspaceState:diagnostics'),
  onFlushRequest: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string): void =>
      callback(requestId)
    ipcRenderer.on(workspaceStateIpcEvents.flushRequest, listener)
    return () => ipcRenderer.removeListener(workspaceStateIpcEvents.flushRequest, listener)
  },
  acknowledgeFlush: (acknowledgement) =>
    ipcRenderer.send(workspaceStateIpcEvents.flushAcknowledged, acknowledgement),
}
