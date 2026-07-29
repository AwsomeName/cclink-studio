export type ImageGenerationProviderId = 'meshy'
export type MeshyImageModel = 'nano-banana' | 'nano-banana-2' | 'nano-banana-pro' | 'gpt-image-2'
export type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3'

export interface ImageGenerationRequest {
  provider?: ImageGenerationProviderId
  prompt: string
  model?: MeshyImageModel
  aspectRatio?: ImageAspectRatio
}

export interface GeneratedImage {
  provider: ImageGenerationProviderId
  model: string
  taskId: string
  content: Buffer
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  consumedCredits?: number
}

export interface ImageGenerationProviderStatus {
  id: ImageGenerationProviderId
  configured: boolean
  models: string[]
  reason?: string
}

export interface ImageGenerationProvider {
  readonly id: ImageGenerationProviderId
  getStatus(): ImageGenerationProviderStatus
  generate(request: ImageGenerationRequest): Promise<GeneratedImage>
}
