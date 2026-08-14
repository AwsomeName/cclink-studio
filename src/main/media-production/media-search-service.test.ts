import { describe, expect, it, vi } from 'vitest'
import { MediaSearchService } from './media-search-service'

describe('MediaSearchService', () => {
  it('keeps download URLs in main process and imports an explicitly selected Pexels result', async () => {
    const storeSearchAsset = vi.fn(async () => ({ id: 'asset-1' }))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            page: 1,
            next_page: 'https://api.pexels.com/v1/search?page=2',
            photos: [
              {
                id: 42,
                width: 1600,
                height: 900,
                url: 'https://www.pexels.com/photo/42',
                photographer: 'Ada',
                photographer_url: 'https://www.pexels.com/@ada',
                src: {
                  medium: 'https://images.pexels.com/photos/42/preview.jpeg',
                  large2x: 'https://images.pexels.com/photos/42/full.jpeg',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(Buffer.from('jpeg-content'), { status: 200 }))
    const service = new MediaSearchService({ storeSearchAsset } as never, () => 'pexels-key', {
      fetch: fetchMock,
      now: () => 1_000,
    })

    const searched = await service.search({
      query: 'creative studio',
      kind: 'image',
      orientation: '16:9',
      page: 1,
    })
    expect(searched).toMatchObject({
      success: true,
      configured: true,
      hasMore: true,
      candidates: [
        {
          provider: 'pexels',
          sourceUrl: 'https://www.pexels.com/photo/42',
          author: 'Ada',
        },
      ],
    })
    if (!searched.success) return
    expect(searched.candidates[0]).not.toHaveProperty('downloadUrl')

    const added = await service.addCandidate({
      workspacePath: '/workspace',
      projectId: '11111111-1111-4111-8111-111111111111',
      candidateId: searched.candidates[0].id,
    })
    expect(added).toEqual({ success: true, asset: { id: 'asset-1' } })
    expect(storeSearchAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'pexels',
        author: 'Ada',
        content: Buffer.from('jpeg-content'),
      }),
    )
  })

  it('degrades without making a network request when no key is configured', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const result = await new MediaSearchService({} as never, () => '', {
      fetch: fetchMock,
      now: Date.now,
    }).search({ query: 'x', kind: 'image', orientation: '1:1' })
    expect(result).toMatchObject({
      success: false,
      configured: false,
      error: { code: 'MEDIA_PROJECT_SEARCH_PROVIDER_UNAVAILABLE' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
