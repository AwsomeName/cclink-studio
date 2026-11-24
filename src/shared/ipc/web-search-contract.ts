import { z } from 'zod'
import { bindIpcParser, ipcArgs, type IpcInvokeDefinition } from './contract'
import { webSearchIpc } from './web-search'
import { WEB_SEARCH_RESULT_COUNTS } from '../web-search/web-search-types'

export const webSearchSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    keySource: z.enum(['agent', 'own']),
    monthlyLimit: z.number().int().min(0).max(1_000_000),
    resultCount: z
      .number()
      .int()
      .refine((value) => (WEB_SEARCH_RESULT_COUNTS as readonly number[]).includes(value)),
    backends: z
      .object({ codex: z.boolean(), claudeCode: z.boolean(), owner: z.boolean() })
      .strict(),
  })
  .strict()

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

function bind<Args extends unknown[], Result>(
  definition: IpcInvokeDefinition<Args, Result>,
  parseArgs: (args: unknown[]) => Args,
) {
  return bindIpcParser(
    definition,
    parseArgs,
    async () => ({ success: false, error: '联网搜索参数无效' }) as Result,
  )
}

function one<T>(args: unknown[], schema: z.ZodType<T>): [T] {
  if (args.length !== 1) throw new Error('联网搜索 IPC 需要且仅需要一个参数')
  return ipcArgs(schema.parse(args[0]))
}

export const webSearchIpcContracts = {
  getStatus: bind(webSearchIpc.getStatus, (args) => {
    if (args.length !== 0) throw new Error('不接受参数')
    return [] as []
  }),
  saveSettings: bind(webSearchIpc.saveSettings, (args) => one(args, webSearchSettingsInputSchema)),
  verify: bind(webSearchIpc.verify, (args) => one(args, webSearchSettingsInputSchema)),
  getUsage: bind(webSearchIpc.getUsage, (args) => one(args, monthSchema)),
} as const
