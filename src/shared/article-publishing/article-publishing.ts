import { defineIpcCall } from '../ipc/contract'
import type { WebAffair, WebAffairOperationResult } from '../web-affairs/web-affair-types'
import type {
  ReduceArticlePublishingTagsInput,
  ArticlePublishingApiContract,
  ArticlePublishingSourcePreview,
  CreateArticlePublishingTaskInput,
  InspectArticlePublishingSourceInput,
  ManageArticlePublishingRuntimeInput,
  ResolveArticlePublishingAssetInput,
  StartArticlePublishingTaskInput,
  StartArticlePublishingTaskResult,
} from './article-publishing-types'

export const articlePublishingIpc = {
  reduceTags: defineIpcCall<
    [ReduceArticlePublishingTagsInput],
    WebAffairOperationResult<WebAffair>
  >('articlePublishing:reduceTags'),
  verifyPublishedResult: defineIpcCall<
    [ManageArticlePublishingRuntimeInput],
    WebAffairOperationResult<WebAffair>
  >('articlePublishing:verifyPublishedResult'),
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
  checkRuntime: defineIpcCall<
    [ManageArticlePublishingRuntimeInput],
    WebAffairOperationResult<WebAffair>
  >('articlePublishing:checkRuntime'),
  continueRuntime: defineIpcCall<
    [ManageArticlePublishingRuntimeInput],
    WebAffairOperationResult<WebAffair>
  >('articlePublishing:continueRuntime'),
  terminateRuntime: defineIpcCall<
    [ManageArticlePublishingRuntimeInput],
    WebAffairOperationResult<WebAffair>
  >('articlePublishing:terminateRuntime'),
  resolveAsset: defineIpcCall<
    [ResolveArticlePublishingAssetInput],
    WebAffairOperationResult<WebAffair>
  >('articlePublishing:resolveAsset'),
} as const

export type { ArticlePublishingApiContract }
