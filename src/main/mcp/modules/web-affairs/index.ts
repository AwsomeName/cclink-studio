import type { ToolDefinition, ToolExecutionContext, ToolModule } from '../../types'
import type { WebAffairService } from '../../../web-affairs/web-affair-service'
import type { WorkspaceRef } from '../../../../shared/workspace-ref'
import type { WebAffairOperationResult } from '../../../../shared/web-affairs/web-affair-types'

const TOOLS: ToolDefinition[] = [
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
  ) {}

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    const scope = await this.resolveScope(context)
    if (!scope.success) return scope
    const { workspaceId, workspaceRef } = scope.data

    if (toolName === 'web_affair_get') {
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
      return this.service.finishAttempt({ ...params, workspaceRef } as never, workspaceId)
    }
    if (toolName === 'web_affair_complete_check') {
      return this.service.completeCheck({ ...params, workspaceRef } as never, workspaceId)
    }
    if (toolName === 'article_publishing_report_checkpoint') {
      return this.service.reportArticlePublishingCheckpoint(
        { ...params, workspaceRef } as never,
        workspaceId,
      )
    }
    if (toolName === 'article_publishing_report_asset') {
      return this.service.reportArticlePublishingAsset(
        { ...params, workspaceRef } as never,
        workspaceId,
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
