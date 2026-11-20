import { desktopIpc, type DesktopApi } from '../shared/ipc/remote-desktop'
import { invokeIpcContract } from './ipc-contract-client'
export const desktopApi: DesktopApi = {
  open: (input) => invokeIpcContract(desktopIpc.open, input),
  close: (id) => invokeIpcContract(desktopIpc.close, id),
  read: (id) => invokeIpcContract(desktopIpc.read, id),
  write: (id, bytes) => invokeIpcContract(desktopIpc.write, id, bytes),
}
