import { randomUUID } from 'node:crypto'
import type { BrowserTaskRun } from '../../shared/ipc/browser'
import type { ToolExecutionContext } from '../mcp/types'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import type { WebAffairService } from '../web-affairs/web-affair-service'
import {
  isSameCsdnDraft,
  parseCsdnDraftAnchor,
} from '../../shared/article-publishing/csdn-draft-anchor'
import { CsdnPublishingAdapter, type CsdnPageProbe } from './csdn-publishing-adapter'
import type { WebAffairOperationResult } from '../../shared/web-affairs/web-affair-types'
import type { ArticlePublishingAgentReporter } from '../web-affairs/web-affair-service'

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
  | { kind: 'allow-once'; sideEffectKey: string }
  | { kind: 'handoff'; reason: string }
  | { kind: 'runtime-error'; reason: string }
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
  launchOperationId: string
  browserTaskRunId: string
  writePermitted: boolean
  writePermitId?: string
  draftUrl?: string
  expectedTitle: string
  assets: Array<{
    id: string
    kind: 'local' | 'remote'
    sourcePath: string
    displayPath: string
    platformUrl?: string
    manualResolution?: { status: 'present' | 'missing'; resolvedAt: string }
    status:
      | 'pending'
      | 'uploading'
      | 'waiting-platform'
      | 'verifying'
      | 'uploaded'
      | 'retryable-failed'
      | 'result-unknown'
      | 'reconciling'
      | 'failed'
    uploadAttemptCount: number
  }>
}

export interface ArticlePublishingPageInspection extends CsdnPageProbe {
  matchedAssets: Record<string, string>
}

interface TrustedPageAttestation {
  scope: ArticlePublishingExecutionScope
  inspection: ArticlePublishingPageInspection
}

interface ResolveExecutionInput {
  workspacePath: string
  affairId: string
  attemptId: string
  accountId: string
  browserTaskRunId?: string
  executionGeneration?: number
  launchOperationId?: string
  tabId?: string
  browserViewRuntimeGeneration?: number
  webContentsId?: number
  playwrightConnectionGeneration?: number
  playwrightPageBindingGeneration?: number
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
const POTENTIAL_AUTOSAVE_ACTIONS = new Set(['fill', 'select', 'check', 'uncheck'])
const AUTOSAVE_STEPS = new Set(['fill-body', 'fill-fields'])

/**
 * Stateless article-domain policy consumed by the generic Browser tool boundary.
 * It owns no task state and only resolves the current WebAffair snapshot.
 */
export class ArticlePublishingBrowserPolicy {
  private readonly adapter = new CsdnPublishingAdapter()
  private readonly attestations = new Map<string, TrustedPageAttestation>()

  constructor(
    private readonly webAffairService: WebAffairService,
    private readonly resolveWorkspaceId: (workspacePath: string) => Promise<string | null>,
    private readonly playwrightBridge?: PlaywrightBridge | null,
    private readonly browserTaskRuntime?: BrowserTaskRuntime | null,
  ) {}

  async inspectCurrentPage(
    context?: ToolExecutionContext,
  ): Promise<WebAffairOperationResult<ArticlePublishingPageInspection>> {
    const conversationId = context?.conversationId?.trim()
    const agentRunId = context?.agentRunId?.trim()
    if (!conversationId || !agentRunId || !this.playwrightBridge || !this.browserTaskRuntime) {
      return publishingEvidenceError('当前工具会话没有可核验的文章发布页面 Runtime')
    }
    const task = this.browserTaskRuntime.getActiveTaskForConversation(conversationId)
    if (!task || task.correlation?.agentRunId !== agentRunId) {
      return publishingEvidenceError('当前 Agent Run 没有精确绑定的活动 BrowserTask')
    }
    const scope = await this.resolveTaskScope(task, context)
    if (!scope) return publishingEvidenceError('文章发布页面 Runtime 身份已经失效')
    const page = this.playwrightBridge.getPageById(task.tabId)
    if (!page || page.isClosed()) return publishingEvidenceError('绑定的 CSDN 页面不可用')
    const probe = await this.adapter.probe(page)
    if (
      scope.draftUrl &&
      probe.pageKind === 'editor' &&
      !isSameCsdnDraft(scope.draftUrl, probe.url)
    ) {
      return publishingEvidenceError('当前页面不是本 Attempt 已绑定的 CSDN 草稿')
    }
    const matchedAssets: Record<string, string> = {}
    if (probe.editor.recognized && probe.editor.imageEnumerationComplete) {
      for (const asset of scope.assets) {
        const existing = asset.platformUrl
          ? probe.editor.images.find((image) => image.src === asset.platformUrl)?.src
          : null
        if (existing) matchedAssets[asset.id] = existing
      }
    }
    const inspection: ArticlePublishingPageInspection = {
      ...probe,
      matchedAssets,
    }
    this.attestations.set(this.attestationKey(context), { scope, inspection })
    while (this.attestations.size > 40) {
      const oldest = this.attestations.keys().next().value
      if (!oldest) break
      this.attestations.delete(oldest)
    }
    return { success: true, data: inspection }
  }

