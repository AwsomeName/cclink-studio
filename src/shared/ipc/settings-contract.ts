import { bindIpcParser, bindNoArgsIpc, ipcArgs } from './contract'
import {
  settingsIpc,
  type SettingsOperationResult,
  type SettingsSecretOperationResult,
} from './settings'
import {
  parseSettingsKey,
  parseSettingsSecretKey,
  parseSettingsSecretValue,
  parseSettingsUpdate,
} from './settings-schema'

const invalidSettingsResult = async (): Promise<SettingsOperationResult> => ({
  success: false,
  error: '设置参数无效',
})
const invalidSecretResult = async (): Promise<SettingsSecretOperationResult> => ({
  success: false,
  error: '设置参数无效',
})

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

export const settingsIpcContracts = {
  getAll: bindNoArgsIpc(settingsIpc.getAll),
  getSecretStatus: bindNoArgsIpc(settingsIpc.getSecretStatus),
  set: bindIpcParser(
    settingsIpc.set,
    (args) => {
      requireArgs(args, 1, settingsIpc.set.channel)
      return ipcArgs(parseSettingsUpdate(args[0]))
    },
    invalidSettingsResult,
  ),
  setSecret: bindIpcParser(
    settingsIpc.setSecret,
    (args) => {
      requireArgs(args, 2, settingsIpc.setSecret.channel)
      return ipcArgs(parseSettingsSecretKey(args[0]), parseSettingsSecretValue(args[1]))
    },
    invalidSecretResult,
  ),
  clearSecret: bindIpcParser(
    settingsIpc.clearSecret,
    (args) => {
      requireArgs(args, 1, settingsIpc.clearSecret.channel)
      return ipcArgs(parseSettingsSecretKey(args[0]))
    },
    invalidSecretResult,
  ),
  reset: bindNoArgsIpc(settingsIpc.reset),
  resetKey: bindIpcParser(
    settingsIpc.resetKey,
    (args) => {
      requireArgs(args, 1, settingsIpc.resetKey.channel)
      return ipcArgs(parseSettingsKey(args[0]))
    },
    invalidSettingsResult,
  ),
  detectClaudeCode: bindNoArgsIpc(settingsIpc.detectClaudeCode),
} as const
