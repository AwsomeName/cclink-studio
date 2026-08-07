import type { IpcMainInvokeEvent } from 'electron'
import type {
  WorkspaceStateSection,
  WorkspaceStateSetSectionOptions,
} from '../../shared/ipc/workspace-state'
import { WorkspaceStateService } from './workspace-state-service'
import { registerTrustedIpcHandler, type TrustedRendererGuard } from '../ipc/trusted-renderer-guard'
import {
  workspaceStateOwnerKeySchema,
  workspaceStateSectionSchema,
  workspaceStateSetSectionOptionsSchema,
  workspaceStateValueSchema,
  workspaceStateWorkspaceKeySchema,
} from '../ipc/workbench-ipc-schema'
import { absolutePathSchema } from '../ipc/ipc-input-schema'

export function registerWorkspaceStateIpc(
  workspaceStateService: WorkspaceStateService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  const handle = <Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
  ): void => registerTrustedIpcHandler(channel, trustedRendererGuard, handler)

  handle('workspaceState:resolveLocalWorkspace', (_event, workspacePath: string) => {
    return workspaceStateService.resolveLocalWorkspace(absolutePathSchema.parse(workspacePath))
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
        const parsedValue = workspaceStateValueSchema.parse(value)
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
        const message = error instanceof Error ? error.message : String(error)
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
