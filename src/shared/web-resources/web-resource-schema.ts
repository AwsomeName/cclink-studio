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
const uuidSchema = z.uuid()

const workspaceRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), path: trimmedText(4_096, '项目路径') }).strict(),
  z.object({ kind: z.literal('global') }).strict(),
])

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
    workspaceRef: workspaceRefSchema,
    websiteName: trimmedText(120, '网站名称'),
    entryUrl: httpUrlSchema,
    websiteNotes: optionalTrimmedText(1_000, '网站备注'),
    principalKind: webPrincipalKindSchema,
    principalName: trimmedText(160, '主体名称'),
    accountLabel: trimmedText(160, '账号名称'),
    accountRole: optionalTrimmedText(120, '账号角色'),
    loginHint: optionalTrimmedText(500, '登录提示'),
  })
  .strict()

export const webResourceProjectScopeInputSchema = z
  .object({ workspaceRef: workspaceRefSchema })
  .strict()

export const saveWebResourceDraftInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    draftId: uuidSchema,
    tabId: trimmedText(160, '浏览器标签页'),
    displayName: trimmedText(160, '账号名称'),
    duplicateResolution: z.literal('save-another').optional(),
  })
  .strict()

export const cancelWebResourceDraftInputSchema = z
  .object({
    workspaceRef: workspaceRefSchema,
    draftId: uuidSchema,
    tabId: trimmedText(160, '浏览器标签页'),
  })
  .strict()

export const resolveWebResourceLaunchInputSchema = z
  .object({ workspaceRef: workspaceRefSchema, accountId: uuidSchema })
  .strict()

export const confirmWebConnectionLoginInputSchema = z
  .object({ workspaceRef: workspaceRefSchema, accountId: uuidSchema })
  .strict()

export const importProjectOpsConfigInputSchema = z
  .object({
    workspacePath: trimmedText(4_096, '工作空间路径'),
    principalKind: webPrincipalKindSchema,
    principalName: trimmedText(160, '主体名称'),
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
    id: uuidSchema,
    websiteId: uuidSchema,
    principalId: uuidSchema,
    label: trimmedText(160, '账号名称'),
    role: optionalTrimmedText(120, '账号角色'),
    browserProfileId: trimmedText(BROWSER_PROFILE_ID_MAX_LENGTH, 'Browser Profile').regex(
      BROWSER_PROFILE_ID_PATTERN,
    ),
    loginHint: optionalTrimmedText(500, '登录提示'),
    loginConfirmedAt: timestampSchema.optional(),
    archivedAt: timestampSchema.optional(),
    mergedIntoAccountId: uuidSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export const webAccountGroupSchema = z
  .object({
    id: uuidSchema,
    name: trimmedText(160, '运营矩阵名称'),
    revision: z.number().int().positive(),
    accountIds: z.array(uuidSchema).min(1).max(200),
    archivedAt: timestampSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()

export const webResourceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(3),
    revision: z.number().int().nonnegative(),
    websites: z.array(websiteResourceSchema).max(1_000),
    principals: z.array(webPrincipalSchema).max(500),
    accounts: z.array(webAccountSchema).max(2_000),
    accountGroups: z.array(webAccountGroupSchema).max(500),
  })
  .strict()

const webAccountV2Schema = webAccountSchema
  .omit({ archivedAt: true, mergedIntoAccountId: true })
  .extend({ projectId: uuidSchema.nullable() })
  .strict()

const webResourceSnapshotV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    revision: z.number().int().nonnegative(),
    websites: z.array(websiteResourceSchema).max(1_000),
    principals: z.array(webPrincipalSchema).max(500),
    accounts: z.array(webAccountV2Schema).max(2_000),
  })
  .strict()

const webResourceSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    websites: z.array(websiteResourceSchema).max(1_000),
    principals: z.array(webPrincipalSchema).max(500),
    accounts: z
      .array(
        webAccountSchema
          .omit({ loginConfirmedAt: true, archivedAt: true, mergedIntoAccountId: true })
          .strict(),
      )
      .max(2_000),
  })
  .strict()

export function parseCreateWebConnectionInput(value: unknown) {
  return createWebConnectionInputSchema.parse(value)
}

export function parseWebResourceProjectScopeInput(value: unknown) {
  return webResourceProjectScopeInputSchema.parse(value)
}

export function parseSaveWebResourceDraftInput(value: unknown) {
  return saveWebResourceDraftInputSchema.parse(value)
}

export function parseCancelWebResourceDraftInput(value: unknown) {
  return cancelWebResourceDraftInputSchema.parse(value)
}

export function parseResolveWebResourceLaunchInput(value: unknown) {
  return resolveWebResourceLaunchInputSchema.parse(value)
}

export function parseConfirmWebConnectionLoginInput(value: unknown) {
  return confirmWebConnectionLoginInputSchema.parse(value)
}

export function parseImportProjectOpsConfigInput(value: unknown) {
  return importProjectOpsConfigInputSchema.parse(value)
}

export function parseWebResourceSnapshot(value: unknown) {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion
  if (version === 1) {
    const legacy = webResourceSnapshotV1Schema.parse(value)
    return webResourceSnapshotSchema.parse({
      ...legacy,
      schemaVersion: 3,
      accountGroups: [],
    })
  }
  if (version === 2) {
    const legacy = webResourceSnapshotV2Schema.parse(value)
    return webResourceSnapshotSchema.parse({
      ...legacy,
      schemaVersion: 3,
      accounts: legacy.accounts.map(({ projectId: _projectId, ...account }) => account),
      accountGroups: [],
    })
  }
  return webResourceSnapshotSchema.parse(value)
}

export const createWebAccountGroupInputSchema = z
  .object({
    name: trimmedText(160, '运营矩阵名称'),
    accountIds: z
      .array(uuidSchema)
      .min(1)
      .max(200)
      .transform((items) => [...new Set(items)]),
  })
  .strict()

export const updateWebAccountGroupInputSchema = createWebAccountGroupInputSchema
  .extend({ groupId: uuidSchema, expectedRevision: z.number().int().positive() })
  .strict()

export const archiveWebAccountGroupInputSchema = z.object({ groupId: uuidSchema }).strict()
export const archiveWebAccountInputSchema = z.object({ accountId: uuidSchema }).strict()
export const mergeWebAccountsInputSchema = z
  .object({ primaryAccountId: uuidSchema, duplicateAccountId: uuidSchema })
  .strict()
