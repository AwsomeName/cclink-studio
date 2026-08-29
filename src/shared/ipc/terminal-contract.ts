import { z } from 'zod'
import {
  bindIpcParser,
  ipcArgs,
  type IpcInvokeContract,
  type IpcInvokeDefinition,
} from './contract'
import { isBoundedIpcEventPayload } from './event-payload'
import {
  terminalIpc,
  type TerminalAuditListFilter,
  type TerminalLifecycleAuditInput,
  type TerminalOperationResult,
  type TerminalSubmitCommandInput,
  type TerminalSubmitCommandResult,
} from './terminal'
import { workspaceRefSchema } from './workspace-ref-schema'

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

/** 保留迁移前无参数 handler 忽略多余参数的行为。 */
function bindLegacyNoArgs<Result>(
  definition: IpcInvokeDefinition<[], Result>,
): IpcInvokeContract<[], Result> {
  return bindIpcParser(definition, (args) => {
    if (args.some((value) => !isBoundedLegacyTerminalValue(value))) {
      throw new Error(`IPC ${definition.channel} 参数超过结构或大小限制`)
    }
    return ipcArgs()
  })
}

const terminalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\0\r\n]+$/u)
const terminalSizeSchema = z
  .object({
    columns: z.number().int().min(2).max(500),
    rows: z.number().int().min(2).max(200),
  })
  .strict()
const terminalRuntimeSchema = z
  .object({
    location: z.enum(['local', 'remote']),
    transport: z.enum(['local', 'cclink']),
    backend: z.enum(['local-shell', 'remote-shell', 'codex', 'custom']),
    workspaceRef: workspaceRefSchema,
    cwd: z.string().min(1).max(32_768).optional(),
    shell: z.string().min(1).max(4_096).optional(),
    endpointId: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
const terminalPtyStartSchema = z
  .object({
    terminalSessionId: terminalIdSchema,
    runtime: terminalRuntimeSchema,
    size: terminalSizeSchema.optional().default({ columns: 80, rows: 24 }),
  })
  .strict()
const terminalPtyWriteSchema = z
  .object({ terminalSessionId: terminalIdSchema, data: z.string().min(1).max(100_000) })
  .strict()
const terminalPtyResizeSchema = z
  .object({ terminalSessionId: terminalIdSchema, size: terminalSizeSchema })
  .strict()

function isBoundedLegacyTerminalValue(value: unknown): boolean {
  return isBoundedIpcEventPayload(value, {
    maxDepth: 12,
    maxNodes: 5_000,
    maxArrayLength: 256,
    maxObjectKeys: 256,
    maxStringLength: 100_000,
    maxTotalStringLength: 200_000,
  })
}

const legacyBoundedValueSchema = z.unknown().superRefine((value, context) => {
  if (!isBoundedLegacyTerminalValue(value)) {
    context.addIssue({ code: 'custom', message: 'Terminal 参数超过结构或大小限制' })
  }
})
const legacyBoundedRuleListSchema = z.array(legacyBoundedValueSchema).max(256)
const terminalPermissionPolicySchema = z
  .object({
    mode: z.enum(['read-only', 'ask-every-command', 'ask-risky-command', 'trusted-session']),
    requireConfirmationFor: legacyBoundedRuleListSchema.optional(),
    allowlist: legacyBoundedRuleListSchema.optional(),
    denylist: legacyBoundedRuleListSchema.optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!isBoundedLegacyTerminalValue(value)) {
      context.addIssue({ code: 'custom', message: 'Terminal 权限策略超过大小限制' })
    }
  })
const terminalLifecycleAuditInputSchema = z
  .object({
    terminalSessionId: z.string().min(1).max(256),
    workspaceKey: legacyBoundedValueSchema.optional(),
    kind: z.enum(['created', 'closed', 'terminated']),
    message: z.string().max(100_000).optional(),
    runtime: terminalRuntimeSchema.optional(),
    permissionPolicy: terminalPermissionPolicySchema.optional(),
    closePolicy: z.enum(['close-view', 'terminate-process', 'keep-running']).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!isBoundedLegacyTerminalValue(value)) {
      context.addIssue({ code: 'custom', message: 'Terminal 生命周期参数超过大小限制' })
    }
  })
