import type {
  GenerateMediaSceneImageInput,
  MediaImageProviderStatusResult,
  MediaProjectAssetImportResult,
} from '../../shared/media-production/media-project-types'
import type { ImageGenerationService } from '../image-generation/image-generation-service'
import type { UsageLedgerService } from '../usage/usage-ledger-service'
import type { MediaAssetService } from './media-asset-service'
import type { MediaProjectService } from './media-project-service'

export class MediaImageGenerationService {
  constructor(
    private readonly projectService: MediaProjectService,
    private readonly assetService: MediaAssetService,
    private readonly getImageGenerationService: () => ImageGenerationService | null,
    private readonly getUsageLedgerService: () => UsageLedgerService | null,
  ) {}

  getProviders(): MediaImageProviderStatusResult {
    const service = this.getImageGenerationService()
    if (!service) {
      return {
        success: false,
        providers: [],
        error: {
          code: 'MEDIA_PROJECT_IMAGE_PROVIDER_UNAVAILABLE',
          message: '图片生成服务尚未就绪',
          recovery: '检查图片 Provider 设置后重试；本地素材仍可使用',
        },
      }
    }
    return { success: true, providers: service.getStatus() }
  }

  async generate(input: GenerateMediaSceneImageInput): Promise<MediaProjectAssetImportResult> {
    const service = this.getImageGenerationService()
    if (!service) return this.unavailable()
    const projectResult = await this.projectService.get(input.workspacePath, input.projectId)
    if (!projectResult.success) return projectResult
    if (!projectResult.project.scenes.some((scene) => scene.id === input.sceneId)) {
      return {
        success: false,
        error: {
          code: 'MEDIA_PROJECT_INVALID',
          message: '当前场景尚未保存或已经不存在',
          recovery: '先保存工程，再为该场景生成图片',
        },
      }
    }
    const provider = service.getStatus().find((status) => status.id === input.provider)
    if (!provider?.configured) return this.unavailable(provider?.reason)

    try {
      const image = await service.generate({
        provider: input.provider,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
      })
      const asset = await this.assetService.storeGeneratedImage({
        workspacePath: input.workspacePath,
        projectId: input.projectId,
        content: image.content,
        mimeType: image.mimeType,
        fileName: `scene-${input.sceneId.slice(0, 8)}`,
        provider: image.provider,
        model: image.model,
        taskId: image.taskId,
        prompt: input.prompt,
      })
      await this.getUsageLedgerService()
        ?.record({
          conversationId: `media-project:${input.projectId}`,
          source: 'image-generation',
          provider: image.provider,
          model: image.model,
          quantity: 1,
          unit: image.consumedCredits === undefined ? 'image' : 'credit',
          ...(image.consumedCredits === undefined ? {} : { amount: image.consumedCredits }),
          estimated: false,
          status: 'succeeded',
          taskId: image.taskId,
        })
        .catch((error) => {
          console.warn('[MediaImageGenerationService] 记录图片用量失败:', error)
        })
      return { success: true, asset }
    } catch (error) {
      await this.getUsageLedgerService()
        ?.record({
          conversationId: `media-project:${input.projectId}`,
          source: 'image-generation',
          provider: input.provider,
          quantity: 1,
          unit: 'image',
          estimated: false,
          status: 'failed',
        })
        .catch(() => undefined)
      return {
        success: false,
        error: {
          code: 'MEDIA_PROJECT_IMAGE_GENERATION_FAILED',
          message: error instanceof Error ? error.message : '场景图片生成失败',
          recovery: '修改提示词后单独重试当前场景，其他场景不会受影响',
        },
      }
    }
  }

  private unavailable(reason?: string): MediaProjectAssetImportResult {
    return {
      success: false,
      error: {
        code: 'MEDIA_PROJECT_IMAGE_PROVIDER_UNAVAILABLE',
        message: reason || '所选图片 Provider 未配置或不可用',
        recovery: '在设置 → 图像生成中配置 Provider；本地素材仍可使用',
      },
    }
  }
}
