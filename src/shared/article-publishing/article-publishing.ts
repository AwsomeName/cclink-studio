import { defineIpcCall } from '../ipc/contract'
import type { WebAffair, WebAffairOperationResult } from '../web-affairs/web-affair-types'
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

export type { ArticlePublishingApiContract }
