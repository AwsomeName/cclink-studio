import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelImageImport,
  imageImportBlockReason,
  startImageImport,
  useImageImportJobs,
} from './image-import-jobs'
import type { ImageAttachmentImportResult } from './image-attachments'
import type { AgentImageAttachment } from '@shared/ipc/agent'

const picture = (id: string): AgentImageAttachment => ({
  id,
  name: `${id}.png`,
  mediaType: 'image/png',
  data: 'AQID',
  size: 3,
})

afterEach(() => {
  for (const scope of Object.keys(useImageImportJobs.getState().jobs)) cancelImageImport(scope)
})

describe('conversation-scoped image preparation', () => {
  it('blocks sending and concurrent imports, then discards cancelled results', async () => {
    let finish!: (result: ImageAttachmentImportResult) => void
    const accept = vi.fn()
    const importer = vi.fn(
      () =>
        new Promise<ImageAttachmentImportResult>((resolve) => {
          finish = resolve
        }),
    )
    startImageImport('local:a', [], () => [], accept, importer)
    await Promise.resolve()
    expect(imageImportBlockReason('local:a', [])).toContain('正在处理')
    expect(imageImportBlockReason('local:b', [])).toBeNull()
    expect(startImageImport('local:a', [], () => [], accept, importer)).toBeNull()
    expect(useImageImportJobs.getState().jobs['local:a'].error).toContain('新选图片未添加')
    cancelImageImport('local:a')
    finish({ attachments: [], errors: [] })
    await Promise.resolve()
    expect(accept).not.toHaveBeenCalled()
    expect(imageImportBlockReason('local:a', [])).toBeNull()
  })

  it('keeps partial failures visible until the user acknowledges the remaining attachments', async () => {
    startImageImport(
      'remote:a',
      [],
      () => [],
      vi.fn(),
      async () => ({
        attachments: [],
        errors: ['broken.png：图片损坏'],
      }),
    )
    await vi.waitFor(() => expect(useImageImportJobs.getState().jobs['remote:a'].busy).toBe(false))
    expect(useImageImportJobs.getState().jobs['remote:a'].error).toContain('broken.png')
    expect(imageImportBlockReason('remote:a', [])).toContain('未添加')
    startImageImport(
      'remote:a',
      [],
      () => [],
      vi.fn(),
      async () => ({ attachments: [], errors: [] }),
    )
    await vi.waitFor(() => expect(useImageImportJobs.getState().jobs['remote:a'].busy).toBe(false))
    expect(useImageImportJobs.getState().jobs['remote:a'].error).toContain('broken.png')
    cancelImageImport('remote:a')
    expect(imageImportBlockReason('remote:a', [])).toBeNull()
  })

  it('keeps a concurrent selection warning after the original batch succeeds', async () => {
    let finish!: (result: ImageAttachmentImportResult) => void
    const importer = () =>
      new Promise<ImageAttachmentImportResult>((resolve) => {
        finish = resolve
      })
    const accept = vi.fn()
    startImageImport('local:a', [], () => [], accept, importer)
    await Promise.resolve()
    startImageImport('local:a', [], () => [], accept, importer)
    finish({ attachments: [picture('first')], errors: [] })
    await vi.waitFor(() => expect(useImageImportJobs.getState().jobs['local:a'].busy).toBe(false))
    expect(accept).toHaveBeenCalledWith([picture('first')])
    expect(useImageImportJobs.getState().jobs['local:a'].error).toContain('重新添加')
    expect(imageImportBlockReason('local:a', [])).not.toBeNull()
  })

  it('reports images that no longer fit after a failed Run restores a draft during processing', async () => {
    let images: AgentImageAttachment[] = []
    let finish!: (result: ImageAttachmentImportResult) => void
    const accept = vi.fn((added: AgentImageAttachment[]) => {
      images.push(...added)
    })
    startImageImport(
      'local:a',
      [],
      () => images,
      accept,
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await Promise.resolve()
    images = [0, 1, 2, 3].map((i) => picture(`restored-${i}`))
    finish({ attachments: [picture('new-1'), picture('new-2')], errors: [] })
    await vi.waitFor(() => expect(useImageImportJobs.getState().jobs['local:a'].busy).toBe(false))
    expect(images).toHaveLength(5)
    expect(accept).toHaveBeenCalledWith([picture('new-1')])
    expect(useImageImportJobs.getState().jobs['local:a'].error).toContain('new-2.png')
  })

  it('does not resurrect a cancelled job if accepting results changes the active surface', async () => {
    startImageImport(
      'local:a',
      [],
      () => [],
      () => cancelImageImport('local:a'),
      async () => ({ attachments: [], errors: ['bad.png'] }),
    )
    await vi.waitFor(() => expect(useImageImportJobs.getState().jobs['local:a']).toBeUndefined())
  })

  it('cleans state before abort listeners start a replacement job', () => {
    startImageImport(
      'local:a',
      [],
      () => [],
      vi.fn(),
      () => new Promise(() => {}),
    )
    const oldJob = useImageImportJobs.getState().jobs['local:a']
    oldJob.controller.signal.addEventListener('abort', () => {
      startImageImport(
        'local:a',
        [],
        () => [],
        vi.fn(),
        () => new Promise(() => {}),
      )
    })
    cancelImageImport('local:a')
    expect(useImageImportJobs.getState().jobs['local:a'].id).not.toBe(oldJob.id)
  })

  it('surfaces synchronous preparation failures instead of leaving a busy job', async () => {
    startImageImport(
      'local:a',
      [],
      () => [],
      vi.fn(),
      () => {
        throw new Error('无法启动')
      },
    )
    await vi.waitFor(() => expect(useImageImportJobs.getState().jobs['local:a'].busy).toBe(false))
    expect(useImageImportJobs.getState().jobs['local:a'].error).toContain('无法启动')
  })
})
