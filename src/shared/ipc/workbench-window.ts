import { z } from 'zod'
import { defineIpcInvoke, defineNoArgsIpc, ipcArgs } from './contract'
import type {
  BrowserDownloadChangedPayload,
  BrowserFindResultPayload,
  BrowserFindShortcutTriggeredPayload,
  BrowserNativeContextMenuOpenedPayload,
  BrowserPageMetaChangedPayload,
  BrowserTaskChangedPayload,
  BrowserUrlChangedPayload,
} from './browser'

export const workbenchWindowRoleSchema = z.enum(['main', 'auxiliary'])
export type WorkbenchWindowRole = z.infer<typeof workbenchWindowRoleSchema>

const stableIdSchema = z.string().trim().min(1).max(200)
const workspaceKeySchema = z.string().trim().min(1).max(4096).nullable()
const ownerKeySchema = z.string().trim().min(1).max(512).nullable()
const generationSchema = z.number().int().nonnegative()
const screenCoordinateSchema = z.number().finite().int().min(-100_000).max(100_000)

export const workbenchWindowDropPointSchema = z
  .object({
    x: screenCoordinateSchema,
    y: screenCoordinateSchema,
  })
  .strict()
export type WorkbenchWindowDropPoint = z.infer<typeof workbenchWindowDropPointSchema>

export const workbenchTabDetachDragInputSchema = z
  .object({
    tabId: stableIdSchema,
  })
  .strict()
export type WorkbenchTabDetachDragInput = z.infer<typeof workbenchTabDetachDragInputSchema>

export const workbenchTabDetachReleasedSchema = z
  .object({
    tabId: stableIdSchema,
    dropPoint: workbenchWindowDropPointSchema,
  })
  .strict()
export type WorkbenchTabDetachReleased = z.infer<typeof workbenchTabDetachReleasedSchema>

export const workbenchWindowBootstrapSchema = z
  .object({
    windowId: stableIdSchema,
    role: workbenchWindowRoleSchema,
    workspaceKey: workspaceKeySchema,
    activeTabId: stableIdSchema.nullable(),
    generation: generationSchema,
  })
  .strict()
export type WorkbenchWindowBootstrap = z.infer<typeof workbenchWindowBootstrapSchema>

