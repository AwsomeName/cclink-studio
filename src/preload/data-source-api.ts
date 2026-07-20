import { ipcRenderer } from 'electron'
import type { DataSourceApiContract } from '../shared/ipc/data-source'

export const dataSourceApi: DataSourceApiContract = {
  listSources: () => ipcRenderer.invoke('data-source:list'),
  createSource: (input) => ipcRenderer.invoke('data-source:create', input),
  testConnection: (id) => ipcRenderer.invoke('data-source:test', id),
  listCollections: (id) => ipcRenderer.invoke('data-source:list-collections', id),
  runQuery: (input) => ipcRenderer.invoke('data-source:query', input),
  listSavedQueries: (sourceId) => ipcRenderer.invoke('data-source:list-saved-queries', sourceId),
  saveQuery: (input) => ipcRenderer.invoke('data-source:save-query', input),
}
