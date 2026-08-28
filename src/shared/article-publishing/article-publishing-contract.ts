import { z } from 'zod'
import { bindIpcParser, ipcArgs, type IpcInvokeDefinition } from '../ipc/contract'
import type { WebAffairOperationResult } from '../web-affairs/web-affair-types'
import { articlePublishingIpc } from './article-publishing'
import {
  createArticlePublishingTaskInputSchema,
  inspectArticlePublishingSourceInputSchema,
  recoverArticlePublishingTaskLaunchInputSchema,
  reportArticlePublishingAssetInputSchema,
  reportArticlePublishingCheckpointInputSchema,
  startArticlePublishingTaskInputSchema,
} from './article-publishing-schema'
const invalidInputResult = async <T>(): Promise<WebAffairOperationResult<T>> => ({
  success: false,
  error: { code: 'INVALID_INPUT', message: '文章发布参数无效' },
})

function bindSingle<Input, Output>(
  call: IpcInvokeDefinition<[Input], WebAffairOperationResult<Output>>,
  schema: z.ZodType<Input>,
) {
  return bindIpcParser(
    call,
    (args) => {
      if (args.length !== 1) throw new Error(`IPC ${call.channel} 需要 1 个参数`)
      return ipcArgs(schema.parse(args[0]))
    },
    invalidInputResult,
  )
}

export const articlePublishingIpcContracts = {
  inspectSource: bindSingle(
    articlePublishingIpc.inspectSource,
    inspectArticlePublishingSourceInputSchema,
  ),
  createTask: bindSingle(articlePublishingIpc.createTask, createArticlePublishingTaskInputSchema),
  startTask: bindSingle(articlePublishingIpc.startTask, startArticlePublishingTaskInputSchema),
  recoverTaskLaunch: bindSingle(
    articlePublishingIpc.recoverTaskLaunch,
    recoverArticlePublishingTaskLaunchInputSchema,
  ),
  reportCheckpoint: bindSingle(
    articlePublishingIpc.reportCheckpoint,
    reportArticlePublishingCheckpointInputSchema,
  ),
  reportAsset: bindSingle(
    articlePublishingIpc.reportAsset,
    reportArticlePublishingAssetInputSchema,
  ),
}
