import { ipcRenderer } from 'electron'
import type { BrowserApiContract } from '../shared/ipc/browser'

export const reportWorkbenchBounds = (bounds: {
  x: number
  y: number
  width: number
  height: number
}): void => ipcRenderer.send('workbench:bounds', bounds)

export const browserApi: BrowserApiContract = {
  createView: (tabId, initialUrl, opts) =>
    ipcRenderer.invoke('browser:createView', tabId, initialUrl, opts),
  destroyView: (tabId) => ipcRenderer.invoke('browser:destroyView', tabId),
  setActive: (tabId) => ipcRenderer.invoke('browser:setActive', tabId),
  reconcileViews: (options) => ipcRenderer.invoke('browser:reconcileViews', options),
  navigate: (tabId, url) => ipcRenderer.invoke('browser:navigate', tabId, url),
  goBack: (tabId) => ipcRenderer.invoke('browser:goBack', tabId),
  goForward: (tabId) => ipcRenderer.invoke('browser:goForward', tabId),
  reload: (tabId) => ipcRenderer.invoke('browser:reload', tabId),
  capturePage: (tabId) => ipcRenderer.invoke('browser:capturePage', tabId),
  getCurrentURL: (tabId) => ipcRenderer.invoke('browser:getCurrentURL', tabId),
  getActiveViewId: (workspaceKey) => ipcRenderer.invoke('browser:getActiveViewId', workspaceKey),
  getDiagnostics: (tabId) => ipcRenderer.invoke('browser:getDiagnostics', tabId),
  getRuntimeDiagnostics: (tabId) => ipcRenderer.invoke('browser:getRuntimeDiagnostics', tabId),
  getSessionDiagnostics: (request) => ipcRenderer.invoke('browser:getSessionDiagnostics', request),
  onUrlChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on('browser:urlChanged', handler)
    return () => ipcRenderer.removeListener('browser:urlChanged', handler)
  },
  onPageMetaChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on('browser:pageMetaChanged', handler)
    return () => ipcRenderer.removeListener('browser:pageMetaChanged', handler)
  },
  onRequestOpenTab: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on('browser:requestOpenTab', handler)
    return () => ipcRenderer.removeListener('browser:requestOpenTab', handler)
  },
  zoomIn: (tabId) => ipcRenderer.invoke('browser:zoomIn', tabId),
  zoomOut: (tabId) => ipcRenderer.invoke('browser:zoomOut', tabId),
  resetZoom: (tabId) => ipcRenderer.invoke('browser:resetZoom', tabId),
  setZoom: (tabId, factor) => ipcRenderer.invoke('browser:setZoom', tabId, factor),
  fitWidth: (tabId) => ipcRenderer.invoke('browser:fitWidth', tabId),
  setDeviceMode: (tabId, mode) => ipcRenderer.invoke('browser:setDeviceMode', tabId, mode),
  getViewState: () => ipcRenderer.invoke('browser:getViewState'),
  listSnapshots: () => ipcRenderer.invoke('browser:listSnapshots'),
  removeSnapshot: (id) => ipcRenderer.invoke('browser:removeSnapshot', id),
  clearSnapshots: () => ipcRenderer.invoke('browser:clearSnapshots'),
  listHistory: (limit) => ipcRenderer.invoke('browser:listHistory', limit),
  clearHistory: () => ipcRenderer.invoke('browser:clearHistory'),
  startTask: (tabId, goal) => ipcRenderer.invoke('browserTask:start', tabId, goal),
  listTasks: () => ipcRenderer.invoke('browserTask:list'),
  getTask: (taskRunId) => ipcRenderer.invoke('browserTask:get', taskRunId),
  getActiveTaskForTab: (tabId) => ipcRenderer.invoke('browserTask:getActiveForTab', tabId),
  pauseTask: (taskRunId) => ipcRenderer.invoke('browserTask:pause', taskRunId),
  resumeTask: (taskRunId) => ipcRenderer.invoke('browserTask:resume', taskRunId),
  cancelTask: (taskRunId) => ipcRenderer.invoke('browserTask:cancel', taskRunId),
  finishTask: (taskRunId) => ipcRenderer.invoke('browserTask:finish', taskRunId),
  listActionLogs: (taskRunId) => ipcRenderer.invoke('browserTask:listActionLogs', taskRunId),
  onTaskChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on('browserTask:changed', handler)
    return () => ipcRenderer.removeListener('browserTask:changed', handler)
  },
  onActionLogChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on('browserActionLog:changed', handler)
    return () => ipcRenderer.removeListener('browserActionLog:changed', handler)
  },
  listDownloads: () => ipcRenderer.invoke('browserDownload:list'),
  getDownload: (downloadId) => ipcRenderer.invoke('browserDownload:get', downloadId),
  keepDownloadToWorkspace: (downloadId) =>
    ipcRenderer.invoke('browserDownload:keepToWorkspace', downloadId),
  saveDownloadAs: (downloadId) => ipcRenderer.invoke('browserDownload:saveAs', downloadId),
  discardDownload: (downloadId) => ipcRenderer.invoke('browserDownload:discard', downloadId),
  openDownload: (downloadId) => ipcRenderer.invoke('browserDownload:open', downloadId),
  revealDownload: (downloadId) => ipcRenderer.invoke('browserDownload:reveal', downloadId),
  onDownloadChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on('browserDownload:changed', handler)
    return () => ipcRenderer.removeListener('browserDownload:changed', handler)
  },
  onViewStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on('browser:viewStateChanged', handler)
    return () => ipcRenderer.removeListener('browser:viewStateChanged', handler)
  },
}
