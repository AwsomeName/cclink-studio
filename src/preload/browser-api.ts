import { ipcRenderer } from 'electron'
import {
  browserDownloadIpc,
  browserIpc,
  browserIpcEvents,
  browserTaskIpc,
  type BrowserApiContract,
  type BrowserWorkbenchBounds,
  parseBrowserActionLogChangedPayload,
  parseBrowserContextAgentRequest,
  parseBrowserDownloadChangedPayload,
  parseBrowserFindResultPayload,
  parseBrowserFindShortcutTriggeredPayload,
  parseBrowserNativeContextMenuOpenedPayload,
  parseBrowserOpenTabRequest,
  parseBrowserPageMetaChangedPayload,
  parseBrowserPopupCreatedPayload,
  parseBrowserRuntimeTabClosedPayload,
  parseBrowserTaskChangedPayload,
  parseBrowserUrlChangedPayload,
  parseBrowserViewStateChangedPayload,
} from '../shared/ipc/browser'
import { invokeIpcContract } from './ipc-contract-client'

export const reportWorkbenchBounds = (bounds: BrowserWorkbenchBounds): void =>
  ipcRenderer.send(browserIpcEvents.workbenchBounds, bounds)

export const browserApi: BrowserApiContract = {
  createView: (tabId, initialUrl, opts) =>
    invokeIpcContract(browserIpc.createView, tabId, initialUrl, opts),
  destroyView: (tabId) => invokeIpcContract(browserIpc.destroyView, tabId),
  beginPopupAdoption: (tabId) => invokeIpcContract(browserIpc.beginPopupAdoption, tabId),
  acceptPopup: (tabId) => invokeIpcContract(browserIpc.acceptPopup, tabId),
  rejectPopup: (tabId) => invokeIpcContract(browserIpc.rejectPopup, tabId),
  setActive: (tabId) => invokeIpcContract(browserIpc.setActive, tabId),
  reconcileViews: (options) => invokeIpcContract(browserIpc.reconcileViews, options),
  navigate: (tabId, url) => invokeIpcContract(browserIpc.navigate, tabId, url),
  goBack: (tabId) => invokeIpcContract(browserIpc.goBack, tabId),
  goForward: (tabId) => invokeIpcContract(browserIpc.goForward, tabId),
  reload: (tabId) => invokeIpcContract(browserIpc.reload, tabId),
  capturePage: (tabId) => invokeIpcContract(browserIpc.capturePage, tabId),
  getCurrentURL: (tabId) => invokeIpcContract(browserIpc.getCurrentURL, tabId),
  getActiveViewId: (workspaceKey) => invokeIpcContract(browserIpc.getActiveViewId, workspaceKey),
  syncFindShortcut: (input) => invokeIpcContract(browserIpc.syncFindShortcut, input),
  getRuntimeIdentity: (tabId) => invokeIpcContract(browserIpc.getRuntimeIdentity, tabId),
  findInPage: (input) => invokeIpcContract(browserIpc.findInPage, input),
  stopFindInPage: (input) => invokeIpcContract(browserIpc.stopFindInPage, input),
  dispatchFindShortcutForSmoke: (tabId) =>
    invokeIpcContract(browserIpc.dispatchFindShortcutForSmoke, tabId),
  onFindShortcutTriggered: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserFindShortcutTriggeredPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.findShortcutTriggered, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.findShortcutTriggered, handler)
  },
  onFindResult: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserFindResultPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.findResult, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.findResult, handler)
  },
  getDiagnostics: (tabId) => invokeIpcContract(browserIpc.getDiagnostics, tabId),
  getRuntimeDiagnostics: (tabId) => invokeIpcContract(browserIpc.getRuntimeDiagnostics, tabId),
  getSessionDiagnostics: (request) => invokeIpcContract(browserIpc.getSessionDiagnostics, request),
  onUrlChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserUrlChangedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.urlChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.urlChanged, handler)
  },
  onPageMetaChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserPageMetaChangedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.pageMetaChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.pageMetaChanged, handler)
  },
  onRequestOpenTab: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserOpenTabRequest(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.requestOpenTab, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.requestOpenTab, handler)
  },
  onPopupCreated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = parseBrowserPopupCreatedPayload(payload)
      if (parsed) callback(parsed)
    }
    ipcRenderer.on(browserIpcEvents.popupCreated, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.popupCreated, handler)
  },
  onRuntimeTabClosed: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = parseBrowserRuntimeTabClosedPayload(payload)
      if (parsed) callback(parsed)
    }
    ipcRenderer.on(browserIpcEvents.runtimeTabClosed, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.runtimeTabClosed, handler)
  },
  onNativeContextMenuOpened: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserNativeContextMenuOpenedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.nativeContextMenuOpened, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.nativeContextMenuOpened, handler)
  },
  onContextAgentRequest: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserContextAgentRequest(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.contextAgentRequest, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.contextAgentRequest, handler)
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
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserTaskChangedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.taskChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.taskChanged, handler)
  },
  onActionLogChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserActionLogChangedPayload(value)
      if (payload) callback(payload)
    }
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
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserDownloadChangedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.downloadChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.downloadChanged, handler)
  },
  onViewStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const payload = parseBrowserViewStateChangedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.viewStateChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.viewStateChanged, handler)
  },
}
