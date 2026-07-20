import { z } from 'zod'

const identifierSchema = z.string().trim().min(1).max(256)
const collectionSchema = z.string().trim().min(1).max(1_024)
const boundedSecretSchema = z.string().max(8_192).optional()

const jsonPayloadSchema = z.unknown().superRefine((value, context) => {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > 100_000 || current.depth > 64) {
      context.addIssue({ code: 'custom', message: '查询 JSON 结构过于复杂' })
      return
    }
    if (
      current.value === null ||
      typeof current.value === 'string' ||
      typeof current.value === 'boolean'
    ) {
      continue
    }
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) {
        context.addIssue({ code: 'custom', message: '查询 JSON 包含非有限数字' })
        return
      }
      continue
    }
    if (Array.isArray(current.value)) {
      for (const entry of current.value) pending.push({ value: entry, depth: current.depth + 1 })
      continue
    }
    if (typeof current.value === 'object') {
      const prototype = Object.getPrototypeOf(current.value)
      if (prototype !== Object.prototype && prototype !== null) {
        context.addIssue({ code: 'custom', message: '查询必须只包含普通 JSON 对象' })
        return
      }
      for (const [key, entry] of Object.entries(current.value)) {
        if (key.length > 1_024) {
          context.addIssue({ code: 'custom', message: '查询 JSON 字段名过长' })
          return
        }
        pending.push({ value: entry, depth: current.depth + 1 })
      }
      continue
    }
    context.addIssue({ code: 'custom', message: '查询必须是标准 JSON 值' })
    return
  }

  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      context.addIssue({ code: 'custom', message: '查询必须是可序列化 JSON' })
    } else if (Buffer.byteLength(serialized, 'utf8') > 1_048_576) {
      context.addIssue({ code: 'custom', message: '查询 JSON 不得超过 1 MiB' })
    }
  } catch {
    context.addIssue({ code: 'custom', message: '查询必须是可序列化 JSON' })
  }
})

const endpointSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), '仅允许 HTTP(S) 数据源')
  .refine((value) => {
    const url = new URL(value)
    return !url.username && !url.password
  }, 'Endpoint URL 不得包含明文凭证')

const secretSchema = z
  .object({
    authType: z.enum(['apiKey', 'basic', 'bearer', 'none']),
    username: boundedSecretSchema,
    password: boundedSecretSchema,
    apiKey: boundedSecretSchema,
    token: boundedSecretSchema,
  })
  .strict()

const mappingPathsSchema = z.array(z.string().min(1).max(256)).max(64).optional()
const fieldMappingSchema = z
  .object({
    title: mappingPathsSchema,
    content: mappingPathsSchema,
    sourceUrl: mappingPathsSchema,
    author: mappingPathsSchema,
    publishedAt: mappingPathsSchema,
    collectedAt: mappingPathsSchema,
    updatedAt: mappingPathsSchema,
    tags: mappingPathsSchema,
  })
  .strict()
  .optional()

const timeoutSchema = z.number().int().min(100).max(120_000).optional()
const maxRowsSchema = z.number().int().min(1).max(10_000).optional()

export const dataSourceIdSchema = identifierSchema
export const optionalDataSourceIdSchema = identifierSchema.optional()

export const createSourceSchema = z
  .object({
    type: z.literal('elasticsearch'),
    scope: z.enum(['workspace', 'global']).optional(),
    name: z.string().trim().min(1).max(256),
    endpoint: endpointSchema,
    defaultCollection: z.string().max(1_024).optional(),
    timeoutMs: timeoutSchema,
    maxRows: maxRowsSchema,
    fieldMapping: fieldMappingSchema,
    secret: secretSchema.optional(),
  })
  .strict()

export const runQuerySchema = z
  .object({
    sourceId: identifierSchema,
    collection: z.string().max(1_024).optional(),
    query: jsonPayloadSchema,
    maxRows: maxRowsSchema,
    includeRaw: z.boolean().optional(),
    caller: z.string().max(256).optional(),
  })
  .strict()

export const saveQuerySchema = z
  .object({
    id: identifierSchema.optional(),
    sourceId: identifierSchema,
    name: z.string().trim().min(1).max(256),
    collection: collectionSchema,
    query: jsonPayloadSchema,
    fieldMapping: fieldMappingSchema,
    maxRows: maxRowsSchema,
  })
  .strict()
