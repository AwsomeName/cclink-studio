import { bindIpcParser, bindNoArgsIpc, ipcArgs } from '../ipc/contract'
import {
  parseCreateWebConnectionInput,
  parseImportProjectOpsConfigInput,
} from './web-resource-schema'
import { webResourcesIpc } from './web-resource'
import type {
  ImportProjectOpsConfigSummary,
  WebResourceConnection,
  WebResourceOperationResult,
} from './web-resource-types'

const invalidInputResult = async (): Promise<
  WebResourceOperationResult<WebResourceConnection>
> => ({
  success: false,
  error: {
    code: 'INVALID_INPUT',
    message: '网站或账号参数无效',
  },
})

export const webResourcesIpcContracts = {
  getSnapshot: bindNoArgsIpc(webResourcesIpc.getSnapshot),
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
