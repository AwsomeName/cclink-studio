import { z } from 'zod'

const MAX_URL_LENGTH = 32_768
const MAX_IDENTIFIER_LENGTH = 512
const MAX_WORKSPACE_KEY_LENGTH = 32_768
const MAX_HISTORY_ENTRIES = 500

const boundedString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !/[\0\r\n]/.test(value), '包含非法控制字符')

export const browserIdentifierSchema = boundedString(MAX_IDENTIFIER_LENGTH)
export const browserOptionalIdentifierSchema = browserIdentifierSchema.nullable()
export const browserWorkspaceKeySchema = z
  .string()
  .max(MAX_WORKSPACE_KEY_LENGTH)
  .refine((value) => !value.includes('\0'), '包含非法控制字符')
  .nullable()

export const browserProfileIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, 'Profile ID 格式无效')
  .nullable()

export const browserUrlSchema = z
  .string()
  .min(1)
  .max(MAX_URL_LENGTH)
  .superRefine((value, context) => {
    if (value === 'about:blank') return
    try {
      const url = new URL(value)
      if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
        context.addIssue({ code: 'custom', message: `不允许的浏览器协议: ${url.protocol}` })
      }
    } catch {
      context.addIssue({ code: 'custom', message: '浏览器 URL 无效' })
    }
  })

export const browserBoundsSchema = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
    width: z.number().finite().min(0).max(100_000),
    height: z.number().finite().min(0).max(100_000),
  })
  .strict()

const zoomFactorSchema = z.number().finite().min(0.3).max(3)

export const browserCreateViewOptionsSchema = z
  .object({
    restore: z
      .object({
        viewMode: z.enum(['desktop', 'mobile']),
        zoomMode: z.enum(['fit', 'manual']),
        manualZoom: zoomFactorSchema,
        history: z.array(browserUrlSchema).max(MAX_HISTORY_ENTRIES).optional(),
        historyIndex: z
          .number()
          .int()
          .min(0)
          .max(MAX_HISTORY_ENTRIES - 1)
          .optional(),
      })
      .strict()
      .optional(),
    profileId: browserProfileIdSchema.optional(),
    workspaceKey: browserWorkspaceKeySchema.optional(),
  })
  .strict()

export const browserReconcileViewsSchema = z
  .object({
    workspaceKey: browserWorkspaceKeySchema,
    validTabIds: z.array(browserIdentifierSchema).max(MAX_HISTORY_ENTRIES),
    activeTabId: browserOptionalIdentifierSchema,
  })
  .strict()

export const browserSessionDiagnosticRequestSchema = z
  .object({
    url: browserUrlSchema,
    profileId: browserProfileIdSchema.optional(),
  })
  .strict()

export const browserZoomFactorSchema = zoomFactorSchema
export const browserViewModeSchema = z.enum(['desktop', 'mobile'])
export const browserHistoryLimitSchema = z.number().int().min(1).max(MAX_HISTORY_ENTRIES).optional()
export const browserTaskGoalSchema = z.string().trim().min(1).max(4_000)
