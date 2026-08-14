import { describe, expect, it, vi } from 'vitest'
import { MediaImageGenerationService } from './media-image-generation-service'

describe('MediaImageGenerationService', () => {
  it('reuses ImageGenerationService, records usage and stores the output as a project asset', async () => {
    const sceneId = '22222222-2222-4222-8222-222222222222'
    const generate = vi.fn(async () => ({
      provider: 'jimeng' as const,
      model: 'jimeng-4.0',
      taskId: 'task-1',
      content: Buffer.from('png'),
      mimeType: 'image/png' as const,
    }))
    const storeGeneratedImage = vi.fn(async () => ({ id: 'asset-1' }))
    const record = vi.fn(async () => undefined)
    const service = new MediaImageGenerationService(
      {
        get: vi.fn(async () => ({ success: true, project: { scenes: [{ id: sceneId }] } })),
      } as never,
      { storeGeneratedImage } as never,
      () =>
        ({
          getStatus: () => [{ id: 'jimeng', configured: true, models: ['jimeng-4.0'] }],
          generate,
        }) as never,
      () => ({ record }) as never,
    )

    const result = await service.generate({
      workspacePath: '/workspace',
      projectId: '11111111-1111-4111-8111-111111111111',
      sceneId,
      prompt: '现代产品工作台',
      aspectRatio: '16:9',
      provider: 'jimeng',
    })

    expect(result).toEqual({ success: true, asset: { id: 'asset-1' } })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'jimeng', prompt: '现代产品工作台' }),
    )
    expect(storeGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', provider: 'jimeng' }),
    )
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }))
  })
})
