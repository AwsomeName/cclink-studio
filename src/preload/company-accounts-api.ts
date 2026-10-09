import { companyAccountsIpc, type CompanyAccountsApiContract } from '../shared/ipc/company-accounts'
import { invokeIpcContract } from './ipc-contract-client'

export const companyAccountsApi: CompanyAccountsApiContract = {
  getSnapshot: (month) => invokeIpcContract(companyAccountsIpc.getSnapshot, month),
  initialize: (month) => invokeIpcContract(companyAccountsIpc.initialize, month),
  importFiles: (input) => invokeIpcContract(companyAccountsIpc.importFiles, input),
  updateRecord: (input) => invokeIpcContract(companyAccountsIpc.updateRecord, input),
  confirmRecord: (input) => invokeIpcContract(companyAccountsIpc.confirmRecord, input),
  proposeRecord: (recordId) => invokeIpcContract(companyAccountsIpc.proposeRecord, recordId),
  createProject: (name) => invokeIpcContract(companyAccountsIpc.createProject, name),
  updateSettings: (input) => invokeIpcContract(companyAccountsIpc.updateSettings, input),
  exportMonth: (input) => invokeIpcContract(companyAccountsIpc.exportMonth, input),
  createBackup: (input) => invokeIpcContract(companyAccountsIpc.createBackup, input),
  restoreBackup: (input) => invokeIpcContract(companyAccountsIpc.restoreBackup, input),
}
