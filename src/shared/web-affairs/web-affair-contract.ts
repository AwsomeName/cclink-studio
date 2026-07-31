import { bindIpcParser, bindNoArgsIpc, ipcArgs } from '../ipc/contract'
import { webAffairsIpc } from './web-affair'
import { parseCreateWebAffairInput, parseUpdateWebAffairNodeInput } from './web-affair-schema'
import type { WebAffair, WebAffairOperationResult } from './web-affair-types'

const invalidInputResult = async (): Promise<WebAffairOperationResult<WebAffair>> => ({
  success: false,
  error: { code: 'INVALID_INPUT', message: '事务参数无效' },
})

export const webAffairsIpcContracts = {
  getSnapshot: bindNoArgsIpc(webAffairsIpc.getSnapshot),
  createAffair: bindIpcParser(
    webAffairsIpc.createAffair,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webAffairsIpc.createAffair.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseCreateWebAffairInput(args[0]))
    },
    invalidInputResult,
  ),
  updateNode: bindIpcParser(
    webAffairsIpc.updateNode,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webAffairsIpc.updateNode.channel} 需要 1 个参数`)
      }
      return ipcArgs(parseUpdateWebAffairNodeInput(args[0]))
    },
    invalidInputResult,
  ),
} as const
