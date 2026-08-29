import path from 'node:path'
import { z, ZodError } from 'zod'
import {
  bindIpcParser,
  ipcArgs,
  type IpcInvokeContract,
  type IpcInvokeDefinition,
} from './contract'
import {
  absolutePathSchema,
  boundedIdentifierSchema,
  boundedJsonValueSchema,
  boundedTextSchema,
  httpUrlSchema,
  optionalOwnerKeySchema,
} from './input-schema'
import { cadIpc } from './cad'
import { editorIpc } from './editor'
import { gitBackupIpc } from './git-backup'
import { hardwareIpc } from './hardware'
import { projectOpsIpc } from './project-ops'
import { wechatIpc, type WechatConvertResult } from './wechat'
import {
  workspaceStateIpc,
  type ActiveLocalWorkspaceResult,
  type WorkspaceStateSetSectionResult,
} from './workspace-state'

function bindLegacyNoArgs<Result>(
  definition: IpcInvokeDefinition<[], Result>,
): IpcInvokeContract<[], Result> {
  return bindIpcParser(definition, () => ipcArgs())
}

function rejectAsync<Result>(error: unknown): Promise<Result> {
  return Promise.reject(error)
}

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

const remoteWorkspaceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .regex(/^cclink:\/\/[^/\s]+\/[^/\s]+$/u, '远程工作空间键无效')
export const workspaceStateWorkspaceKeySchema = z
  .union([absolutePathSchema, remoteWorkspaceKeySchema])
  .nullable()
  .optional()
export const workspaceStateOwnerKeySchema = optionalOwnerKeySchema
export const workspaceStateSectionSchema = z.enum([
  'layout',
  'tabs',
  'browserTabs',
  'browserBookmarks',
  'editorDrafts',
  'fileTree',
  'search',
  'commandPalette',
  'settingsPage',
  'agentConversations',
  'projectStrip',
])
export const workspaceStateValueSchema = boundedJsonValueSchema(5 * 1024 * 1024, '工作空间状态')
export const workspaceStateConversationValueSchema = boundedJsonValueSchema(
  32 * 1024 * 1024,
  'Agent 会话状态',
)

export function parseWorkspaceStateSectionValue(
  section: z.infer<typeof workspaceStateSectionSchema>,
  value: unknown,
): unknown {
  return section === 'agentConversations'
    ? workspaceStateConversationValueSchema.parse(value)
    : workspaceStateValueSchema.parse(value)
}

export const workspaceStateSetSectionOptionsSchema = z
  .object({
    conversationHistoryMutation: z
      .discriminatedUnion('type', [
        z.object({
          type: z.literal('clear-messages'),
          conversationId: boundedIdentifierSchema(256),
        }),
        z.object({
          type: z.literal('delete-conversation'),
          conversationId: boundedIdentifierSchema(256),
        }),
      ])
      .optional(),
  })
  .strict()
  .optional()

export const editorOperationIdSchema = boundedIdentifierSchema()
export const editorContentSchema = boundedTextSchema(5 * 1024 * 1024)
export const editorErrorSchema = boundedTextSchema(8_192).optional()
export const wechatConvertSchema = z
  .object({
    markdown: boundedTextSchema(5 * 1024 * 1024),
    documentPath: absolutePathSchema.optional(),
  })
  .strict()

function formatWorkspaceStateWriteError(section: unknown, error: unknown): string {
  const sectionLabel = typeof section === 'string' && section ? section : 'unknown'
  if (error instanceof ZodError) {
    const details = [...new Set(error.issues.map((issue) => issue.message))].join('；')
    return `保存 ${sectionLabel} 失败：${details || '输入无效'}`
  }
  return `保存 ${sectionLabel} 失败：${error instanceof Error ? error.message : String(error)}`
}

export const workspaceStateIpcContracts = {
  resolveLocalWorkspace: bindIpcParser(workspaceStateIpc.resolveLocalWorkspace, (args) =>
    ipcArgs(absolutePathSchema.parse(args[0])),
  ),
  setActiveLocalWorkspace: bindIpcParser(
    workspaceStateIpc.setActiveLocalWorkspace,
    (args) => ipcArgs(args[0] === null ? null : absolutePathSchema.parse(args[0])),
    async (error): Promise<ActiveLocalWorkspaceResult> => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  ),
  get: bindIpcParser(
    workspaceStateIpc.get,
    (args) =>
      ipcArgs(
        workspaceStateWorkspaceKeySchema.parse(args[0]),
        workspaceStateOwnerKeySchema.parse(args[1]),
      ),
    rejectAsync,
  ),
  setSection: bindIpcParser(
    workspaceStateIpc.setSection,
    (args) => {
      try {
        const section = workspaceStateSectionSchema.parse(args[1])
        return ipcArgs(
          workspaceStateWorkspaceKeySchema.parse(args[0]),
          section,
          parseWorkspaceStateSectionValue(section, args[2]),
          workspaceStateOwnerKeySchema.parse(args[3]),
          workspaceStateSetSectionOptionsSchema.parse(args[4]),
        )
      } catch (error) {
        throw new Error(formatWorkspaceStateWriteError(args[1], error))
      }
    },
    async (error): Promise<WorkspaceStateSetSectionResult> => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  ),
  clear: bindIpcParser(
    workspaceStateIpc.clear,
    (args) =>
      ipcArgs(
        workspaceStateWorkspaceKeySchema.parse(args[0]),
        workspaceStateOwnerKeySchema.parse(args[1]),
      ),
    async (error): Promise<{ success: boolean; error?: string }> => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  ),
  listLocalWorkspaces: bindIpcParser(workspaceStateIpc.listLocalWorkspaces, (args) =>
    ipcArgs(workspaceStateOwnerKeySchema.parse(args[0])),
  ),
  diagnostics: bindLegacyNoArgs(workspaceStateIpc.diagnostics),
} as const

