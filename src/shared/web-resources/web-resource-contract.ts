import { bindIpcParser, bindNoArgsIpc, ipcArgs } from '../ipc/contract'
import { parseCreateWebConnectionInput } from './web-resource-schema'
import { webResourcesIpc } from './web-resource'
import type { WebResourceConnection, WebResourceOperationResult } from './web-resource-types'

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
} as const