const terminalSubmitCommandInputSchema = z
  .object({
    terminalSessionId: z.string().min(1).max(256),
    command: z.string().min(1).max(100_000),
    actor: z.enum(['user', 'agent', 'system']),
    permissionPolicy: terminalPermissionPolicySchema,
    workspaceKey: legacyBoundedValueSchema.optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!isBoundedLegacyTerminalValue(value)) {
      context.addIssue({ code: 'custom', message: 'Terminal 命令参数超过大小限制' })
    }
  })

function parseSingleObject<T>(args: unknown[], channel: string): T {
  requireArgs(args, 1, channel)
  if (!args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])) {
    throw new Error(`IPC ${channel} 需要对象参数`)
  }
  return args[0] as T
}

function parseBoundedObject<T>(args: unknown[], channel: string, schema: z.ZodType): T {
  const input = parseSingleObject<T>(args, channel)
  schema.parse(input)
  return input
}

export const terminalIpcContracts = {
  resolveCommandConfirmation: bindIpcParser(
    terminalIpc.resolveCommandConfirmation,
    (args) => {
      requireArgs(args, 2, terminalIpc.resolveCommandConfirmation.channel)
      return ipcArgs(terminalIdSchema.parse(args[0]), z.boolean().parse(args[1]))
    },
    (): TerminalOperationResult => ({ success: false }),
  ),
  recordLifecycleEvent: bindIpcParser(
    terminalIpc.recordLifecycleEvent,
    (args) =>
      ipcArgs(
        parseBoundedObject<TerminalLifecycleAuditInput>(
          args,
          terminalIpc.recordLifecycleEvent.channel,
          terminalLifecycleAuditInputSchema,
        ),
      ),
    async (): Promise<TerminalOperationResult> => ({
      success: false,
      error: 'Terminal 生命周期审计事件无效',
    }),
  ),
  submitCommand: bindIpcParser(
    terminalIpc.submitCommand,
    (args) =>
      ipcArgs(
        parseBoundedObject<TerminalSubmitCommandInput>(
          args,
          terminalIpc.submitCommand.channel,
          terminalSubmitCommandInputSchema,
        ),
      ),
    async (): Promise<TerminalSubmitCommandResult> => ({
      success: false,
      status: 'rejected',
      error: 'Terminal 命令提交参数无效',
    }),
  ),
  startPty: bindIpcParser(
    terminalIpc.startPty,
    (args) => {
      requireArgs(args, 1, terminalIpc.startPty.channel)
      return ipcArgs(terminalPtyStartSchema.parse(args[0]))
    },
    async (): Promise<TerminalOperationResult> => ({
      success: false,
      error: 'Terminal PTY 启动参数无效',
    }),
  ),
  writePty: bindIpcParser(
    terminalIpc.writePty,
    (args) => {
      requireArgs(args, 1, terminalIpc.writePty.channel)
      return ipcArgs(terminalPtyWriteSchema.parse(args[0]))
    },
    async (): Promise<TerminalOperationResult> => ({
      success: false,
      error: 'Terminal PTY 写入参数无效',
    }),
  ),
  resizePty: bindIpcParser(
    terminalIpc.resizePty,
    (args) => {
      requireArgs(args, 1, terminalIpc.resizePty.channel)
      return ipcArgs(terminalPtyResizeSchema.parse(args[0]))
    },
    async (): Promise<TerminalOperationResult> => ({
      success: false,
      error: 'Terminal PTY resize 参数无效',
    }),
  ),
  terminatePty: bindIpcParser(
    terminalIpc.terminatePty,
    (args) => {
      requireArgs(args, 1, terminalIpc.terminatePty.channel)
      return ipcArgs(terminalIdSchema.parse(args[0]))
    },
    async (): Promise<TerminalOperationResult> => ({
      success: false,
      error: 'terminalSessionId 不能为空',
    }),
  ),
  listSessions: bindLegacyNoArgs(terminalIpc.listSessions),
  listAuditEvents: bindIpcParser(terminalIpc.listAuditEvents, (args) => {
    args.forEach((value) => legacyBoundedValueSchema.parse(value))
    return ipcArgs(args[0] as TerminalAuditListFilter | undefined)
  }),
  clearAuditSession: bindIpcParser(
    terminalIpc.clearAuditSession,
    (args) => {
      requireArgs(args, 1, terminalIpc.clearAuditSession.channel)
      return ipcArgs(terminalIdSchema.parse(args[0]))
    },
    async (): Promise<TerminalOperationResult> => ({
      success: false,
      error: 'terminalSessionId 不能为空',
    }),
  ),
  clearAuditEvents: bindLegacyNoArgs(terminalIpc.clearAuditEvents),
} as const
