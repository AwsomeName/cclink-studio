import path from 'node:path'
import { z } from 'zod'
import {
  absolutePathSchema,
  boundedIdentifierSchema,
  boundedJsonValueSchema,
  boundedTextSchema,
  httpUrlSchema,
  optionalOwnerKeySchema,
} from './ipc-input-schema'

export const projectOpsWorkspacePathSchema = absolutePathSchema
export const projectOpsDraftSchema = z
  .object({
    platformId: boundedIdentifierSchema(128).optional(),
    title: boundedTextSchema(500).trim().min(1).optional(),
    fileName: boundedTextSchema(255).trim().min(1).optional(),
  })
  .strict()
  .optional()
export const projectOpsPublicationSchema = z
  .object({
    platformId: boundedIdentifierSchema(128),
    platformName: boundedTextSchema(512).trim().min(1).optional(),
    account: boundedTextSchema(1_024).optional(),
    contentFile: boundedTextSchema(32_768).optional(),
    url: httpUrlSchema().optional(),
    status: z.enum(['published', 'pending-review', 'failed', 'cancelled', 'draft']),
    notes: boundedTextSchema(64 * 1_024).optional(),
  })
  .strict()

export const gitBackupWorkspacePathSchema = absolutePathSchema
export const gitBackupSaveAccountSchema = z
  .object({
    username: boundedTextSchema(256),
    token: boundedTextSchema(8_192).optional(),
  })
  .strict()
export const gitBackupTestAccountSchema = z
  .object({
    username: boundedTextSchema(256).optional(),
    token: boundedTextSchema(8_192).optional(),
  })
  .strict()
  .optional()
export const gitBackupRunSchema = z
  .object({
    workspacePath: absolutePathSchema,
    repositoryInput: boundedTextSchema(2_048).trim().min(1).optional(),
  })
  .strict()

export const cadPathSchema = absolutePathSchema
export const cadConvertRequestSchema = z
  .object({
    inputPath: absolutePathSchema,
    targetFormat: z.enum(['stl', 'obj', 'glb']).optional(),
    force: z.boolean().optional(),
  })
  .strict()

export const hardwareWorkspacePathSchema = absolutePathSchema
export const hardwarePackagePathSchema = absolutePathSchema
export const hardwarePackageEntrySchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => !/[\0\r\n]/.test(value), '压缩包条目包含非法控制字符')
  .refine((value) => !path.isAbsolute(value), '压缩包条目必须是相对路径')
  .refine((value) => !value.split(/[\\/]+/).includes('..'), '压缩包条目不得包含路径穿越')

export const workspaceStateWorkspaceKeySchema = absolutePathSchema.nullable().optional()
export const workspaceStateOwnerKeySchema = optionalOwnerKeySchema
export const workspaceStateSectionSchema = z.enum([
  'layout',
  'tabs',
  'browserTabs',
  'editorDrafts',
  'fileTree',
  'search',
  'commandPalette',
  'settingsPage',
  'agentConversations',
  'projectStrip',
])
export const workspaceStateValueSchema = boundedJsonValueSchema(5 * 1024 * 1024, '工作空间状态')

export {
  messageBoxOptionsSchema,
  openDialogOptionsSchema,
  saveDialogOptionsSchema,
} from '../../shared/ipc/dialog-schema'

export const editorOperationIdSchema = boundedIdentifierSchema()
export const editorContentSchema = boundedTextSchema(5 * 1024 * 1024)
export const editorErrorSchema = boundedTextSchema(8_192).optional()
export const wechatConvertSchema = z
  .object({ markdown: boundedTextSchema(5 * 1024 * 1024) })
  .strict()
