import { webResourcesIpc, type WebResourcesApiContract } from '../shared/web-resources/web-resource'
import { invokeIpcContract } from './ipc-contract-client'

export const webResourcesApi: WebResourcesApiContract = {
  getSnapshot: () => invokeIpcContract(webResourcesIpc.getSnapshot),
  createConnection: (input) => invokeIpcContract(webResourcesIpc.createConnection, input),
}
