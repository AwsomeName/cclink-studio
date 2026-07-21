import { bindIpcParser, ipcArgs } from './contract'
import { dialogIpc } from './dialog'
import {
  messageBoxOptionsSchema,
  openDialogOptionsSchema,
  saveDialogOptionsSchema,
} from './dialog-schema'

function parseOptionalDialogArgs<T>(
  channel: string,
  args: unknown[],
  parse: (value: unknown) => T,
): [T] {
  if (args.length > 1) throw new Error(`IPC ${channel} 最多接受 1 个参数`)
  return [parse(args[0])]
}

export const dialogIpcContracts = {
  showOpenDialog: bindIpcParser(dialogIpc.showOpenDialog, (args) =>
    parseOptionalDialogArgs(dialogIpc.showOpenDialog.channel, args, (value) =>
      openDialogOptionsSchema.parse(value),
    ),
  ),
  showSaveDialog: bindIpcParser(dialogIpc.showSaveDialog, (args) =>
    parseOptionalDialogArgs(dialogIpc.showSaveDialog.channel, args, (value) =>
      saveDialogOptionsSchema.parse(value),
    ),
  ),
  showMessageBox: bindIpcParser(dialogIpc.showMessageBox, (args) => {
    if (args.length !== 1) {
      throw new Error(`IPC ${dialogIpc.showMessageBox.channel} 需要 1 个参数`)
    }
    return ipcArgs(messageBoxOptionsSchema.parse(args[0]))
  }),
} as const
