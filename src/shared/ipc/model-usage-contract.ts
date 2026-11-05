import { z } from 'zod'
import { bindIpcParser, type IpcInvokeDefinition } from './contract'
import { modelUsageIpc } from './model-usage'
import { usageCategorySchema, type UsageResult } from '../model-usage'
export const usageQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    workspace: z.string().min(1).max(4096).optional(),
    model: z.string().min(1).max(4096).optional(),
    category: usageCategorySchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.from < value.to && Date.parse(value.to) - Date.parse(value.from) <= 3660 * 86400000,
    '时间范围无效或超过十年',
  )
function bind<A extends unknown[], R>(
  definition: IpcInvokeDefinition<A, UsageResult<R>>,
  schema: z.ZodType<A>,
) {
  return bindIpcParser(
    definition,
    (args) => schema.parse(args),
    () => ({
      success: false as const,
      error: { code: 'INVALID_INPUT', message: '统计参数无效，请检查日期或重新打开页面。' },
    }),
  )
}
export const modelUsageContracts = {
  snapshot: bind(modelUsageIpc.snapshot, z.tuple([usageQuerySchema])),
  calls: bind(
    modelUsageIpc.calls,
    z.tuple([usageQuerySchema, z.number().int().min(0).max(10000000), z.boolean()]),
  ),
  setEnabled: bind(modelUsageIpc.setEnabled, z.tuple([z.boolean()])),
  classify: bind(
    modelUsageIpc.classify,
    z.tuple([
      z
        .object({
          kind: z.enum(['run', 'task', 'session']),
          id: z.string().min(1).max(4096),
          category: usageCategorySchema,
        })
        .strict(),
    ]),
  ),
  backfill: bind(modelUsageIpc.backfill, z.tuple([z.boolean()])),
  importFile: bind(modelUsageIpc.importFile, z.tuple([])),
  exportFile: bind(
    modelUsageIpc.exportFile,
    z.tuple([
      z
        .object({
          query: usageQuerySchema,
          format: z.enum(['csv', 'json']),
          excludeDevelopment: z.boolean(),
        })
        .strict(),
    ]),
  ),
}
