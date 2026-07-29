import { describe, expect, it } from 'vitest'
import { ImageGenerationService } from './image-generation-service'

describe('ImageGenerationService provider selection', () => {
  it('selects Jimeng when Meshy is absent and Jimeng AK/SK are configured', () => {
    const service = new ImageGenerationService(
      () => '',
      () => ({ accessKeyId: 'ak', secretAccessKey: 'sk' }),
    )

    expect(service.getStatus()).toMatchObject([
      { id: 'meshy', configured: false },
      { id: 'jimeng', configured: true, models: ['jimeng-4.0'] },
    ])
    expect(service.getDefaultProviderId()).toBe('jimeng')
  })

  it('keeps explicit provider choice independent from default selection', async () => {
    const service = new ImageGenerationService(
      () => 'meshy-key',
      () => ({ accessKeyId: 'ak', secretAccessKey: 'sk' }),
    )

    await expect(
      service.generate({ provider: 'jimeng', model: 'nano-banana', prompt: 'test' }),
    ).rejects.toThrow('不支持的即梦图片模型: nano-banana')
  })
})
