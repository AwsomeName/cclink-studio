import { z } from 'zod'
import { absolutePathSchema } from '../ipc/input-schema'

const uuidSchema = z.uuid()
const assetIdSchema = z.string().trim().min(1).max(16_384)
const timestampSchema = z.iso.datetime()
const workspaceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('local'), path: absolutePathSchema }).strict(),
])

export const articlePublishingResumePolicySchema = z.enum([
  'skip-if-verified',
  'reconcile-then-run',
  'manual-only',
])

export const articlePublishingCheckpointStatusSchema = z.enum([
  'pending',
  'running',
  'waiting-platform',
  'verifying',
  'completed',
  'retryable-failed',
  'result-unknown',
  'needs-reconcile',
  'waiting-human',
  'failed',
])

export const articleAssetUploadStatusSchema = z.enum([
  'pending',
  'uploading',
  'waiting-platform',
  'verifying',
  'uploaded',
  'retryable-failed',
  'result-unknown',
  'reconciling',
  'failed',
])

const errorSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict()

const evidenceSchema = z.array(z.string().trim().min(1).max(2_000)).max(40)

const articleAssetUploadAttemptSchema = z
  .object({
    number: z.number().int().min(1).max(100),
    status: z.enum([
      'uploading',
      'waiting-platform',
      'verifying',
      'retryable-failed',
      'result-unknown',
      'failed',
      'succeeded',
    ]),
    startedAt: timestampSchema,
    finishedAt: timestampSchema.optional(),
    evidence: evidenceSchema,
    error: errorSchema.optional(),
  })
  .strict()

export const articlePublishingAssetSchema = z
  .object({
    id: assetIdSchema,
    kind: z.enum(['local', 'remote']),
    sourcePath: z.string().trim().min(1).max(16_384),
    displayPath: z.string().trim().min(1).max(4_096),
    mediaType: z.string().trim().min(1).max(200).optional(),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024)
      .optional(),
    modifiedAt: z.number().finite().nonnegative().optional(),
    occurrences: z
      .array(
        z
          .object({
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
            alt: z.string().max(1_000),
          })
          .strict()
          .refine((value) => value.end >= value.start, '图片位置无效'),
      )
      .min(1)
      .max(500),
    status: articleAssetUploadStatusSchema,
    platformUrl: z.url().max(16_384).optional(),
    verifiedAt: timestampSchema.optional(),
    manualResolution: z
      .object({
        status: z.enum(['present', 'missing']),
        resolvedAt: timestampSchema,
      })
      .strict()
      .optional(),
    uploadAttempts: z.array(articleAssetUploadAttemptSchema).max(100),
  })
  .strict()

