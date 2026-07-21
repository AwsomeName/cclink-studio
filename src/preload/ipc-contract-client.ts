import { ipcRenderer } from 'electron'
import type { IpcInvokeDefinition } from '../shared/ipc/contract'

export function invokeIpcContract<Args extends unknown[], Result>(
  contract: IpcInvokeDefinition<Args, Result>,
  ...args: Args
): Promise<Result> {
  return ipcRenderer.invoke(contract.channel, ...args)
}
