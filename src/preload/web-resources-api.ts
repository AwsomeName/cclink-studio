import { ipcRenderer } from 'electron'
import {
  webResourcesIpc,
  webResourcesIpcEvents,
  type AgentWebResourceLaunchRequest,
  type WebResourcesApiContract,
} from '../shared/web-resources/web-resource'
import {
  parseAgentWebResourceLaunchAcknowledgement,
  parseAgentWebResourceLaunchRequest,
} from '../shared/web-resources/web-resource-schema'
import { invokeIpcContract } from './ipc-contract-client'

export const webResourcesApi: WebResourcesApiContract = {
  onAgentLaunchRequest: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      callback(parseAgentWebResourceLaunchRequest(value) as AgentWebResourceLaunchRequest)
    }
    ipcRenderer.on(webResourcesIpcEvents.agentLaunchRequested, listener)
    return () => ipcRenderer.removeListener(webResourcesIpcEvents.agentLaunchRequested, listener)
  },
  acknowledgeAgentLaunch: (acknowledgement) => {
    ipcRenderer.send(
      webResourcesIpcEvents.agentLaunchAcknowledged,
      parseAgentWebResourceLaunchAcknowledgement(acknowledgement),
    )
  },
  getSnapshot: (input) => invokeIpcContract(webResourcesIpc.getSnapshot, input),
  createConnection: (input) => invokeIpcContract(webResourcesIpc.createConnection, input),
  beginDraft: (input) => invokeIpcContract(webResourcesIpc.beginDraft, input),
  saveDraft: (input) => invokeIpcContract(webResourcesIpc.saveDraft, input),
  cancelDraft: (input) => invokeIpcContract(webResourcesIpc.cancelDraft, input),
  resolveLaunch: (input) => invokeIpcContract(webResourcesIpc.resolveLaunch, input),
  confirmLogin: (input) => invokeIpcContract(webResourcesIpc.confirmLogin, input),
  updateAccount: (input) => invokeIpcContract(webResourcesIpc.updateAccount, input),
  claimLegacyConnections: (input) =>
    invokeIpcContract(webResourcesIpc.claimLegacyConnections, input),
  importProjectOpsConfig: (input) =>
    invokeIpcContract(webResourcesIpc.importProjectOpsConfig, input),
  createAccountGroup: (input) => invokeIpcContract(webResourcesIpc.createAccountGroup, input),
  updateAccountGroup: (input) => invokeIpcContract(webResourcesIpc.updateAccountGroup, input),
  archiveAccountGroup: (input) => invokeIpcContract(webResourcesIpc.archiveAccountGroup, input),
  archiveAccount: (input) => invokeIpcContract(webResourcesIpc.archiveAccount, input),
  mergeAccounts: (input) => invokeIpcContract(webResourcesIpc.mergeAccounts, input),
}
