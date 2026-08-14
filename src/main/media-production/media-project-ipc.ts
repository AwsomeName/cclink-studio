import type { BrowserWindow } from 'electron'
import {
  mediaProjectsIpcContracts as mediaProjectsIpc,
  mediaProjectsIpcEvents,
} from '../../shared/media-production/media-project-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { MediaProjectService } from './media-project-service'
import type { StoryboardProposalService } from './storyboard-proposal-service'

export function registerMediaProjectIpc(
  service: MediaProjectService,
  trustedRendererGuard: TrustedRendererGuard,
  mainWindow?: BrowserWindow,
  proposalService?: StoryboardProposalService,
): () => void {
  registerTrustedIpcContract(mediaProjectsIpc.list, trustedRendererGuard, (_event, workspacePath) =>
    service.list(workspacePath),
  )
  registerTrustedIpcContract(
    mediaProjectsIpc.get,
    trustedRendererGuard,
    (_event, workspacePath, projectId) => service.get(workspacePath, projectId),
  )
  registerTrustedIpcContract(mediaProjectsIpc.create, trustedRendererGuard, (_event, input) =>
    service.create(input),
  )
  registerTrustedIpcContract(mediaProjectsIpc.save, trustedRendererGuard, (_event, input) =>
    service.save(input),
  )
  registerTrustedIpcContract(
    mediaProjectsIpc.proposeStoryboard,
    trustedRendererGuard,
    (_event, input) => {
      if (!proposalService) {
        return Promise.resolve({
          success: false as const,
          error: {
            code: 'MEDIA_PROJECT_AGENT_UNAVAILABLE' as const,
            message: '智能分镜服务尚未就绪',
            recovery: '检查 Agent Runtime 后重试',
          },
        })
      }
      return proposalService.propose(input.project)
    },
  )
  if (!mainWindow) return () => undefined
  return service.onChanged((workspacePath) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(mediaProjectsIpcEvents.changed, workspacePath)
    }
  })
}
