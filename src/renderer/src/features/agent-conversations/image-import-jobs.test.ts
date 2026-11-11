import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelImageImport,
  imageImportBlockReason,
  startImageImport,
  useImageImportJobs,
} from './image-import-jobs'
import type { ImageAttachmentImportResult } from './image-attachments'

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
    startImageImport('local:a', [], [], accept, importer)
    expect(imageImportBlockReason('local:a', [])).toContain('正在处理')
    expect(imageImportBlockReason('local:b', [])).toBeNull()
    expect(startImageImport('local:a', [], [], accept, importer)).toBeNull()
    cancelImageImport('local:a')
    finish({ attachments: [], errors: [] })
    await Promise.resolve()
    expect(accept).not.toHaveBeenCalled()
    expect(imageImportBlockReason('local:a', [])).toBeNull()
  })

  it('keeps partial failures visible until the user acknowledges the remaining attachments', async () => {
    startImageImport('remote:a', [], [], vi.fn(), async () => ({
      attachments: [],
      errors: ['broken.png：图片损坏'],
    }))
    await Promise.resolve()
    expect(useImageImportJobs.getState().jobs['remote:a'].error).toContain('broken.png')
    expect(imageImportBlockReason('remote:a', [])).toContain('未添加')
    cancelImageImport('remote:a')
    expect(imageImportBlockReason('remote:a', [])).toBeNull()
  })
})
