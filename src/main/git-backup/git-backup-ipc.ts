import { gitBackupIpcContracts } from '../../shared/ipc/workbench-contract'
import type { GitBackupService } from './git-backup-service'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

export function registerGitBackupIpc(
  service: GitBackupService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(gitBackupIpcContracts.getAccountStatus, trustedRendererGuard, () =>
    service.getAccountStatus(),
  )
  registerTrustedIpcContract(
    gitBackupIpcContracts.saveAccount,
    trustedRendererGuard,
    (_event, input) => service.saveAccount(input),
  )
  registerTrustedIpcContract(gitBackupIpcContracts.clearAccount, trustedRendererGuard, () =>
    service.clearAccount(),
  )
  registerTrustedIpcContract(
    gitBackupIpcContracts.testAccount,
    trustedRendererGuard,
    (_event, input) => service.testAccount(input),
  )
  registerTrustedIpcContract(
    gitBackupIpcContracts.getProjectStatus,
    trustedRendererGuard,
    (_event, workspacePath) => service.getProjectStatus(workspacePath),
  )
  registerTrustedIpcContract(gitBackupIpcContracts.backup, trustedRendererGuard, (_event, input) =>
    service.backup(input),
  )
}
