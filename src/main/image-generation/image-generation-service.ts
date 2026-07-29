import { JimengImageProvider, type JimengCredentials } from './providers/jimeng-image-provider'
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

  constructor(getMeshyApiKey: () => string, getJimengCredentials: () => JimengCredentials) {
    const meshy = new MeshyImageProvider(getMeshyApiKey)
    const jimeng = new JimengImageProvider(getJimengCredentials)
    this.providers = new Map<ImageGenerationProviderId, ImageGenerationProvider>([
      [meshy.id, meshy],
      [jimeng.id, jimeng],
    ])
  }

  getStatus(): ImageGenerationProviderStatus[] {
    return Array.from(this.providers.values(), (provider) => provider.getStatus())
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const providerId = request.provider ?? this.getDefaultProviderId()
    const provider = this.providers.get(providerId)
    if (!provider) throw new Error(`未安装图片生成服务商: ${providerId}`)
    return provider.generate(request)
  }

  getDefaultProviderId(): ImageGenerationProviderId {
    return this.getStatus().find((provider) => provider.configured)?.id ?? 'meshy'
  }
}