export const gitBackupIpcContracts = {
  getAccountStatus: bindLegacyNoArgs(gitBackupIpc.getAccountStatus),
  saveAccount: bindIpcParser(gitBackupIpc.saveAccount, (args) =>
    ipcArgs(gitBackupSaveAccountSchema.parse(args[0])),
  ),
  clearAccount: bindLegacyNoArgs(gitBackupIpc.clearAccount),
  testAccount: bindIpcParser(gitBackupIpc.testAccount, (args) =>
    ipcArgs(gitBackupTestAccountSchema.parse(args[0])),
  ),
  getProjectStatus: bindIpcParser(gitBackupIpc.getProjectStatus, (args) =>
    ipcArgs(gitBackupWorkspacePathSchema.parse(args[0])),
  ),
  backup: bindIpcParser(gitBackupIpc.backup, (args) => ipcArgs(gitBackupRunSchema.parse(args[0]))),
} as const

export const hardwareIpcContracts = {
  scanWorkspace: bindIpcParser(hardwareIpc.scanWorkspace, (args) =>
    ipcArgs(hardwareWorkspacePathSchema.parse(args[0])),
  ),
  inspectProductionPackage: bindIpcParser(hardwareIpc.inspectProductionPackage, (args) =>
    ipcArgs(hardwareWorkspacePathSchema.parse(args[0])),
  ),
  prepareFpcShapeContext: bindIpcParser(hardwareIpc.prepareFpcShapeContext, (args) =>
    ipcArgs(hardwareWorkspacePathSchema.parse(args[0])),
  ),
  readGerberLayerPreview: bindIpcParser(hardwareIpc.readGerberLayerPreview, (args) =>
    ipcArgs(
      hardwareWorkspacePathSchema.parse(args[0]),
      hardwarePackagePathSchema.parse(args[1]),
      hardwarePackageEntrySchema.parse(args[2]),
    ),
  ),
  readGerberLayerGeometry: bindIpcParser(hardwareIpc.readGerberLayerGeometry, (args) =>
    ipcArgs(
      hardwareWorkspacePathSchema.parse(args[0]),
      hardwarePackagePathSchema.parse(args[1]),
      hardwarePackageEntrySchema.parse(args[2]),
    ),
  ),
  writeProductionReportMarkdown: bindIpcParser(hardwareIpc.writeProductionReportMarkdown, (args) =>
    ipcArgs(hardwareWorkspacePathSchema.parse(args[0])),
  ),
} as const

export const cadIpcContracts = {
  getBackendStatus: bindLegacyNoArgs(cadIpc.getBackendStatus),
  getModelSupport: bindIpcParser(cadIpc.getModelSupport, (args) =>
    ipcArgs(cadPathSchema.parse(args[0])),
  ),
  inspectModel: bindIpcParser(cadIpc.inspectModel, (args) => ipcArgs(cadPathSchema.parse(args[0]))),
  getCacheStatus: bindLegacyNoArgs(cadIpc.getCacheStatus),
  clearCache: bindLegacyNoArgs(cadIpc.clearCache),
  convertModel: bindIpcParser(cadIpc.convertModel, (args) =>
    ipcArgs(cadConvertRequestSchema.parse(args[0])),
  ),
} as const

export const projectOpsIpcContracts = {
  getAccounts: bindIpcParser(projectOpsIpc.getAccounts, (args) =>
    ipcArgs(projectOpsWorkspacePathSchema.parse(args[0])),
  ),
  createAccountsTemplate: bindIpcParser(projectOpsIpc.createAccountsTemplate, (args) =>
    ipcArgs(projectOpsWorkspacePathSchema.parse(args[0])),
  ),
  createCopyDraft: bindIpcParser(projectOpsIpc.createCopyDraft, (args) =>
    ipcArgs(projectOpsWorkspacePathSchema.parse(args[0]), projectOpsDraftSchema.parse(args[1])),
  ),
  appendPublicationRecord: bindIpcParser(projectOpsIpc.appendPublicationRecord, (args) =>
    ipcArgs(
      projectOpsWorkspacePathSchema.parse(args[0]),
      projectOpsPublicationSchema.parse(args[1]),
    ),
  ),
} as const

export const editorIpcContracts = {
  readResponse: bindIpcParser(editorIpc.readResponse, (args) =>
    ipcArgs(editorOperationIdSchema.parse(args[0]), editorContentSchema.parse(args[1])),
  ),
  saveResult: bindIpcParser(editorIpc.saveResult, (args) =>
    ipcArgs(
      editorOperationIdSchema.parse(args[0]),
      z.boolean().parse(args[1]),
      editorErrorSchema.parse(args[2]),
    ),
  ),
} as const

export const wechatIpcContracts = {
  convert: bindIpcParser(
    wechatIpc.convert,
    (args) => ipcArgs(wechatConvertSchema.parse(args[0])),
    async (error): Promise<WechatConvertResult> => ({ error: String(error) }),
  ),
} as const
