import { webResourcesIpc, type WebResourcesApiContract } from '../shared/web-resources/web-resource'
import { invokeIpcContract } from './ipc-contract-client'

export const webResourcesApi: WebResourcesApiContract = {
  getSnapshot: (input) => invokeIpcContract(webResourcesIpc.getSnapshot, input),
  createConnection: (input) => invokeIpcContract(webResourcesIpc.createConnection, input),
  confirmLogin: (input) => invokeIpcContract(webResourcesIpc.confirmLogin, input),
  claimLegacyConnections: (input) =>
    invokeIpcContract(webResourcesIpc.claimLegacyConnections, input),
  importProjectOpsConfig: (input) =>
    invokeIpcContract(webResourcesIpc.importProjectOpsConfig, input),
}
