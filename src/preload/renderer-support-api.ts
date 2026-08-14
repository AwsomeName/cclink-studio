import { ipcRenderer } from 'electron'
import { dialogIpc, type DialogApiContract } from '../shared/ipc/dialog'
import type { EditorApiContract } from '../shared/ipc/editor'
import { identityIpc, type IdentityApiContract } from '../shared/ipc/identity'
import type { UpdateApiContract } from '../shared/ipc/update'
import {
  parseUpdateSnapshot,
  updateIpc,
  updateSnapshotChangedChannel,
  updateSnapshotChangedEventSchema,
} from '../shared/update'
import type { WechatApiContract } from '../shared/ipc/wechat'
import {
  windowIpc,
  windowIpcEvents,
  type ShortcutCaptureInputEvent,
  type WindowApiContract,
} from '../shared/ipc/window'
import { invokeIpcContract } from './ipc-contract-client'

export const windowApi: WindowApiContract = {
  toggleFullscreen: () => invokeIpcContract(windowIpc.toggleFullscreen),
  toggleDevtools: () => invokeIpcContract(windowIpc.toggleDevtools),
  reload: () => invokeIpcContract(windowIpc.reload),
  focusRenderer: () => invokeIpcContract(windowIpc.focusRenderer),
  setShortcutCaptureGuard: (input) => invokeIpcContract(windowIpc.setShortcutCaptureGuard, input),
  onShortcutCaptureInput: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, input: ShortcutCaptureInputEvent): void =>
      callback(input)
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
    ipcRenderer.invoke('wechat:convert', { markdown, documentPath }),
}

export const editorApi: EditorApiContract = {
  onContentUpdate: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: Parameters<typeof callback>[0],
    ): void => callback(data)
    ipcRenderer.removeAllListeners('editor:contentUpdate')
    ipcRenderer.on('editor:contentUpdate', handler)
    return () => ipcRenderer.removeListener('editor:contentUpdate', handler)
  },
  contentUpdateAck: (id, success = true, error) =>
    ipcRenderer.invoke('editor:contentUpdateAck', id, success, error),
  onReadRequest: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: Parameters<typeof callback>[0],
    ): void => callback(data)
    ipcRenderer.removeAllListeners('editor:readRequest')
    ipcRenderer.on('editor:readRequest', handler)
    return () => ipcRenderer.removeListener('editor:readRequest', handler)
  },
  readResponse: (id, content) => ipcRenderer.invoke('editor:readResponse', id, content),
  onSaveRequest: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: Parameters<typeof callback>[0],
    ): void => callback(data)
    ipcRenderer.removeAllListeners('editor:saveRequest')
    ipcRenderer.on('editor:saveRequest', handler)
    return () => ipcRenderer.removeListener('editor:saveRequest', handler)
  },
  saveResult: (id, success, error) => ipcRenderer.invoke('editor:saveResult', id, success, error),
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
    ipcRenderer.on(updateSnapshotChangedChannel, handler)
    return () => ipcRenderer.removeListener(updateSnapshotChangedChannel, handler)
  },
}
