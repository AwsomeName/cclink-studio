import type { IpcMainInvokeEvent } from 'electron'
import type { IpcInvokeContract } from '../../shared/ipc/contract'
import { companyWorkspaceIpcContracts } from '../../shared/company-workspace/company-workspace-contract'
import type {
  CompanyWorkspaceResult,
  CompanyWorkspaceScope,
  CompanyWorkspaceSnapshot,
} from '../../shared/company-workspace/company-workspace-types'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import {
  CompanyWorkspaceError,
  CompanyWorkspaceService,
  type CompanyWorkspaceTarget,
} from './company-workspace-service'

export function registerCompanyWorkspaceIpc(
  getService: () => CompanyWorkspaceService | null,
  guard: TrustedRendererGuard,
  resolveTarget: (
    event: IpcMainInvokeEvent,
    input: CompanyWorkspaceScope,
  ) => Promise<CompanyWorkspaceTarget>,
): void {
  function handle<T extends CompanyWorkspaceScope>(
    contract: IpcInvokeContract<[T], CompanyWorkspaceResult<CompanyWorkspaceSnapshot>>,
    invoke: (
      service: CompanyWorkspaceService,
      target: CompanyWorkspaceTarget,
      input: T,
    ) => Promise<CompanyWorkspaceSnapshot>,
  ): void {
    registerTrustedIpcContract(
      contract,
      guard,
      async (event, input): Promise<CompanyWorkspaceResult<CompanyWorkspaceSnapshot>> => {
        try {
          const service = getService()
          if (!service)
            throw new CompanyWorkspaceError(
              'SERVICE_UNAVAILABLE',
              '公司能力当前不可用，其他本地功能可继续使用',
            )
          return {
            success: true,
            data: await invoke(service, await resolveTarget(event, input), input),
          }
        } catch (error) {
          return {
            success: false,
            error: {
              code: error instanceof CompanyWorkspaceError ? error.code : 'IO_ERROR',
              message:
                error instanceof CompanyWorkspaceError
                  ? error.message
                  : '公司资料无法读取或保存，原数据已保留；请检查目录权限和数据文件',
            },
          }
        }
      },
    )
  }
  handle(companyWorkspaceIpcContracts.getSnapshot, (service, target, input) =>
    service.getSnapshot(target, input.month),
  )
  handle(companyWorkspaceIpcContracts.configure, (service, target, input) =>
    service.configure(target, input),
  )
  handle(companyWorkspaceIpcContracts.createBusiness, (service, target, input) =>
    service.createBusiness(target, input),
  )
  handle(companyWorkspaceIpcContracts.updateBusiness, (service, target, input) =>
    service.updateBusiness(target, input),
  )
  handle(companyWorkspaceIpcContracts.linkResource, (service, target, input) =>
    service.linkResource(target, input),
  )
  handle(companyWorkspaceIpcContracts.unlinkResource, (service, target, input) =>
    service.unlinkResource(target, input),
  )
}
