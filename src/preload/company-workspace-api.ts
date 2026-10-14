import { ipcRenderer } from 'electron'
import {
  companyWorkspaceIpc,
  companyWorkspaceIpcEvents,
  type CompanyWorkspaceApiContract,
} from '../shared/company-workspace/company-workspace'
import { companyWorkspaceChangedSchema } from '../shared/company-workspace/company-workspace-schema'
import { invokeIpcContract } from './ipc-contract-client'
export const companyWorkspaceApi: CompanyWorkspaceApiContract = {
  getSnapshot: (input) => invokeIpcContract(companyWorkspaceIpc.getSnapshot, input),
  configure: (input) => invokeIpcContract(companyWorkspaceIpc.configure, input),
  createBusiness: (input) => invokeIpcContract(companyWorkspaceIpc.createBusiness, input),
  updateBusiness: (input) => invokeIpcContract(companyWorkspaceIpc.updateBusiness, input),
  linkResource: (input) => invokeIpcContract(companyWorkspaceIpc.linkResource, input),
  unlinkResource: (input) => invokeIpcContract(companyWorkspaceIpc.unlinkResource, input),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const parsed = companyWorkspaceChangedSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on(companyWorkspaceIpcEvents.changed, listener)
    return () => ipcRenderer.removeListener(companyWorkspaceIpcEvents.changed, listener)
  },
}
