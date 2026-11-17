import {
  personalDiarySourceSchema,
  personalDiarySourceSection,
} from '../../shared/personal-diary-source'
import { workspaceStateIpcContracts } from '../../shared/ipc/workbench-contract'
import { WorkspaceStateService } from './workspace-state-service'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { SettingsService } from '../settings/settings-service'
import type { FileService } from '../fs/file-service'
import type { WebContents } from 'electron'
import { isAbsolute } from 'node:path'
import type { DefaultWorkspaceResult } from '../../shared/ipc/workspace-state'
import type { CompanyWorkspaceService } from '../company-workspace/company-workspace-service'

export function registerWorkspaceStateIpc(
  workspaceStateService: WorkspaceStateService,
  trustedRendererGuard: TrustedRendererGuard,
  settingsService?: SettingsService,
  fileService?: FileService,
  getCompanyService?: () => CompanyWorkspaceService | null,
): void {
  registerTrustedIpcContract(
    workspaceStateIpcContracts.diaryDocument,
    trustedRendererGuard,
    (_event, input) => workspaceStateService.diaryDocument(input),
  )
  const cleanupBoundSenders = new WeakSet<WebContents>()
  const bindCapabilityCleanup = (sender: WebContents): void => {
    if (!fileService || cleanupBoundSenders.has(sender) || typeof sender.once !== 'function') return
    cleanupBoundSenders.add(sender)
    sender.once('destroyed', () => fileService.releaseRendererCapabilities(sender.id))
  }
  const assertWorkspaceAccess = (rendererId: number, workspaceKey?: string | null): void => {
    if (
      workspaceKey &&
      isAbsolute(workspaceKey) &&
      fileService &&
      !fileService.canActivateWorkspace(rendererId, workspaceKey)
    ) {
      throw new Error('工作空间状态只能访问当前项目或主进程已授权的项目')
    }
  }
  registerTrustedIpcContract(
    workspaceStateIpcContracts.verifyLocalIdentity,
    trustedRendererGuard,
    async (event, path, id) => {
      assertWorkspaceAccess(event.sender.id, path)
      await workspaceStateService.verifyLocalIdentity(path, id)
    },
  )
  const defaultFailure = (error: unknown): DefaultWorkspaceResult => ({
    success: false,
    workspacePath: null,
    errorCode: 'DEFAULT_WORKSPACE_UNAVAILABLE',
    error: error instanceof Error ? error.message : '默认工作空间当前不可用',
  })
  const grant = (sender: WebContents, paths: string[]): void => {
    bindCapabilityCleanup(sender)
    fileService?.registerKnownWorkspaces(sender.id, paths)
    fileService?.registerPickerSelection(sender.id, paths, 'workspace')
  }
  registerTrustedIpcContract(workspaceStateIpcContracts.getFixedSpaces, trustedRendererGuard, () =>
    workspaceStateService.getFixedSpaces(),
  )
  registerTrustedIpcContract(
    workspaceStateIpcContracts.ensurePersonalSpace,
    trustedRendererGuard,
    async (event) => {
      const fixed = await workspaceStateService.ensurePersonalSpace(
        settingsService?.getAll().defaultWorkspacePath,
      )
      if (fixed.personal) grant(event.sender, [fixed.personal.workspacePath])
      return fixed
    },
  )
  registerTrustedIpcContract(
    workspaceStateIpcContracts.listCompanySpaces,
    trustedRendererGuard,
    async (event) => {
      const candidates = await workspaceStateService.listCompanySpaces()
      grant(
        event.sender,
        candidates.map((item) => item.workspacePath),
      )
      return candidates
    },
  )
  registerTrustedIpcContract(
    workspaceStateIpcContracts.inspectCompanySpace,
    trustedRendererGuard,
    async (event, path) => {
      assertWorkspaceAccess(event.sender.id, path)
      return workspaceStateService.inspectCompanySpace(path)
    },
  )
  registerTrustedIpcContract(
    workspaceStateIpcContracts.connectCompanySpace,
    trustedRendererGuard,
    async (event, input) => {
      if (input.workspacePath) assertWorkspaceAccess(event.sender.id, input.workspacePath)
      const fixed = await workspaceStateService.connectCompanySpace(input, async (target, name) => {
        const service = getCompanyService?.()
        if (!service) throw new Error('公司能力当前不可用，请稍后重试；原资料已保留')
        await service.configure(target, {
          workspaceRef: { kind: 'local', path: target.workspacePath },
          name,
          enabled: true,
          month: new Date().toISOString().slice(0, 7),
        })
      })
      grant(
        event.sender,
        [fixed.personal?.workspacePath, fixed.company?.workspacePath].filter(
          (path): path is string => Boolean(path),
        ),
      )
      return fixed
    },
  )
  registerTrustedIpcContract(
    workspaceStateIpcContracts.resolveFixedSpace,
    trustedRendererGuard,
    async (event, role) => {
      try {
        const workspacePath = await workspaceStateService.resolveFixedSpace(role)
        grant(event.sender, [workspacePath])
        return { success: true, workspacePath }
      } catch (error) {
        return defaultFailure(error)
      }
    },
  )
  registerTrustedIpcContract(
    workspaceStateIpcContracts.getDefaultWorkspace,
    trustedRendererGuard,
    () => ({
      success: true,
      workspacePath:
        workspaceStateService.getFixedSpaces().personal?.workspacePath ??
        workspaceStateService.getDefaultWorkspacePath(
          settingsService?.getAll().defaultWorkspacePath,
        ),
    }),
  )
  registerTrustedIpcContract(
    workspaceStateIpcContracts.ensureDefaultWorkspace,
    trustedRendererGuard,
    async (event) => {
      bindCapabilityCleanup(event.sender)
      try {
        if (!settingsService) throw new Error('设置服务当前不可用')
        const fixed = await workspaceStateService.ensurePersonalSpace(
          settingsService.getAll().defaultWorkspacePath,
        )
        const workspacePath = fixed.personal!.workspacePath
        fileService?.registerKnownWorkspaces(event.sender.id, [workspacePath])
        fileService?.registerPickerSelection(event.sender.id, [workspacePath], 'workspace')
        return { success: true, workspacePath }
      } catch (error) {
        return defaultFailure(error)
      }
    },
  )
  registerTrustedIpcContract(
    workspaceStateIpcContracts.setDefaultWorkspace,
    trustedRendererGuard,
    async (event, path) => {
      bindCapabilityCleanup(event.sender)
      try {
        if (!settingsService || !fileService?.canActivateWorkspace(event.sender.id, path)) {
          throw new Error('请先通过工作空间选择器打开要设为默认的目录')
        }
        const resolved = await workspaceStateService.resolveLocalWorkspace(path)
        if (!resolved.valid || !resolved.workspacePath) throw new Error(resolved.error)
        await workspaceStateService.setPersonalSpace(resolved.workspacePath)
        return { success: true, workspacePath: resolved.workspacePath }
      } catch (error) {
        return defaultFailure(error)
      }
    },
  )
  registerTrustedIpcContract(
    workspaceStateIpcContracts.resolveLocalWorkspace,
    trustedRendererGuard,
    async (event, workspacePath) => {
      bindCapabilityCleanup(event.sender)
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
    async (_event, workspacePath, intent = 'selection') => {
      bindCapabilityCleanup(_event.sender)
      try {
        if (
          workspacePath &&
          fileService &&
          !fileService.consumeWorkspaceActivation(_event.sender.id, workspacePath)
        ) {
          throw new Error('工作空间授权已失效，请重新从项目选择器打开')
        }
        const activeWorkspace = await workspaceStateService.setActiveLocalWorkspace(workspacePath)
        if (settingsService && intent !== 'restore') {
          const path = activeWorkspace.workspacePath
          await settingsService.set({
            lastWorkspacePath: path ?? '',
            startupWorkspaceTarget:
              intent === 'remote'
                ? 'resume'
                : path
                  ? path === workspaceStateService.getFixedSpaces().personal?.workspacePath
                    ? 'default'
                    : 'resume'
                  : 'unfiled',
          })
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
    async (event, workspaceKey, ownerKey) => {
      assertWorkspaceAccess(event.sender.id, workspaceKey)
      return workspaceStateService.getSnapshot(workspaceKey, ownerKey)
    },
  )

  registerTrustedIpcContract(
    workspaceStateIpcContracts.setSection,
    trustedRendererGuard,
    async (_event, workspaceKey, section, value: unknown, ownerKey, options) => {
      try {
        assertWorkspaceAccess(_event.sender.id, workspaceKey)
        if (section === personalDiarySourceSection) {
          if (workspaceKey || ownerKey) throw new Error('个人资料连接仅保存在本机全局状态')
          if (value !== null) {
            const source = personalDiarySourceSchema.parse(value)
            const known = workspaceStateService
              .listLocalWorkspaces()
              .find(
                (item) =>
                  item.workspacePath === source.workspacePath &&
                  item.projectId === source.projectId,
              )
            if (!known) throw new Error('请先打开来源工作空间，确认其原身份')
            assertWorkspaceAccess(_event.sender.id, source.workspacePath)
            await workspaceStateService.verifyLocalIdentity(source.workspacePath, source.projectId)
            value = source
          }
        }
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
          errorCode: 'workspace_flush_failed' as const,
        }
      }
    },
  )

  registerTrustedIpcContract(
    workspaceStateIpcContracts.clear,
    trustedRendererGuard,
    async (_event, workspaceKey, ownerKey) => {
      try {
        assertWorkspaceAccess(_event.sender.id, workspaceKey)
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
      bindCapabilityCleanup(event.sender)
      const workspaces = workspaceStateService.listLocalWorkspaces(ownerKey)
      const workspacePaths = workspaces.map((workspace) => workspace.workspacePath)
      fileService?.registerKnownWorkspaces(event.sender.id, workspacePaths)
      // Startup recovery probes these roots with fs:isDirectory before any one
      // of them becomes active. Keep the bounded browse grant as well as the
      // renderer-lifetime reactivation grant above.
      fileService?.registerPickerSelection(event.sender.id, workspacePaths, 'workspace')
      return workspaces
    },
  )

  registerTrustedIpcContract(workspaceStateIpcContracts.diagnostics, trustedRendererGuard, () => {
    return workspaceStateService.getDiagnostics()
  })
}
