import { ipcRenderer } from 'electron'
import { cadIpc, type CadApiContract } from '../shared/ipc/cad'
import { gitBackupIpc, type GitBackupApiContract } from '../shared/ipc/git-backup'
import { hardwareIpc, type HardwareApiContract } from '../shared/ipc/hardware'
import { projectOpsIpc, type ProjectOpsApiContract } from '../shared/ipc/project-ops'
import {
  parseWorkspaceStateFlushRequest,
  workspaceStateIpc,
  workspaceStateIpcEvents,
  type WorkspaceStateApiContract,
} from '../shared/ipc/workspace-state'
import { invokeIpcContract } from './ipc-contract-client'

export const projectOpsApi: ProjectOpsApiContract = {
  getAccounts: (workspacePath) => invokeIpcContract(projectOpsIpc.getAccounts, workspacePath),
  createAccountsTemplate: (workspacePath) =>
    invokeIpcContract(projectOpsIpc.createAccountsTemplate, workspacePath),
  createCopyDraft: (workspacePath, input) =>
    invokeIpcContract(projectOpsIpc.createCopyDraft, workspacePath, input),
  appendPublicationRecord: (workspacePath, input) =>
    invokeIpcContract(projectOpsIpc.appendPublicationRecord, workspacePath, input),
}

export const gitBackupApi: GitBackupApiContract = {
  getAccountStatus: () => invokeIpcContract(gitBackupIpc.getAccountStatus),
  saveAccount: (input) => invokeIpcContract(gitBackupIpc.saveAccount, input),
  clearAccount: () => invokeIpcContract(gitBackupIpc.clearAccount),
  testAccount: (input) => invokeIpcContract(gitBackupIpc.testAccount, input),
  getProjectStatus: (workspacePath) =>
    invokeIpcContract(gitBackupIpc.getProjectStatus, workspacePath),
  backup: (input) => invokeIpcContract(gitBackupIpc.backup, input),
}

export const hardwareApi: HardwareApiContract = {
  scanWorkspace: (workspacePath) => invokeIpcContract(hardwareIpc.scanWorkspace, workspacePath),
  inspectProductionPackage: (workspacePath) =>
    invokeIpcContract(hardwareIpc.inspectProductionPackage, workspacePath),
  prepareFpcShapeContext: (workspacePath) =>
    invokeIpcContract(hardwareIpc.prepareFpcShapeContext, workspacePath),
  readGerberLayerPreview: (workspacePath, packagePath, entry) =>
    invokeIpcContract(hardwareIpc.readGerberLayerPreview, workspacePath, packagePath, entry),
  readGerberLayerGeometry: (workspacePath, packagePath, entry) =>
    invokeIpcContract(hardwareIpc.readGerberLayerGeometry, workspacePath, packagePath, entry),
  writeProductionReportMarkdown: (workspacePath) =>
    invokeIpcContract(hardwareIpc.writeProductionReportMarkdown, workspacePath),
}

export const cadApi: CadApiContract = {
  getBackendStatus: () => invokeIpcContract(cadIpc.getBackendStatus),
  getModelSupport: (inputPath) => invokeIpcContract(cadIpc.getModelSupport, inputPath),
  inspectModel: (inputPath) => invokeIpcContract(cadIpc.inspectModel, inputPath),
  getCacheStatus: () => invokeIpcContract(cadIpc.getCacheStatus),
  clearCache: () => invokeIpcContract(cadIpc.clearCache),
  convertModel: (request) => invokeIpcContract(cadIpc.convertModel, request),
}

export const workspaceStateApi: WorkspaceStateApiContract = {
  resolveLocalWorkspace: (workspacePath) =>
    invokeIpcContract(workspaceStateIpc.resolveLocalWorkspace, workspacePath),
  setActiveLocalWorkspace: (workspacePath) =>
    invokeIpcContract(workspaceStateIpc.setActiveLocalWorkspace, workspacePath),
  get: (workspacePath, ownerKey) =>
    invokeIpcContract(workspaceStateIpc.get, workspacePath, ownerKey),
  setSection: (workspacePath, section, value, ownerKey, options) =>
    invokeIpcContract(
      workspaceStateIpc.setSection,
      workspacePath,
      section,
      value,
      ownerKey,
      options,
    ),
  clear: (workspacePath, ownerKey) =>
    invokeIpcContract(workspaceStateIpc.clear, workspacePath, ownerKey),
  listLocalWorkspaces: (ownerKey) =>
    invokeIpcContract(workspaceStateIpc.listLocalWorkspaces, ownerKey),
  diagnostics: () => invokeIpcContract(workspaceStateIpc.diagnostics),
  onFlushRequest: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const requestId = parseWorkspaceStateFlushRequest(value)
      if (requestId) callback(requestId)
    }
    ipcRenderer.on(workspaceStateIpcEvents.flushRequest, listener)
    return () => ipcRenderer.removeListener(workspaceStateIpcEvents.flushRequest, listener)
  },
  acknowledgeFlush: (acknowledgement) =>
    ipcRenderer.send(workspaceStateIpcEvents.flushAcknowledged, acknowledgement),
}
