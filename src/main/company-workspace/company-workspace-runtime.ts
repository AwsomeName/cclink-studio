import { realpath } from 'node:fs/promises'
import type { CclinkStudioRuntimeState } from '../runtime/app-runtime'
import type { RuntimeService } from '../runtime/service-registry'
import {
  TrustedIpcRegistrationScope,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import { companyWorkspaceIpcEvents } from '../../shared/company-workspace/company-workspace'
import { registerCompanyWorkspaceIpc } from './company-workspace-ipc'
import { CompanyWorkspaceError, CompanyWorkspaceService } from './company-workspace-service'

export function createCompanyWorkspaceRuntime(runtime: CclinkStudioRuntimeState): RuntimeService {
  let registration: TrustedIpcRegistrationScope | null = null
  return {
    name: 'company-workspace',
    start: () => {
      const trusted = runtime.trustedRendererGuard
      if (!trusted) return
      registration = new TrustedIpcRegistrationScope()
      const guard: TrustedRendererGuard = {
        assert: (event) => trusted.assert(event),
        isTrusted: (event) => trusted.isTrusted(event),
        ipcRegistrations: registration,
      }
      try {
        runtime.companyWorkspaceService = new CompanyWorkspaceService({
          finance: (target, month) =>
            runtime.companyAccountsService?.getSnapshotForWorkspace(target.workspacePath, month) ??
            null,
          conversations: async (target) => {
            const identity = await runtime.localIdentityService?.ensureIdentity()
            const snapshot = await runtime.workspaceStateService?.getSnapshot(
              target.workspacePath,
              identity ? `local:${identity.localId}` : null,
            )
            const section = snapshot?.sections.agentConversations as
              | {
                  conversations?: Record<
                    string,
                    { id?: string; title?: string; archivedAt?: number }
                  >
                }
              | undefined
            return Object.entries(section?.conversations ?? {})
              .filter(([, item]) => !item.archivedAt)
              .slice(0, 500)
              .map(([id, item]) => ({
                id,
                title: String(item.title ?? '未命名会话').slice(0, 128),
              }))
          },
          publications: (target) => {
            const result = runtime.webAffairService?.getProjectSnapshot(target.workspaceId)
            if (!result?.success) return null
            return result.data.affairs
              .filter((affair) => affair.articlePublishing)
              .map((affair) => ({
                id: affair.id,
                title: affair.title,
                status: affair.articlePublishing!.publication.status,
                url: affair.articlePublishing!.publication.url,
                observedAt: affair.articlePublishing!.publication.observedAt,
              }))
          },
          changed: (workspaceId, revision) => {
            if (!runtime.mainWindow?.isDestroyed())
              runtime.mainWindow?.webContents.send(companyWorkspaceIpcEvents.changed, {
                workspaceId,
                revision,
              })
          },
        })
      } catch {
        runtime.companyWorkspaceService = null
      }
      registerCompanyWorkspaceIpc(
        () => runtime.companyWorkspaceService,
        guard,
        async (event, input) => {
          if (!runtime.fileService?.canActivateWorkspace(event.sender.id, input.workspaceRef.path))
            throw new CompanyWorkspaceError(
              'WORKSPACE_DENIED',
              '请从工作空间选择器打开已授权的本地目录',
            )
          const workspacePath = await realpath(input.workspaceRef.path)
          const workspaceId = await runtime.workspaceStateService?.getLocalProjectId(workspacePath)
          if (!workspaceId)
            throw new CompanyWorkspaceError(
              'WORKSPACE_DENIED',
              '公司视图需要一个有稳定身份的本地工作空间',
            )
          return { workspacePath, workspaceId }
        },
      )
    },
    stop: async () => {
      registration?.dispose()
      registration = null
      await runtime.companyWorkspaceService?.dispose()
      runtime.companyWorkspaceService = null
    },
  }
}
