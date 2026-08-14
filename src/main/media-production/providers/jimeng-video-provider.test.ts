import { describe, expect, it, vi } from 'vitest'
import { JimengVideoProvider } from './jimeng-video-provider'

describe('JimengVideoProvider', () => {
  it('signs the official submit/query actions and maps the async result', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 10000, data: { task_id: 'provider-task' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 10000,
            data: { status: 'done', video_url: 'https://output.volces.com/result.mp4' },
          }),
          { status: 200 },
        ),
      )
    const provider = new JimengVideoProvider(() => ({ accessKeyId: 'ak', secretAccessKey: 'sk' }), {
      fetch: fetchMock,
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    })

    expect(
      await provider.createTask({ prompt: '产品发布', aspectRatio: '9:16', durationSeconds: 5 }),
    ).toEqual({ taskId: 'provider-task' })
    expect(await provider.getTask('provider-task')).toEqual({
      status: 'succeeded',
      progress: 1,
      resultUrl: 'https://output.volces.com/result.mp4',
    })
    const [submitUrl, submitInit] = fetchMock.mock.calls[0]
    expect(String(submitUrl)).toContain('Action=JimengTI2VV30PROSubmitTask')
    expect(String(submitUrl)).toContain('Version=2024-06-06')
    expect(JSON.parse(String(submitInit?.body))).toMatchObject({
      req_key: 'jimeng_ti2v_v30_pro',
      frames: 121,
      aspect_ratio: '9:16',
    })
    expect(submitInit?.headers).toMatchObject({ Authorization: expect.stringContaining('ak/') })
  })

  it('classifies moderation errors without leaking the full response', async () => {
    const provider = new JimengVideoProvider(() => ({ accessKeyId: 'ak', secretAccessKey: 'sk' }), {
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 50413,
              message: 'Post Text Risk Not Pass',
              request_id: 'req-1',
            }),
            { status: 400 },
          ),
      ),
      now: () => new Date(),
    })
    await expect(
      provider.createTask({ prompt: 'x', aspectRatio: '16:9', durationSeconds: 5 }),
    ).rejects.toThrow('内容审核拒绝')
  })
})
