import { workspaceStateIpcContracts } from '../../shared/ipc/workbench-contract'
import { WorkspaceStateService } from './workspace-state-service'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { SettingsService } from '../settings/settings-service'

export function registerWorkspaceStateIpc(
  workspaceStateService: WorkspaceStateService,
  trustedRendererGuard: TrustedRendererGuard,
  settingsService?: SettingsService,
): void {
  registerTrustedIpcContract(
    workspaceStateIpcContracts.resolveLocalWorkspace,
    trustedRendererGuard,
    (_event, workspacePath) => workspaceStateService.resolveLocalWorkspace(workspacePath),
  )

  registerTrustedIpcContract(
    workspaceStateIpcContracts.setActiveLocalWorkspace,
    trustedRendererGuard,
    async (_event, workspacePath) => {
      try {
        const activeWorkspace = await workspaceStateService.setActiveLocalWorkspace(workspacePath)
        if (settingsService) {
          await settingsService.set({ lastWorkspacePath: activeWorkspace.workspacePath ?? '' })
        }
        return { success: true, activeWorkspace }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  registerTrustedIpcContract(
    workspaceStateIpcContracts.get,
    trustedRendererGuard,
    async (_event, workspaceKey, ownerKey) =>
      workspaceStateService.getSnapshot(workspaceKey, ownerKey),
  )

  registerTrustedIpcContract(
    workspaceStateIpcContracts.setSection,
    trustedRendererGuard,
    async (_event, workspaceKey, section, value: unknown, ownerKey, options) => {
      try {
        if (section === 'tabs' || section === 'browserTabs' || section === 'browserBookmarks') {
          throw new Error(`${section} 已由主进程 Workbench model 单独拥有，renderer 不得直接写入`)
        }
        const snapshot = options
          ? await workspaceStateService.setSection(workspaceKey, section, value, ownerKey, options)
          : await workspaceStateService.setSection(workspaceKey, section, value, ownerKey)
        return { success: true, snapshot }
      } catch (error: unknown) {
        return {
          success: false,
          error: `保存 ${section} 失败：${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  )

  registerTrustedIpcContract(
    workspaceStateIpcContracts.clear,
    trustedRendererGuard,
    async (_event, workspaceKey, ownerKey) => {
      try {
        await workspaceStateService.clear(workspaceKey, ownerKey)
        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  )

  registerTrustedIpcContract(
    workspaceStateIpcContracts.listLocalWorkspaces,
    trustedRendererGuard,
    (_event, ownerKey) => workspaceStateService.listLocalWorkspaces(ownerKey),
  )

  registerTrustedIpcContract(workspaceStateIpcContracts.diagnostics, trustedRendererGuard, () => {
    return workspaceStateService.getDiagnostics()
  })
}
