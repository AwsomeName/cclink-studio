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
import type { MediaAssetService } from './media-asset-service'
import type { MediaImageGenerationService } from './media-image-generation-service'
import type { MediaSearchService } from './media-search-service'

export function registerMediaProjectIpc(
  service: MediaProjectService,
  trustedRendererGuard: TrustedRendererGuard,
  mainWindow?: BrowserWindow,
  proposalService?: StoryboardProposalService,
  assetService?: MediaAssetService,
  imageGenerationService?: MediaImageGenerationService,
  searchService?: MediaSearchService,
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
  registerTrustedIpcContract(mediaProjectsIpc.importAsset, trustedRendererGuard, (_event, input) =>
    assetService
      ? assetService.importAsset(input)
      : Promise.resolve({
          success: false as const,
          error: {
            code: 'MEDIA_PROJECT_ASSET_IMPORT_FAILED' as const,
            message: '素材服务尚未就绪',
            recovery: '重启 Studio 后重试',
          },
        }),
  )
  registerTrustedIpcContract(mediaProjectsIpc.getImageProviders, trustedRendererGuard, () =>
    Promise.resolve(
      imageGenerationService?.getProviders() ?? {
        success: false as const,
        providers: [],
        error: {
          code: 'MEDIA_PROJECT_IMAGE_PROVIDER_UNAVAILABLE' as const,
          message: '图片生成服务尚未就绪',
        },
      },
    ),
  )
  registerTrustedIpcContract(
    mediaProjectsIpc.generateSceneImage,
    trustedRendererGuard,
    (_event, input) =>
      imageGenerationService?.generate(input) ??
      Promise.resolve({
        success: false as const,
        error: {
          code: 'MEDIA_PROJECT_IMAGE_PROVIDER_UNAVAILABLE' as const,
          message: '图片生成服务尚未就绪',
        },
      }),
  )
  registerTrustedIpcContract(
    mediaProjectsIpc.searchAssets,
    trustedRendererGuard,
    (_event, input) =>
      searchService?.search(input) ??
      Promise.resolve({
        success: false as const,
        provider: 'pexels' as const,
        configured: false,
        candidates: [],
        error: {
          code: 'MEDIA_PROJECT_SEARCH_PROVIDER_UNAVAILABLE' as const,
          message: '素材搜索服务尚未就绪',
        },
      }),
  )
  registerTrustedIpcContract(
    mediaProjectsIpc.addSearchCandidate,
    trustedRendererGuard,
    (_event, input) =>
      searchService?.addCandidate(input) ??
      Promise.resolve({
        success: false as const,
        error: {
          code: 'MEDIA_PROJECT_SEARCH_PROVIDER_UNAVAILABLE' as const,
          message: '素材搜索服务尚未就绪',
        },
      }),
  )
  if (!mainWindow) return () => undefined
  return service.onChanged((workspacePath) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(mediaProjectsIpcEvents.changed, workspacePath)
    }
  })
}
