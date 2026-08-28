import type { WorkspaceRef } from '../workspace-ref'
import type { WebAffair, WebAffairOperationResult } from '../web-affairs/web-affair-types'

export type ArticlePublishingResumePolicy =
  | 'skip-if-verified'
  | 'reconcile-then-run'
  | 'manual-only'

export type ArticlePublishingCheckpointStatus =
  | 'pending'
  | 'running'
  | 'waiting-platform'
  | 'verifying'
  | 'completed'
  | 'retryable-failed'
  | 'result-unknown'
  | 'needs-reconcile'
  | 'waiting-human'
  | 'failed'

export interface ArticlePublishingCheckpoint {
  stepId: string
  label: string
  inputHash: string
  adapterVersion: number
  status: ArticlePublishingCheckpointStatus
  resumePolicy: ArticlePublishingResumePolicy
  attemptCount: number
  startedAt?: string
  finishedAt?: string
  outputRefs?: Record<string, string>
  evidence: string[]
  error?: { code: string; message: string }
}

export type ArticleAssetUploadStatus =
  | 'pending'
  | 'uploading'
  | 'waiting-platform'
  | 'verifying'
  | 'uploaded'
  | 'retryable-failed'
  | 'result-unknown'
  | 'reconciling'
  | 'failed'

export interface ArticleAssetUploadAttempt {
  number: number
  status: Exclude<ArticleAssetUploadStatus, 'pending' | 'uploaded' | 'reconciling'> | 'succeeded'
  startedAt: string
  finishedAt?: string
  evidence: string[]
  error?: { code: string; message: string }
}

export interface ArticlePublishingAssetOccurrence {
  start: number
  end: number
  alt: string
}

export interface ArticlePublishingAsset {
  id: string
  kind: 'local' | 'remote'
  sourcePath: string
  displayPath: string
  contentHash: string
  mediaType?: string
  size?: number
  occurrences: ArticlePublishingAssetOccurrence[]
  status: ArticleAssetUploadStatus
  platformUrl?: string
  verifiedAt?: string
  uploadAttempts: ArticleAssetUploadAttempt[]
}

export interface ArticlePublishingFields {
  title: string
  summary: string
  tags: string[]
  category: string
  coverAssetId?: string
}

export interface ArticlePublishingState {
  adapterId: 'csdn'
  adapterVersion: 1
  source: {
    markdownPath: string
    contentHash: string
    modifiedAt: number
    size: number
  }
  accountId: string
  websiteId: string
  fields: ArticlePublishingFields
  assets: ArticlePublishingAsset[]
  checkpoints: ArticlePublishingCheckpoint[]
  execution: {
    status:
      | 'draft'
      | 'running'
      | 'waiting-human'
      | 'interrupted'
      | 'failed'
      | 'published'
      | 'result-unknown'
    currentAttemptId?: string
    currentStepId?: string
    lastAgentRunId?: string
    lastBrowserTaskRunId?: string
  }
  draft?: { url?: string; lastVerifiedAt?: string }
  publication: {
    status: 'not-started' | 'dispatched' | 'verifying' | 'published' | 'result-unknown'
    url?: string
    observedAt?: string
  }
}

export interface ArticlePublishingSourcePreview {
  source: ArticlePublishingState['source']
  title: string
  summary: string
  assets: ArticlePublishingAsset[]
  blockers: string[]
  warnings: string[]
}

export interface InspectArticlePublishingSourceInput {
  workspaceRef: WorkspaceRef
  markdownPath: string
}

export interface CreateArticlePublishingTaskInput extends InspectArticlePublishingSourceInput {
  accountId: string
  fields: ArticlePublishingFields
}

export interface StartArticlePublishingTaskInput {
  workspaceRef: WorkspaceRef
  affairId: string
}

export interface StartArticlePublishingTaskResult {
  affair: WebAffair
  attemptId: string
  resumed: boolean
  agentPrompt: string
}

export interface RecoverArticlePublishingTaskLaunchInput {
  workspaceRef: WorkspaceRef
  affairId: string
  attemptId: string
  reason: string
}

export interface ReportArticlePublishingCheckpointInput {
  workspaceRef: WorkspaceRef
  affairId: string
  attemptId: string
  stepId: string
  status: ArticlePublishingCheckpointStatus
  evidence?: string
  error?: { code: string; message: string }
  outputRefs?: Record<string, string>
}

export interface ReportArticlePublishingAssetInput {
  workspaceRef: WorkspaceRef
  affairId: string
  attemptId: string
  assetId: string
  status: ArticleAssetUploadStatus
  platformUrl?: string
  evidence?: string
  error?: { code: string; message: string }
}

export interface ArticlePublishingApiContract {
  inspectSource(
    input: InspectArticlePublishingSourceInput,
  ): Promise<WebAffairOperationResult<ArticlePublishingSourcePreview>>
  createTask(input: CreateArticlePublishingTaskInput): Promise<WebAffairOperationResult<WebAffair>>
  startTask(
    input: StartArticlePublishingTaskInput,
  ): Promise<WebAffairOperationResult<StartArticlePublishingTaskResult>>
  recoverTaskLaunch(
    input: RecoverArticlePublishingTaskLaunchInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
  reportCheckpoint(
    input: ReportArticlePublishingCheckpointInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
  reportAsset(
    input: ReportArticlePublishingAssetInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
}
