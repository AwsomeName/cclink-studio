import { createHash } from 'node:crypto'
import type { BrowserTaskRun } from '../../shared/ipc/browser'
import type { ToolExecutionContext } from '../mcp/types'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { WebAffairService } from '../web-affairs/web-affair-service'

export const CSDN_ARTICLE_SUPPORTED_ORIGINS = [
  'https://csdn.net',
  'https://www.csdn.net',
  'https://mp.csdn.net',
  'https://app-blog.csdn.net',
  'https://editor.csdn.net',
  'https://blog.csdn.net',
] as const
const CSDN_ARTICLE_SUPPORTED_ORIGIN_SET = new Set<string>(CSDN_ARTICLE_SUPPORTED_ORIGINS)

export type ArticlePublishingBrowserActionDecision =
  | { kind: 'allow' }
  | { kind: 'allow-once'; sideEffectKey: string; actionFingerprint: string }
  | { kind: 'handoff'; reason: string }
  | { kind: 'unknown'; reason: string }

interface ArticlePublishingExecutionScope {
  workspaceId: string
  workspacePath: string
  affairId: string
  attemptId: string
  accountId: string
  currentStepId?: string
  publicationStatus: 'not-started' | 'dispatched' | 'verifying' | 'published' | 'result-unknown'
  localAssetsReady: boolean
  executionGeneration: number
  browserTaskRunId: string
  sourceHash: string
  assets: Array<{ id: string; sourcePath: string; uploadAttemptCount: number }>
}

interface ResolveExecutionInput {
  workspacePath: string
  affairId: string
  attemptId: string
  accountId: string
  browserTaskRunId?: string
}

const HUMAN_ONLY_CONTROL =
  /支付|付款|购买|下单|充值|删除|注销|撤回|签署|签名|授权|权限|所有权|实名认证|人脸|验证码|扫码|同意|接受|原创|转载|翻译|版权|\bpay\b|purchase|delete|withdraw|sign|authorize|ownership|agree\s*(?:to\s*)?(?:terms|agreement)/iu
const FINAL_PUBLICATION_CONTROL = /发布博客|发布文章|立即发布|确认发布|\bpublish\b/iu
const PAGE_MUTATION_ACTIONS = new Set([
  'click',
  'fill',
  'select',
  'check',
  'uncheck',
  'press',
  'uploadFile',
  'pressKey',
  'dragDrop',
  'handleDialog',
])
const CONTROL_ACTIVATION_ACTIONS = new Set(['click', 'press', 'pressKey'])
const READ_ONLY_STEPS = new Set(['verify-account', 'verify-publication'])

/**
 * Stateless article-domain policy consumed by the generic Browser tool boundary.
 * It owns no task state and only resolves the current WebAffair snapshot.
 */
export class ArticlePublishingBrowserPolicy {
  constructor(
    private readonly webAffairService: WebAffairService,
    private readonly resolveWorkspaceId: (workspacePath: string) => Promise<string | null>,
  ) {}

  async resolveAllowedOrigins(input: ResolveExecutionInput): Promise<string[] | null> {
    const scope = await this.resolveExecution(input)
    if (scope) return [...CSDN_ARTICLE_SUPPORTED_ORIGINS]
    return (await this.isArticleAffair(input)) ? [] : null
  }

