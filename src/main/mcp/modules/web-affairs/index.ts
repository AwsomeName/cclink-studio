import type { ToolDefinition, ToolExecutionContext, ToolModule } from '../../types'
import type {
  ArticlePublishingAgentReporter,
  WebAffairService,
} from '../../../web-affairs/web-affair-service'
import type { WorkspaceRef } from '../../../../shared/workspace-ref'
import type { WebAffairOperationResult } from '../../../../shared/web-affairs/web-affair-types'
import type { ArticlePublishingBrowserPolicy } from '../../../article-publishing/article-publishing-browser-policy'
import type { ImageResearchService } from '../../../image-research/image-research-service'

const TOOLS: ToolDefinition[] = [
  {
    name: 'image_research_search',
    description: '在当前绑定的小红书可见页面执行一个冻结搜索词，并返回有界搜索结果。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'image_research_inspect_page',
    description:
      '读取当前小红书页面的有限可见文字和短期引用；不返回截图、HTML、selector、媒体 URL 或媒体字节。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'image_research_open_result',
    description: '打开 inspect 返回的短期 resultRef；打开后会复核稳定 noteId。',
    inputSchema: {
      type: 'object',
      properties: { resultRef: { type: 'string' } },
      required: ['resultRef'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'image_research_propose',
    description: '提交 inspect 返回的当前候选 token。成功后必须立即结束本轮。',
    inputSchema: {
      type: 'object',
      properties: { proposalToken: { type: 'string' } },
      required: ['proposalToken'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'web_affair_get',
    description:
      '读取一件网页事务的主进程事实，包括流程版本、节点、Attempt、等待计划和待确认流程建议。不会返回 Cookie、密码或材料正文。',
    inputSchema: {
      type: 'object',
      properties: { affairId: { type: 'string', description: '事务 UUID' } },
      required: ['affairId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'web_affair_propose_flow_diff',
    description:
      '依据实际网页提出流程 diff。只生成待用户确认的建议，不能直接覆盖已执行历史。tempId 用于在同一 diff 中引用新增节点。',
    inputSchema: {
      type: 'object',
      properties: {
        affairId: { type: 'string' },
        baseVersion: { type: 'number' },
        reason: { type: 'string' },
        operations: { type: 'array', items: { type: 'object' } },
        impacts: { type: 'array', items: { type: 'string' } },
      },
      required: ['affairId', 'baseVersion', 'reason', 'operations', 'impacts'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'web_affair_finish_attempt',
    description:
      '在页面后置条件已经重新读取并取得明确证据后结束当前 Attempt。最终提交节点若未获用户产品级确认会被拒绝。',
    inputSchema: {
      type: 'object',
      properties: {
        affairId: { type: 'string' },
        attemptId: { type: 'string' },
        outcome: { type: 'string', enum: ['succeeded', 'failed', 'cancelled', 'interrupted'] },
        summary: { type: 'string' },
        url: { type: 'string' },
        evidenceKind: {
          type: 'string',
          enum: ['observation', 'user-note', 'page-result', 'receipt', 'official-response'],
        },
      },
      required: ['affairId', 'attemptId', 'outcome', 'summary'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'web_affair_complete_check',
    description:
      '记录一次新的外部状态检查。状态未变化时有界退避；驳回时保留官方摘要并追加补正节点；通过时推进后续节点。',
    inputSchema: {
      type: 'object',
      properties: {
        affairId: { type: 'string' },
        nodeId: { type: 'string' },
        outcome: { type: 'string', enum: ['unchanged', 'approved', 'rejected'] },
        summary: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['affairId', 'nodeId', 'outcome', 'summary'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'article_publishing_inspect_page',
    description:
      '使用主进程内置 csdn@1 适配器一次性读取当前绑定页面、编辑器、标题、图片、草稿保存状态和公开文章结果。成功回报前必须先调用本工具；页面版本未知时会明确停止，不要继续猜 selector。',
    inputSchema: {
      type: 'object',
      properties: {
        affairId: { type: 'string' },
        attemptId: { type: 'string' },
      },
      required: ['affairId', 'attemptId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'article_publishing_report_checkpoint',
    description:
      '报告文章发布固定步骤的状态。只能更新当前事务和 Attempt 中已经定义的检查点；完成必须附带重新观察到的证据。',
    inputSchema: {
      type: 'object',
      properties: {
        affairId: { type: 'string' },
        attemptId: { type: 'string' },
        stepId: { type: 'string' },
        status: {
          type: 'string',
          enum: [
            'running',
            'waiting-platform',
            'verifying',
            'completed',
            'retryable-failed',
            'result-unknown',
            'needs-reconcile',
            'waiting-human',
            'failed',
          ],
        },
        evidence: { type: 'string' },
        outputRefs: { type: 'object' },
        error: { type: 'object' },
      },
      required: ['affairId', 'attemptId', 'stepId', 'status'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'article_publishing_report_asset',
    description:
      '报告一张正文图片的上传状态。必须按 uploading→waiting-platform→verifying→uploaded 顺序；uploaded 必须附平台 URL 和页面核验证据，单图最多三次安全尝试。',
    inputSchema: {
      type: 'object',
      properties: {
        affairId: { type: 'string' },
        attemptId: { type: 'string' },
        assetId: { type: 'string' },
        status: {
          type: 'string',
          enum: [
            'uploading',
            'waiting-platform',
            'verifying',
            'uploaded',
            'retryable-failed',
            'result-unknown',
            'reconciling',
            'failed',
          ],
        },
        platformUrl: { type: 'string' },
        evidence: { type: 'string' },
        error: { type: 'object' },
      },
      required: ['affairId', 'attemptId', 'assetId', 'status'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]

export class WebAffairToolModule implements ToolModule {
  readonly name = 'web-affairs'
  readonly tools = TOOLS

  constructor(
    private readonly service: WebAffairService,
    private readonly resolveWorkspaceId: (workspacePath: string) => Promise<string | null>,
    private readonly articlePublishingBrowserPolicy?: ArticlePublishingBrowserPolicy | null,
    private readonly imageResearchService?: ImageResearchService | null,
  ) {}

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    const scope = await this.resolveScope(context)
    if (!scope.success) return scope
    const { workspaceId, workspaceRef } = scope.data

    if (toolName === 'image_research_search') {
      return (
        this.imageResearchService?.search(String(params['query'] ?? ''), context) ??
        publishingPolicyError('图片调研适配器尚未就绪')
      )
    }
    if (toolName === 'image_research_inspect_page') {
      return (
        this.imageResearchService?.inspectPage(context) ??
        publishingPolicyError('图片调研适配器尚未就绪')
      )
    }
    if (toolName === 'image_research_open_result') {
      return (
        this.imageResearchService?.openResult(String(params['resultRef'] ?? ''), context) ??
        publishingPolicyError('图片调研适配器尚未就绪')
      )
    }
    if (toolName === 'image_research_propose') {
      return (
        this.imageResearchService?.propose(String(params['proposalToken'] ?? ''), context) ??
        publishingPolicyError('图片调研适配器尚未就绪')
      )
    }

    if (toolName === 'web_affair_get') {
      const policyError = this.validatePublishingTarget(params, context)
      if (policyError) return policyError
      const snapshot = this.service.getProjectSnapshot(workspaceId)
      if (!snapshot.success) return snapshot
      const affair = snapshot.data.affairs.find((item) => item.id === params['affairId'])
      return affair
        ? {
            success: true,
            data: affair.attempts
              ? {
                  ...affair,
                  attempts: affair.attempts.map(({ profileId: _profileId, ...attempt }) => attempt),
                }
              : affair,
          }
        : { success: false, error: { code: 'NOT_FOUND', message: '事务不存在' } }
    }
    if (toolName === 'web_affair_propose_flow_diff') {
      return this.service.proposeFlowDiff(
        {
          workspaceRef,
          affairId: params['affairId'] as string,
          baseVersion: params['baseVersion'] as number,
          reason: params['reason'] as string,
          operations: params['operations'] as never,
          impacts: params['impacts'] as string[],
          proposedBy: 'ai',
        },
        workspaceId,
      )
    }
    if (toolName === 'web_affair_finish_attempt') {
      const reporter = this.resolvePublishingReporter(params, context, workspaceId)
      if (context?.articlePublishingPolicy && !reporter.success) return reporter
      const trustedReporter = reporter.success
        ? this.authorizeTrustedReport(toolName, params, context, reporter.data)
        : reporter
      if (context?.articlePublishingPolicy && !trustedReporter.success) return trustedReporter
      return this.service.finishAttempt(
        { ...params, workspaceRef } as never,
        workspaceId,
        trustedReporter.success ? trustedReporter.data : undefined,
      )
    }
    if (toolName === 'web_affair_complete_check') {
      return this.service.completeCheck({ ...params, workspaceRef } as never, workspaceId)
    }
    if (toolName === 'article_publishing_report_checkpoint') {
      const reporter = this.resolvePublishingReporter(params, context, workspaceId)
      if (!reporter.success) return reporter
      const trustedReporter = this.authorizeTrustedReport(toolName, params, context, reporter.data)
      if (!trustedReporter.success) return trustedReporter
      return this.service.reportArticlePublishingCheckpoint(
        this.withCanonicalEvidence(params, workspaceRef, trustedReporter.data) as never,
        workspaceId,
        trustedReporter.data,
      )
    }
    if (toolName === 'article_publishing_report_asset') {
      const reporter = this.resolvePublishingReporter(params, context, workspaceId)
      if (!reporter.success) return reporter
      const trustedReporter = this.authorizeTrustedReport(toolName, params, context, reporter.data)
      if (!trustedReporter.success) return trustedReporter
      return this.service.reportArticlePublishingAsset(
        this.withCanonicalEvidence(params, workspaceRef, trustedReporter.data) as never,
        workspaceId,
        trustedReporter.data,
      )
    }
    if (toolName === 'article_publishing_inspect_page') {
      const targetError = this.validatePublishingTarget(params, context)
      if (targetError) return targetError
      if (params['attemptId'] !== context?.articlePublishingPolicy?.attemptId) {
        return publishingPolicyError('工具参数与当前文章发布 Attempt 不匹配')
      }
      return (
        this.articlePublishingBrowserPolicy?.inspectCurrentPage(context) ??
        publishingPolicyError('CSDN 页面适配器尚未就绪')
      )
    }
    throw new Error(`未知网页事务工具: ${toolName}`)
  }

  private async resolveScope(
    context?: ToolExecutionContext,
  ): Promise<WebAffairOperationResult<{ workspaceId: string; workspaceRef: WorkspaceRef }>> {
    const workspacePath = context?.workspaceKey?.trim()
    if (!workspacePath) return workspaceRequired()
    try {
      const workspaceId = await this.resolveWorkspaceId(workspacePath)
      return workspaceId
        ? {
            success: true,
            data: { workspaceId, workspaceRef: { kind: 'local', path: workspacePath } },
          }
        : workspaceRequired()
    } catch {
      return workspaceRequired()
    }
  }

  private validatePublishingTarget(
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): WebAffairOperationResult<never> | null {
    const policy = context?.articlePublishingPolicy
    if (!policy) return null
    return params['affairId'] === policy.affairId
      ? null
      : publishingPolicyError('当前发布 Agent 不能读取或修改其他事务')
  }

  private resolvePublishingReporter(
    params: Record<string, unknown>,
    context: ToolExecutionContext | undefined,
    workspaceId: string,
  ): WebAffairOperationResult<ArticlePublishingAgentReporter> {
    const policy = context?.articlePublishingPolicy
    const conversationId = context?.conversationId?.trim()
    const agentRunId = context?.agentRunId?.trim()
    if (!policy || !conversationId || !agentRunId) {
      return publishingPolicyError('当前工具会话没有主进程签发的文章发布执行身份')
    }
    if (
      policy.workspaceId !== workspaceId ||
      params['affairId'] !== policy.affairId ||
      params['attemptId'] !== policy.attemptId
    ) {
      return publishingPolicyError('工具参数与当前文章发布执行身份不匹配')
    }
    return {
      success: true,
      data: {
        workspaceId,
        affairId: policy.affairId,
        attemptId: policy.attemptId,
        executionGeneration: policy.executionGeneration,
        launchOperationId: policy.launchOperationId,
        conversationId,
        agentRunId,
      },
    }
  }

  private authorizeTrustedReport(
    toolName: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext | undefined,
    reporter: ArticlePublishingAgentReporter,
  ): WebAffairOperationResult<ArticlePublishingAgentReporter> {
    const requiresEvidence =
      (toolName === 'article_publishing_report_checkpoint' && params['status'] === 'completed') ||
      (toolName === 'article_publishing_report_asset' &&
        ['uploading', 'uploaded'].includes(String(params['status'] ?? ''))) ||
      (toolName === 'web_affair_finish_attempt' && params['outcome'] === 'succeeded')
    if (!requiresEvidence) return { success: true, data: reporter }
    return (
      this.articlePublishingBrowserPolicy?.authorizeTrustedReport(
        toolName,
        params,
        context,
        reporter,
      ) ?? publishingPolicyError('成功回报必须经过当前 CSDN 页面适配器核验')
    )
  }

  private withCanonicalEvidence(
    params: Record<string, unknown>,
    workspaceRef: WorkspaceRef,
    reporter: ArticlePublishingAgentReporter,
  ): Record<string, unknown> {
    const trusted = reporter.trustedPageEvidence
    return {
      ...params,
      workspaceRef,
      ...(trusted
        ? {
            evidence: `csdn@${trusted.adapterVersion} 页面回读 · ${trusted.url}`,
          }
        : {}),
    }
  }
}

function workspaceRequired<T>(): WebAffairOperationResult<T> {
  return {
    success: false,
    error: {
      code: 'WORKSPACE_REQUIRED',
      message: '当前 Agent 会话没有可验证的本地工作空间，不能读写事务',
    },
  }
}

function publishingPolicyError<T>(message: string): WebAffairOperationResult<T> {
  return { success: false, error: { code: 'INVALID_TRANSITION', message } }
}
