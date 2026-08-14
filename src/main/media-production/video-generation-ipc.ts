import { mediaVideoIpcContracts as mediaVideoIpc } from '../../shared/media-production/video-generation-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { VideoGenerationService } from './video-generation-service'

export function registerVideoGenerationIpc(
  service: VideoGenerationService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(mediaVideoIpc.getProviders, trustedRendererGuard, () =>
    Promise.resolve(service.getProviders()),
  )
  registerTrustedIpcContract(mediaVideoIpc.createTask, trustedRendererGuard, (_event, input) =>
    service.createTask(input),
  )
  registerTrustedIpcContract(
    mediaVideoIpc.listTasks,
    trustedRendererGuard,
    (_event, workspacePath, projectId) => service.listTasks(workspacePath, projectId),
  )
  registerTrustedIpcContract(
    mediaVideoIpc.retryTask,
    trustedRendererGuard,
    (_event, workspacePath, taskId) => service.retryTask(workspacePath, taskId),
  )
}
