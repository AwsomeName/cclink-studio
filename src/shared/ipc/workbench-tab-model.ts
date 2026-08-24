import { z } from 'zod'
import { defineIpcInvoke, ipcArgs } from './contract'

const tabIdSchema = z.string().trim().min(1).max(200)
const workspaceKeySchema = z.string().trim().min(1).max(4096).nullable()
const ownerKeySchema = z.string().trim().min(1).max(512).nullable()
const jsonRecordSchema = z.record(z.string(), z.json())

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const workbenchTabDescriptorSchema = jsonRecordSchema.superRefine((value, context) => {
  for (const field of ['id', 'type', 'title', 'icon'] as const) {
    const candidate = value[field]
    if (typeof candidate !== 'string' || !candidate.trim()) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `Tab descriptor 缺少 ${field}`,
      })
    }
  }

  if (value.type !== 'browser') return
  const workspaceRef = value.workspaceRef
  const isLocalBrowser = isJsonObject(workspaceRef) && workspaceRef.kind === 'local'
  if (!isLocalBrowser || typeof value.filePath === 'string') return

  const hasProfile =
    typeof value.browserProfile === 'string' && Boolean(value.browserProfile.trim())
  const hasAccount =
    isJsonObject(value.webResourceRef) &&
    typeof value.webResourceRef.accountId === 'string' &&
    Boolean(value.webResourceRef.accountId.trim())
  const hasDraft =
    isJsonObject(value.webResourceDraftRef) &&
    typeof value.webResourceDraftRef.draftId === 'string' &&
    Boolean(value.webResourceDraftRef.draftId.trim())
  const isOrdinary = !hasProfile && !hasAccount && !hasDraft
  const isOwnedProfile = hasProfile && Number(hasAccount) + Number(hasDraft) === 1
  if (!isOrdinary && !isOwnedProfile) {
    context.addIssue({
      code: 'custom',
      path: ['browserProfile'],
      message: '本地 Browser Tab 必须是普通浏览，或绑定且只能绑定一个网站账号/账号草稿',
    })
  }
})
export type WorkbenchTabDescriptor = z.infer<typeof workbenchTabDescriptorSchema>

export const workbenchTabProjectionRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    ownerKey: ownerKeySchema.optional().default(null),
  })
  .strict()
export type WorkbenchTabProjectionRequest = z.infer<typeof workbenchTabProjectionRequestSchema>

export const workbenchTabDeltaSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    ownerKey: ownerKeySchema.optional().default(null),
    expectedRevision: z.number().int().nonnegative(),
    upserts: z.array(workbenchTabDescriptorSchema).max(500),
    removedTabIds: z.array(tabIdSchema).max(500),
    orderedTabIds: z.array(tabIdSchema).max(500),
    activeTabId: tabIdSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.removedTabIds).size !== value.removedTabIds.length) {
      context.addIssue({ code: 'custom', path: ['removedTabIds'], message: '移除列表存在重复 ID' })
    }
    if (new Set(value.orderedTabIds).size !== value.orderedTabIds.length) {
      context.addIssue({ code: 'custom', path: ['orderedTabIds'], message: 'Tab 顺序存在重复 ID' })
    }
  })
export type WorkbenchTabDelta = z.infer<typeof workbenchTabDeltaSchema>

export interface WorkbenchTabProjection {
  workspaceKey: string | null
  ownerKey: string | null
  revision: number
  tabs: WorkbenchTabDescriptor[]
  activeTabId: string | null
}

export type WorkbenchTabDeltaResult =
  | { success: true; projection: WorkbenchTabProjection }
  | {
      success: false
      error: { code: 'stale-revision' | 'invalid-delta' | 'persist-failed'; message: string }
    }

export const workbenchTabModelIpc = {
  getProjection: defineIpcInvoke<[WorkbenchTabProjectionRequest], WorkbenchTabProjection>(
    'workbenchTabModel:getProjection',
    (args) => ipcArgs(workbenchTabProjectionRequestSchema.parse(args[0])),
  ),
  applyDelta: defineIpcInvoke<[WorkbenchTabDelta], WorkbenchTabDeltaResult>(
    'workbenchTabModel:applyDelta',
    (args) => ipcArgs(workbenchTabDeltaSchema.parse(args[0])),
  ),
} as const

export interface WorkbenchTabModelApiContract {
  getProjection: (input: WorkbenchTabProjectionRequest) => Promise<WorkbenchTabProjection>
  applyDelta: (input: WorkbenchTabDelta) => Promise<WorkbenchTabDeltaResult>
}

