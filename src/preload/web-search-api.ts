import { webSearchIpc, type WebSearchApiContract } from '../shared/ipc/web-search'
import { invokeIpcContract } from './ipc-contract-client'

export const webSearchApi: WebSearchApiContract = {
  getStatus: () => invokeIpcContract(webSearchIpc.getStatus),
  saveSettings: (input) => invokeIpcContract(webSearchIpc.saveSettings, input),
  verify: (input) => invokeIpcContract(webSearchIpc.verify, input),
  getUsage: (month) => invokeIpcContract(webSearchIpc.getUsage, month),
}
