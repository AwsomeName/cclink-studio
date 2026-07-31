import { z } from 'zod'
import { BROWSER_PROFILE_ID_MAX_LENGTH, BROWSER_PROFILE_ID_PATTERN } from '../browser-profile'

const trimmedText = (maxLength: number, label: string): z.ZodString =>
  z.string().trim().min(1, `${label}不能为空`).max(maxLength, `${label}过长`)

const optionalTrimmedText = (maxLength: number, label: string) =>
  z
    .string()
    .trim()
    .max(maxLength, `${label}过长`)
    .optional()
    .transform((value) => value || undefined)

const timestampSchema = z.iso.datetime()

const httpUrlSchema = trimmedText(2_048, '网站地址').refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}, '网站地址必须是 http 或 https URL')

export const webPrincipalKindSchema = z.enum([
  'personal',
  'sole-proprietor',
  'company',
  'organization',
])

export const createWebConnectionInputSchema = z
  .object({
    websiteName: trimmedText(120, '网站名称'),
    entryUrl: httpUrlSchema,
    websiteNotes: optionalTrimmedText(1_000, '网站备注'),
    principalKind: webPrincipalKindSchema,
    principalName: trimmedText(160, '主体名称'),
    accountLabel: trimmedText(160, '账号名称'),
    accountRole: optionalTrimmedText(120, '账号角色'),
    browserProfileId: trimmedText(BROWSER_PROFILE_ID_MAX_LENGTH, 'Browser Profile').regex(
      BROWSER_PROFILE_ID_PATTERN,
      'Browser Profile 只能包含字母、数字、点、下划线和连字符',
    ),
    loginHint: optionalTrimmedText(500, '登录提示'),
  })
  .strict()

export const websiteResourceSchema = z
  .object({
    id: z.uuid(),
    name: trimmedText(120, '网站名称'),
    origin: httpUrlSchema,
    entryUrl: httpUrlSchema,
    notes: optionalTrimmedText(1_000, '网站备注'),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export const webPrincipalSchema = z
  .object({
    id: z.uuid(),
    kind: webPrincipalKindSchema,
    name: trimmedText(160, '主体名称'),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export const webAccountSchema = z
  .object({
    id: z.uuid(),
    websiteId: z.uuid(),
    principalId: z.uuid(),
    label: trimmedText(160, '账号名称'),
    role: optionalTrimmedText(120, '账号角色'),
    browserProfileId: trimmedText(BROWSER_PROFILE_ID_MAX_LENGTH, 'Browser Profile').regex(
      BROWSER_PROFILE_ID_PATTERN,
    ),
    loginHint: optionalTrimmedText(500, '登录提示'),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export const webResourceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    websites: z.array(websiteResourceSchema).max(1_000),
    principals: z.array(webPrincipalSchema).max(500),
    accounts: z.array(webAccountSchema).max(2_000),
  })
  .strict()

export function parseCreateWebConnectionInput(value: unknown) {
  return createWebConnectionInputSchema.parse(value)
}

export function parseWebResourceSnapshot(value: unknown) {
  return webResourceSnapshotSchema.parse(value)
}
