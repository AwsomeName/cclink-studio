import { contextBridge, ipcRenderer } from 'electron'
import {
  workbenchPlacementChangedSchema,
  workbenchWindowIpc,
  workbenchWindowIpcEvents,
  workbenchWindowProjectionSchema,
  type WorkbenchWindowApiContract,
} from '../shared/ipc/workbench-window'
import {
  browserIpcEvents,
  parseBrowserDownloadChangedPayload,
  parseBrowserFindResultPayload,
  parseBrowserFindShortcutTriggeredPayload,
  parseBrowserNativeContextMenuOpenedPayload,
  parseBrowserPageMetaChangedPayload,
  parseBrowserTaskChangedPayload,
  parseBrowserUrlChangedPayload,
} from '../shared/ipc/browser'
import { invokeIpcContract } from './ipc-contract-client'

const api: WorkbenchWindowApiContract = {
  getBootstrap: () => invokeIpcContract(workbenchWindowIpc.getBootstrap),
  getProjection: () => invokeIpcContract(workbenchWindowIpc.getProjection),
  moveTabToNewWindow: (input) => invokeIpcContract(workbenchWindowIpc.moveTabToNewWindow, input),
  returnTabToMain: (input) => invokeIpcContract(workbenchWindowIpc.returnTabToMain, input),
  auxiliaryReady: (input) => invokeIpcContract(workbenchWindowIpc.auxiliaryReady, input),
  updateBounds: (input) => invokeIpcContract(workbenchWindowIpc.updateBounds, input),
  browserCommand: (input) => invokeIpcContract(workbenchWindowIpc.browserCommand, input),
  onProjectionChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const parsed = workbenchWindowProjectionSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on(workbenchWindowIpcEvents.projectionChanged, handler)
    return () => ipcRenderer.removeListener(workbenchWindowIpcEvents.projectionChanged, handler)
  },
  onPlacementChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const parsed = workbenchPlacementChangedSchema.safeParse(value)
      if (parsed.success) callback(parsed.data)
    }
    ipcRenderer.on(workbenchWindowIpcEvents.placementChanged, handler)
    return () => ipcRenderer.removeListener(workbenchWindowIpcEvents.placementChanged, handler)
  },
  onUrlChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const payload = parseBrowserUrlChangedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.urlChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.urlChanged, handler)
  },
  onPageMetaChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const payload = parseBrowserPageMetaChangedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.pageMetaChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.pageMetaChanged, handler)
  },
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
  onTaskChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const payload = parseBrowserTaskChangedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.taskChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.taskChanged, handler)
  },
  onDownloadChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const payload = parseBrowserDownloadChangedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.downloadChanged, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.downloadChanged, handler)
  },
  onNativeContextMenuOpened: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const payload = parseBrowserNativeContextMenuOpenedPayload(value)
      if (payload) callback(payload)
    }
    ipcRenderer.on(browserIpcEvents.nativeContextMenuOpened, handler)
    return () => ipcRenderer.removeListener(browserIpcEvents.nativeContextMenuOpened, handler)
  },
}

contextBridge.exposeInMainWorld('cclinkAuxiliary', api)
