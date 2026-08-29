import { dataSourceIpc, type DataSourceApiContract } from '../shared/ipc/data-source'
import { invokeIpcContract } from './ipc-contract-client'

export const dataSourceApi: DataSourceApiContract = {
  listSources: () => invokeIpcContract(dataSourceIpc.listSources),
  createSource: (input) => invokeIpcContract(dataSourceIpc.createSource, input),
  testConnection: (id) => invokeIpcContract(dataSourceIpc.testConnection, id),
  listCollections: (id) => invokeIpcContract(dataSourceIpc.listCollections, id),
  runQuery: (input) => invokeIpcContract(dataSourceIpc.runQuery, input),
  listSavedQueries: (sourceId) => invokeIpcContract(dataSourceIpc.listSavedQueries, sourceId),
  saveQuery: (input) => invokeIpcContract(dataSourceIpc.saveQuery, input),
}
