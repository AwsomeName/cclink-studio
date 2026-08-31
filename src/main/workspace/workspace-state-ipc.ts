import { workspaceStateIpcContracts } from '../../shared/ipc/workbench-contract'
import { WorkspaceStateService } from './workspace-state-service'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { SettingsService } from '../settings/settings-service'
import type { FileService } from '../fs/file-service'

export function registerWorkspaceStateIpc(
  workspaceStateService: WorkspaceStateService,
  trustedRendererGuard: TrustedRendererGuard,
  settingsService?: SettingsService,
  fileService?: FileService,
): void {
  registerTrustedIpcContract(
    workspaceStateIpcContracts.resolveLocalWorkspace,
    trustedRendererGuard,
    async (event, workspacePath) => {
      if (fileService && !fileService.canActivateWorkspace(event.sender.id, workspacePath)) {
        return {
          valid: false,
          workspacePath: null,
          error: '工作空间必须来自主进程文件选择器或已登记的最近项目',
        }
      }
      const result = await workspaceStateService.resolveLocalWorkspace(workspacePath)
      if (fileService && result.valid && result.workspacePath) {
        fileService.registerPickerSelection(event.sender.id, [result.workspacePath], 'workspace')
      }
      return result
    },
  )

  registerTrustedIpcContract(
    workspaceStateIpcContracts.setActiveLocalWorkspace,
    trustedRendererGuard,
    async (_event, workspacePath) => {
      try {
        if (
          workspacePath &&
          fileService &&
          !fileService.consumeWorkspaceActivation(_event.sender.id, workspacePath)
        ) {
          throw new Error('工作空间授权已失效，请重新从项目选择器打开')
        }
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
    (event, ownerKey) => {
      const workspaces = workspaceStateService.listLocalWorkspaces(ownerKey)
      fileService?.registerPickerSelection(
        event.sender.id,
        workspaces.map((workspace) => workspace.workspacePath),
        'workspace',
      )
      return workspaces
    },
  )

  registerTrustedIpcContract(workspaceStateIpcContracts.diagnostics, trustedRendererGuard, () => {
    return workspaceStateService.getDiagnostics()
  })
}
