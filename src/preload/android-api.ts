import { ipcRenderer } from 'electron'
import type { AndroidApiContract } from '../shared/ipc/android'

export const androidApi: AndroidApiContract = {
  reconnect: () => ipcRenderer.invoke('android:reconnect'),
  onDeviceLost: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, info: Parameters<typeof callback>[0]) =>
      callback(info)
    ipcRenderer.on('android:deviceLost', handler)
    return () => ipcRenderer.removeListener('android:deviceLost', handler)
  },
  listPhysicalDevices: () => ipcRenderer.invoke('android:listPhysicalDevices'),
  connectPhysical: (serial) => ipcRenderer.invoke('android:connectPhysical', serial),
  disconnectPhysical: () => ipcRenderer.invoke('android:disconnectPhysical'),
  onPhysicalConnected: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) =>
      callback(data)
    ipcRenderer.on('android:physicalConnected', handler)
    return () => ipcRenderer.removeListener('android:physicalConnected', handler)
  },
  onPhysicalDisconnected: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('android:physicalDisconnected', handler)
    return () => ipcRenderer.removeListener('android:physicalDisconnected', handler)
  },
  onStoreInstallProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('android:storeInstallProgress', handler)
    return () => ipcRenderer.removeListener('android:storeInstallProgress', handler)
  },
  onStoreInstallResult: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, result: Parameters<typeof callback>[0]) =>
      callback(result)
    ipcRenderer.on('android:storeInstallResult', handler)
    return () => ipcRenderer.removeListener('android:storeInstallResult', handler)
  },
  retryStoreInstall: () => ipcRenderer.invoke('android:retryStoreInstall'),
  tap: (x, y) => ipcRenderer.invoke('android:tap', x, y),
  swipe: (x1, y1, x2, y2, duration) =>
    ipcRenderer.invoke('android:swipe', x1, y1, x2, y2, duration),
  pressKey: (key) => ipcRenderer.invoke('android:pressKey', key),
  typeText: (text) => ipcRenderer.invoke('android:typeText', text),
  screenshot: () => ipcRenderer.invoke('android:screenshot'),
  getDeviceInfo: () => ipcRenderer.invoke('android:getDeviceInfo'),
  listPackages: (filter) => ipcRenderer.invoke('android:listPackages', filter),
  getDeviceId: () => ipcRenderer.invoke('android:getDeviceId'),
  dumpUi: () => ipcRenderer.invoke('android:dumpUi'),
  installApk: (path) => ipcRenderer.invoke('android:installApk', path),
  connectMirror: (deviceId) => ipcRenderer.invoke('scrcpy:connect', deviceId),
  disconnectMirror: () => ipcRenderer.invoke('scrcpy:disconnect'),
  sendTouch: (data) => ipcRenderer.send('scrcpy:touch', data),
  onVideoFrame: (callback) => {
    ipcRenderer.removeAllListeners('scrcpy:videoFrame')
    ipcRenderer.on('scrcpy:videoFrame', (_event, frame) => callback(frame))
  },
  onMirrorError: (callback) => {
    ipcRenderer.removeAllListeners('scrcpy:error')
    ipcRenderer.on('scrcpy:error', (_event, error) => callback(error))
  },
  onMirrorDisconnected: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.removeAllListeners('scrcpy:disconnected')
    ipcRenderer.on('scrcpy:disconnected', handler)
    return () => ipcRenderer.removeListener('scrcpy:disconnected', handler)
  },
}