  async classifyAction(
    task: BrowserTaskRun,
    actionType: string,
    params: Record<string, unknown>,
    page: ReturnType<PlaywrightBridge['getPage']>,
    context?: ToolExecutionContext,
  ): Promise<ArticlePublishingBrowserActionDecision | null> {
    const scope = await this.resolveTaskScope(task, context)
    if (!scope) {
      const correlation = task.correlation
      if (
        correlation?.accountId &&
        correlation.affairId &&
        correlation.affairAttemptId &&
        context?.trustedWorkspace?.kind === 'local' &&
        (await this.isArticleAffair({
          workspacePath: context.trustedWorkspace.rootPath,
          affairId: correlation.affairId,
          attemptId: correlation.affairAttemptId,
          accountId: correlation.accountId,
        }))
      ) {
        const reason = '文章发布任务状态已过期或与当前 Agent 不一致'
        console.warn('[ArticlePublishing] 适配器动作判定', {
          affairId: correlation.affairId,
          attemptId: correlation.affairAttemptId,
          adapter: 'csdn@1',
          currentStepId: null,
          actionType,
          currentOrigin: page ? toOrigin(safePageUrl(page)) : null,
          decision: 'unknown',
          reason,
        })
        return { kind: 'unknown', reason }
      }
      return null
    }
    if (!PAGE_MUTATION_ACTIONS.has(actionType)) {
      return { kind: 'allow' }
    }
    if (!page) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '文章发布页面尚未就绪，无法核验当前动作',
      )
    }
    let pageUrl = ''
    try {
      pageUrl = page.url()
    } catch {
      return this.stopDecision(scope, actionType, 'unknown', '文章发布适配器无法读取当前页面地址')
    }
    if (!this.isRecognizedPageForStep(pageUrl, scope.currentStepId)) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '当前页面不是适配器可核验的 CSDN 文章发布页面',
        pageUrl,
      )
    }
    if (READ_ONLY_STEPS.has(scope.currentStepId ?? '')) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '当前文章发布检查点只允许读取和核验页面',
        pageUrl,
      )
    }
    if (scope.currentStepId === 'open-editor' && !CONTROL_ACTIVATION_ACTIONS.has(actionType)) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '打开编辑器检查点不允许填写、上传或拖放',
        pageUrl,
      )
    }
    if (actionType === 'uploadFile') {
      if (scope.currentStepId !== 'upload-assets') {
        return this.stopDecision(
          scope,
          actionType,
          'unknown',
          '上传动作与当前文章发布检查点不一致',
          pageUrl,
        )
      }
      const paths = Array.isArray(params.paths)
        ? params.paths.filter((path): path is string => typeof path === 'string')
        : []
      if (paths.length !== 1) {
        return this.stopDecision(
          scope,
          actionType,
          'unknown',
          '每次只能上传一张已冻结图片',
          pageUrl,
        )
      }
      const asset = scope.assets.find((candidate) => candidate.sourcePath === paths[0])
      if (!asset) {
        return this.stopDecision(
          scope,
          actionType,
          'unknown',
          '上传文件不属于冻结正文图片',
          pageUrl,
        )
      }
      return this.reserveSideEffect(
        scope,
        'upload-asset',
        `${asset.id}:attempt-${asset.uploadAttemptCount + 1}`,
        actionType,
        params,
        pageUrl,
      )
    }
    if (actionType === 'handleDialog') {
      return params.action === 'accept'
        ? this.stopDecision(
            scope,
            actionType,
            'unknown',
            '文章发布页面出现无法由适配器核验的原生确认对话框',
            pageUrl,
          )
        : { kind: 'allow' }
    }
    if ((actionType === 'press' || actionType === 'pressKey') && params.key !== 'Enter') {
      return { kind: 'allow' }
    }
    if (!CONTROL_ACTIVATION_ACTIONS.has(actionType)) return { kind: 'allow' }

    const selector = String(params.selector ?? '').trim()
    let control: { label: string; type: string; role: string } | null = null
    try {
      if (actionType === 'pressKey') {
        control = await page.evaluate(() => {
          const target = document.activeElement
          if (!(target instanceof Element)) return null
          return {
            label: String(
              target.getAttribute('value') ||
                target.getAttribute('aria-label') ||
                target.textContent ||
                '',
            ).trim(),
            type: String(target.getAttribute('type') || '').toLowerCase(),
            role: String(target.getAttribute('role') || '').toLowerCase(),
          }
        })
      } else {
        if (!selector) {
          return this.stopDecision(
            scope,
            actionType,
            'unknown',
            '文章发布动作缺少明确控件选择器',
            pageUrl,
          )
        }
        const locator = page.locator(selector)
        if ((await locator.count()) !== 1 || !(await locator.isVisible())) {
          return this.stopDecision(
            scope,
            actionType,
            'unknown',
            '文章发布动作的目标控件不是唯一可见元素',
            pageUrl,
          )
        }
        control = await locator.evaluate((element) => {
          const target = element.closest('button, input, a, [role="button"]') ?? element
          return {
            label: String(
              target.getAttribute('value') ||
                target.getAttribute('aria-label') ||
                target.textContent ||
                '',
            ).trim(),
            type: String(target.getAttribute('type') || '').toLowerCase(),
            role: String(target.getAttribute('role') || '').toLowerCase(),
          }
        })
      }
    } catch {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '文章发布适配器无法读取当前控件',
        pageUrl,
      )
    }

    const signature = `${control?.label ?? ''} ${control?.type ?? ''} ${control?.role ?? ''}`.trim()
    if (HUMAN_ONLY_CONTROL.test(signature)) {
      return this.stopDecision(
        scope,
        actionType,
        'handoff',
        `文章发布动作需要人工处理${control?.label ? `（${control.label}）` : ''}`,
        pageUrl,
      )
    }
    if (/草稿|暂存|保存.*草稿|save\s*(?:as\s*)?draft|draft/iu.test(signature)) {
      if (scope.currentStepId !== 'save-draft') {
        return this.stopDecision(
          scope,
          actionType,
          'unknown',
          '保存草稿动作与当前文章发布检查点不一致',
          pageUrl,
        )
      }
      return this.reserveSideEffect(
        scope,
        'save-draft',
        scope.sourceHash,
        actionType,
        params,
        pageUrl,
      )
    }
    if (!FINAL_PUBLICATION_CONTROL.test(signature)) return { kind: 'allow' }
    if (scope.currentStepId !== 'publish') {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '发布控件与当前文章发布检查点不一致',
        pageUrl,
      )
    }
    if (!scope.localAssetsReady) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '正文图片尚未全部核验，不能执行常规发布',
        pageUrl,
      )
    }
    if (scope.publicationStatus !== 'not-started') {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '发布动作已经派发或结果未知，只允许重新核验',
        pageUrl,
      )
    }
    return this.reserveSideEffect(scope, 'publish', 'final', actionType, params, pageUrl)
  }

  async consumeSideEffect(
    task: BrowserTaskRun,
    sideEffectKey: string,
    actionFingerprint: string,
    context?: ToolExecutionContext,
  ): Promise<void> {
    const scope = await this.resolveTaskScope(task, context)
    if (!scope) throw new Error('文章发布副作用授权已经失去 Runtime 绑定')
    const consumed = await this.webAffairService.consumeArticlePublishingSideEffect(
      scope.affairId,
      scope.attemptId,
      scope.executionGeneration,
      sideEffectKey,
      actionFingerprint,
      scope.browserTaskRunId,
      scope.workspaceId,
    )
    if (!consumed.success) throw new Error(consumed.error.message)
  }

  async observeSideEffect(
    task: BrowserTaskRun,
    sideEffectKey: string,
    status: 'result-unknown' | 'rejected',
    context?: ToolExecutionContext,
  ): Promise<void> {
    const scope = await this.resolveTaskScope(task, context)
    if (!scope) return
    const observed = await this.webAffairService.observeArticlePublishingSideEffect(
      scope.affairId,
      scope.attemptId,
      scope.executionGeneration,
      sideEffectKey,
      status,
      scope.workspaceId,
    )
    if (!observed.success) {
      console.warn('[ArticlePublishing] 副作用观察回写失败', observed.error.message)
    }
  }

  async recordHandoff(
    task: BrowserTaskRun,
    context: ToolExecutionContext | undefined,
    reason: string,
  ): Promise<void> {
    const scope = await this.resolveTaskScope(task, context)
    if (!scope) return
    const result = await this.webAffairService.handoffAttempt(
      {
        workspaceRef: { kind: 'local', path: scope.workspacePath },
        affairId: scope.affairId,
        attemptId: scope.attemptId,
        reason,
      },
      scope.workspaceId,
    )
    if (!result.success) {
      console.warn('[ArticlePublishing] 人工接管状态回写失败', {
        affairId: scope.affairId,
        attemptId: scope.attemptId,
        reason: result.error.message,
      })
    }
  }

  private async resolveTaskScope(
    task: BrowserTaskRun,
    context?: ToolExecutionContext,
  ): Promise<ArticlePublishingExecutionScope | null> {
    const correlation = task.correlation
    if (
      !correlation?.accountId ||
      !correlation.affairId ||
      !correlation.affairAttemptId ||
      context?.trustedWorkspace?.kind !== 'local'
    ) {
      return null
    }
    return this.resolveExecution({
      workspacePath: context.trustedWorkspace.rootPath,
      affairId: correlation.affairId,
      attemptId: correlation.affairAttemptId,
      accountId: correlation.accountId,
      browserTaskRunId: task.id,
    })
  }

  private async reserveSideEffect(
    scope: ArticlePublishingExecutionScope,
    kind: 'upload-asset' | 'save-draft' | 'publish',
    targetId: string,
    actionType: string,
    params: Record<string, unknown>,
    pageUrl: string,
  ): Promise<ArticlePublishingBrowserActionDecision> {
    const actionFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          actionType,
          origin: toOrigin(pageUrl),
          selector: String(params.selector ?? ''),
          key: String(params.key ?? ''),
          paths: Array.isArray(params.paths) ? params.paths : [],
          targetId,
        }),
      )
      .digest('hex')
    const reserved = await this.webAffairService.reserveArticlePublishingSideEffect(
      scope.affairId,
      scope.attemptId,
      scope.executionGeneration,
      kind,
      targetId,
      actionFingerprint,
      scope.browserTaskRunId,
      scope.workspaceId,
    )
    if (!reserved.success) {
      return this.stopDecision(scope, actionType, 'unknown', reserved.error.message, pageUrl)
    }
    console.info('[ArticlePublishing] 适配器动作判定', {
      affairId: scope.affairId,
      attemptId: scope.attemptId,
      adapter: 'csdn@1',
      currentStepId: scope.currentStepId ?? null,
      actionType,
      currentOrigin: toOrigin(pageUrl),
      decision: 'allow-once',
    })
    return {
      kind: 'allow-once',
      sideEffectKey: `${scope.affairId}:${scope.attemptId}:g${scope.executionGeneration}:${kind}:${targetId}`,
      actionFingerprint,
    }
  }

  private stopDecision(
    scope: ArticlePublishingExecutionScope,
    actionType: string,
    kind: 'handoff' | 'unknown',
    reason: string,
    pageUrl = '',
  ): ArticlePublishingBrowserActionDecision {
    console.warn('[ArticlePublishing] 适配器动作判定', {
      affairId: scope.affairId,
      attemptId: scope.attemptId,
      adapter: 'csdn@1',
      currentStepId: scope.currentStepId ?? null,
      actionType,
      currentOrigin: toOrigin(pageUrl),
      decision: kind,
      reason,
    })
    return { kind, reason }
  }

  private async resolveExecution(
    input: ResolveExecutionInput,
  ): Promise<ArticlePublishingExecutionScope | null> {
    const workspaceId = await this.resolveWorkspaceId(input.workspacePath)
    if (!workspaceId) return null
    const snapshot = this.webAffairService.getProjectSnapshot(workspaceId)
    if (!snapshot.success) return null
    const affair = snapshot.data.affairs.find((candidate) => candidate.id === input.affairId)
    const publishing = affair?.articlePublishing
    const attempt = affair?.attempts.find((candidate) => candidate.id === input.attemptId)
    if (
      affair?.kind !== 'article-publishing' ||
      !publishing ||
      !attempt ||
      publishing.adapterId !== 'csdn' ||
      publishing.adapterVersion !== 1 ||
      publishing.accountId !== input.accountId ||
      attempt.accountId !== input.accountId ||
      publishing.execution.currentAttemptId !== input.attemptId ||
      publishing.execution.status !== 'running' ||
      !['preparing', 'running-ai'].includes(attempt.status)
    ) {
      return null
    }
    return {
      workspaceId,
      workspacePath: input.workspacePath,
      affairId: affair.id,
      attemptId: attempt.id,
      accountId: input.accountId,
      currentStepId: publishing.execution.currentStepId,
      publicationStatus: publishing.publication.status,
      localAssetsReady: publishing.assets.every(
        (asset) => asset.kind !== 'local' || asset.status === 'uploaded',
      ),
      executionGeneration: attempt.executionGeneration,
      browserTaskRunId: input.browserTaskRunId ?? attempt.browserTaskRunId ?? '',
      sourceHash: publishing.source.contentHash,
      assets: publishing.assets.map((asset) => ({
        id: asset.id,
        sourcePath: asset.sourcePath,
        uploadAttemptCount: asset.uploadAttempts.length,
      })),
    }
  }

  private async isArticleAffair(input: ResolveExecutionInput): Promise<boolean> {
    const workspaceId = await this.resolveWorkspaceId(input.workspacePath)
    if (!workspaceId) return false
    const snapshot = this.webAffairService.getProjectSnapshot(workspaceId)
    if (!snapshot.success) return false
    const affair = snapshot.data.affairs.find((candidate) => candidate.id === input.affairId)
    const publishing = affair?.articlePublishing
    const attempt = affair?.attempts.find((candidate) => candidate.id === input.attemptId)
    return Boolean(
      affair?.kind === 'article-publishing' &&
      publishing?.adapterId === 'csdn' &&
      publishing.adapterVersion === 1 &&
      publishing.accountId === input.accountId &&
      attempt?.accountId === input.accountId,
    )
  }

  private isRecognizedPageForStep(rawUrl: string, stepId?: string): boolean {
    try {
      const url = new URL(rawUrl)
      if (!CSDN_ARTICLE_SUPPORTED_ORIGIN_SET.has(url.origin)) return false
      const isEditorPage =
        url.hostname === 'editor.csdn.net' ||
        (url.hostname === 'mp.csdn.net' && /\/mp_blog\/creation/iu.test(url.pathname)) ||
        (url.hostname === 'app-blog.csdn.net' && /\/csdn\/aiChatNew/iu.test(url.pathname))
      if (stepId === 'open-editor') {
        return isEditorPage || (url.hostname === 'mp.csdn.net' && url.pathname === '/')
      }
      if (stepId === 'verify-account') return true
      if (stepId === 'verify-publication') {
        return ['blog.csdn.net', 'www.csdn.net', 'mp.csdn.net'].includes(url.hostname)
      }
      return isEditorPage
    } catch {
      return false
    }
  }
}

function toOrigin(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin
  } catch {
    return null
  }
}

function safePageUrl(page: ReturnType<PlaywrightBridge['getPage']>): string {
  try {
    return page?.url() ?? ''
  } catch {
    return ''
  }
}
