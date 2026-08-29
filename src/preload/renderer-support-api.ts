import { ipcRenderer } from 'electron'
import { dialogIpc, type DialogApiContract } from '../shared/ipc/dialog'
import {
  editorIpc,
  editorIpcEvents,
  parseEditorReadRequest,
  parseEditorSaveRequest,
  type EditorApiContract,
} from '../shared/ipc/editor'
import { identityIpc, type IdentityApiContract } from '../shared/ipc/identity'
import type { UpdateApiContract } from '../shared/ipc/update'
import {
  parseUpdateSnapshot,
  updateIpc,
  updateIpcEvents,
  updateSnapshotChangedEventSchema,
} from '../shared/update'
import { wechatIpc, type WechatApiContract } from '../shared/ipc/wechat'
import {
  windowIpc,
  windowIpcEvents,
  parseShortcutCaptureInputEvent,
  type WindowApiContract,
} from '../shared/ipc/window'
import { invokeIpcContract } from './ipc-contract-client'

export const windowApi: WindowApiContract = {
  toggleFullscreen: () => invokeIpcContract(windowIpc.toggleFullscreen),
  toggleDevtools: () => invokeIpcContract(windowIpc.toggleDevtools),
  reload: () => invokeIpcContract(windowIpc.reload),
  requestClose: () => invokeIpcContract(windowIpc.requestClose),
  focusRenderer: () => invokeIpcContract(windowIpc.focusRenderer),
  setShortcutCaptureGuard: (input) => invokeIpcContract(windowIpc.setShortcutCaptureGuard, input),
  onShortcutCaptureInput: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const input = parseShortcutCaptureInputEvent(value)
      if (input) callback(input)
    }
    ipcRenderer.on(windowIpcEvents.shortcutCaptureInput, handler)
    return () => ipcRenderer.removeListener(windowIpcEvents.shortcutCaptureInput, handler)
  },
}

export const identityApi: IdentityApiContract = {
  getLocalIdentity: () => invokeIpcContract(identityIpc.getLocalIdentity),
}

export const dialogApi: DialogApiContract = {
  showOpenDialog: (options) => invokeIpcContract(dialogIpc.showOpenDialog, options),
  showSaveDialog: (options) => invokeIpcContract(dialogIpc.showSaveDialog, options),
  showMessageBox: (options) => invokeIpcContract(dialogIpc.showMessageBox, options),
}

export const wechatApi: WechatApiContract = {
  convert: (markdown, documentPath) =>
    invokeIpcContract(wechatIpc.convert, { markdown, documentPath }),
}

type OwnedEditorListener = (event: Electron.IpcRendererEvent, ...args: unknown[]) => void

function registerOwnedEditorListener(channel: string, listener: OwnedEditorListener): () => void {
  ipcRenderer.on(channel, listener)

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    ipcRenderer.removeListener(channel, listener)
  }
}

export const editorApi: EditorApiContract = {
  onReadRequest: (callback) => {
    const handler: OwnedEditorListener = (_event, data): void => {
      const request = parseEditorReadRequest(data)
      if (request) callback(request)
    }
    return registerOwnedEditorListener(editorIpcEvents.readRequest, handler)
  },
  readResponse: (id, content) => invokeIpcContract(editorIpc.readResponse, id, content),
  onSaveRequest: (callback) => {
    const handler: OwnedEditorListener = (_event, data): void => {
      const request = parseEditorSaveRequest(data)
      if (request) callback(request)
    }
    return registerOwnedEditorListener(editorIpcEvents.saveRequest, handler)
  },
  saveResult: (id, success, error) => invokeIpcContract(editorIpc.saveResult, id, success, error),
}

export const updateApi: UpdateApiContract = {
  getSnapshot: async () => parseUpdateSnapshot(await invokeIpcContract(updateIpc.getSnapshot)),
  check: () => invokeIpcContract(updateIpc.check),
  startDownload: () => invokeIpcContract(updateIpc.startDownload),
  cancelDownload: () => invokeIpcContract(updateIpc.cancelDownload),
  defer: () => invokeIpcContract(updateIpc.defer),
  ignoreVersion: () => invokeIpcContract(updateIpc.ignoreVersion),
  openManualInstaller: () => invokeIpcContract(updateIpc.openManualInstaller),
  prepareInstall: () => invokeIpcContract(updateIpc.prepareInstall),
  installAndRestart: (input) => invokeIpcContract(updateIpc.installAndRestart, input),
  onSnapshotChanged: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof callback>[0],
    ): void => callback(updateSnapshotChangedEventSchema.parse(value))
    ipcRenderer.on(updateIpcEvents.snapshotChanged, handler)
    return () => ipcRenderer.removeListener(updateIpcEvents.snapshotChanged, handler)
  },
}
