import { GitBackupError } from '../git-backup/git-backup-error'
import type { GitTransferResult } from '../../shared/git'
import type { FileService } from '../fs/file-service'
import { gitIpcContracts } from '../../shared/git'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { GitWorkspaceService } from './git-workspace-service'

export function registerGitIpc(
  service: GitWorkspaceService,
  trustedRendererGuard: TrustedRendererGuard,
  fileService?: FileService,
): void {
  registerTrustedIpcContract(
    gitIpcContracts.shareWorkspaceSettings,
    trustedRendererGuard,
    (event, path) => {
      if (!fileService?.canActivateWorkspace(event.sender.id, path)) throw Error('请先打开项目')
      return service.shareWorkspaceSettings(path)
    },
  )
  registerTrustedIpcContract(
    gitIpcContracts.transfer,
    trustedRendererGuard,
    async (event, input): Promise<GitTransferResult> => {
      try {
        if (
          input.workspacePath &&
          fileService &&
          !fileService.canActivateWorkspace(event.sender.id, input.workspacePath)
        )
          throw Error('请先通过工作空间选择器登记来源')
        if (
          input.destinationParent &&
          !fileService?.canActivateWorkspace(event.sender.id, input.destinationParent)
        )
          throw Error('请通过目录选择器选择 Git 保存位置')
        if (
          input.destination &&
          (input.action !== 'clone' ||
            !fileService?.canActivateWorkspace(event.sender.id, input.destination))
        )
          throw Error('请通过目录选择器选择拉取的空目录')
        const result = await service.transfer(input)
        if (result.newCopy) {
          fileService?.registerKnownWorkspaces(event.sender.id, [result.workspacePath])
          fileService?.registerPickerSelection(event.sender.id, [result.workspacePath], 'workspace')
        }
        return { success: true, snapshot: result }
      } catch (error) {
        return {
          success: false,
          error: {
            code: error instanceof GitBackupError ? error.code : 'GIT_TRANSFER_FAILED',
            message: error instanceof Error ? error.message : 'Git 操作失败',
            operation: input.action,
          },
        }
      }
    },
  )
  registerTrustedIpcContract(
    gitIpcContracts.getSnapshot,
    trustedRendererGuard,
    (_event, workspacePath) => service.getSnapshot(workspacePath),
  )
  registerTrustedIpcContract(
    gitIpcContracts.previewProjectSync,
    trustedRendererGuard,
    (event, path) => {
      if (fileService && !fileService.canActivateWorkspace(event.sender.id, path))
        throw Error('请先打开项目')
      return service.previewProjectSync(path)
    },
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
