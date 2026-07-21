import { ipcRenderer } from 'electron'
import { dialogIpc, type DialogApiContract } from '../shared/ipc/dialog'
import type { EditorApiContract } from '../shared/ipc/editor'
import { identityIpc, type IdentityApiContract } from '../shared/ipc/identity'
import type { UpdateApiContract } from '../shared/ipc/update'
import type { WechatApiContract } from '../shared/ipc/wechat'
import { windowIpc, type WindowApiContract } from '../shared/ipc/window'
import { invokeIpcContract } from './ipc-contract-client'

export const windowApi: WindowApiContract = {
  toggleFullscreen: () => invokeIpcContract(windowIpc.toggleFullscreen),
  toggleDevtools: () => invokeIpcContract(windowIpc.toggleDevtools),
  reload: () => invokeIpcContract(windowIpc.reload),
  focusRenderer: () => invokeIpcContract(windowIpc.focusRenderer),
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
  convert: (markdown) => ipcRenderer.invoke('wechat:convert', { markdown }),
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
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  onUpdateAvailable: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: Parameters<typeof callback>[0],
    ): void => callback(info)
    ipcRenderer.removeAllListeners('updater:update-available')
    ipcRenderer.on('updater:update-available', handler)
    return () => ipcRenderer.removeListener('updater:update-available', handler)
  },
}
