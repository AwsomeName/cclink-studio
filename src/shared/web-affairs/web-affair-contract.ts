import { z } from 'zod'
import {
  bindIpcParser,
  bindNoArgsIpc,
  ipcArgs,
  type IpcInvokeContract,
  type IpcInvokeDefinition,
} from '../ipc/contract'
import { webAffairsIpc } from './web-affair'
import {
  bindWebAffairAttemptInputSchema,
  claimLegacyWebAffairInputSchema,
  completeWebAffairCheckInputSchema,
  confirmWebAffairFinalActionInputSchema,
  createWebAffairInputSchema,
  decideWebAffairFlowProposalInputSchema,
  finishWebAffairAttemptInputSchema,
  handoffWebAffairAttemptInputSchema,
  inspectWebAffairMaterialsInputSchema,
  proposeWebAffairFlowDiffInputSchema,
  returnWebAffairAttemptInputSchema,
  reviseWebAffairFlowInputSchema,
  scheduleWebAffairCheckInputSchema,
  startWebAffairAttemptInputSchema,
  updateWebAffairNodeInputSchema,
  webAffairWorkspaceScopeInputSchema,
} from './web-affair-schema'
import type { WebAffair, WebAffairOperationResult } from './web-affair-types'

const invalidInputResult = async <T>(): Promise<WebAffairOperationResult<T>> => ({
  success: false,
  error: { code: 'INVALID_INPUT', message: '事务参数无效' },
})

function bindSingleInput<Input>(
  contract: IpcInvokeDefinition<[Input], WebAffairOperationResult<WebAffair>>,
  schema: z.ZodType<Input>,
): IpcInvokeContract<[Input], WebAffairOperationResult<WebAffair>> {
  return bindIpcParser(
    contract,
    (args) => {
      if (args.length !== 1) throw new Error(`IPC ${contract.channel} 需要 1 个参数`)
      return ipcArgs(schema.parse(args[0]))
    },
    invalidInputResult,
  )
}

export const webAffairsIpcContracts = {
  getSnapshot: bindIpcParser(
    webAffairsIpc.getSnapshot,
    (args) => {
      if (args.length !== 1) {
        throw new Error(`IPC ${webAffairsIpc.getSnapshot.channel} 需要 1 个参数`)
      }
      return ipcArgs(webAffairWorkspaceScopeInputSchema.parse(args[0]))
    },
    invalidInputResult,
  ),
  getCatalog: bindNoArgsIpc(webAffairsIpc.getCatalog),
  createAffair: bindSingleInput(webAffairsIpc.createAffair, createWebAffairInputSchema),
  claimLegacyAffair: bindSingleInput(
    webAffairsIpc.claimLegacyAffair,
    claimLegacyWebAffairInputSchema,
  ),
  updateNode: bindSingleInput(webAffairsIpc.updateNode, updateWebAffairNodeInputSchema),
  reviseFlow: bindSingleInput(webAffairsIpc.reviseFlow, reviseWebAffairFlowInputSchema),
  inspectMaterials: bindSingleInput(
    webAffairsIpc.inspectMaterials,
    inspectWebAffairMaterialsInputSchema,
  ),
  startAttempt: bindSingleInput(webAffairsIpc.startAttempt, startWebAffairAttemptInputSchema),
  bindAttempt: bindSingleInput(webAffairsIpc.bindAttempt, bindWebAffairAttemptInputSchema),
  handoffAttempt: bindSingleInput(webAffairsIpc.handoffAttempt, handoffWebAffairAttemptInputSchema),
  returnAttempt: bindSingleInput(webAffairsIpc.returnAttempt, returnWebAffairAttemptInputSchema),
  confirmFinalAction: bindSingleInput(
    webAffairsIpc.confirmFinalAction,
    confirmWebAffairFinalActionInputSchema,
  ),
  finishAttempt: bindSingleInput(webAffairsIpc.finishAttempt, finishWebAffairAttemptInputSchema),
  scheduleCheck: bindSingleInput(webAffairsIpc.scheduleCheck, scheduleWebAffairCheckInputSchema),
  completeCheck: bindSingleInput(webAffairsIpc.completeCheck, completeWebAffairCheckInputSchema),
  proposeFlowDiff: bindSingleInput(
    webAffairsIpc.proposeFlowDiff,
    proposeWebAffairFlowDiffInputSchema,
  ),
  decideFlowProposal: bindSingleInput(
    webAffairsIpc.decideFlowProposal,
    decideWebAffairFlowProposalInputSchema,
  ),
}
