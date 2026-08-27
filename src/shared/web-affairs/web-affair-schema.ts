import { z } from 'zod'
import { absolutePathSchema } from '../ipc/input-schema'
import { articlePublishingStateSchema } from '../article-publishing/article-publishing-schema'

const trimmedText = (maxLength: number, label: string): z.ZodString =>
  z.string().trim().min(1, `${label}不能为空`).max(maxLength, `${label}过长`)

const optionalTrimmedText = (maxLength: number, label: string) =>
  z
    .string()
    .trim()
    .max(maxLength, `${label}过长`)
    .optional()
    .transform((value) => value || undefined)

const timestampSchema = z.iso.datetime()
const uuidSchema = z.uuid()
const positiveVersionSchema = z.number().int().positive().max(1_000_000)

export const webAffairStatusSchema = z.enum([
  'draft',
  'active',
  'needs-attention',
  'waiting-external',
  'paused',
  'completed',
  'failed',
  'cancelled',
])

export const webAffairNodeStatusSchema = z.enum([
  'blocked',
  'ready',
  'running',
  'waiting-human',
  'waiting-external',
  'verifying',
  'completed',
  'failed',
  'skipped',
  'cancelled',
])

const webAffairNodeTypeSchema = z.enum(['web-task', 'human-task', 'wait-external', 'verification'])
const webAffairNodeExecutorSchema = z.enum(['ai', 'user', 'external'])

const workspaceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('local'), path: absolutePathSchema }).strict(),
])

export const webAffairWorkspaceScopeInputSchema = z
  .object({ workspaceRef: workspaceRefSchema })
  .strict()

export const claimLegacyWebAffairInputSchema = z
  .object({ workspaceRef: workspaceRefSchema, affairId: uuidSchema })
  .strict()

const templateRefSchema = z
  .object({ templateId: trimmedText(120, '模板 ID'), version: positiveVersionSchema })
  .strict()

export const createWebAffairInputSchema = z
  .object({
    title: trimmedText(160, '事务名称'),
    objective: trimmedText(4_000, '事务目标'),
    principalId: uuidSchema,
    accountIds: z
      .array(uuidSchema)
      .max(200)
      .transform((items) => [...new Set(items)]),
    accountGroupIds: z
      .array(uuidSchema)
      .max(32)
      .transform((items) => [...new Set(items)])
      .optional(),
    materialPaths: z
      .array(absolutePathSchema)
      .max(64)
      .transform((items) => [...new Set(items)]),
    nodeTitles: z
      .array(trimmedText(240, '流程节点'))
      .min(1)
      .max(40)
      .transform((items) => items.map((item) => item.trim())),
    workspaceRef: workspaceRefSchema,
    templateRef: templateRefSchema.optional(),
  })
  .strict()

export const updateWebAffairNodeInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    nodeId: uuidSchema,
    status: webAffairNodeStatusSchema,
    resultNote: optionalTrimmedText(2_000, '结果说明'),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === 'completed' && !input.resultNote) {
      context.addIssue({
        code: 'custom',
        path: ['resultNote'],
        message: '标记完成时必须填写结果说明',
      })
    }
  })

const reviseFlowNodeInputSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    title: trimmedText(240, '节点名称'),
    description: optionalTrimmedText(2_000, '节点说明'),
    type: webAffairNodeTypeSchema,
    executor: webAffairNodeExecutorSchema,
    accountIds: z.array(uuidSchema).max(200),
    materialIds: z.array(uuidSchema).max(64),
    successCriteria: z.array(trimmedText(500, '成功判据')).min(1).max(20),
  })
  .strict()

export const reviseWebAffairFlowInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    expectedVersion: positiveVersionSchema,
    nodes: z.array(reviseFlowNodeInputSchema).min(1).max(40),
    edges: z
      .array(z.object({ fromNodeId: z.string().min(1), toNodeId: z.string().min(1) }).strict())
      .max(160),
  })
  .strict()

export const inspectWebAffairMaterialsInputSchema = z
  .object({ workspaceRef: workspaceRefSchema, affairId: uuidSchema })
  .strict()

export const startWebAffairAttemptInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    nodeId: uuidSchema,
    accountId: uuidSchema,
  })
  .strict()

