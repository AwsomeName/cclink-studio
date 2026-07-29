import { describe, expect, it, vi } from 'vitest'
import type { FileService } from '../fs/file-service'
import type { UsageLedgerService } from '../usage/usage-ledger-service'
import type { ImageGenerationService } from './image-generation-service'
import { MarkdownIllustrationService } from './markdown-illustration-service'

describe('MarkdownIllustrationService', () => {
  it('does not start paid generation when document preflight fails', async () => {
    const generate = vi.fn()
    const preflightMarkdownIllustrations = vi
      .fn()
      .mockRejectedValue(new Error('Markdown 文件已变化'))
    const service = createService({
      imageGeneration: { generate },
      fileService: { preflightMarkdownIllustrations },
    })

    await expect(
      service.illustrate({
        filePath: '/workspace/report.md',
        expectedHash: 'stale',
        illustrations: [{ prompt: 'A chart', alt: 'Chart' }],
      }),
    ).rejects.toThrow('Markdown 文件已变化')

    expect(generate).not.toHaveBeenCalled()
  })

  it('inserts successful images and records both successful and failed attempts', async () => {
    const generatedImage = {
      provider: 'meshy' as const,
      taskId: 'task-1',
      model: 'nano-banana' as const,
      mimeType: 'image/png' as const,
      content: Buffer.from('png'),
      consumedCredits: 3,
    }
    const generate = vi
      .fn()
      .mockResolvedValueOnce(generatedImage)
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const applyMarkdownIllustrations = vi.fn().mockResolvedValue({
      snapshot: { hash: 'new-hash' },
      assets: [{ absolutePath: '/workspace/report.assets/illustration-01.png' }],
    })
    const record = vi.fn().mockResolvedValue(undefined)
    const service = createService({
      imageGeneration: { generate },
      fileService: {
        preflightMarkdownIllustrations: vi.fn().mockResolvedValue({ hash: 'disk-hash' }),
        applyMarkdownIllustrations,
      },
      usageLedger: { record },
    })

    const result = await service.illustrate(
      {
        filePath: '/workspace/report.md',
        illustrations: [
          {
            prompt: 'A useful diagram',
            alt: 'Architecture diagram',
            anchorText: '## Architecture',
          },
          {
            prompt: 'A second diagram',
            alt: 'Unavailable diagram',
          },
        ],
      },
      { conversationId: 'conversation-1' },
    )

    expect(result).toMatchObject({
      success: true,
      inserted: 1,
      failed: 1,
      versionHash: 'new-hash',
      failures: [{ index: 1, error: 'provider unavailable' }],
    })
    expect(applyMarkdownIllustrations).toHaveBeenCalledWith({
      documentPath: '/workspace/report.md',
      expectedHash: 'disk-hash',
      illustrations: [
        expect.objectContaining({
          fileName: 'illustration-01',
          alt: 'Architecture diagram',
          anchorText: '## Architecture',
          placement: 'after',
        }),
      ],
    })
    expect(record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        conversationId: 'conversation-1',
        source: 'image-generation',
        status: 'succeeded',
        unit: 'credit',
        amount: 3,
      }),
    )
    expect(record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId: 'conversation-1',
        source: 'image-generation',
        status: 'failed',
        unit: 'image',
      }),
    )
  })
})

function createService(overrides: {
  imageGeneration?: Partial<ImageGenerationService>
  fileService?: Partial<FileService>
  usageLedger?: Partial<UsageLedgerService>
}): MarkdownIllustrationService {
  const imageGeneration = overrides.imageGeneration ?? {}
  const fileService = overrides.fileService ?? {}
  const usageLedger = {
    record: vi.fn().mockResolvedValue(undefined),
    summarize: vi.fn().mockResolvedValue({ events: 0, byUnit: {} }),
    ...overrides.usageLedger,
  }
  return new MarkdownIllustrationService(
    imageGeneration as ImageGenerationService,
    fileService as FileService,
    usageLedger as UsageLedgerService,
  )
}
