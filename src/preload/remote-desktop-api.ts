import { desktopIpc, type DesktopApi } from '../shared/ipc/remote-desktop'
import { invokeIpcContract } from './ipc-contract-client'
export const desktopApi: DesktopApi = {
  listDevices: () => invokeIpcContract(desktopIpc.listDevices),
  saveDevice: (input) => invokeIpcContract(desktopIpc.saveDevice, input),
  forgetCredential: (deviceId) => invokeIpcContract(desktopIpc.forgetCredential, deviceId),
  open: (input) => invokeIpcContract(desktopIpc.open, input),
  savedCredential: (id) => invokeIpcContract(desktopIpc.savedCredential, id),
  rememberCredential: (id, credential) =>
    invokeIpcContract(desktopIpc.rememberCredential, id, credential),
  close: (id) => invokeIpcContract(desktopIpc.close, id),
  read: (id) => invokeIpcContract(desktopIpc.read, id),
  write: (id, bytes) => invokeIpcContract(desktopIpc.write, id, bytes),
}
