import { z } from 'zod'
import { BROWSER_PROFILE_ID_MAX_LENGTH, BROWSER_PROFILE_ID_PATTERN } from '../browser-profile'
import { isReservedKeyChord, isValidKeyChord, normalizeKeyChord } from '../keybindings'

const MAX_URL_LENGTH = 32_768
const MAX_IDENTIFIER_LENGTH = 512
const MAX_WORKSPACE_KEY_LENGTH = 32_768
const MAX_HISTORY_ENTRIES = 500
const MAX_CONTEXT_TEXT_LENGTH = 8_000

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
  .max(BROWSER_PROFILE_ID_MAX_LENGTH)
  .regex(BROWSER_PROFILE_ID_PATTERN, 'Profile ID 格式无效')
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

export const browserWorkbenchBoundsSchema = browserBoundsSchema.extend({
  protectedTop: z.number().finite().min(0).max(100_000),
})

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
    views: z
      .array(
        z
          .object({
            tabId: browserIdentifierSchema,
            profileId: browserProfileIdSchema,
            accountId: browserOptionalIdentifierSchema.optional(),
          })
          .strict(),
      )
      .max(MAX_HISTORY_ENTRIES),
    activeTabId: browserOptionalIdentifierSchema,
  })
  .strict()
  .superRefine(({ views }, context) => {
    const tabIds = new Set<string>()
    views.forEach(({ tabId }, index) => {
      if (tabIds.has(tabId)) {
        context.addIssue({
          code: 'custom',
          path: ['views', index, 'tabId'],
          message: '浏览器 Tab 绑定重复',
        })
      }
      tabIds.add(tabId)
    })
  })

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

const browserKeyChordSchema = z
  .object({
    code: z.string().min(1).max(32),
    modifiers: z.array(z.enum(['primary', 'control', 'alt', 'shift'])).max(4),
  })
  .strict()
  .transform(normalizeKeyChord)
  .refine((value) => isValidKeyChord(value) && !isReservedKeyChord(value), '快捷键无效或被保留')

export const browserFindShortcutSyncSchema = z
  .object({
    configVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    bindings: z.array(browserKeyChordSchema).max(4),
  })
  .strict()

const browserRuntimeIdentityFields = {
  tabId: browserIdentifierSchema,
  workspaceKey: browserWorkspaceKeySchema,
  runtimeGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}

export const browserFindRequestSchema = z
  .object({
    ...browserRuntimeIdentityFields,
    requestToken: browserIdentifierSchema,
    query: z
      .string()
      .min(1)
      .max(4_000)
      .refine((value) => !value.includes('\0')),
    forward: z.boolean(),
    findNext: z.boolean(),
  })
  .strict()

export const browserStopFindRequestSchema = z
  .object({
    ...browserRuntimeIdentityFields,
    action: z.enum(['clearSelection', 'keepSelection', 'activateSelection']),
  })
  .strict()

export const browserPopupDispositionSchema = z.enum([
  'default',
  'foreground-tab',
  'background-tab',
  'new-window',
  'other',
])

export const browserPopupCreatedSchema = z
  .object({
    tabId: browserIdentifierSchema,
    url: browserUrlSchema,
    workspaceKey: browserWorkspaceKeySchema,
    profileId: browserProfileIdSchema,
    disposition: browserPopupDispositionSchema,
    activate: z.boolean(),
  })
  .strict()

export const browserRuntimeTabClosedSchema = z
  .object({
    tabId: browserIdentifierSchema,
    workspaceKey: browserWorkspaceKeySchema,
  })
  .strict()

const browserContextUrlSchema = browserUrlSchema.nullable()
const browserContextTextSchema = z
  .string()
  .max(MAX_CONTEXT_TEXT_LENGTH)
  .refine((value) => !value.includes('\0'), '包含非法控制字符')

export const browserContextSchema = z
  .object({
    workspaceKey: browserWorkspaceKeySchema,
    tabId: browserIdentifierSchema,
    profileId: browserProfileIdSchema,
    pageUrl: browserUrlSchema,
    selectionText: browserContextTextSchema,
    linkUrl: browserContextUrlSchema,
    srcUrl: browserContextUrlSchema,
    isEditable: z.boolean(),
    mediaType: z.enum(['none', 'image', 'audio', 'video', 'canvas', 'file', 'plugin']),
    editFlags: z
      .object({
        canUndo: z.boolean(),
        canRedo: z.boolean(),
        canCut: z.boolean(),
        canCopy: z.boolean(),
        canPaste: z.boolean(),
        canDelete: z.boolean(),
        canSelectAll: z.boolean(),
      })
      .strict(),
  })
  .strict()
