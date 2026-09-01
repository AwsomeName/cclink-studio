import { z } from 'zod'
import { absolutePathSchema } from '../ipc/input-schema'

const uuidSchema = z.uuid()
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
    id: uuidSchema,
    kind: z.enum(['local', 'remote']),
    sourcePath: z.string().trim().min(1).max(16_384),
    displayPath: z.string().trim().min(1).max(4_096),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    mediaType: z.string().trim().min(1).max(200).optional(),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024)
      .optional(),
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
    platformContentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    verifiedAt: timestampSchema.optional(),
    uploadAttempts: z.array(articleAssetUploadAttemptSchema).max(100),
  })
  .strict()

export const articlePublishingFieldsSchema = z
  .object({
    title: z.string().trim().min(1, '标题不能为空').max(160),
    summary: z.string().trim().max(1_000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    category: z.string().trim().max(120),
    coverAssetId: uuidSchema.optional(),
  })
  .strict()

const checkpointSchema = z
  .object({
    stepId: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(160),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    adapterVersion: z.literal(1),
    status: articlePublishingCheckpointStatusSchema,
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
    actionFingerprint: z.string().trim().min(1).max(1_000),
    status: z.enum(['reserved', 'dispatched', 'result-unknown', 'verified', 'rejected']),
    reservedAt: timestampSchema,
    dispatchedAt: timestampSchema.optional(),
    observedAt: timestampSchema.optional(),
    browserTaskRunId: uuidSchema.optional(),
  })
  .strict()

export const articlePublishingStateSchema = z
  .object({
    adapterId: z.literal('csdn'),
    adapterVersion: z.literal(1),
    source: z
      .object({
        markdownPath: absolutePathSchema,
        contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
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
        url: z.url().max(16_384).optional(),
        normalizedTitle: z.string().max(320).optional(),
        bodyStructureHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        platformSnapshot: z
          .object({
            adapterId: z.literal('csdn'),
            adapterVersion: z.literal(1),
            platformAccountId: z.string().trim().min(1).max(320),
            draftId: z.string().trim().regex(/^\d+$/u).max(120),
            normalizedTitle: z.string().max(320),
            bodyStructureHash: z.string().regex(/^[a-f0-9]{64}$/u),
            images: z
              .array(
                z
                  .object({
                    url: z.url().max(16_384),
                    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
                    alt: z.string().max(1_000),
                  })
                  .strict(),
              )
              .max(24),
            imageEnumerationComplete: z.literal(true),
            saveState: z.literal('saved'),
            snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
            evidenceHash: z.string().regex(/^[a-f0-9]{64}$/u),
            observedAt: timestampSchema,
          })
          .strict()
          .optional(),
        lastVerifiedAt: timestampSchema.optional(),
        recovery: z
          .object({
            operationId: z.string().trim().min(1).max(200),
            executionGeneration: z.number().int().positive().max(1_000_000),
            status: z.enum(['locating', 'verified', 'failed']),
            expectedDraftId: z.string().trim().regex(/^\d+$/u).max(120),
            startedAt: timestampSchema,
            verifiedAt: timestampSchema.optional(),
            evidenceHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/u)
              .optional(),
            platformAccountId: z.string().trim().min(1).max(320).optional(),
            snapshotHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/u)
              .optional(),
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
                snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
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
    assetId: uuidSchema,
    status: articleAssetUploadStatusSchema,
    platformUrl: z.url().max(16_384).optional(),
    evidence: z.string().trim().min(1).max(2_000).optional(),
    error: errorSchema.optional(),
  })
  .strict()
