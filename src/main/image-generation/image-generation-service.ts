import { MeshyImageProvider } from './providers/meshy-image-provider'
import type {
  GeneratedImage,
  ImageGenerationProvider,
  ImageGenerationProviderId,
  ImageGenerationProviderStatus,
  ImageGenerationRequest,
} from './types'

export class ImageGenerationService {
  private readonly providers: Map<ImageGenerationProviderId, ImageGenerationProvider>

  constructor(getMeshyApiKey: () => string) {
    const meshy = new MeshyImageProvider(getMeshyApiKey)
    this.providers = new Map([[meshy.id, meshy]])
  }

  getStatus(): ImageGenerationProviderStatus[] {
    return Array.from(this.providers.values(), (provider) => provider.getStatus())
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const providerId = request.provider ?? 'meshy'
    const provider = this.providers.get(providerId)
    if (!provider) throw new Error(`未安装图片生成服务商: ${providerId}`)
    return provider.generate(request)
  }
}
