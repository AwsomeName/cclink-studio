import { describe, expect, it, vi } from 'vitest'
import { MeshyImageProvider } from './meshy-image-provider'

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])

describe('MeshyImageProvider', () => {
  it('creates, polls, validates and returns a text-to-image result', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ result: 'task-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'task-1',
          ai_model: 'nano-banana',
          status: 'SUCCEEDED',
          image_urls: ['https://assets.meshy.ai/tasks/task-1/image.png'],
          consumed_credits: 3,
        }),
      )
      .mockResolvedValueOnce(
        new Response(PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      )
    const provider = new MeshyImageProvider(() => 'secret', {
      fetch: fetchMock,
      sleep: async () => {},
      now: () => 0,
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    })

    const result = await provider.generate({
      prompt: 'Editorial illustration',
      model: 'nano-banana',
      aspectRatio: '16:9',
    })

    expect(result).toMatchObject({
      provider: 'meshy',
      taskId: 'task-1',
      model: 'nano-banana',
      mimeType: 'image/png',
      consumedCredits: 3,
    })
    expect(result.content).toEqual(PNG)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.meshy.ai/openapi/v1/text-to-image')
  })

  it('reports missing credentials without exposing a key', () => {
    const provider = new MeshyImageProvider(() => '')
    expect(provider.getStatus()).toMatchObject({
      id: 'meshy',
      configured: false,
      reason: '请先在设置中配置 Meshy API Key',
    })
  })

  it('rejects image downloads outside Meshy hosts', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ result: 'task-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'task-1',
          ai_model: 'nano-banana',
          status: 'SUCCEEDED',
          image_urls: ['https://example.com/image.png'],
        }),
      )
    const provider = new MeshyImageProvider(() => 'secret', {
      fetch: fetchMock,
      sleep: async () => {},
      now: () => 0,
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    })

    await expect(provider.generate({ prompt: 'Test' })).rejects.toThrow('不受信任')
  })
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