export const bindWebAffairAttemptInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    attemptId: uuidSchema,
    tabId: trimmedText(200, '浏览器 Tab ID'),
    conversationId: trimmedText(200, 'Agent 会话 ID'),
    agentRunId: trimmedText(200, 'Agent Run ID'),
    browserTaskRunId: uuidSchema,
  })
  .strict()

export const handoffWebAffairAttemptInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    attemptId: uuidSchema,
    reason: trimmedText(1_000, '接管原因'),
  })
  .strict()

export const returnWebAffairAttemptInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    attemptId: uuidSchema,
    observationSummary: trimmedText(2_000, '重新观察结果'),
    url: z.url().max(4_096),
  })
  .strict()

export const confirmWebAffairFinalActionInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    attemptId: uuidSchema,
    summary: trimmedText(2_000, '确认摘要'),
  })
  .strict()

export const finishWebAffairAttemptInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    attemptId: uuidSchema,
    outcome: z.enum(['succeeded', 'failed', 'cancelled', 'interrupted']),
    summary: trimmedText(2_000, '办理结果'),
    url: z.url().max(4_096).optional(),
    evidenceKind: z
      .enum(['observation', 'user-note', 'page-result', 'receipt', 'official-response'])
      .optional(),
  })
  .strict()

export const scheduleWebAffairCheckInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    nodeId: uuidSchema,
    nextCheckAt: timestampSchema,
    intervalMinutes: z.number().int().min(1).max(43_200),
    maxIntervalMinutes: z.number().int().min(1).max(43_200),
    maxChecks: z.number().int().min(1).max(1_000),
  })
  .strict()
  .refine((input) => input.maxIntervalMinutes >= input.intervalMinutes, {
    message: '最大检查间隔不能小于初始检查间隔',
    path: ['maxIntervalMinutes'],
  })

export const completeWebAffairCheckInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    nodeId: uuidSchema,
    outcome: z.enum(['unchanged', 'approved', 'rejected']),
    summary: trimmedText(2_000, '检查结果'),
    url: z.url().max(4_096).optional(),
  })
  .strict()

const flowDiffOperationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('add-node'),
      tempId: trimmedText(120, '临时节点 ID'),
      title: trimmedText(240, '节点名称'),
      nodeType: webAffairNodeTypeSchema,
      executor: webAffairNodeExecutorSchema,
      catalogId: optionalTrimmedText(120, '目录 ID'),
      description: optionalTrimmedText(2_000, '节点说明'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('update-node'),
      nodeId: uuidSchema,
      title: trimmedText(240, '节点名称').optional(),
      description: optionalTrimmedText(2_000, '节点说明'),
      executor: webAffairNodeExecutorSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('remove-node'), nodeId: uuidSchema }).strict(),
  z
    .object({
      kind: z.literal('add-edge'),
      fromNodeId: z.string().min(1),
      toNodeId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal('remove-edge'), edgeId: uuidSchema }).strict(),
])

export const proposeWebAffairFlowDiffInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    baseVersion: positiveVersionSchema,
    reason: trimmedText(2_000, '变更原因'),
    operations: z.array(flowDiffOperationSchema).min(1).max(80),
    impacts: z.array(trimmedText(500, '变更影响')).max(20),
    proposedBy: z.enum(['ai', 'user']),
  })
  .strict()

export const decideWebAffairFlowProposalInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    affairId: uuidSchema,
    proposalId: uuidSchema,
    decision: z.enum(['accept', 'reject']),
  })
  .strict()

const webAffairMaterialSchema = z
  .object({
    id: uuidSchema,
    path: absolutePathSchema,
    name: trimmedText(512, '材料名称'),
    state: z.enum(['available', 'missing', 'changed', 'unchecked']),
    size: z.number().int().nonnegative().optional(),
    modifiedAt: timestampSchema.optional(),
    checkedAt: timestampSchema.optional(),
    addedAt: timestampSchema,
  })
  .strict()

