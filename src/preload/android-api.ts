import { ipcRenderer } from 'electron'
import {
  androidIpc,
  androidIpcEvents,
  parseAndroidEventMessage,
  parseScrcpyVideoFrame,
  type AndroidApiContract,
} from '../shared/ipc/android'
import { invokeIpcContract } from './ipc-contract-client'

export const androidApi: AndroidApiContract = {
  reconnect: () => invokeIpcContract(androidIpc.reconnect),
  listPhysicalDevices: () => invokeIpcContract(androidIpc.listPhysicalDevices),
  connectPhysical: (serial) => invokeIpcContract(androidIpc.connectPhysical, serial),
  disconnectPhysical: () => invokeIpcContract(androidIpc.disconnectPhysical),
  onStoreInstallProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const message = parseAndroidEventMessage(value)
      if (message !== null) callback(message)
    }
    ipcRenderer.on(androidIpcEvents.storeInstallProgress, handler)
    return () => ipcRenderer.removeListener(androidIpcEvents.storeInstallProgress, handler)
  },
  retryStoreInstall: () => invokeIpcContract(androidIpc.retryStoreInstall),
  tap: (x, y) => invokeIpcContract(androidIpc.tap, x, y),
  swipe: (x1, y1, x2, y2, duration) =>
    invokeIpcContract(androidIpc.swipe, x1, y1, x2, y2, duration),
  pressKey: (key) => invokeIpcContract(androidIpc.pressKey, key),
  typeText: (text) => invokeIpcContract(androidIpc.typeText, text),
  screenshot: () => invokeIpcContract(androidIpc.screenshot),
  getDeviceInfo: () => invokeIpcContract(androidIpc.getDeviceInfo),
  listPackages: (filter) => invokeIpcContract(androidIpc.listPackages, filter),
  getDeviceId: () => invokeIpcContract(androidIpc.getDeviceId),
  dumpUi: () => invokeIpcContract(androidIpc.dumpUi),
  installApk: (path) => invokeIpcContract(androidIpc.installApk, path),
  connectMirror: (deviceId) => invokeIpcContract(androidIpc.connectMirror, deviceId),
  disconnectMirror: () => invokeIpcContract(androidIpc.disconnectMirror),
  sendTouch: (data) => ipcRenderer.send(androidIpcEvents.touch, data),
  onVideoFrame: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const frame = parseScrcpyVideoFrame(value)
      if (frame) callback(frame)
    }
    ipcRenderer.on(androidIpcEvents.videoFrame, handler)
    return () => ipcRenderer.removeListener(androidIpcEvents.videoFrame, handler)
  },
  onMirrorError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const error = parseAndroidEventMessage(value)
      if (error !== null) callback(error)
    }
    ipcRenderer.on(androidIpcEvents.mirrorError, handler)
    return () => ipcRenderer.removeListener(androidIpcEvents.mirrorError, handler)
  },
  onMirrorDisconnected: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on(androidIpcEvents.mirrorDisconnected, handler)
    return () => ipcRenderer.removeListener(androidIpcEvents.mirrorDisconnected, handler)
  },
}
