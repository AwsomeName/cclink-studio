import { bindIpcParser, bindNoArgsIpc, ipcArgs } from './contract'
import {
  settingsIpc,
  type SettingsOperationResult,
  type SettingsSecretOperationResult,
  type ClaudeRuntimeProbeOperationResult,
  type ClaudeModelConnectionTestOperationResult,
} from './settings'
import {
  parseSettingsKey,
  parseSettingsSecretKey,
  parseSettingsSecretValue,
  parseSettingsUpdate,
  parseClaudeRuntimeSelection,
} from './settings-schema'

const invalidSettingsResult = async (): Promise<SettingsOperationResult> => ({
  success: false,
  error: '设置参数无效',
})
const invalidSecretResult = async (): Promise<SettingsSecretOperationResult> => ({
  success: false,
  error: '设置参数无效',
})
const invalidRuntimeProbeResult = async (): Promise<ClaudeRuntimeProbeOperationResult> => ({
  success: false,
  error: 'Claude Code 运行时参数无效',
})
const invalidConnectionTestResult =
  async (): Promise<ClaudeModelConnectionTestOperationResult> => ({
    success: false,
    error: 'Claude 模型连接测试参数无效',
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
  getClaudeRuntimeStatus: bindNoArgsIpc(settingsIpc.getClaudeRuntimeStatus),
  probeClaudeRuntime: bindIpcParser(
    settingsIpc.probeClaudeRuntime,
    (args) => {
      requireArgs(args, 1, settingsIpc.probeClaudeRuntime.channel)
      return ipcArgs(parseClaudeRuntimeSelection(args[0]))
    },
    invalidRuntimeProbeResult,
  ),
  testClaudeModelConnection: bindIpcParser(
    settingsIpc.testClaudeModelConnection,
    (args) => {
      requireArgs(args, 1, settingsIpc.testClaudeModelConnection.channel)
      return ipcArgs(parseClaudeRuntimeSelection(args[0]))
    },
    invalidConnectionTestResult,
  ),
} as const