export const workbenchBrowserProjectionSchema = z
  .object({
    url: z.string().max(16_384),
    urlInput: z.string().max(16_384),
    title: z.string().max(500).nullable().optional(),
    faviconUrl: z.string().max(16_384).nullable().optional(),
    viewMode: z.enum(['desktop', 'mobile']),
    zoomMode: z.enum(['fit', 'manual']),
    zoomFactor: z.number().finite().min(0.3).max(3),
    history: z.array(z.string().max(16_384)).max(500),
    historyIndex: z.number().int().nonnegative(),
    ready: z.boolean(),
  })
  .strict()
export type WorkbenchBrowserProjection = z.infer<typeof workbenchBrowserProjectionSchema>

export const workbenchBrowserStateDeltaSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    ownerKey: ownerKeySchema.optional().default(null),
    expectedRevision: z.number().int().nonnegative(),
    upserts: z
      .array(
        z.object({ tabId: tabIdSchema, projection: workbenchBrowserProjectionSchema }).strict(),
      )
      .max(500),
    removedTabIds: z.array(tabIdSchema).max(500),
  })
  .strict()
export type WorkbenchBrowserStateDelta = z.infer<typeof workbenchBrowserStateDeltaSchema>

export interface WorkbenchBrowserStateSnapshot {
  workspaceKey: string | null
  ownerKey: string | null
  revision: number
  tabs: Record<string, WorkbenchBrowserProjection>
}

export type WorkbenchBrowserStateDeltaResult =
  | { success: true; projection: WorkbenchBrowserStateSnapshot }
  | {
      success: false
      error: { code: 'stale-revision' | 'invalid-delta' | 'persist-failed'; message: string }
    }

export const workbenchBrowserBookmarkSchema = z
  .object({
    id: tabIdSchema,
    url: z.string().trim().min(1).max(16_384),
    title: z.string().max(500),
    faviconUrl: z.string().max(16_384).nullable(),
    createdAt: z.number().finite().nonnegative(),
  })
  .strict()
export type WorkbenchBrowserBookmark = z.infer<typeof workbenchBrowserBookmarkSchema>

export const workbenchReplaceBookmarksSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    ownerKey: ownerKeySchema.optional().default(null),
    expectedRevision: z.number().int().nonnegative(),
    bookmarks: z.array(workbenchBrowserBookmarkSchema).max(2_000),
  })
  .strict()
export type WorkbenchReplaceBookmarks = z.infer<typeof workbenchReplaceBookmarksSchema>

export interface WorkbenchBrowserBookmarkSnapshot {
  workspaceKey: string | null
  ownerKey: string | null
  revision: number
  bookmarks: WorkbenchBrowserBookmark[]
}

export type WorkbenchBrowserBookmarkResult =
  | { success: true; projection: WorkbenchBrowserBookmarkSnapshot }
  | {
      success: false
      error: { code: 'stale-revision' | 'invalid-delta' | 'persist-failed'; message: string }
    }

export const workbenchBrowserStateIpc = {
  getBrowserProjection: defineIpcInvoke<
    [WorkbenchTabProjectionRequest],
    WorkbenchBrowserStateSnapshot
  >('workbenchTabModel:getBrowserProjection', (args) =>
    ipcArgs(workbenchTabProjectionRequestSchema.parse(args[0])),
  ),
  applyBrowserDelta: defineIpcInvoke<
    [WorkbenchBrowserStateDelta],
    WorkbenchBrowserStateDeltaResult
  >('workbenchTabModel:applyBrowserDelta', (args) =>
    ipcArgs(workbenchBrowserStateDeltaSchema.parse(args[0])),
  ),
  getBookmarks: defineIpcInvoke<[WorkbenchTabProjectionRequest], WorkbenchBrowserBookmarkSnapshot>(
    'workbenchTabModel:getBookmarks',
    (args) => ipcArgs(workbenchTabProjectionRequestSchema.parse(args[0])),
  ),
  replaceBookmarks: defineIpcInvoke<[WorkbenchReplaceBookmarks], WorkbenchBrowserBookmarkResult>(
    'workbenchTabModel:replaceBookmarks',
    (args) => ipcArgs(workbenchReplaceBookmarksSchema.parse(args[0])),
  ),
} as const

export interface WorkbenchBrowserStateApiContract {
  getBrowserProjection: (
    input: WorkbenchTabProjectionRequest,
  ) => Promise<WorkbenchBrowserStateSnapshot>
  applyBrowserDelta: (
    input: WorkbenchBrowserStateDelta,
  ) => Promise<WorkbenchBrowserStateDeltaResult>
  getBookmarks: (input: WorkbenchTabProjectionRequest) => Promise<WorkbenchBrowserBookmarkSnapshot>
  replaceBookmarks: (input: WorkbenchReplaceBookmarks) => Promise<WorkbenchBrowserBookmarkResult>
}

export interface WorkbenchTabStateApiContract
  extends WorkbenchTabModelApiContract, WorkbenchBrowserStateApiContract {}
