import { mediaRenderIpcContracts as mediaRenderIpc } from '../../shared/media-production/media-render-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { MediaRenderService } from './media-render-service'

export function registerMediaRenderIpc(
  service: MediaRenderService,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(mediaRenderIpc.getRuntimeStatus, trustedRendererGuard, () =>
    service.getRuntimeStatus(),
  )
  registerTrustedIpcContract(mediaRenderIpc.createTask, trustedRendererGuard, (_event, input) =>
    service.createTask(input),
  )
  registerTrustedIpcContract(
    mediaRenderIpc.listTasks,
    trustedRendererGuard,
    (_event, workspacePath, projectId) => service.listTasks(workspacePath, projectId),
  )
  registerTrustedIpcContract(
    mediaRenderIpc.retryTask,
    trustedRendererGuard,
    (_event, workspacePath, taskId) => service.retryTask(workspacePath, taskId),
  )
}
