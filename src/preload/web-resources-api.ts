import { webResourcesIpc, type WebResourcesApiContract } from '../shared/web-resources/web-resource'
import { invokeIpcContract } from './ipc-contract-client'

export const webResourcesApi: WebResourcesApiContract = {
  getSnapshot: (input) => invokeIpcContract(webResourcesIpc.getSnapshot, input),
  createConnection: (input) => invokeIpcContract(webResourcesIpc.createConnection, input),
  beginDraft: (input) => invokeIpcContract(webResourcesIpc.beginDraft, input),
  saveDraft: (input) => invokeIpcContract(webResourcesIpc.saveDraft, input),
  cancelDraft: (input) => invokeIpcContract(webResourcesIpc.cancelDraft, input),
  resolveLaunch: (input) => invokeIpcContract(webResourcesIpc.resolveLaunch, input),
  confirmLogin: (input) => invokeIpcContract(webResourcesIpc.confirmLogin, input),
  claimLegacyConnections: (input) =>
    invokeIpcContract(webResourcesIpc.claimLegacyConnections, input),
  importProjectOpsConfig: (input) =>
    invokeIpcContract(webResourcesIpc.importProjectOpsConfig, input),
}
