import { gitIpcContracts } from '../../shared/git'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { GitWorkspaceService } from './git-workspace-service'

export function registerGitIpc(
  service: GitWorkspaceService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(
    gitIpcContracts.getSnapshot,
    trustedRendererGuard,
    (_event, workspacePath) => service.getSnapshot(workspacePath),
  )
  registerTrustedIpcContract(gitIpcContracts.getDiff, trustedRendererGuard, (_event, input) =>
    service.getDiff(input),
  )
  registerTrustedIpcContract(gitIpcContracts.commit, trustedRendererGuard, (_event, input) =>
    service.commit(input),
  )
  registerTrustedIpcContract(gitIpcContracts.push, trustedRendererGuard, (_event, input) =>
    service.push(input),
  )
}
