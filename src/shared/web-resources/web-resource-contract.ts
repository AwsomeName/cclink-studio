import { bindIpcParser, ipcArgs } from '../ipc/contract'
import {
  parseConfirmWebConnectionLoginInput,
  parseCreateWebConnectionInput,
  parseImportProjectOpsConfigInput,
  parseWebResourceProjectScopeInput,
} from './web-resource-schema'
import { webResourcesIpc } from './web-resource'
import type {
  ClaimLegacyWebConnectionsSummary,
  ImportProjectOpsConfigSummary,
  WebResourceOperationResult,
} from './web-resource-types'

const invalidInputResult = async <T>(): Promise<WebResourceOperationResult<T>> => ({
  success: false,
  error: {
    code: 'INVALID_INPUT',
    message: '网站或账号参数无效',
  },
})

export const webResourcesIpcContracts = {
  getSnapshot: bindIpcParser(
    webResourcesIpc.getSnapshot,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.getSnapshot.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseWebResourceProjectScopeInput(args[0]))
    },
    invalidInputResult,
  ),
  createConnection: bindIpcParser(
    webResourcesIpc.createConnection,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.createConnection.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseCreateWebConnectionInput(args[0]))
    },
    invalidInputResult,
  ),
  confirmLogin: bindIpcParser(
    webResourcesIpc.confirmLogin,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.confirmLogin.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseConfirmWebConnectionLoginInput(args[0]))
    },
    invalidInputResult,
  ),
  claimLegacyConnections: bindIpcParser(
    webResourcesIpc.claimLegacyConnections,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.claimLegacyConnections.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseWebResourceProjectScopeInput(args[0]))
    },
    async (): Promise<WebResourceOperationResult<ClaimLegacyWebConnectionsSummary>> =>
      invalidInputResult(),
  ),
  importProjectOpsConfig: bindIpcParser(
    webResourcesIpc.importProjectOpsConfig,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webResourcesIpc.importProjectOpsConfig.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseImportProjectOpsConfigInput(args[0]))
    },
    async (): Promise<WebResourceOperationResult<ImportProjectOpsConfigSummary>> => ({
      success: false,
      error: { code: 'INVALID_INPUT', message: '导入参数无效' },
    }),
  ),
} as const
