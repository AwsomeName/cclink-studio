import type { ToolDefinition, ToolExecutionContext, ToolModule } from '../../types'
import type { WebSearchSource } from '../../../../shared/web-search/web-search-types'
import { WebSearchError, type WebSearchService } from '../../../web-search/web-search-service'

export const WEB_SEARCH_TOOL_NAMES = ['web_search', 'web_fetch'] as const

const TOOLS: ToolDefinition[] = [
  {
    name: 'web_search',
    description:
      '通过 DeepSeek 搜索公开网页，返回标题、网址、摘要（可选正文）。只读；搜索词会发送到 DeepSeek，每次约 $0.00075。' +
      '支持 site:example.com、-site:、"精确短语"、lang:zh、after:2026-01、before: 等写法。' +
      '引用结果时必须给出网址；搜索结果不能证明网页上的操作（发布、登录、提交）已经完成。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词，1–128 个字符' },
        count: { type: 'number', description: '返回条数，1–20；省略时用设置中的默认值' },
        needContent: {
          type: 'boolean',
          description: '是否同时返回每条结果的正文（更长、更占上下文）；默认 false',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'web_fetch',
    description:
      '通过 DeepSeek 读取一个公开网页，返回 Markdown 正文。只读；网址会发送到 DeepSeek，每次约 $0.00075。' +
      '不能读取需要登录的页面；需要登录或操作页面时使用可视浏览器工具。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) 网址，不能包含账号密码' },
      },
      required: ['url'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
]

/** Which caller a host-signed tool session belongs to; the model cannot set this. */
function sourceOf(context?: ToolExecutionContext): WebSearchSource | null {
  if (context?.webSearchSource) return context.webSearchSource
  if (context?.agentBackend === 'codex') return 'codex'
  if (context?.agentBackend === 'claude-code') return 'claude-code'
  return null
}

export class WebSearchToolModule implements ToolModule {
  readonly name = 'web-search'
  readonly tools = TOOLS

  constructor(private readonly service: WebSearchService) {}

  /**
   * Hidden from tasks bound to the visible browser (search happens there instead),
   * from sessions whose agent is switched off in Settings, and when the service is not ready.
   */
  isVisible(context?: ToolExecutionContext): boolean {
    if (!context || context.forceVisibleBrowser) return false
    const source = sourceOf(context)
    if (source === 'owner' || source === 'decision')
      return context.webSearchAllowed === true && this.service.isAvailableFor('owner')
    if (source === 'codex') return this.service.isAvailableFor('codex')
    if (source === 'claude-code') return this.service.isAvailableFor('claudeCode')
    return false
  }

  getExecutionPolicy() {
    // Read-only and announced in Settings; each call is shown in the conversation instead of a prompt.
    return { requireConfirmation: false, riskLevel: 'read' as const, authorizationSatisfied: true }
  }

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    const source = sourceOf(context)
    if (!source || !this.isVisible(context))
      return { success: false, error: '联网搜索在这个任务中不可用。需要时请在可视浏览器里搜索。' }
    try {
      if (toolName === 'web_search') {
        const count = typeof params.count === 'number' ? Math.min(20, params.count) : undefined
        const results = await this.service.search(
          {
            query: String(params.query ?? ''),
            ...(count ? { count } : {}),
            needContent: params.needContent === true,
          },
          { source, signal: context?.abortSignal },
        )
        return {
          success: true,
          provider: 'DeepSeek',
          query: String(params.query ?? '').trim(),
          resultCount: results.length,
          results,
          note: results.length
            ? '引用时给出网址；网页内容可能已变化。'
            : '没有找到结果（不计费）。可以换个说法再搜。',
        }
      }
      if (toolName === 'web_fetch') {
        const page = await this.service.fetchPage(
          { url: String(params.url ?? '') },
          { source, signal: context?.abortSignal },
        )
        return {
          success: true,
          provider: 'DeepSeek',
          ...page,
          fetchedAt: new Date().toISOString(),
          note: page.truncated ? '正文过长，已截断。' : undefined,
        }
      }
      return { success: false, error: `未知工具 ${toolName}` }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '联网搜索失败',
        ...(error instanceof WebSearchError ? { code: error.code } : {}),
      }
    }
  }
}
