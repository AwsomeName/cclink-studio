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
  mediaType?: string
  size?: number
  modifiedAt?: number
  occurrences: ArticlePublishingAssetOccurrence[]
  status: ArticleAssetUploadStatus
  platformUrl?: string
  verifiedAt?: string
  manualResolution?: {
    status: 'present' | 'missing'
    resolvedAt: string
  }
  uploadAttempts: ArticleAssetUploadAttempt[]
}

export interface ArticlePublishingRecoveryWritePermit {
  id: string
  recoveryOperationId: string
  executionGeneration: number
  draftId: string
  tabId: string
  browserViewRuntimeGeneration: number
  webContentsId: number
  playwrightConnectionGeneration: number
  playwrightPageBindingGeneration: number
  issuedAt: string
}

export interface ArticlePublishingDraftRecovery {
  operationId: string
  executionGeneration: number
  status: 'locating' | 'verified' | 'failed'
  expectedDraftId: string
  expectedTitle: string
  startedAt: string
  verifiedAt?: string
  platformAccountId?: string
  failureReason?: string
  writePermit?: ArticlePublishingRecoveryWritePermit
}

export interface ArticlePublishingFields {
  title: string
  summary: string
  tags: string[]
  category: string
  coverAssetId?: string
}

export interface ArticlePublishingSideEffect {
  key: string
  affairId: string
  attemptId: string
  executionGeneration: number
  kind: 'upload-asset' | 'save-draft' | 'publish'
  targetId: string
  status: 'reserved' | 'dispatched' | 'result-unknown' | 'verified' | 'rejected'
  reservedAt: string
  dispatchedAt?: string
  observedAt?: string
  browserTaskRunId?: string
}

export interface ArticlePublishingState {
  adapterId: 'csdn'
  adapterVersion: 1
  source: {
    markdownPath: string
    modifiedAt: number
    size: number
  }
  accountId: string
  websiteId: string
  fields: ArticlePublishingFields
  assets: ArticlePublishingAsset[]
  checkpoints: ArticlePublishingCheckpoint[]
  sideEffects: ArticlePublishingSideEffect[]
  execution: {
    status:
      | 'draft'
      | 'preparing'
      | 'running'
      | 'checking-runtime'
      | 'waiting-human'
      | 'interrupted'
      | 'cancelled'
      | 'failed'
      | 'published'
      | 'result-unknown'
    currentAttemptId?: string
    currentGeneration: number
    currentLaunchOperationId?: string
    currentStepId?: string
    lastAgentRunId?: string
    lastBrowserTaskRunId?: string
    runtimeCheck?: {
      reasonCode: string
      reason: string
      suspectedAt: string
      lastOwnerAt?: string
      lastProgressAt?: string
      probeDeadline: string
      ownerResponsive?: boolean
      probeAttempts: number
    }
  }
  draft?: {
    platformDraftId?: string
    platformAccountId?: string
    url?: string
    normalizedTitle?: string
    lastVerifiedAt?: string
    recovery?: ArticlePublishingDraftRecovery
  }
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
  executionGeneration: number
  launchOperationId: string
  conversationId: string
  agentRunId: string
  browserTaskRunId: string
  browserTabId: string
  agentPrompt: string
}

export interface ManageArticlePublishingRuntimeInput {
  workspaceRef: WorkspaceRef
  affairId: string
  attemptId: string
  executionGeneration: number
  launchOperationId: string
}

export interface ResolveArticlePublishingAssetInput {
  workspaceRef: WorkspaceRef
  affairId: string
  assetId: string
  resolution: 'present' | 'missing'
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
  checkRuntime(
    input: ManageArticlePublishingRuntimeInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
  continueRuntime(
    input: ManageArticlePublishingRuntimeInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
  terminateRuntime(
    input: ManageArticlePublishingRuntimeInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
  resolveAsset(
    input: ResolveArticlePublishingAssetInput,
  ): Promise<WebAffairOperationResult<WebAffair>>
}
