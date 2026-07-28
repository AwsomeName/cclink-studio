import { bindIpcParser, bindNoArgsIpc, ipcArgs } from './contract'
import {
  credentialsIpc,
  type CredentialFieldResult,
  type CredentialOperationResult,
} from './credentials'
import {
  parseCredentialFieldName,
  parseCredentialId,
  parseSetCredentialInput,
} from './credentials-schema'

const invalidOperation = async (): Promise<CredentialOperationResult> => ({
  success: false,
  error: '凭证参数无效',
})
const invalidFieldOperation = async (): Promise<CredentialFieldResult> => ({
  success: false,
  error: '凭证参数无效',
})

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

export const credentialsIpcContracts = {
  listMetadata: bindNoArgsIpc(credentialsIpc.listMetadata),
  getStatus: bindNoArgsIpc(credentialsIpc.getStatus),
  set: bindIpcParser(
    credentialsIpc.set,
    (args) => {
      requireArgs(args, 1, credentialsIpc.set.channel)
      return ipcArgs(parseSetCredentialInput(args[0]))
    },
    invalidOperation,
  ),
  revealField: bindIpcParser(
    credentialsIpc.revealField,
    (args) => {
      requireArgs(args, 2, credentialsIpc.revealField.channel)
      return ipcArgs(parseCredentialId(args[0]), parseCredentialFieldName(args[1]))
    },
    invalidFieldOperation,
  ),
  copyField: bindIpcParser(
    credentialsIpc.copyField,
    (args) => {
      requireArgs(args, 2, credentialsIpc.copyField.channel)
      return ipcArgs(parseCredentialId(args[0]), parseCredentialFieldName(args[1]))
    },
    invalidOperation,
  ),
  remove: bindIpcParser(
    credentialsIpc.remove,
    (args) => {
      requireArgs(args, 1, credentialsIpc.remove.channel)
      return ipcArgs(parseCredentialId(args[0]))
    },
    invalidOperation,
  ),
  clearAll: bindNoArgsIpc(credentialsIpc.clearAll),
  removeLegacyFiles: bindNoArgsIpc(credentialsIpc.removeLegacyFiles),
  openDirectory: bindNoArgsIpc(credentialsIpc.openDirectory),
  reload: bindNoArgsIpc(credentialsIpc.reload),
} as const
