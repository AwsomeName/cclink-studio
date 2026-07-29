import { describe, expect, it, vi } from 'vitest'
import { JimengImageProvider } from './jimeng-image-provider'

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])

describe('JimengImageProvider', () => {
  it('signs, submits, polls and decodes a Jimeng 4.0 image task', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          data: { task_id: 'task-1' },
          message: 'Success',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          data: { status: 'in_queue' },
          message: 'Success',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 10000,
          data: {
            status: 'done',
            binary_data_base64: [PNG.toString('base64')],
          },
          message: 'Success',
        }),
      )
    const provider = new JimengImageProvider(() => ({ accessKeyId: 'ak', secretAccessKey: 'sk' }), {
      fetch: fetchMock,
      sleep: async () => {},
      now: () => 0,
      currentDate: () => new Date('2026-07-29T03:04:05.000Z'),
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    })

    const result = await provider.generate({
      prompt: '中文杂志插图',
      model: 'jimeng-4.0',
      aspectRatio: '16:9',
    })

    expect(result).toEqual({
      provider: 'jimeng',
      model: 'jimeng-4.0',
      taskId: 'task-1',
      content: PNG,
      mimeType: 'image/png',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const submitUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(Object.fromEntries(submitUrl.searchParams)).toEqual({
      Action: 'CVSync2AsyncSubmitTask',
      Version: '2022-08-31',
    })
    const submitRequest = fetchMock.mock.calls[0][1]!
    expect(JSON.parse(String(submitRequest.body))).toMatchObject({
      req_key: 't2i_v40_jimeng',
      prompt: '中文杂志插图',
      force_single: true,
      width: 2560,
      height: 1440,
    })
    expect(submitRequest.headers).toMatchObject({
      Authorization: expect.stringContaining('Credential=ak/20260729/cn-north-1/cv/request'),
      'X-Date': '20260729T030405Z',
    })
    expect(JSON.stringify(submitRequest)).not.toContain('"sk"')
  })

  it('reports an incomplete AK/SK pair as not configured', () => {
    const provider = new JimengImageProvider(() => ({
      accessKeyId: 'ak-only',
      secretAccessKey: '',
    }))

    expect(provider.getStatus()).toMatchObject({
      id: 'jimeng',
      configured: false,
      reason: '请先在设置中配置即梦 Access Key ID 和 Secret Access Key',
    })
  })

  it('returns provider error codes and request IDs without credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        code: 50413,
        message: 'Post Text Risk Not Pass',
        request_id: 'request-1',
        data: null,
      }),
    )
    const provider = new JimengImageProvider(() => ({ accessKeyId: 'ak', secretAccessKey: 'sk' }), {
      fetch: fetchMock,
      sleep: async () => {},
      now: () => 0,
      currentDate: () => new Date('2026-07-29T03:04:05.000Z'),
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    })

    await expect(provider.generate({ prompt: 'blocked' })).rejects.toThrow(
      '即梦 API 返回错误 (50413, requestId=request-1): Post Text Risk Not Pass',
    )
  })
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
