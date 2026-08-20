import type { IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import type {
  WorkspaceStateSection,
  WorkspaceStateSetSectionOptions,
} from '../../shared/ipc/workspace-state'
import { WorkspaceStateService } from './workspace-state-service'
import { registerTrustedIpcHandler, type TrustedRendererGuard } from '../ipc/trusted-renderer-guard'
import {
  workspaceStateOwnerKeySchema,
  parseWorkspaceStateSectionValue,
  workspaceStateSectionSchema,
  workspaceStateSetSectionOptionsSchema,
  workspaceStateWorkspaceKeySchema,
} from '../ipc/workbench-ipc-schema'
import { absolutePathSchema } from '../ipc/ipc-input-schema'
import type { SettingsService } from '../settings/settings-service'

export function registerWorkspaceStateIpc(
  workspaceStateService: WorkspaceStateService,
  trustedRendererGuard: TrustedRendererGuard,
  settingsService?: SettingsService,
): void {
  const handle = <Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
  ): void => registerTrustedIpcHandler(channel, trustedRendererGuard, handler)

  handle('workspaceState:resolveLocalWorkspace', (_event, workspacePath: string) => {
    return workspaceStateService.resolveLocalWorkspace(absolutePathSchema.parse(workspacePath))
  })

  handle('workspaceState:setActiveLocalWorkspace', async (_event, workspacePath: unknown) => {
    try {
      const parsedPath = workspacePath === null ? null : absolutePathSchema.parse(workspacePath)
      const activeWorkspace = await workspaceStateService.setActiveLocalWorkspace(parsedPath)
      if (settingsService) {
        await settingsService.set({ lastWorkspacePath: activeWorkspace.workspacePath ?? '' })
      }
      return { success: true, activeWorkspace }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  handle(
    'workspaceState:get',
    async (_event, workspaceKey?: string | null, ownerKey?: string | null) => {
      return workspaceStateService.getSnapshot(
        workspaceStateWorkspaceKeySchema.parse(workspaceKey),
        workspaceStateOwnerKeySchema.parse(ownerKey),
      )
    },
  )

  handle(
    'workspaceState:setSection',
    async (
      _event,
      workspaceKey: string | null | undefined,
      section: WorkspaceStateSection,
      value: unknown,
      ownerKey?: string | null,
      options?: WorkspaceStateSetSectionOptions,
    ) => {
      try {
        const parsedWorkspaceKey = workspaceStateWorkspaceKeySchema.parse(workspaceKey)
        const parsedSection = workspaceStateSectionSchema.parse(section)
        if (
          parsedSection === 'tabs' ||
          parsedSection === 'browserTabs' ||
          parsedSection === 'browserBookmarks'
        ) {
          throw new Error(
            `${parsedSection} 已由主进程 Workbench model 单独拥有，renderer 不得直接写入`,
          )
        }
        const parsedValue = parseWorkspaceStateSectionValue(parsedSection, value)
        const parsedOwnerKey = workspaceStateOwnerKeySchema.parse(ownerKey)
        const parsedOptions = workspaceStateSetSectionOptionsSchema.parse(options)
        const snapshot = parsedOptions
          ? await workspaceStateService.setSection(
              parsedWorkspaceKey,
              parsedSection,
              parsedValue,
              parsedOwnerKey,
              parsedOptions,
            )
          : await workspaceStateService.setSection(
              parsedWorkspaceKey,
              parsedSection,
              parsedValue,
              parsedOwnerKey,
            )
        return { success: true, snapshot }
      } catch (error: unknown) {
        const message = formatWorkspaceStateWriteError(section, error)
        return { success: false, error: message }
      }
    },
  )

  handle(
    'workspaceState:clear',
    async (_event, workspaceKey?: string | null, ownerKey?: string | null) => {
      try {
        await workspaceStateService.clear(
          workspaceStateWorkspaceKeySchema.parse(workspaceKey),
          workspaceStateOwnerKeySchema.parse(ownerKey),
        )
        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  handle('workspaceState:listLocalWorkspaces', (_event, ownerKey?: string | null) => {
    return workspaceStateService.listLocalWorkspaces(workspaceStateOwnerKeySchema.parse(ownerKey))
  })

  handle('workspaceState:diagnostics', () => {
    return workspaceStateService.getDiagnostics()
  })
}

function formatWorkspaceStateWriteError(section: unknown, error: unknown): string {
  const sectionLabel = typeof section === 'string' && section ? section : 'unknown'
  if (error instanceof ZodError) {
    const details = [...new Set(error.issues.map((issue) => issue.message))].join('；')
    return `保存 ${sectionLabel} 失败：${details || '输入无效'}`
  }
  return `保存 ${sectionLabel} 失败：${error instanceof Error ? error.message : String(error)}`
}
