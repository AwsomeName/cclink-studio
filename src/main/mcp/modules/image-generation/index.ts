import type { ToolDefinition, ToolExecutionContext, ToolModule } from '../../types'
import type {
  MarkdownIllustrationItem,
  MarkdownIllustrationRequest,
  MarkdownIllustrationService,
} from '../../../image-generation/markdown-illustration-service'

const IMAGE_GENERATION_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'image_generation_status',
    description:
      '查看内置图片生成服务商是否已配置、可用模型以及当前会话的图片用量统计。不会发起生成，也不会返回密钥。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'markdown_illustrate',
    description:
      '仅在用户明确要求给 Markdown 配图时调用。先用 editor_save 保存目标文档，再读取文档并调用本工具；工具会生成图片、保存到可见的 <文档名>.assets 目录，并自动插入 Markdown 图片引用。anchorText 必须是文档中唯一的原始文本片段。费用只统计，不进行预算或额度控制。',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '目标 .md 或 .markdown 文件的绝对路径',
        },
        expectedHash: {
          type: 'string',
          description: '读取文档时得到的版本哈希；建议传入，用于阻止并发覆盖',
        },
        provider: {
          type: 'string',
          enum: ['meshy'],
          description: '图片服务商，当前版本支持 meshy',
        },
        model: {
          type: 'string',
          enum: ['nano-banana', 'nano-banana-2', 'nano-banana-pro', 'gpt-image-2'],
          description: 'Meshy 图片模型，默认 nano-banana',
        },
        illustrations: {
          type: 'array',
          description: '要生成并插入的插图方案',
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: '发送给图片服务商的提示词' },
              alt: { type: 'string', description: 'Markdown 图片替代文本' },
              anchorText: {
                type: 'string',
                description: '文档中唯一的原始文本片段；省略时只能使用 end',
              },
              placement: {
                type: 'string',
                enum: ['before', 'after', 'end'],
                description: '插入到锚点之前、之后或文档末尾',
              },
              aspectRatio: {
                type: 'string',
                enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
                description: '图片画幅，默认 16:9',
              },
            },
            required: ['prompt', 'alt'],
          },
        },
      },
      required: ['filePath', 'illustrations'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]

export class ImageGenerationToolModule implements ToolModule {
  readonly name = 'image-generation'
  readonly tools = IMAGE_GENERATION_TOOL_DEFINITIONS

  constructor(private readonly service: MarkdownIllustrationService) {}

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    switch (toolName) {
      case 'image_generation_status':
        return this.service.getStatus(context?.conversationId)
      case 'markdown_illustrate':
        return this.service.illustrate(parseIllustrationRequest(params), context)
      default:
        throw new Error(`未知图片生成工具: ${toolName}`)
    }
  }
}

function parseIllustrationRequest(params: Record<string, unknown>): MarkdownIllustrationRequest {
  const illustrations = Array.isArray(params.illustrations)
    ? params.illustrations.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('illustrations 必须是对象数组')
        }
        const item = value as Record<string, unknown>
        return {
          prompt: String(item.prompt ?? ''),
          alt: String(item.alt ?? ''),
          ...(typeof item.anchorText === 'string' ? { anchorText: item.anchorText } : {}),
          ...(item.placement === 'before' || item.placement === 'after' || item.placement === 'end'
            ? { placement: item.placement as MarkdownIllustrationItem['placement'] }
            : {}),
          ...(typeof item.aspectRatio === 'string'
            ? { aspectRatio: item.aspectRatio as MarkdownIllustrationItem['aspectRatio'] }
            : {}),
        }
      })
    : []
  return {
    filePath: String(params.filePath ?? ''),
    ...(typeof params.expectedHash === 'string' ? { expectedHash: params.expectedHash } : {}),
    ...(params.provider === 'meshy' ? { provider: params.provider } : {}),
    ...(typeof params.model === 'string'
      ? { model: params.model as MarkdownIllustrationRequest['model'] }
      : {}),
    illustrations,
  }
}
