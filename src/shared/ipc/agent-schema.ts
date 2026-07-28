import { z } from 'zod'
import {
  absolutePathSchema,
  boundedIdentifierSchema,
  boundedJsonValueSchema,
  boundedTextSchema,
  httpUrlSchema,
} from './input-schema'

const MAX_MESSAGE_LENGTH = 1024 * 1024
const MAX_RESOURCE_PAYLOAD_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4
const MAX_IMAGE_PAYLOAD_BYTES = 26 * 1024 * 1024

export const agentConversationIdSchema = boundedIdentifierSchema()
export const optionalAgentConversationIdSchema = agentConversationIdSchema.optional()
export const nullableAgentSessionIdSchema = boundedIdentifierSchema().nullable()
export const nullableAgentSessionCompatibilityFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable()

const workspaceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('local'), path: absolutePathSchema }).strict(),
])

const continuitySchema = z
  .object({
    recentMessages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant', 'system']),
            text: boundedTextSchema(1_200).trim().min(1),
          })
          .strict(),
      )
      .max(10),
    tasks: z
      .array(
        z
          .object({
            content: boundedTextSchema(300).trim().min(1),
            status: z.enum(['pending', 'in_progress', 'completed']),
          })
          .strict(),
      )
      .max(12),
  })
  .strict()

const resourceRefSchema = z
  .object({
    type: z.enum([
      'file',
      'image',
      'file-range',
      'folder',
      'tab',
      'browser',
      'android',
      'terminal',
      'artifact',
      'project',
      'data-source',
      'saved-query',
      'data-query',
      'data-record',
    ]),
    path: boundedTextSchema(32_768).optional(),
    tabId: boundedIdentifierSchema().optional(),
    workspaceKey: boundedTextSchema(32_768).nullable().optional(),
    sourceId: boundedIdentifierSchema().optional(),
    collection: boundedTextSchema(1_024).optional(),
    savedQueryId: boundedIdentifierSchema().optional(),
    queryId: boundedIdentifierSchema().optional(),
    recordId: boundedIdentifierSchema().optional(),
    sourceUrl: httpUrlSchema().optional(),
    publishedAt: boundedTextSchema(128).optional(),
    collectedAt: boundedTextSchema(128).optional(),
    executedAt: boundedTextSchema(128).optional(),
    total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    returned: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    truncated: z.boolean().optional(),
    format: z.literal('markdown').optional(),
    startLine: z.number().int().min(0).max(10_000_000).optional(),
    endLine: z.number().int().min(0).max(10_000_000).optional(),
    startColumn: z.number().int().min(0).max(10_000_000).optional(),
    endColumn: z.number().int().min(0).max(10_000_000).optional(),
    selectedText: boundedTextSchema(MAX_MESSAGE_LENGTH).optional(),
    sourceSnapshot: boundedTextSchema(MAX_MESSAGE_LENGTH).optional(),
    snapshotHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    dirty: z.boolean().optional(),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']).optional(),
    size: z.number().int().positive().max(MAX_IMAGE_BYTES).optional(),
  })
  .strict()

const resourcesSchema = z
  .array(
    z
      .object({
        id: boundedIdentifierSchema(),
        kind: resourceRefSchema.shape.type,
        label: boundedTextSchema(512).trim().min(1),
        detail: boundedTextSchema(4_096).optional(),
        ref: resourceRefSchema,
      })
      .strict(),
  )
  .max(100)
  .and(boundedJsonValueSchema(MAX_RESOURCE_PAYLOAD_BYTES, 'Agent 资源'))

const skillsSchema = z
  .array(
    z
      .object({
        id: boundedIdentifierSchema(),
        name: boundedIdentifierSchema(),
        label: boundedTextSchema(512).trim().min(1),
        description: boundedTextSchema(4_096).optional(),
        source: z.enum(['builtin', 'user', 'workspace']).optional(),
      })
      .strict(),
  )
  .max(50)

const imagesSchema = z
  .array(
    z
      .object({
        id: boundedIdentifierSchema(),
        name: boundedTextSchema(512).trim().min(1),
        mediaType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
        data: z
          .string()
          .min(1)
          .max(MAX_IMAGE_BASE64_LENGTH)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, '图片数据不是有效 Base64'),
        size: z.number().int().positive().max(MAX_IMAGE_BYTES),
      })
      .strict(),
  )
  .max(5)
  .and(boundedJsonValueSchema(MAX_IMAGE_PAYLOAD_BYTES, 'Agent 图片附件'))

export const agentSendMessageInputSchema = z.union([
  boundedTextSchema(MAX_MESSAGE_LENGTH).trim().min(1),
  z
    .object({
      message: boundedTextSchema(MAX_MESSAGE_LENGTH).trim().min(1),
      runId: boundedIdentifierSchema().optional(),
      resources: resourcesSchema.optional(),
      skills: skillsSchema.optional(),
      images: imagesSchema.optional(),
      sessionId: nullableAgentSessionIdSchema.optional(),
      sessionCompatibilityFingerprint:
        nullableAgentSessionCompatibilityFingerprintSchema.optional(),
      workspaceRef: workspaceRefSchema.optional(),
      continuity: continuitySchema.optional(),
    })
    .strict(),
])

export const agentCompactPayloadSchema = z
  .object({
    runId: boundedIdentifierSchema().optional(),
    sessionId: boundedIdentifierSchema(),
    sessionCompatibilityFingerprint: nullableAgentSessionCompatibilityFingerprintSchema.optional(),
    workspaceRef: workspaceRefSchema.optional(),
    instructions: boundedTextSchema(1_000).trim().min(1).optional(),
  })
  .strict()

export const agentScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('android') }).strict(),
  z.object({ kind: z.literal('editor') }).strict(),
  z.object({ kind: z.literal('browser'), instanceId: boundedIdentifierSchema() }).strict(),
])

export const agentToolModuleIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/)
export const agentConfirmationIdSchema = boundedIdentifierSchema()
export const agentPermissionModeSchema = z.enum(['auto', 'categorized', 'strict'])

const boundedStringRecordSchema = z
  .record(boundedIdentifierSchema(256), boundedTextSchema(8_192))
  .superRefine((value, context) => {
    if (Object.keys(value).length > 128) {
      context.addIssue({ code: 'custom', message: 'MCP 配置字段过多' })
    }
  })

const mcpServerFields = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  transport: z.enum(['stdio', 'http', 'sse']),
  command: boundedTextSchema(32_768).trim().min(1).optional(),
  args: z.array(boundedTextSchema(8_192)).max(128).optional(),
  env: boundedStringRecordSchema.optional(),
  url: httpUrlSchema(2_048).optional(),
  headers: boundedStringRecordSchema.optional(),
  enabled: z.boolean(),
}

export const mcpServerSchema = z
  .object(mcpServerFields)
  .strict()
  .superRefine((value, context) => {
    if (value.transport === 'stdio' && !value.command) {
      context.addIssue({ code: 'custom', path: ['command'], message: 'stdio MCP 必须配置命令' })
    }
    if (value.transport !== 'stdio' && !value.url) {
      context.addIssue({ code: 'custom', path: ['url'], message: '远程 MCP 必须配置 URL' })
    }
  })

export const mcpServerNameSchema = mcpServerFields.name
export const mcpServerUpdatesSchema = z.object(mcpServerFields).strict().partial()