  authorizeTrustedReport(
    toolName: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext | undefined,
    reporter: ArticlePublishingAgentReporter,
  ): WebAffairOperationResult<ArticlePublishingAgentReporter> {
    if (!requiresTrustedPageEvidence(toolName, params)) return { success: true, data: reporter }
    const attestation = this.attestations.get(this.attestationKey(context))
    if (!attestation) {
      return publishingEvidenceError(
        '成功回报前必须调用 article_publishing_inspect_page 取得主进程页面证据',
      )
    }
    const { scope, inspection } = attestation
    if (
      scope.workspaceId !== reporter.workspaceId ||
      scope.affairId !== reporter.affairId ||
      scope.attemptId !== reporter.attemptId ||
      scope.executionGeneration !== reporter.executionGeneration ||
      scope.launchOperationId !== reporter.launchOperationId ||
      Date.now() - Date.parse(inspection.observedAt) > 60_000
    ) {
      return publishingEvidenceError('CSDN 页面证据已经过期或不属于当前执行代次')
    }
    const evidenceKind = trustedEvidenceKind(toolName, params)
    if (!this.inspectionProves(evidenceKind, params, attestation)) {
      return publishingEvidenceError('当前 CSDN 页面读回结果不能证明所报告的成功状态')
    }
    const trustedUrl =
      evidenceKind === 'published'
        ? (this.resolvePublishedUrl(params, attestation) ?? inspection.url)
        : inspection.url
    return {
      success: true,
      data: {
        ...reporter,
        trustedPageEvidence: {
          adapterId: inspection.adapterId,
          adapterVersion: inspection.adapterVersion,
          observedAt: inspection.observedAt,
          url: trustedUrl,
          kind: evidenceKind,
          ...(inspection.platformAccountId
            ? { platformAccountId: inspection.platformAccountId }
            : {}),
          ...(inspection.draftId ? { draftId: inspection.draftId } : {}),
          normalizedTitle: normalizeText(inspection.title.value),
          saveState: inspection.saveState,
        },
      },
    }
  }

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
          decision: 'runtime-error',
          reason,
        })
        return { kind: 'runtime-error', reason }
      }
      return null
    }
    const isMutation = PAGE_MUTATION_ACTIONS.has(actionType)
    if (isMutation && !scope.writePermitted) {
      const reason = '草稿恢复正在收敛到最新 Page Runtime，当前禁止写入'
      console.warn('[ArticlePublishing] 适配器动作判定', {
        affairId: scope.affairId,
        attemptId: scope.attemptId,
        adapter: 'csdn@1',
        currentStepId: scope.currentStepId ?? null,
        actionType,
        currentOrigin: null,
        decision: 'runtime-error',
        reason,
      })
      return { kind: 'runtime-error', reason }
    }
    if (!page) {
      if (!isMutation) return { kind: 'allow' }
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
    const visibleAnchor = parseCsdnDraftAnchor(pageUrl)
    let boundDraftUrl = scope.draftUrl
    if (visibleAnchor && !boundDraftUrl) {
      const recorded = await this.webAffairService.recordArticlePublishingDraftAnchor(
        scope.affairId,
        scope.attemptId,
        scope.executionGeneration,
        scope.launchOperationId,
        visibleAnchor.url,
        scope.workspaceId,
        scope.browserTaskRunId,
      )
      if (!recorded.success) {
        return this.stopDecision(scope, actionType, 'unknown', recorded.error.message, pageUrl)
      }
      boundDraftUrl = visibleAnchor.url
    }
    if (
      isMutation &&
      !READ_ONLY_STEPS.has(scope.currentStepId ?? '') &&
      scope.currentStepId !== 'open-editor'
    ) {
      if (!boundDraftUrl) {
        return this.stopDecision(
          scope,
          actionType,
          'unknown',
          '当前编辑页没有稳定草稿编号，禁止产生无法跨重启恢复的平台写入',
          pageUrl,
        )
      }
      if (!isSameCsdnDraft(boundDraftUrl, pageUrl)) {
        return this.stopDecision(
          scope,
          actionType,
          'unknown',
          '当前页面不是本 Attempt 已绑定的原草稿，已拒绝串稿写入',
          pageUrl,
        )
      }
    }
    if (!isMutation) return { kind: 'allow' }
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
    const selectorDecision = this.validateAttestedSelector(
      scope,
      actionType,
      params,
      pageUrl,
      context,
    )
    if (selectorDecision) return selectorDecision
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
      if (asset.status !== 'uploading') {
        return this.stopDecision(
          scope,
          actionType,
          'unknown',
          '图片尚未取得本次确定性“页面不存在”证据并进入 uploading，禁止派发上传',
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
    if (
      AUTOSAVE_STEPS.has(scope.currentStepId ?? '') &&
      POTENTIAL_AUTOSAVE_ACTIONS.has(actionType)
    ) {
      return this.reserveSideEffect(
        scope,
        'save-draft',
        `autosave:${scope.currentStepId}:${randomUUID()}`,
        actionType,
        params,
        pageUrl,
      )
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
        `manual-save:${scope.currentStepId}`,
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

  async completeMutation(
    task: BrowserTaskRun,
    actionType: string,
    page: ReturnType<PlaywrightBridge['getPage']>,
    context?: ToolExecutionContext,
  ): Promise<void> {
    if (!PAGE_MUTATION_ACTIONS.has(actionType) || !page) return
    const scope = await this.resolveTaskScope(task, context)
    if (!scope) return
    if (scope.currentStepId === 'open-editor' || scope.currentStepId === 'publish') return
    let observation: CsdnPageProbe | null = null
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const probe = await this.adapter.probe(page)
      if (
        probe.editor.recognized &&
        probe.draftId &&
        probe.platformAccountId &&
        probe.saveState === 'saved'
      ) {
        observation = probe
        break
      }
      await page.waitForTimeout(250)
    }
    if (!observation?.draftId || !observation.platformAccountId) {
      throw new Error('网页动作后无法读回同一账号、同一草稿和已保存状态')
    }
    const recorded = await this.webAffairService.recordArticlePublishingPageObservation(
      {
        affairId: scope.affairId,
        attemptId: scope.attemptId,
        executionGeneration: scope.executionGeneration,
        browserTaskRunId: scope.browserTaskRunId,
        ...(scope.writePermitId ? { permitId: scope.writePermitId } : {}),
        draftId: observation.draftId,
        platformAccountId: observation.platformAccountId,
        normalizedTitle: normalizeText(observation.title.value),
        url: observation.url,
        saveState: 'saved',
      },
      scope.workspaceId,
    )
    if (!recorded.success) throw new Error(recorded.error.message)
  }

  async consumeSideEffect(
    task: BrowserTaskRun,
    sideEffectKey: string,
    context?: ToolExecutionContext,
  ): Promise<void> {
    const scope = await this.resolveTaskScope(task, context)
    if (!scope) throw new Error('文章发布副作用授权已经失去 Runtime 绑定')
    const consumed = await this.webAffairService.consumeArticlePublishingSideEffect(
      scope.affairId,
      scope.attemptId,
      scope.executionGeneration,
      sideEffectKey,
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
      executionGeneration: correlation.affairExecutionGeneration,
      launchOperationId: correlation.affairLaunchOperationId,
      tabId: task.tabId,
      browserViewRuntimeGeneration: correlation.browserViewRuntimeGeneration,
      webContentsId: correlation.webContentsId,
      playwrightConnectionGeneration: correlation.playwrightConnectionGeneration,
      playwrightPageBindingGeneration: correlation.playwrightPageBindingGeneration,
    })
  }

  private async reserveSideEffect(
    scope: ArticlePublishingExecutionScope,
    kind: 'upload-asset' | 'save-draft' | 'publish',
    targetId: string,
    actionType: string,
    _params: Record<string, unknown>,
    pageUrl: string,
  ): Promise<ArticlePublishingBrowserActionDecision> {
    const reserved = await this.webAffairService.reserveArticlePublishingSideEffect(
      scope.affairId,
      scope.attemptId,
      scope.executionGeneration,
      kind,
      targetId,
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
    if (!workspaceId) {
      this.logRuntimeResolutionFailure(input, ['workspace-not-resolved'])
      return null
    }
    const snapshot = this.webAffairService.getProjectSnapshot(workspaceId)
    if (!snapshot.success) {
      this.logRuntimeResolutionFailure(input, ['workspace-snapshot-unavailable'])
      return null
    }
    const affair = snapshot.data.affairs.find((candidate) => candidate.id === input.affairId)
    const publishing = affair?.articlePublishing
    const attempt = affair?.attempts.find((candidate) => candidate.id === input.attemptId)
    const activeBrowserBinding = attempt?.runtimeBindings?.find(
      (binding) => binding.kind === 'browser-task' && binding.status === 'active',
    )
    const browserBinding = attempt?.runtimeBindings?.find(
      (binding) =>
        binding.kind === 'browser-task' &&
        binding.status === 'active' &&
        binding.browserTaskRunId === input.browserTaskRunId &&
        binding.executionGeneration === input.executionGeneration &&
        binding.launchOperationId === input.launchOperationId &&
        binding.tabId === input.tabId &&
        binding.browserViewRuntimeGeneration === input.browserViewRuntimeGeneration &&
        binding.webContentsId === input.webContentsId &&
        binding.playwrightConnectionGeneration === input.playwrightConnectionGeneration &&
        binding.playwrightPageBindingGeneration === input.playwrightPageBindingGeneration,
    )
    const mismatches: string[] = []
    if (affair?.kind !== 'article-publishing') mismatches.push('affair-kind')
    if (!publishing) mismatches.push('publishing-state')
    if (!attempt) mismatches.push('attempt')
    if (publishing?.adapterId !== 'csdn' || publishing?.adapterVersion !== 1) {
      mismatches.push('adapter')
    }
    if (publishing?.accountId !== input.accountId) mismatches.push('publishing-accountId')
    if (attempt?.accountId !== input.accountId) mismatches.push('attempt-accountId')
    if (publishing?.execution.currentAttemptId !== input.attemptId) {
      mismatches.push('currentAttemptId')
    }
    if (publishing?.execution.status !== 'running') mismatches.push('execution-status')
    if (!attempt || !['preparing', 'running-ai'].includes(attempt.status)) {
      mismatches.push('attempt-status')
    }
    if (
      input.browserTaskRunId !== undefined &&
      attempt?.browserTaskRunId !== input.browserTaskRunId
    ) {
      mismatches.push('browserTaskRunId')
    }
    if (input.browserTaskRunId !== undefined && !browserBinding) {
      mismatches.push('browser-runtime-binding')
    }
    if (mismatches.length > 0 || !publishing || !attempt || affair?.kind !== 'article-publishing') {
      this.logRuntimeResolutionFailure(input, mismatches, {
        workspaceId,
        affairKind: affair?.kind ?? null,
        execution: publishing?.execution ?? null,
        publishingAccountId: publishing?.accountId ?? null,
        attempt: attempt
          ? {
              id: attempt.id,
              status: attempt.status,
              accountId: attempt.accountId,
              executionGeneration: attempt.executionGeneration,
              launchOperationId: attempt.launchOperationId,
              browserTaskRunId: attempt.browserTaskRunId ?? null,
              tabId: attempt.tabId ?? null,
            }
          : null,
        activeBrowserBinding: activeBrowserBinding ?? null,
      })
      return null
    }
    const recovery = publishing.draft?.recovery
    const permit = recovery?.writePermit
    const writePermitted =
      recovery?.executionGeneration !== attempt.executionGeneration ||
      Boolean(
        recovery.status === 'verified' &&
        permit &&
        permit.recoveryOperationId === recovery.operationId &&
        permit.executionGeneration === attempt.executionGeneration &&
        permit.tabId === input.tabId &&
        permit.browserViewRuntimeGeneration === input.browserViewRuntimeGeneration &&
        permit.webContentsId === input.webContentsId &&
        permit.playwrightConnectionGeneration === input.playwrightConnectionGeneration &&
        permit.playwrightPageBindingGeneration === input.playwrightPageBindingGeneration,
      )
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
      launchOperationId: attempt.launchOperationId,
      browserTaskRunId: input.browserTaskRunId ?? attempt.browserTaskRunId ?? '',
      writePermitted,
      ...(permit?.id ? { writePermitId: permit.id } : {}),
      draftUrl: publishing.draft?.url,
      expectedTitle: publishing.fields.title,
      assets: publishing.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        sourcePath: asset.sourcePath,
        displayPath: asset.displayPath,
        platformUrl: asset.platformUrl,
        manualResolution: asset.manualResolution,
        status: asset.status,
        uploadAttemptCount: asset.uploadAttempts.length,
      })),
    }
  }

  private logRuntimeResolutionFailure(
    input: ResolveExecutionInput,
    mismatches: string[],
    transaction?: Record<string, unknown>,
  ): void {
    const pageBinding =
      input.tabId && this.playwrightBridge?.getPageBindingIdentity
        ? this.playwrightBridge.getPageBindingIdentity(input.tabId)
        : null
    console.warn('[ArticlePublishing] Runtime 身份解析失败', {
      affairId: input.affairId,
      attemptId: input.attemptId,
      mismatches,
      transaction: transaction ?? null,
      browserTask: {
        browserTaskRunId: input.browserTaskRunId ?? null,
        accountId: input.accountId,
        executionGeneration: input.executionGeneration ?? null,
        launchOperationId: input.launchOperationId ?? null,
        tabId: input.tabId ?? null,
        browserViewRuntimeGeneration: input.browserViewRuntimeGeneration ?? null,
        webContentsId: input.webContentsId ?? null,
        playwrightConnectionGeneration: input.playwrightConnectionGeneration ?? null,
        playwrightPageBindingGeneration: input.playwrightPageBindingGeneration ?? null,
      },
      currentPage: pageBinding
        ? {
            tabId: input.tabId,
            webContentsId: pageBinding.webContentsId,
            playwrightConnectionGeneration: pageBinding.connectionGeneration,
            playwrightPageBindingGeneration: pageBinding.generation,
          }
        : null,
    })
  }

  private attestationKey(context?: ToolExecutionContext): string {
    const policy = context?.articlePublishingPolicy
    return [
      context?.conversationId ?? '',
      context?.agentRunId ?? '',
      policy?.attemptId ?? '',
      policy?.executionGeneration ?? '',
      policy?.launchOperationId ?? '',
    ].join(':')
  }

  private validateAttestedSelector(
    scope: ArticlePublishingExecutionScope,
    actionType: string,
    params: Record<string, unknown>,
    pageUrl: string,
    context?: ToolExecutionContext,
  ): ArticlePublishingBrowserActionDecision | null {
    const attestation = this.attestations.get(this.attestationKey(context))
    if (!attestation) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '页面写入前必须先调用 article_publishing_inspect_page，禁止 Agent 猜 selector',
        pageUrl,
      )
    }
    const { inspection, scope: inspectedScope } = attestation
    if (
      inspectedScope.affairId !== scope.affairId ||
      inspectedScope.attemptId !== scope.attemptId ||
      inspectedScope.executionGeneration !== scope.executionGeneration ||
      inspectedScope.launchOperationId !== scope.launchOperationId ||
      inspectedScope.browserTaskRunId !== scope.browserTaskRunId ||
      inspection.url !== pageUrl ||
      Date.now() - Date.parse(inspection.observedAt) > 60_000
    ) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '页面证据已过期或页面已变化，请重新调用 article_publishing_inspect_page',
        pageUrl,
      )
    }
    if (actionType === 'pressKey' || actionType === 'dragDrop') {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '文章发布不允许无确定目标的键盘或拖放写入',
        pageUrl,
      )
    }
    const selector = String(params.selector ?? '').trim()
    const stepId = scope.currentStepId ?? ''
    const selectors = inspection.selectors
    const allowed =
      stepId === 'open-editor'
        ? [selectors.openEditor]
        : stepId === 'upload-assets'
          ? [selectors.fileInput, selectors.uploadConfirm]
          : stepId === 'fill-body'
            ? [selectors.body]
            : stepId === 'fill-fields'
              ? [
                  selectors.title,
                  selectors.summary,
                  selectors.tags,
                  selectors.category,
                  selectors.cover,
                ]
              : stepId === 'save-draft'
                ? [selectors.save]
                : stepId === 'publish'
                  ? [selectors.publish]
                  : []
    const allowedSelectors = new Set(allowed.filter((value): value is string => Boolean(value)))
    if (!selector || !allowedSelectors.has(selector)) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        allowedSelectors.size === 0
          ? 'csdn@1 未识别当前步骤的唯一控件，已停止并等待人工处理'
          : '写入目标不是 csdn@1 本次读回签发的唯一 selector，已拒绝执行',
        pageUrl,
      )
    }
    return null
  }

  private inspectionProves(
    kind: NonNullable<ArticlePublishingAgentReporter['trustedPageEvidence']>['kind'],
    params: Record<string, unknown>,
    attestation: TrustedPageAttestation,
  ): boolean {
    const { inspection, scope } = attestation
    if (kind === 'asset-uploaded') {
      const assetId = String(params['assetId'] ?? '')
      const platformUrl = String(params['platformUrl'] ?? '')
      return Boolean(
        platformUrl &&
        inspection.editor.recognized &&
        (inspection.matchedAssets[assetId] === platformUrl ||
          inspection.editor.images.some((image) => image.src === platformUrl)),
      )
    }
    if (kind === 'asset-absent') {
      const assetId = String(params['assetId'] ?? '')
      const asset = scope.assets.find((candidate) => candidate.id === assetId)
      const absenceCanAuthorizeFirstUpload = Boolean(
        asset &&
        ((asset.status !== 'reconciling' && asset.uploadAttemptCount === 0) ||
          asset.manualResolution?.status === 'missing'),
      )
      return Boolean(
        inspection.editor.recognized &&
        inspection.editor.imageEnumerationComplete &&
        asset &&
        absenceCanAuthorizeFirstUpload &&
        !inspection.matchedAssets[assetId],
      )
    }
    if (kind === 'published') {
      return Boolean(this.resolvePublishedUrl(params, attestation))
    }
    const stepId = String(params['stepId'] ?? '')
    if (stepId === 'open-editor') {
      return inspection.editor.recognized
    }
    if (stepId === 'verify-account') {
      return inspection.editor.recognized && Boolean(inspection.platformAccountId)
    }
    if (stepId === 'upload-assets') {
      return Boolean(
        inspection.editor.recognized &&
        inspection.saveState === 'saved' &&
        scope.assets.every((asset) => asset.kind !== 'local' || asset.status === 'uploaded'),
      )
    }
    if (stepId === 'fill-body') {
      return Boolean(inspection.editor.recognized && inspection.editor.bodyTextLength > 0)
    }
    if (stepId === 'fill-fields') {
      return Boolean(
        inspection.editor.recognized &&
        normalizeText(inspection.title.value) === normalizeText(scope.expectedTitle),
      )
    }
    if (stepId === 'save-draft') {
      return Boolean(
        inspection.editor.recognized &&
        inspection.saveState === 'saved' &&
        normalizeText(inspection.title.value) === normalizeText(scope.expectedTitle),
      )
    }
    if (stepId === 'publish') {
      return inspection.pageKind === 'published-article' || scope.publicationStatus === 'dispatched'
    }
    if (stepId === 'verify-publication') {
      return (
        inspection.pageKind === 'published-article' &&
        normalizeText(inspection.title.value) === normalizeText(scope.expectedTitle)
      )
    }
    return false
  }

  private resolvePublishedUrl(
    params: Record<string, unknown>,
    attestation: TrustedPageAttestation,
  ): string | null {
    const outputRefs =
      params['outputRefs'] && typeof params['outputRefs'] === 'object'
        ? (params['outputRefs'] as Record<string, unknown>)
        : {}
    const requestedUrl = String(params['url'] ?? outputRefs['publicationUrl'] ?? '')
    if (!requestedUrl) return null
    const { inspection, scope } = attestation
    if (
      inspection.pageKind === 'published-article' &&
      inspection.url === requestedUrl &&
      normalizeText(inspection.title.value) === normalizeText(scope.expectedTitle)
    ) {
      return requestedUrl
    }
    return null
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

function requiresTrustedPageEvidence(toolName: string, params: Record<string, unknown>): boolean {
  return (
    (toolName === 'article_publishing_report_checkpoint' && params['status'] === 'completed') ||
    (toolName === 'article_publishing_report_asset' &&
      ['uploading', 'uploaded'].includes(String(params['status'] ?? ''))) ||
    (toolName === 'web_affair_finish_attempt' && params['outcome'] === 'succeeded')
  )
}

function trustedEvidenceKind(
  toolName: string,
  params: Record<string, unknown>,
): NonNullable<ArticlePublishingAgentReporter['trustedPageEvidence']>['kind'] {
  if (toolName === 'article_publishing_report_asset') {
    return params['status'] === 'uploading' ? 'asset-absent' : 'asset-uploaded'
  }
  if (toolName === 'web_affair_finish_attempt' || params['stepId'] === 'verify-publication') {
    return 'published'
  }
  return 'checkpoint'
}

function publishingEvidenceError<T>(message: string): WebAffairOperationResult<T> {
  return { success: false, error: { code: 'EVIDENCE_REQUIRED', message } }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
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