const webAffairNodeSchema = z
  .object({
    id: uuidSchema,
    type: webAffairNodeTypeSchema,
    catalogId: optionalTrimmedText(120, '目录 ID'),
    title: trimmedText(240, '流程节点'),
    description: optionalTrimmedText(2_000, '节点说明'),
    status: webAffairNodeStatusSchema,
    executor: webAffairNodeExecutorSchema,
    accountIds: z.array(uuidSchema).max(200),
    materialIds: z.array(uuidSchema).max(64),
    successCriteria: z.array(trimmedText(500, '成功判据')).max(20),
    availableTransitions: z.array(webAffairNodeStatusSchema).max(10),
    lastResultNote: optionalTrimmedText(2_000, '结果说明'),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

const webAffairEdgeSchema = z
  .object({ id: uuidSchema, fromNodeId: uuidSchema, toNodeId: uuidSchema })
  .strict()

const webAffairEvidenceSchema = z
  .object({
    id: uuidSchema,
    kind: z.enum(['observation', 'user-note', 'page-result', 'receipt', 'official-response']),
    source: z.enum(['browser', 'user', 'system', 'external']),
    summary: trimmedText(2_000, '证据摘要'),
    observedAt: timestampSchema,
    url: z.url().max(4_096).optional(),
    attemptId: uuidSchema.optional(),
    browserTaskRunId: uuidSchema.optional(),
    agentRunId: trimmedText(200, 'Agent Run ID').optional(),
  })
  .strict()

const webAffairAttemptSchema = z
  .object({
    id: uuidSchema,
    nodeId: uuidSchema,
    number: z.number().int().positive(),
    status: z.enum([
      'preparing',
      'running-ai',
      'waiting-human',
      'waiting-external',
      'verifying',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
    ]),
    profileId: trimmedText(200, 'Profile ID'),
    accountId: uuidSchema,
    entryUrl: z.url().max(4_096),
    tabId: trimmedText(200, '浏览器 Tab ID').optional(),
    conversationId: trimmedText(200, 'Agent 会话 ID').optional(),
    agentRunId: trimmedText(200, 'Agent Run ID').optional(),
    browserTaskRunId: uuidSchema.optional(),
    sideEffectKey: trimmedText(500, '副作用 Key'),
    finalActionConfirmedAt: timestampSchema.optional(),
    finalActionSummary: optionalTrimmedText(2_000, '最终操作摘要'),
    handoffReason: optionalTrimmedText(1_000, '接管原因'),
    handedOffAt: timestampSchema.optional(),
    returnedAt: timestampSchema.optional(),
    reobservedAt: timestampSchema.optional(),
    failureMessage: optionalTrimmedText(2_000, '失败信息'),
    evidence: z.array(webAffairEvidenceSchema).max(200),
    startedAt: timestampSchema,
    endedAt: timestampSchema.optional(),
  })
  .strict()

const webAffairWaitPlanSchema = z
  .object({
    nodeId: uuidSchema,
    status: z.enum(['scheduled', 'due', 'missed', 'exhausted', 'cancelled']),
    nextCheckAt: timestampSchema,
    intervalMinutes: z.number().int().min(1).max(43_200),
    maxIntervalMinutes: z.number().int().min(1).max(43_200),
    checkCount: z.number().int().nonnegative(),
    maxChecks: z.number().int().positive().max(1_000),
    lastCheckedAt: timestampSchema.optional(),
    lastOutcome: optionalTrimmedText(2_000, '最近检查结果'),
  })
  .strict()

const webAffairFlowProposalSchema = z
  .object({
    id: uuidSchema,
    baseVersion: positiveVersionSchema,
    status: z.enum(['pending', 'accepted', 'rejected', 'superseded']),
    reason: trimmedText(2_000, '变更原因'),
    operations: z.array(flowDiffOperationSchema).min(1).max(80),
    impacts: z.array(trimmedText(500, '变更影响')).max(20),
    requiresConfirmation: z.boolean(),
    proposedBy: z.enum(['ai', 'user', 'system']),
    createdAt: timestampSchema,
    decidedAt: timestampSchema.optional(),
  })
  .strict()

const webAffairEventSchema = z
  .object({
    id: uuidSchema,
    type: z.enum([
      'created',
      'node-status-changed',
      'flow-revised',
      'material-checked',
      'attempt-started',
      'attempt-handoff',
      'attempt-returned',
      'attempt-finished',
      'final-action-confirmed',
      'wait-scheduled',
      'wait-due',
      'flow-proposed',
      'flow-proposal-decided',
      'workspace-assigned',
    ]),
    nodeId: uuidSchema.optional(),
    attemptId: uuidSchema.optional(),
    summary: trimmedText(2_400, '事务事件'),
    occurredAt: timestampSchema,
  })
  .strict()

const webAffairSchema = z
  .object({
    id: uuidSchema,
    kind: z.enum(['generic', 'article-publishing']),
    workspaceId: uuidSchema.nullable(),
    title: trimmedText(160, '事务名称'),
    objective: trimmedText(4_000, '事务目标'),
    status: webAffairStatusSchema,
    principalId: uuidSchema,
    websiteIds: z.array(uuidSchema).max(64),
    accountIds: z.array(uuidSchema).max(200),
    accountGroupBindings: z
      .array(
        z
          .object({
            groupId: uuidSchema,
            groupRevision: positiveVersionSchema,
            accountIds: z.array(uuidSchema).min(1).max(200),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    materials: z.array(webAffairMaterialSchema).max(64),
    flow: z
      .object({
        version: positiveVersionSchema,
        nodes: z.array(webAffairNodeSchema).min(1).max(40),
        edges: z.array(webAffairEdgeSchema).max(160),
      })
      .strict(),
    attempts: z.array(webAffairAttemptSchema).max(2_000),
    waitPlans: z.array(webAffairWaitPlanSchema).max(40),
    flowProposals: z.array(webAffairFlowProposalSchema).max(500),
    templateRef: templateRefSchema.optional(),
    articlePublishing: articlePublishingStateSchema.optional(),
    events: z.array(webAffairEventSchema).max(2_000),
    workspaceRef: workspaceRefSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'article-publishing' && !value.articlePublishing) {
      context.addIssue({
        code: 'custom',
        path: ['articlePublishing'],
        message: '文章发布事务缺少领域状态',
      })
    }
    if (value.kind === 'generic' && value.articlePublishing) {
      context.addIssue({
        code: 'custom',
        path: ['articlePublishing'],
        message: '通用事务不能保存文章发布领域状态',
      })
    }
  })

export const webAffairSnapshotSchema = z
  .object({
    schemaVersion: z.literal(4),
    revision: z.number().int().nonnegative(),
    affairs: z.array(webAffairSchema).max(1_000),
  })
  .strict()

export function parseCreateWebAffairInput(value: unknown) {
  return createWebAffairInputSchema.parse(value)
}

export function parseUpdateWebAffairNodeInput(value: unknown) {
  return updateWebAffairNodeInputSchema.parse(value)
}

export function parseWebAffairSnapshot(value: unknown) {
  return webAffairSnapshotSchema.parse(migrateSnapshot(value))
}

function migrateSnapshot(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const snapshot = structuredClone(value) as Record<string, unknown>
  if (snapshot['schemaVersion'] === 3) {
    const affairs = Array.isArray(snapshot['affairs']) ? snapshot['affairs'] : []
    for (const item of affairs) {
      if (!item || typeof item !== 'object') continue
      const affair = item as Record<string, unknown>
      affair['kind'] = 'generic'
    }
    snapshot['schemaVersion'] = 4
    return snapshot
  }
  if (snapshot['schemaVersion'] === 2) {
    const affairs = Array.isArray(snapshot['affairs']) ? snapshot['affairs'] : []
    for (const item of affairs) {
      if (!item || typeof item !== 'object') continue
      const affair = item as Record<string, unknown>
      affair['workspaceId'] = null
      affair['workspaceRef'] ??= { kind: 'global' }
    }
    snapshot['schemaVersion'] = 3
    return migrateSnapshot(snapshot)
  }
  if (snapshot['schemaVersion'] !== 1) return snapshot
  const affairs = Array.isArray(snapshot['affairs']) ? snapshot['affairs'] : []
  for (const item of affairs) {
    if (!item || typeof item !== 'object') continue
    const affair = item as Record<string, unknown>
    affair['attempts'] = []
    affair['waitPlans'] = []
    affair['flowProposals'] = []
    const materials = Array.isArray(affair['materials']) ? affair['materials'] : []
    for (const itemMaterial of materials) {
      if (itemMaterial && typeof itemMaterial === 'object') {
        ;(itemMaterial as Record<string, unknown>)['state'] = 'unchecked'
      }
    }
  }
  snapshot['schemaVersion'] = 2
  return migrateSnapshot(snapshot)
}