export const articlePublishingFieldsSchema = z
  .object({
    title: z.string().trim().min(1, '标题不能为空').max(160),
    summary: z.string().trim().max(1_000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    category: z.string().trim().max(120),
    coverAssetId: assetIdSchema.optional(),
  })
  .strict()

const checkpointSchema = z
  .object({
    stepId: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(160),
    adapterVersion: z.literal(1),
    status: articlePublishingCheckpointStatusSchema,
    details: z
      .array(
        z
          .object({
            id: z.string().min(1).max(240),
            nextAction: z.string().max(2000).optional(),
            recheck: z
              .object({
                status: z.enum([
                  'running',
                  'verifying',
                  'completed',
                  'waiting',
                  'failed',
                  'unknown',
                  'skipped',
                ]),
                evidence: z.string().max(4000),
                reason: z.string().max(2000).optional(),
                observedAt: timestampSchema,
                generation: z.number().int().nonnegative(),
              })
              .strict()
              .optional(),
            status: z.enum([
              'running',
              'verifying',
              'completed',
              'waiting',
              'failed',
              'unknown',
              'skipped',
            ]),
            evidence: z.string().max(4000),
            reason: z.string().max(2000).optional(),
            observedAt: timestampSchema,
            generation: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(1200)
      .optional(),
    resumePolicy: articlePublishingResumePolicySchema,
    attemptCount: z.number().int().nonnegative().max(100),
    startedAt: timestampSchema.optional(),
    finishedAt: timestampSchema.optional(),
    outputRefs: z.record(z.string(), z.string().max(16_384)).optional(),
    evidence: evidenceSchema,
    error: errorSchema.optional(),
  })
  .strict()

const sideEffectSchema = z
  .object({
    key: z.string().trim().min(1).max(500),
    affairId: uuidSchema,
    attemptId: uuidSchema,
    executionGeneration: z.number().int().positive().max(1_000_000),
    kind: z.enum(['upload-asset', 'save-draft', 'publish']),
    targetId: z.string().trim().min(1).max(500),
    status: z.enum([
      'reserved',
      'dispatched',
      'result-unknown',
      'verified',
      'rejected',
      'reconciled',
    ]),
    reservedAt: timestampSchema,
    consumedAt: timestampSchema.optional(),
    dispatchedAt: timestampSchema.optional(),
    observedAt: timestampSchema.optional(),
    browserTaskRunId: uuidSchema.optional(),
  })
  .strict()

const operationRuntimeSchema = z
  .object({
    tabId: z.string().trim().min(1).max(200),
    browserViewRuntimeGeneration: z.number().int().positive().max(1_000_000),
    webContentsId: z.number().int().positive(),
    playwrightConnectionGeneration: z.number().int().positive().max(1_000_000),
    playwrightPageBindingGeneration: z.number().int().positive().max(1_000_000),
    agentRunId: z.string().trim().min(1).max(200).optional(),
    browserTaskRunId: uuidSchema.optional(),
  })
  .strict()

const operationFailureSchema = z
  .object({
    category: z.enum([
      'studio-state',
      'studio-runtime',
      'agent-runtime',
      'platform-page',
      'human-required',
      'side-effect-unknown',
    ]),
    code: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(2_000),
    mismatches: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(200),
            expected: z.union([z.string().max(2_000), z.number().finite(), z.null()]),
            actual: z.union([z.string().max(2_000), z.number().finite(), z.null()]),
          })
          .strict(),
      )
      .max(30)
      .optional(),
  })
  .strict()

const operationDefinitionIdSchema = z.enum([
  'recovery.restore-exact-draft',
  'runtime.prepare-first-inspect',
  'page.first-inspect',
])

const currentOperationSchema = z
  .object({
    operationRunId: uuidSchema,
    revision: z.number().int().positive().max(1_000_000),
    definitionId: operationDefinitionIdSchema,
    checkpointId: z.string().trim().min(1).max(200),
    status: z.enum([
      'ready',
      'running',
      'verifying',
      'waiting-human',
      'interrupted',
      'result-unknown',
      'failed',
    ]),
    owner: z.enum(['studio', 'agent', 'adapter', 'human']),
    attemptId: uuidSchema,
    executionGeneration: z.number().int().positive().max(1_000_000),
    launchOperationId: z.string().trim().min(1).max(200),
    startSummary: z.string().trim().min(1).max(1_000),
    goalSummary: z.string().trim().min(1).max(1_000),
    startedAt: timestampSchema.optional(),
    lastTransitionAt: timestampSchema,
    runtime: operationRuntimeSchema.optional(),
    failure: operationFailureSchema.optional(),
  })
  .strict()

const operationTransitionSchema = z
  .object({
    id: uuidSchema,
    operationRunId: uuidSchema,
    kind: z.enum([
      'recovery-started',
      'draft-restored',
      'runtime-prepare-started',
      'page-identity-sampled',
      'page-identity-changed',
      'draft-reverified',
      'lease-transferred',
      'binding-committed',
      'cached-identity-replayed',
      'runtime-ready',
      'first-inspect-started',
      'first-inspect-completed',
      'operation-failed',
      'operation-interrupted',
    ]),
    occurredAt: timestampSchema,
    summary: z.string().trim().min(1).max(2_000),
    previousRuntime: operationRuntimeSchema.optional(),
    currentRuntime: operationRuntimeSchema.optional(),
    failure: operationFailureSchema.optional(),
  })
  .strict()

export const articlePublishingStateSchema = z
  .object({
    adapterId: z.literal('csdn'),
    adapterVersion: z.literal(1),
    source: z
      .object({
        markdownPath: absolutePathSchema,
        modifiedAt: z.number().finite().nonnegative(),
        size: z
          .number()
          .int()
          .nonnegative()
          .max(10 * 1024 * 1024),
      })
      .strict(),
    accountId: uuidSchema,
    websiteId: uuidSchema,
    fields: articlePublishingFieldsSchema,
    assets: z.array(articlePublishingAssetSchema).max(200),
    checkpoints: z.array(checkpointSchema).min(1).max(40),
    sideEffects: z.array(sideEffectSchema).max(500),
    executionProtocol: z
      .object({
        version: z.literal(1),
        current: currentOperationSchema.optional(),
        recentTransitions: z.array(operationTransitionSchema).max(200),
      })
      .strict(),
    execution: z
      .object({
        status: z.enum([
          'draft',
          'preparing',
          'running',
          'checking-runtime',
          'waiting-human',
          'interrupted',
          'cancelled',
          'failed',
          'published',
          'result-unknown',
        ]),
        currentAttemptId: uuidSchema.optional(),
        currentGeneration: z.number().int().nonnegative().max(1_000_000),
        currentLaunchOperationId: z.string().trim().min(1).max(200).optional(),
        currentStepId: z.string().trim().min(1).max(120).optional(),
        lastAgentRunId: z.string().trim().min(1).max(200).optional(),
        lastBrowserTaskRunId: uuidSchema.optional(),
        runtimeCheck: z
          .object({
            reasonCode: z.string().trim().min(1).max(200),
            reason: z.string().trim().min(1).max(2_000),
            suspectedAt: timestampSchema,
            lastOwnerAt: timestampSchema.optional(),
            lastProgressAt: timestampSchema.optional(),
            probeDeadline: timestampSchema,
            ownerResponsive: z.boolean().optional(),
            probeAttempts: z.number().int().nonnegative().max(100),
          })
          .strict()
          .optional(),
      })
      .strict(),
    draft: z
      .object({
        platformDraftId: z.string().trim().regex(/^\d+$/u).max(120).optional(),
        platformAccountId: z.string().trim().min(1).max(320).optional(),
        url: z.url().max(16_384).optional(),
        normalizedTitle: z.string().max(320).optional(),
        lastVerifiedAt: timestampSchema.optional(),
        recovery: z
          .object({
            operationId: z.string().trim().min(1).max(200),
            executionGeneration: z.number().int().positive().max(1_000_000),
            status: z.enum(['locating', 'verified', 'failed']),
            expectedDraftId: z.string().trim().regex(/^\d+$/u).max(120),
            expectedTitle: z.string().trim().min(1).max(320),
            startedAt: timestampSchema,
            verifiedAt: timestampSchema.optional(),
            platformAccountId: z.string().trim().min(1).max(320).optional(),
            failureReason: z.string().trim().min(1).max(2_000).optional(),
            writePermit: z
              .object({
                id: z.string().trim().min(1).max(200),
                recoveryOperationId: z.string().trim().min(1).max(200),
                executionGeneration: z.number().int().positive().max(1_000_000),
                draftId: z.string().trim().regex(/^\d+$/u).max(120),
                tabId: z.string().trim().min(1).max(200),
                browserViewRuntimeGeneration: z.number().int().positive().max(1_000_000),
                webContentsId: z.number().int().positive(),
                playwrightConnectionGeneration: z.number().int().positive().max(1_000_000),
                playwrightPageBindingGeneration: z.number().int().positive().max(1_000_000),
                issuedAt: timestampSchema,
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    publication: z
      .object({
        status: z.enum(['not-started', 'dispatched', 'verifying', 'published', 'result-unknown']),
        url: z.url().max(16_384).optional(),
        observedAt: timestampSchema.optional(),
      })
      .strict(),
  })
  .strict()

export const inspectArticlePublishingSourceInputSchema = z
  .object({ workspaceRef: workspaceRefSchema, markdownPath: absolutePathSchema })
  .strict()

export const createArticlePublishingTaskInputSchema = z
  .object({
    reviseDraftFromAffairId: uuidSchema.optional(),
    workspaceRef: workspaceRefSchema,
    markdownPath: absolutePathSchema,
    accountId: uuidSchema,
    fields: articlePublishingFieldsSchema,
  })
  .strict()

export const startArticlePublishingTaskInputSchema = z
  .object({ workspaceRef: workspaceRefSchema, affairId: uuidSchema })
  .strict()

export const manageArticlePublishingRuntimeInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    attemptId: uuidSchema,
    executionGeneration: z.number().int().positive().max(1_000_000),
    launchOperationId: z.string().trim().min(1).max(200),
  })
  .strict()

export const resolveArticlePublishingAssetInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    assetId: assetIdSchema,
    resolution: z.enum(['present', 'missing']),
  })
  .strict()

export const reportArticlePublishingCheckpointInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    attemptId: uuidSchema,
    stepId: z.string().trim().min(1).max(120),
    status: articlePublishingCheckpointStatusSchema,
    evidence: z.string().trim().min(1).max(2_000).optional(),
    error: errorSchema.optional(),
    outputRefs: z.record(z.string(), z.string().max(16_384)).optional(),
  })
  .strict()

export const reportArticlePublishingAssetInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    attemptId: uuidSchema,
    assetId: assetIdSchema,
    status: articleAssetUploadStatusSchema,
    platformUrl: z.url().max(16_384).optional(),
    evidence: z.string().trim().min(1).max(2_000).optional(),
    error: errorSchema.optional(),
  })
  .strict()
