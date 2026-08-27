import { z } from 'zod'
import { bindIpcParser, defineIpcCall, ipcArgs } from '../ipc/contract'
import type { WebAffair, WebAffairOperationResult } from '../web-affairs/web-affair-types'
import {
  createArticlePublishingTaskInputSchema,
  inspectArticlePublishingSourceInputSchema,
  reportArticlePublishingAssetInputSchema,
  reportArticlePublishingCheckpointInputSchema,
  startArticlePublishingTaskInputSchema,
} from './article-publishing-schema'
import type {
  ArticlePublishingApiContract,
  ArticlePublishingSourcePreview,
  CreateArticlePublishingTaskInput,
  InspectArticlePublishingSourceInput,
  ReportArticlePublishingAssetInput,
  ReportArticlePublishingCheckpointInput,
  StartArticlePublishingTaskInput,
  StartArticlePublishingTaskResult,
} from './article-publishing-types'

const invalidInputResult = async <T>(): Promise<WebAffairOperationResult<T>> => ({
  success: false,
  error: { code: 'INVALID_INPUT', message: '文章发布参数无效' },
})

function bindSingle<Input, Output>(
  call: ReturnType<typeof defineIpcCall<[Input], WebAffairOperationResult<Output>>>,
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

export const articlePublishingIpc = {
  inspectSource: defineIpcCall<
    [InspectArticlePublishingSourceInput],
    WebAffairOperationResult<ArticlePublishingSourcePreview>
  >('articlePublishing:inspectSource'),
  createTask: defineIpcCall<
    [CreateArticlePublishingTaskInput],
    WebAffairOperationResult<WebAffair>
  >('articlePublishing:createTask'),
  startTask: defineIpcCall<
    [StartArticlePublishingTaskInput],
    WebAffairOperationResult<StartArticlePublishingTaskResult>
  >('articlePublishing:startTask'),
  reportCheckpoint: defineIpcCall<
    [ReportArticlePublishingCheckpointInput],
    WebAffairOperationResult<WebAffair>
  >('articlePublishing:reportCheckpoint'),
  reportAsset: defineIpcCall<
    [ReportArticlePublishingAssetInput],
    WebAffairOperationResult<WebAffair>
  >('articlePublishing:reportAsset'),
} as const

export const articlePublishingIpcContracts = {
  inspectSource: bindSingle(
    articlePublishingIpc.inspectSource,
    inspectArticlePublishingSourceInputSchema,
  ),
  createTask: bindSingle(articlePublishingIpc.createTask, createArticlePublishingTaskInputSchema),
  startTask: bindSingle(articlePublishingIpc.startTask, startArticlePublishingTaskInputSchema),
  reportCheckpoint: bindSingle(
    articlePublishingIpc.reportCheckpoint,
    reportArticlePublishingCheckpointInputSchema,
  ),
  reportAsset: bindSingle(
    articlePublishingIpc.reportAsset,
    reportArticlePublishingAssetInputSchema,
  ),
}

export type { ArticlePublishingApiContract }
