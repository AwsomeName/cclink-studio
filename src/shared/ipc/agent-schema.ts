import { z } from 'zod'
import {
  boundedIdentifierSchema,
  boundedJsonValueSchema,
  boundedTextSchema,
  httpUrlSchema,
} from './input-schema'
import { workspaceRefSchema } from './workspace-ref-schema'

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

export const agentRuntimeBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claude-code') }).strict(),
  z.object({ kind: z.literal('acp'), implementationId: z.literal('codex-acp') }).strict(),
])

export const agentProfileRefSchema = z
  .object({
    profileId: boundedIdentifierSchema(),
    version: z.number().int().positive().max(1_000_000),
  })
  .strict()

export const agentRoleRefSchema = z
  .object({
    roleId: boundedIdentifierSchema(),
    version: z.number().int().positive().max(1_000_000),
  })
  .strict()

export const agentSkillRefSchema = z
  .object({
    skillId: boundedIdentifierSchema(),
    version: z.number().int().positive().max(1_000_000),
  })
  .strict()

export const agentSkillRefsSchema = z.array(agentSkillRefSchema).max(8)

export const agentRoleIconSchema = z.enum([
  'assistant',
  'challenger',
  'fact-checker',
  'product',
  'architect',
  'governance',
  'rights',
])

const agentRoleTextListSchema = z.array(boundedTextSchema(2_000).trim().min(1)).max(32)

export const agentRoleDraftSchema = z
  .object({
    label: boundedTextSchema(80).trim().min(1),
    description: boundedTextSchema(240).trim().min(1),
    icon: agentRoleIconSchema,
    goals: agentRoleTextListSchema.min(1),
    suitableFor: agentRoleTextListSchema,
    unsuitableFor: agentRoleTextListSchema,
    instructions: agentRoleTextListSchema.min(1),
    boundaries: agentRoleTextListSchema.min(1),
    examples: z
      .array(
        z
          .object({
            input: boundedTextSchema(2_000).trim().min(1),
            focus: boundedTextSchema(2_000).trim().min(1),
          })
          .strict(),
      )
      .max(16),
    soulMarkdown: boundedTextSchema(64 * 1024)
      .trim()
      .min(1)
      .optional(),
    recommendedSkillRefs: agentSkillRefsSchema,
    disclaimer: boundedTextSchema(2_000).trim().min(1).optional(),
  })
  .strict()

export const agentConversationConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    roleRef: agentRoleRefSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict()

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

const skillsSchema = agentSkillRefsSchema

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
      runtimeBinding: agentRuntimeBindingSchema.optional(),
      runId: boundedIdentifierSchema().optional(),
      resources: resourcesSchema.optional(),
      skills: skillsSchema.optional(),
      images: imagesSchema.optional(),
      sessionId: nullableAgentSessionIdSchema.optional(),
      sessionCompatibilityFingerprint:
        nullableAgentSessionCompatibilityFingerprintSchema.optional(),
      configuration: agentConversationConfigurationSchema.optional(),
      profileRef: agentProfileRefSchema.optional(),
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
    configuration: agentConversationConfigurationSchema,
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
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value), {
      message: 'MCP 名称不能使用保留原型键',
    }),
  transport: z.enum(['stdio', 'http', 'sse']),
  command: boundedTextSchema(32_768).trim().min(1).optional(),
  args: z.array(boundedTextSchema(8_192)).max(128).optional(),
  url: httpUrlSchema(2_048).optional(),
  enabled: z.boolean(),
  credentials: z
    .object({
      env: boundedStringRecordSchema.optional(),
      headers: boundedStringRecordSchema.optional(),
    })
    .strict()
    .nullable()
    .refine(
      (value) =>
        value === null ||
        Boolean(
          (value.env && Object.keys(value.env).length > 0) ||
          (value.headers && Object.keys(value.headers).length > 0),
        ),
      { message: 'MCP 凭证更新必须包含 env/header，清除请使用 null' },
    )
    .optional(),
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
