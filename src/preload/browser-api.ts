import { ipcRenderer } from 'electron'
import {
  browserDownloadIpc,
  browserIpc,
  browserIpcEvents,
  browserTaskIpc,
  type BrowserApiContract,
  type BrowserBounds,
} from '../shared/ipc/browser'
import { invokeIpcContract } from './ipc-contract-client'

export const reportWorkbenchBounds = (bounds: BrowserBounds): void =>
  ipcRenderer.send(browserIpcEvents.workbenchBounds, bounds)

export const browserApi: BrowserApiContract = {
  createView: (tabId, initialUrl, opts) =>
    invokeIpcContract(browserIpc.createView, tabId, initialUrl, opts),
  destroyView: (tabId) => invokeIpcContract(browserIpc.destroyView, tabId),
  setActive: (tabId) => invokeIpcContract(browserIpc.setActive, tabId),
  reconcileViews: (options) => invokeIpcContract(browserIpc.reconcileViews, options),
  navigate: (tabId, url) => invokeIpcContract(browserIpc.navigate, tabId, url),
  goBack: (tabId) => invokeIpcContract(browserIpc.goBack, tabId),
  goForward: (tabId) => invokeIpcContract(browserIpc.goForward, tabId),
  reload: (tabId) => invokeIpcContract(browserIpc.reload, tabId),
  capturePage: (tabId) => invokeIpcContract(browserIpc.capturePage, tabId),
  getCurrentURL: (tabId) => invokeIpcContract(browserIpc.getCurrentURL, tabId),
  getActiveViewId: (workspaceKey) => invokeIpcContract(browserIpc.getActiveViewId, workspaceKey),
  getDiagnostics: (tabId) => invokeIpcContract(browserIpc.getDiagnostics, tabId),
  getRuntimeDiagnostics: (tabId) => invokeIpcContract(browserIpc.getRuntimeDiagnostics, tabId),
  getSessionDiagnostics: (request) => invokeIpcContract(browserIpc.getSessionDiagnostics, request),
  onUrlChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on(browserIpcEvents.urlChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.urlChanged, handler)
  },
  onPageMetaChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on(browserIpcEvents.pageMetaChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.pageMetaChanged, handler)
  },
  onRequestOpenTab: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on(browserIpcEvents.requestOpenTab, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.requestOpenTab, handler)
  },
  zoomIn: (tabId) => invokeIpcContract(browserIpc.zoomIn, tabId),
  zoomOut: (tabId) => invokeIpcContract(browserIpc.zoomOut, tabId),
  resetZoom: (tabId) => invokeIpcContract(browserIpc.resetZoom, tabId),
  setZoom: (tabId, factor) => invokeIpcContract(browserIpc.setZoom, tabId, factor),
  fitWidth: (tabId) => invokeIpcContract(browserIpc.fitWidth, tabId),
  setDeviceMode: (tabId, mode) => invokeIpcContract(browserIpc.setDeviceMode, tabId, mode),
  getViewState: () => invokeIpcContract(browserIpc.getViewState),
  listSnapshots: () => invokeIpcContract(browserIpc.listSnapshots),
  removeSnapshot: (id) => invokeIpcContract(browserIpc.removeSnapshot, id),
  clearSnapshots: () => invokeIpcContract(browserIpc.clearSnapshots),
  listHistory: (limit) => invokeIpcContract(browserIpc.listHistory, limit),
  clearHistory: () => invokeIpcContract(browserIpc.clearHistory),
  startTask: (tabId, goal) => invokeIpcContract(browserTaskIpc.start, tabId, goal),
  listTasks: () => invokeIpcContract(browserTaskIpc.list),
  getTask: (taskRunId) => invokeIpcContract(browserTaskIpc.get, taskRunId),
  getActiveTaskForTab: (tabId) => invokeIpcContract(browserTaskIpc.getActiveForTab, tabId),
  pauseTask: (taskRunId) => invokeIpcContract(browserTaskIpc.pause, taskRunId),
  resumeTask: (taskRunId) => invokeIpcContract(browserTaskIpc.resume, taskRunId),
  cancelTask: (taskRunId) => invokeIpcContract(browserTaskIpc.cancel, taskRunId),
  finishTask: (taskRunId) => invokeIpcContract(browserTaskIpc.finish, taskRunId),
  listActionLogs: (taskRunId) => invokeIpcContract(browserTaskIpc.listActionLogs, taskRunId),
  onTaskChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on(browserIpcEvents.taskChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.taskChanged, handler)
  },
  onActionLogChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on(browserIpcEvents.actionLogChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.actionLogChanged, handler)
  },
  listDownloads: () => invokeIpcContract(browserDownloadIpc.list),
  getDownload: (downloadId) => invokeIpcContract(browserDownloadIpc.get, downloadId),
  keepDownloadToWorkspace: (downloadId) =>
    invokeIpcContract(browserDownloadIpc.keepToWorkspace, downloadId),
  saveDownloadAs: (downloadId) => invokeIpcContract(browserDownloadIpc.saveAs, downloadId),
  discardDownload: (downloadId) => invokeIpcContract(browserDownloadIpc.discard, downloadId),
  openDownload: (downloadId) => invokeIpcContract(browserDownloadIpc.open, downloadId),
  revealDownload: (downloadId) => invokeIpcContract(browserDownloadIpc.reveal, downloadId),
  onDownloadChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on(browserIpcEvents.downloadChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.downloadChanged, handler)
  },
  onViewStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on(browserIpcEvents.viewStateChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.viewStateChanged, handler)
  },
}
