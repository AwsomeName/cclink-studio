import { z } from 'zod'
import { absolutePathSchema } from '../ipc/input-schema'

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

const workspaceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('local'), path: absolutePathSchema }).strict(),
])

export const createWebAffairInputSchema = z
  .object({
    title: trimmedText(160, '事务名称'),
    objective: trimmedText(4_000, '事务目标'),
    principalId: uuidSchema,
    accountIds: z
      .array(uuidSchema)
      .max(32)
      .transform((items) => [...new Set(items)]),
    materialPaths: z
      .array(absolutePathSchema)
      .max(64)
      .transform((items) => [...new Set(items)]),
    nodeTitles: z
      .array(trimmedText(240, '流程节点'))
      .min(1)
      .max(40)
      .transform((items) => items.map((item) => item.trim())),
    workspaceRef: workspaceRefSchema.optional(),
  })
  .strict()

export const updateWebAffairNodeInputSchema = z
  .object({
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

const webAffairMaterialSchema = z
  .object({
    id: uuidSchema,
    path: absolutePathSchema,
    name: trimmedText(512, '材料名称'),
    addedAt: timestampSchema,
  })
  .strict()

const webAffairNodeSchema = z
  .object({
    id: uuidSchema,
    type: z.literal('web-task'),
    title: trimmedText(240, '流程节点'),
    status: webAffairNodeStatusSchema,
    executor: z.enum(['ai', 'user', 'external']),
    accountIds: z.array(uuidSchema).max(32),
    materialIds: z.array(uuidSchema).max(64),
    successCriteria: z.array(trimmedText(500, '成功判据')).max(20),
    availableTransitions: z.array(webAffairNodeStatusSchema).max(10),
    lastResultNote: optionalTrimmedText(2_000, '结果说明'),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

const webAffairEdgeSchema = z
  .object({
    id: uuidSchema,
    fromNodeId: uuidSchema,
    toNodeId: uuidSchema,
  })
  .strict()

const webAffairEventSchema = z
  .object({
    id: uuidSchema,
    type: z.enum(['created', 'node-status-changed']),
    nodeId: uuidSchema.optional(),
    summary: trimmedText(2_400, '事务事件'),
    occurredAt: timestampSchema,
  })
  .strict()

const webAffairSchema = z
  .object({
    id: uuidSchema,
    title: trimmedText(160, '事务名称'),
    objective: trimmedText(4_000, '事务目标'),
    status: webAffairStatusSchema,
    principalId: uuidSchema,
    websiteIds: z.array(uuidSchema).max(64),
    accountIds: z.array(uuidSchema).max(32),
    materials: z.array(webAffairMaterialSchema).max(64),
    flow: z
      .object({
        version: z.literal(1),
        nodes: z.array(webAffairNodeSchema).min(1).max(40),
        edges: z.array(webAffairEdgeSchema).max(160),
      })
      .strict(),
    events: z.array(webAffairEventSchema).max(2_000),
    workspaceRef: workspaceRefSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export const webAffairSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
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
  return webAffairSnapshotSchema.parse(value)
}