export const workbenchBrowserTabProjectionSchema = z
  .object({
    tabId: stableIdSchema,
    type: z.literal('browser'),
    title: z.string().max(500),
    icon: z.string().max(200),
    workspaceKey: workspaceKeySchema,
    generation: generationSchema,
    initialUrl: z.string().max(16_384).optional(),
    browserProfile: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict()
export type WorkbenchBrowserTabProjection = z.infer<typeof workbenchBrowserTabProjectionSchema>

export const workbenchTransientBrowserTabSeedSchema = z
  .object({
    title: z.string().max(500),
    icon: z.string().max(200),
    initialUrl: z.string().max(16_384).optional(),
    browserProfile: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict()
export type WorkbenchTransientBrowserTabSeed = z.infer<
  typeof workbenchTransientBrowserTabSeedSchema
>

export const workbenchPlacementChangedSchema = z
  .object({
    tabId: stableIdSchema,
    workspaceKey: workspaceKeySchema,
    windowId: stableIdSchema,
    generation: generationSchema,
    state: z.enum(['attached', 'moving', 'returning', 'recovering']),
    active: z.boolean(),
  })
  .strict()
export type WorkbenchPlacementChanged = z.infer<typeof workbenchPlacementChangedSchema>

export const workbenchWindowProjectionSchema = z
  .object({
    window: workbenchWindowBootstrapSchema,
    tabs: z.array(workbenchBrowserTabProjectionSchema).max(500),
    placements: z.array(workbenchPlacementChangedSchema).max(500),
  })
  .strict()
  .superRefine((projection, context) => {
    if (projection.window.role === 'auxiliary' && projection.tabs.length > 1) {
      context.addIssue({ code: 'custom', path: ['tabs'], message: 'M1 辅助窗口最多承载一个 Tab' })
    }
  })
export type WorkbenchWindowProjection = z.infer<typeof workbenchWindowProjectionSchema>

export const workbenchMoveTabInputSchema = z
  .object({
    tabId: stableIdSchema,
    workspaceKey: workspaceKeySchema,
    ownerKey: ownerKeySchema.optional(),
    sourceWindowId: stableIdSchema,
    expectedGeneration: generationSchema,
    dropPoint: workbenchWindowDropPointSchema.optional(),
    transientTabSeed: workbenchTransientBrowserTabSeedSchema.optional(),
  })
  .strict()
export type WorkbenchMoveTabInput = z.infer<typeof workbenchMoveTabInputSchema>

export const workbenchReturnTabInputSchema = z
  .object({
    tabId: stableIdSchema,
    sourceWindowId: stableIdSchema,
    expectedGeneration: generationSchema,
  })
  .strict()
export type WorkbenchReturnTabInput = z.infer<typeof workbenchReturnTabInputSchema>

export const workbenchAuxiliaryReadyInputSchema = z
  .object({
    windowId: stableIdSchema,
    generation: generationSchema,
  })
  .strict()
export type WorkbenchAuxiliaryReadyInput = z.infer<typeof workbenchAuxiliaryReadyInputSchema>

export const workbenchAuxiliaryBoundsInputSchema = z
  .object({
    windowId: stableIdSchema,
    generation: generationSchema,
    bounds: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict()
export type WorkbenchAuxiliaryBoundsInput = z.infer<typeof workbenchAuxiliaryBoundsInputSchema>

export const workbenchAuxiliaryBrowserCommandInputSchema = z
  .object({
    windowId: stableIdSchema,
    tabId: stableIdSchema,
    generation: generationSchema,
    action: z.enum(['navigate', 'back', 'forward', 'reload', 'find', 'stop-find']),
    url: z.string().trim().min(1).max(16_384).optional(),
    query: z.string().max(8_000).optional(),
    requestToken: stableIdSchema.optional(),
    forward: z.boolean().optional(),
    findNext: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === 'navigate' && !input.url) {
      context.addIssue({ code: 'custom', path: ['url'], message: 'navigate 必须提供 URL' })
    }
    if (input.action !== 'navigate' && input.url !== undefined) {
      context.addIssue({ code: 'custom', path: ['url'], message: '非 navigate 命令不能提供 URL' })
    }
    if (input.action === 'find' && (input.query === undefined || !input.requestToken)) {
      context.addIssue({ code: 'custom', path: ['query'], message: 'find 必须提供 query 和 token' })
    }
    if (input.action !== 'find' && input.query !== undefined) {
      context.addIssue({ code: 'custom', path: ['query'], message: '非 find 命令不能提供 query' })
    }
  })
export type WorkbenchAuxiliaryBrowserCommandInput = z.infer<
  typeof workbenchAuxiliaryBrowserCommandInputSchema
>

export interface WorkbenchWindowCommandError {
  code:
    | 'unsupported-tab'
    | 'stale-generation'
    | 'invalid-source'
    | 'window-create-failed'
    | 'target-not-ready'
    | 'attach-failed'
    | 'rollback-failed'
    | 'recovery-failed'
    | 'not-found'
    | 'invalid-request'
  message: string
  transferId?: string
}

export type WorkbenchWindowCommandResult =
  | { success: true; transferId: string; projection: WorkbenchWindowProjection }
  | { success: false; error: WorkbenchWindowCommandError }

export const workbenchWindowIpc = {
  getBootstrap: defineNoArgsIpc<WorkbenchWindowBootstrap>('workbenchWindow:getBootstrap'),
  getProjection: defineNoArgsIpc<WorkbenchWindowProjection>('workbenchWindow:getProjection'),
  beginTabDetachDrag: defineIpcInvoke<[WorkbenchTabDetachDragInput], { success: true }>(
    'workbenchWindow:beginTabDetachDrag',
    (args) => ipcArgs(workbenchTabDetachDragInputSchema.parse(args[0])),
  ),
  finishTabDetachDrag: defineIpcInvoke<
    [WorkbenchTabDetachDragInput],
    WorkbenchWindowDropPoint | null
  >('workbenchWindow:finishTabDetachDrag', (args) =>
    ipcArgs(workbenchTabDetachDragInputSchema.parse(args[0])),
  ),
  cancelTabDetachDrag: defineIpcInvoke<[WorkbenchTabDetachDragInput], { success: true }>(
    'workbenchWindow:cancelTabDetachDrag',
    (args) => ipcArgs(workbenchTabDetachDragInputSchema.parse(args[0])),
  ),
  moveTabToNewWindow: defineIpcInvoke<[WorkbenchMoveTabInput], WorkbenchWindowCommandResult>(
    'workbenchWindow:moveTabToNewWindow',
    (args) => ipcArgs(workbenchMoveTabInputSchema.parse(args[0])),
  ),
  returnTabToMain: defineIpcInvoke<[WorkbenchReturnTabInput], WorkbenchWindowCommandResult>(
    'workbenchWindow:returnTabToMain',
    (args) => ipcArgs(workbenchReturnTabInputSchema.parse(args[0])),
  ),
  auxiliaryReady: defineIpcInvoke<[WorkbenchAuxiliaryReadyInput], { success: true }>(
    'workbenchWindow:auxiliaryReady',
    (args) => ipcArgs(workbenchAuxiliaryReadyInputSchema.parse(args[0])),
  ),
  updateBounds: defineIpcInvoke<[WorkbenchAuxiliaryBoundsInput], { success: true }>(
    'workbenchWindow:updateBounds',
    (args) => ipcArgs(workbenchAuxiliaryBoundsInputSchema.parse(args[0])),
  ),
  browserCommand: defineIpcInvoke<[WorkbenchAuxiliaryBrowserCommandInput], { success: true }>(
    'workbenchWindow:browserCommand',
    (args) => ipcArgs(workbenchAuxiliaryBrowserCommandInputSchema.parse(args[0])),
  ),
} as const

export const workbenchWindowIpcEvents = {
  projectionChanged: 'workbenchWindow:projectionChanged',
  placementChanged: 'workbenchWindow:placementChanged',
  recoveryChanged: 'workbenchWindow:recoveryChanged',
  tabDetachReleased: 'workbenchWindow:tabDetachReleased',
} as const

export interface WorkbenchWindowApiContract {
  getBootstrap: () => Promise<WorkbenchWindowBootstrap>
  getProjection: () => Promise<WorkbenchWindowProjection>
  moveTabToNewWindow: (input: WorkbenchMoveTabInput) => Promise<WorkbenchWindowCommandResult>
  returnTabToMain: (input: WorkbenchReturnTabInput) => Promise<WorkbenchWindowCommandResult>
  auxiliaryReady: (input: WorkbenchAuxiliaryReadyInput) => Promise<{ success: true }>
  updateBounds: (input: WorkbenchAuxiliaryBoundsInput) => Promise<{ success: true }>
  browserCommand: (input: WorkbenchAuxiliaryBrowserCommandInput) => Promise<{ success: true }>
  onProjectionChanged: (callback: (projection: WorkbenchWindowProjection) => void) => () => void
  onPlacementChanged: (callback: (placement: WorkbenchPlacementChanged) => void) => () => void
  onUrlChanged: (callback: (payload: BrowserUrlChangedPayload) => void) => () => void
  onPageMetaChanged: (callback: (payload: BrowserPageMetaChangedPayload) => void) => () => void
  onFindShortcutTriggered: (
    callback: (payload: BrowserFindShortcutTriggeredPayload) => void,
  ) => () => void
  onFindResult: (callback: (payload: BrowserFindResultPayload) => void) => () => void
  onTaskChanged: (callback: (payload: BrowserTaskChangedPayload) => void) => () => void
  onDownloadChanged: (callback: (payload: BrowserDownloadChangedPayload) => void) => () => void
  onNativeContextMenuOpened: (
    callback: (payload: BrowserNativeContextMenuOpenedPayload) => void,
  ) => () => void
}

export interface WorkbenchMainWindowApiContract extends WorkbenchWindowApiContract {
  beginTabDetachDrag: (input: WorkbenchTabDetachDragInput) => Promise<{ success: true }>
  finishTabDetachDrag: (
    input: WorkbenchTabDetachDragInput,
  ) => Promise<WorkbenchWindowDropPoint | null>
  cancelTabDetachDrag: (input: WorkbenchTabDetachDragInput) => Promise<{ success: true }>
  onTabDetachReleased: (callback: (payload: WorkbenchTabDetachReleased) => void) => () => void
}
