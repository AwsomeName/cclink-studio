import { extname } from 'node:path'
import type { FileService } from '../fs/file-service'
import type { ToolExecutionContext } from '../mcp/types'
import type { UsageLedgerService } from '../usage/usage-ledger-service'
import type { ImageGenerationService } from './image-generation-service'
import type { ImageAspectRatio, ImageGenerationModel, ImageGenerationProviderId } from './types'

export interface MarkdownIllustrationItem {
  prompt: string
  alt: string
  anchorText?: string
  placement?: 'before' | 'after' | 'end'
  aspectRatio?: ImageAspectRatio
}

export interface MarkdownIllustrationRequest {
  filePath: string
  expectedHash?: string
  provider?: ImageGenerationProviderId
  model?: ImageGenerationModel
  illustrations: MarkdownIllustrationItem[]
}

export class MarkdownIllustrationService {
  constructor(
    private readonly imageGeneration: ImageGenerationService,
    private readonly fileService: FileService,
    private readonly usageLedger: UsageLedgerService,
  ) {}

  getStatus(conversationId?: string) {
    return Promise.all([
      Promise.resolve(this.imageGeneration.getStatus()),
      this.usageLedger.summarize(conversationId),
    ]).then(([providers, usage]) => ({ providers, usage }))
  }

  async illustrate(request: MarkdownIllustrationRequest, context?: ToolExecutionContext) {
    const filePath = request.filePath.trim()
    if (!filePath) throw new Error('缺少 Markdown 文件路径')
    if (!['.md', '.markdown'].includes(extname(filePath).toLowerCase())) {
      throw new Error('自动配图仅支持 .md 或 .markdown 文件')
    }
    if (!Array.isArray(request.illustrations) || request.illustrations.length === 0) {
      throw new Error('illustrations 至少需要一项')
    }
    const normalized = request.illustrations.map((item) => normalizeIllustrationItem(item))
    const provider = request.provider ?? this.imageGeneration.getDefaultProviderId()
    const snapshot = await this.fileService.preflightMarkdownIllustrations({
      documentPath: filePath,
      ...(request.expectedHash ? { expectedHash: request.expectedHash } : {}),
      illustrations: normalized,
    })

    const generated: Array<{
      item: ReturnType<typeof normalizeIllustrationItem>
      image: Awaited<ReturnType<ImageGenerationService['generate']>>
      sourceIndex: number
    }> = []
    const failures: Array<{ index: number; error: string }> = []
    for (const [index, item] of normalized.entries()) {
      try {
        const image = await this.imageGeneration.generate({
          provider,
          prompt: item.prompt,
          model: request.model,
          aspectRatio: item.aspectRatio,
        })
        generated.push({ item, image, sourceIndex: index })
        await this.recordUsage(
          {
            conversationId: context?.conversationId ?? 'unknown',
            source: 'image-generation',
            provider: image.provider,
            model: image.model,
            quantity: 1,
            unit: image.consumedCredits === undefined ? 'image' : 'credit',
            ...(image.consumedCredits === undefined ? {} : { amount: image.consumedCredits }),
            estimated: false,
            status: 'succeeded',
            taskId: image.taskId,
          },
          `记录图片任务 ${image.taskId} 用量失败`,
        )
      } catch (error) {
        failures.push({
          index,
          error: error instanceof Error ? error.message : String(error),
        })
        await this.recordUsage(
          {
            conversationId: context?.conversationId ?? 'unknown',
            source: 'image-generation',
            provider,
            model: request.model,
            quantity: 1,
            unit: 'image',
            estimated: false,
            status: 'failed',
          },
          '记录图片生成失败事件失败',
        )
      }
    }
    if (generated.length === 0) {
      throw new Error(`图片生成全部失败: ${failures.map((failure) => failure.error).join('; ')}`)
    }

    const applied = await this.fileService.applyMarkdownIllustrations({
      documentPath: filePath,
      expectedHash: snapshot.hash,
      illustrations: generated.map(({ item, image, sourceIndex }) => ({
        fileName: `illustration-${String(sourceIndex + 1).padStart(2, '0')}`,
        mimeType: image.mimeType,
        content: image.content,
        alt: item.alt,
        ...(item.anchorText ? { anchorText: item.anchorText } : {}),
        placement: item.placement,
      })),
    })
    return {
      success: true,
      filePath,
      inserted: generated.length,
      failed: failures.length,
      failures,
      versionHash: applied.snapshot.hash,
      assets: applied.assets.map((asset, index) => ({
        ...asset,
        taskId: generated[index].image.taskId,
        provider: generated[index].image.provider,
        model: generated[index].image.model,
        consumedCredits: generated[index].image.consumedCredits,
      })),
    }
  }

  private async recordUsage(
    event: Parameters<UsageLedgerService['record']>[0],
    failureMessage: string,
  ): Promise<void> {
    await this.usageLedger.record(event).catch((error) => {
      console.warn(
        `[MarkdownIllustrationService] ${failureMessage}:`,
        error instanceof Error ? error.message : String(error),
      )
    })
  }
}

function normalizeIllustrationItem(item: MarkdownIllustrationItem) {
  const prompt = item.prompt?.trim()
  const alt = item.alt?.trim()
  if (!prompt) throw new Error('每张插图都必须提供 prompt')
  if (!alt) throw new Error('每张插图都必须提供 alt')
  const anchorText = item.anchorText?.trim()
  const placement = item.placement ?? (anchorText ? 'after' : 'end')
  if (placement !== 'end' && !anchorText) {
    throw new Error('before/after 插入方式必须提供 anchorText')
  }
  return {
    prompt,
    alt,
    ...(anchorText ? { anchorText } : {}),
    placement,
    ...(item.aspectRatio ? { aspectRatio: item.aspectRatio } : {}),
  }
}
