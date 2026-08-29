import { projectOpsIpcContracts } from '../../shared/ipc/workbench-contract'
import type { ProjectOpsService } from './project-ops-service'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

export function registerProjectOpsIpc(
  projectOpsService: ProjectOpsService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(
    projectOpsIpcContracts.getAccounts,
    trustedRendererGuard,
    (_event, workspacePath) => projectOpsService.getAccounts(workspacePath),
  )

  registerTrustedIpcContract(
    projectOpsIpcContracts.createAccountsTemplate,
    trustedRendererGuard,
    (_event, workspacePath) => projectOpsService.createAccountsTemplate(workspacePath),
  )

  registerTrustedIpcContract(
    projectOpsIpcContracts.createCopyDraft,
    trustedRendererGuard,
    (_event, workspacePath, input) => projectOpsService.createCopyDraft(workspacePath, input),
  )

  registerTrustedIpcContract(
    projectOpsIpcContracts.appendPublicationRecord,
    trustedRendererGuard,
    (_event, workspacePath, input) =>
      projectOpsService.appendPublicationRecord(workspacePath, input),
  )
}
