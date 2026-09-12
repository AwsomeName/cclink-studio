import {
  parseBilibiliPublicationUrl,
  observeBilibiliSubmission,
  finishBilibiliSubmission,
} from './bilibili-publication'
import { readBilibiliComposer } from './bilibili-publishing-adapter'
import { observeBilibiliImageUpload } from './bilibili-upload-receipt'
import { parseToutiaoPublicationUrl } from './toutiao-publication'
import { readWeiboComposer } from './weibo-publishing-adapter'
import { observeToutiaoSubmission } from './toutiao-submission'
import { readToutiaoPage, TOUTIAO_DISABLE_MUSIC_SELECTOR } from './toutiao-publishing-adapter'
import {
  observeWeiboSubmission,
  parseWeiboPublicationUrl,
  weiboImageIdentity,
} from './weibo-publication'
import { observeXiaohongshuSubmission } from './xiaohongshu-submission'
import { readXiaohongshuEditor } from './xiaohongshu-publishing-adapter'
import {
  XIAOHONGSHU_SAVE_SELECTOR,
  XIAOHONGSHU_PUBLISH_SELECTOR,
} from './xiaohongshu-publish-control'
import { PublishingAdapter, publishingPlatform } from './publishing-adapter'
import { randomUUID } from 'node:crypto'
import { prepareArticleBody, prepareArticleMarkdown } from './article-body'
import type { BrowserTaskRun } from '../../shared/ipc/browser'
import type { ToolExecutionContext } from '../mcp/types'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import type { BrowserManager } from '../browser/browser-manager'
import type { WebAffairService } from '../web-affairs/web-affair-service'
import {
  isSamePlatformDraft,
  parsePlatformDraftAnchor,
} from '../../shared/article-publishing/platform-draft-anchor'
import { type CsdnPageProbe } from './csdn-publishing-adapter'
import { observeCsdnInitialDraftSave } from './csdn-initial-draft-save'
import { CsdnDraftRecoveryCoordinator } from './csdn-draft-recovery-coordinator'
import type { WebAffairOperationResult } from '../../shared/web-affairs/web-affair-types'
import type { ArticlePublishingAgentReporter } from '../web-affairs/web-affair-service'
import type {
  ArticlePublishingCurrentOperation,
  ArticlePublishingOperationFailure,
  ArticlePublishingRuntimeSnapshot,
} from '../../shared/article-publishing/article-publishing-types'

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
  adapterId: 'csdn' | 'zhihu' | 'juejin' | 'xiaohongshu' | 'weibo' | 'toutiao' | 'bilibili'
  workspaceId: string
  workspacePath: string
  affairId: string
  attemptId: string
  accountId: string
  currentStepId?: string
  currentOperation?: {
    operationRunId: string
    revision: number
    definitionId:
      | 'recovery.restore-exact-draft'
      | 'runtime.prepare-first-inspect'
      | 'page.first-inspect'
    status:
      | 'ready'
      | 'running'
      | 'verifying'
      | 'waiting-human'
      | 'interrupted'
      | 'result-unknown'
      | 'failed'
  }
  allowPublish?: boolean
  publicationUrl?: string
  publicationStatus: 'not-started' | 'dispatched' | 'verifying' | 'published' | 'result-unknown'
  localAssetsReady: boolean
  executionGeneration: number
  launchOperationId: string
  browserTaskRunId: string
  tabId: string
  browserViewRuntimeGeneration: number
  webContentsId: number
  playwrightConnectionGeneration: number
  playwrightPageBindingGeneration: number
  writePermitted: boolean
  writePermitId?: string
  draftUrl?: string
  expectedPlatformAccountId?: string
  expectedPlatformDraftId?: string
  expectedTitle: string
  expectedFields: import('../../shared/article-publishing/article-publishing-types').ArticlePublishingFields
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
    uploadNeverDispatched?: boolean
  }>
}

export interface ArticlePublishingPageInspection extends CsdnPageProbe {
  bodyMatchesFrozen?: boolean
  matchedAssets: Record<string, string>
}

interface TrustedPageAttestation {
  scope: ArticlePublishingExecutionScope
  inspection: ArticlePublishingPageInspection
  runtime: ArticlePublishingRuntimeSnapshot
  page: ReturnType<PlaywrightBridge['getPageById']>
  documentGeneration?: number
  editorDocumentGeneration?: number
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
  'frameExecute',
])
const CONTROL_ACTIVATION_ACTIONS = new Set(['click', 'press', 'pressKey'])
const READ_ONLY_STEPS = new Set(['verify-account', 'verify-publication'])
const POTENTIAL_AUTOSAVE_ACTIONS = new Set(['fill', 'select', 'check', 'uncheck', 'frameExecute'])
const AUTOSAVE_STEPS = new Set(['fill-body', 'fill-fields'])

/**
 * Stateless article-domain policy consumed by the generic Browser tool boundary.
 * It owns no task state and only resolves the current WebAffair snapshot.
 */
export class ArticlePublishingBrowserPolicy {
  private readonly adapter = new PublishingAdapter()
  private readonly attestations = new Map<string, TrustedPageAttestation>()

  constructor(
    private readonly webAffairService: WebAffairService,
    private readonly resolveWorkspaceId: (workspacePath: string) => Promise<string | null>,
    private readonly playwrightBridge?: PlaywrightBridge | null,
    private readonly browserTaskRuntime?: BrowserTaskRuntime | null,
    private readonly awaitRuntimeConvergence?: (attemptId: string) => Promise<void>,
    private readonly browserManager?: BrowserManager | null,
  ) {}

  async inspectCurrentPage(
    context?: ToolExecutionContext,
    retriesRemaining = 2,
  ): Promise<WebAffairOperationResult<ArticlePublishingPageInspection>> {
    const conversationId = context?.conversationId?.trim()
    const agentRunId = context?.agentRunId?.trim()
    if (!conversationId || !agentRunId || !this.playwrightBridge || !this.browserTaskRuntime) {
      return publishingEvidenceError('当前工具会话没有可核验的文章发布页面 Runtime')
    }
    let task = this.browserTaskRuntime.getActiveTaskForConversation(conversationId)
    if (!task || task.correlation?.agentRunId !== agentRunId) {
      return publishingEvidenceError('当前 Agent Run 没有精确绑定的活动 BrowserTask')
    }
    let scope = await this.resolveTaskScope(
      task,
      context,
      !context?.articlePublishingPolicy || !this.awaitRuntimeConvergence,
    )
    if (!scope && context?.articlePublishingPolicy && this.awaitRuntimeConvergence) {
      await this.awaitRuntimeConvergence(context.articlePublishingPolicy.attemptId).catch(
        () => undefined,
      )
      task = this.browserTaskRuntime.getTask(task.id)
      if (!task || task.status !== 'running' || task.correlation?.agentRunId !== agentRunId) {
        return publishingEvidenceError('Runtime 收敛后当前 Agent 的 BrowserTask 已失效')
      }
      scope = await this.resolveTaskScope(task, context)
    }
    if (!scope) {
      const failure = await this.runtimeResolutionFailure(task, context)
      const policy = context?.articlePublishingPolicy
      if (policy) {
        const snapshot = this.webAffairService.getProjectSnapshot(policy.workspaceId)
        const current = snapshot.success
          ? snapshot.data.affairs.find((affair) => affair.id === policy.affairId)?.articlePublishing
              ?.executionProtocol.current
          : undefined
        if (current) {
          await this.webAffairService.failArticlePublishingCurrentOperation({
            workspaceId: policy.workspaceId,
            affairId: policy.affairId,
            attemptId: policy.attemptId,
            executionGeneration: policy.executionGeneration,
            launchOperationId: policy.launchOperationId,
            expectedOperationRunId: current.operationRunId,
            expectedOperationRevision: current.revision,
            failure,
          })
        }
      }
      return publishingEvidenceError(failure.message)
    }
    const page = this.playwrightBridge.getPageById(task.tabId)
    if (!page || page.isClosed()) return publishingEvidenceError('绑定的 平台页面不可用')
    const trackedOperation = scope.currentOperation
    if (
      trackedOperation &&
      (trackedOperation.definitionId !== 'page.first-inspect' ||
        !['ready', 'running'].includes(trackedOperation.status))
    ) {
      return publishingEvidenceError('当前 operation 不允许执行首次页面检查')
    }
    const runtime = this.runtimeSnapshot(scope, context)
    const documentGeneration = this.browserManager?.getViewRuntimeIdentity(
      task.tabId,
    )?.documentGeneration
    const observationUrl = page.url()
    const editorDocumentGeneration = this.adapter.documentGeneration(page)
    const observationIsCurrent = () =>
      this.attestationRuntimeIsCurrent({
        scope,
        runtime,
        page,
        documentGeneration,
        editorDocumentGeneration,
        inspection: { url: observationUrl } as ArticlePublishingPageInspection,
      })
    const retryCurrentPage = async (): Promise<
      WebAffairOperationResult<ArticlePublishingPageInspection>
    > => {
      if (retriesRemaining > 0 && !context?.abortSignal?.aborted) {
        await this.awaitRuntimeConvergence?.(scope.attemptId)
        return this.inspectCurrentPage(context, retriesRemaining - 1)
      }
      return publishingEvidenceError('页面检查期间身份或文档已变化；旧观察已废止，请重试只读检查')
    }
    if (this.browserManager?.isViewVisible && !this.browserManager.isViewVisible(task.tabId)) {
      await this.webAffairService.recordArticlePublishingPlanResults(
        {
          workspaceId: scope.workspaceId,
          affairId: scope.affairId,
          attemptId: scope.attemptId,
          executionGeneration: scope.executionGeneration,
          launchOperationId: scope.launchOperationId,
          results: [
            {
              id: 'page.inspect',
              status: 'waiting',
              evidence: `当前绑定网页 Tab ${task.tabId} 不可见`,
              reason: '请打开网页，或点击“网页独立窗口”让原稿与执行计划同时可见；不会要求重新登录',
            },
          ],
        },
        () => !context?.abortSignal?.aborted && !this.browserManager!.isViewVisible(task.tabId),
      )
      return publishingEvidenceError(
        '绑定的原稿网页不可见；请打开网页或使用“网页独立窗口”后重新检查，不需要重新登录',
      )
    }
    if (!observationIsCurrent()) return retryCurrentPage()
    let startedOperation: ArticlePublishingCurrentOperation | undefined
    if (trackedOperation) {
      const started = await this.webAffairService.startArticlePublishingFirstInspect({
        workspaceId: scope.workspaceId,
        affairId: scope.affairId,
        attemptId: scope.attemptId,
        executionGeneration: scope.executionGeneration,
        launchOperationId: scope.launchOperationId,
        expectedOperationRunId: trackedOperation.operationRunId,
        expectedOperationRevision: trackedOperation.revision,
        runtime,
      })
      if (!started.success) return publishingEvidenceError(started.error.message)
      startedOperation = started.data.articlePublishing?.executionProtocol.current
      if (
        !startedOperation ||
        startedOperation.operationRunId !== trackedOperation.operationRunId ||
        startedOperation.status !== 'running'
      ) {
        return publishingEvidenceError('首次页面检查 operation 启动后身份不一致')
      }
    }
    let probe: CsdnPageProbe
    try {
      if (!observationIsCurrent()) return retryCurrentPage()
      probe = await this.adapter.probe(
        page,
        scope.expectedFields,
        scope.expectedPlatformDraftId,
        scope.assets,
      )
    } catch (error) {
      if (!observationIsCurrent()) return retryCurrentPage()
      const message = error instanceof Error ? error.message : String(error)
      if (startedOperation) {
        await this.webAffairService.failArticlePublishingCurrentOperation({
          workspaceId: scope.workspaceId,
          affairId: scope.affairId,
          attemptId: scope.attemptId,
          executionGeneration: scope.executionGeneration,
          launchOperationId: scope.launchOperationId,
          expectedOperationRunId: startedOperation.operationRunId,
          expectedOperationRevision: startedOperation.revision,
          failure: {
            category: 'platform-page',
            code: 'platform_page.inspect_failed',
            message: `平台页面只读检查失败：${message}`,
          },
        })
      }
      return publishingEvidenceError(`平台页面只读检查失败：${message}`)
    }
    const currentTask = this.browserTaskRuntime.getTask(task.id)
    const currentPage = this.playwrightBridge.getPageById(task.tabId)
    const currentScope = currentTask ? await this.resolveTaskScope(currentTask, context) : null
    const currentRuntime = currentScope ? this.runtimeSnapshot(currentScope, context) : null
    const visibleRuntime = this.browserManager?.getViewRuntimeIdentity(task.tabId)
    if (
      !observationIsCurrent() ||
      !currentTask ||
      currentTask.status !== 'running' ||
      currentTask.correlation?.agentRunId !== agentRunId ||
      currentPage !== page ||
      page.isClosed() ||
      page.url() !== probe.url ||
      !currentScope ||
      (startedOperation
        ? currentScope.currentOperation?.operationRunId !== startedOperation.operationRunId ||
          currentScope.currentOperation.revision !== startedOperation.revision ||
          currentScope.currentOperation.status !== 'running'
        : Boolean(currentScope.currentOperation)) ||
      !currentRuntime ||
      !sameRuntimeSnapshot(runtime, currentRuntime) ||
      (visibleRuntime !== undefined &&
        (!visibleRuntime ||
          visibleRuntime.browserViewRuntimeGeneration !== runtime.browserViewRuntimeGeneration ||
          visibleRuntime.webContentsId !== runtime.webContentsId))
    ) {
      return retryCurrentPage()
    }
    if (
      scope.draftUrl &&
      probe.pageKind === 'editor' &&
      !isSamePlatformDraft(scope.draftUrl, probe.url, scope.expectedPlatformDraftId)
    ) {
      return publishingEvidenceError('当前页面不是本 Attempt 已绑定的 平台草稿')
    }
    if (
      scope.adapterId === 'xiaohongshu' &&
      probe.pageKind === 'editor' &&
      (probe.draftId !== scope.expectedPlatformDraftId ||
        probe.platformAccountId !== scope.expectedPlatformAccountId)
    )
      return publishingEvidenceError('小红书当前账号或本地原稿身份不一致')
    if (scope.adapterId === 'bilibili' && probe.pageKind === 'published-article') {
      const receipt = parseBilibiliPublicationUrl(scope.publicationUrl ?? '')
      if (
        !receipt ||
        receipt.id !== probe.publishedArticleId ||
        receipt.url !== parseBilibiliPublicationUrl(probe.url)?.url ||
        !scope.expectedPlatformAccountId
      )
        return publishingEvidenceError('B站动态尚未与本账号的单次提交回执绑定')
      // Author identity is bound by main's guarded native submission receipt,
      // never inferred from the logged-in header on someone else's public page.
      probe = { ...probe, platformAccountId: scope.expectedPlatformAccountId }
    }
    if (['weibo', 'bilibili'].includes(scope.adapterId)) {
      const reason =
        probe.platformAccountId !== scope.expectedPlatformAccountId ||
        (!probe.editor.recognized && probe.pageKind !== 'published-article')
          ? `图文账号或编辑区域不能核验：${probe.publicationBlocker ?? 'UID 不一致'}`
          : ['open-editor', 'upload-assets'].includes(scope.currentStepId ?? '') &&
              (probe.editor.bodyTextLength > 0 ||
                (scope.currentStepId === 'open-editor' && probe.editor.images.length > 0) ||
                !probe.editor.imageEnumerationComplete)
            ? '图文编辑器存在未归属内容或无法完整核验图集，不能自动覆盖'
            : undefined
      if (reason) {
        await this.webAffairService.recordArticlePublishingPlanResults(
          {
            ...scope,
            results: [
              {
                id: 'page.inspect',
                status: 'waiting',
                reason,
                evidence: `账号 ${probe.platformAccountId ?? '不可读'}；正文 ${probe.editor.bodyTextLength} 字符；图片 ${probe.editor.images.map((i) => i.src).join('、') || '未读到'}；完整枚举 ${probe.editor.imageEnumerationComplete}`,
              },
            ],
          },
          observationIsCurrent,
        )
        return publishingEvidenceError(reason)
      }
    }
    if (probe.adapterId !== scope.adapterId) return publishingEvidenceError('页面与任务平台不一致')
    if (scope.adapterId === 'toutiao' && probe.pageKind === 'published-article') {
      // The numeric UID comes from main's original-account management verification,
      // bound to this exact public URL. Public profile tokens are not decoded.
      if (
        !scope.publicationUrl ||
        scope.publicationUrl !== probe.url ||
        parseToutiaoPublicationUrl(probe.url)?.id !== scope.expectedPlatformDraftId ||
        !scope.expectedPlatformAccountId
      )
        return publishingEvidenceError('头条公开页尚未与原账号管理页的本次作品绑定')
      probe = { ...probe, platformAccountId: scope.expectedPlatformAccountId }
    }
    const matchedAssets: Record<string, string> = {}
    if (probe.editor.recognized && probe.editor.imageEnumerationComplete) {
      for (const asset of scope.assets) {
        const existing = asset.platformUrl
          ? probe.editor.images.find(
              (image) => image.src === asset.platformUrl && image.loaded === true,
            )?.src
          : null
        if (existing) matchedAssets[asset.id] = existing
      }
    }
    const inspection: ArticlePublishingPageInspection = {
      ...probe,
      matchedAssets,
      ...(['weibo', 'bilibili'].includes(scope.adapterId) && !scope.allowPublish
        ? {
            submissionUnavailableReason:
              '本任务只授权准备图文，未授权提交；不会发送或将准备标为发布成功',
          }
        : {}),
      ...(['xiaohongshu', 'weibo', 'bilibili'].includes(scope.adapterId) && scope.publicationUrl
        ? { publishedLinks: [{ url: scope.publicationUrl, title: scope.expectedTitle }] }
        : {}),
    }
    if (
      (scope.assets.length || ['weibo', 'bilibili'].includes(scope.adapterId)) &&
      scope.localAssetsReady &&
      (probe.editor.recognized || probe.pageKind === 'published-article')
    ) {
      inspection.bodyMatchesFrozen = await this.verifyFrozenBody(scope, page, observationIsCurrent)
      if (!observationIsCurrent()) return retryCurrentPage()
    }
    if (startedOperation) {
      const completed = await this.webAffairService.completeArticlePublishingFirstInspect(
        {
          workspaceId: scope.workspaceId,
          affairId: scope.affairId,
          attemptId: scope.attemptId,
          executionGeneration: scope.executionGeneration,
          launchOperationId: scope.launchOperationId,
          expectedOperationRunId: startedOperation.operationRunId,
          expectedOperationRevision: startedOperation.revision,
          runtime,
          pageKind: inspection.pageKind,
          platformAccountId: inspection.platformAccountId,
          draftId: inspection.draftId,
          normalizedTitle: normalizeText(inspection.title.value),
          saveState: inspection.saveState,
        },
        observationIsCurrent,
      )
      if (!observationIsCurrent()) return retryCurrentPage()
      if (!completed.success) return publishingEvidenceError(completed.error.message)
    }
    const facts: Array<
      Pick<
        import('../../shared/article-publishing/article-publishing-types').ArticlePublishingDetailResult,
        'id' | 'status' | 'evidence' | 'reason'
      >
    > = [
      {
        id: 'page.inspect',
        status:
          inspection.platformAccountId && inspection.pageKind !== 'unsupported'
            ? 'completed'
            : 'waiting',
        evidence: `页面 ${inspection.pageKind} · 账号 ${inspection.platformAccountId ?? '不可读'} · draftId ${inspection.draftId ?? '尚无'} · 标题 ${inspection.title.value} · 保存 ${inspection.saveState}`,
      },
      {
        id: 'body.locate',
        status:
          inspection.editor.recognized && inspection.editor.bodySelector ? 'completed' : 'waiting',
        evidence: `正文 ${inspection.editor.bodySelector ?? '未识别'} · iframe ${inspection.editor.bodyFrameSelector ?? '主文档'} · ${inspection.editor.bodyTextLength} 字符`,
        ...(!inspection.editor.bodySelector ? { reason: '当前页面没有可核验的正文编辑区域' } : {}),
      },
    ]
    if (inspection.pageKind === 'published-article') facts.splice(1, 1)
    if (scope.adapterId === 'toutiao' && inspection.editor.recognized) {
      if (inspection.bodyMatchesFrozen === true)
        facts.push({
          id: 'body.dispatch',
          status: 'skipped',
          evidence: '原稿全文及逐图已与冻结原文一致；本次无需重写',
        })
      if (inspection.bodyMatchesFrozen === true && inspection.saveState === 'saved')
        facts.push({
          id: 'body.verify',
          status: 'completed',
          evidence: `当前冻结全文、逐图顺序和加载一致；${inspection.saveEvidence}`,
        })
      if (
        scope.currentStepId === 'save-draft' &&
        inspection.saveState === 'saved' &&
        inspection.bodyMatchesFrozen === true
      )
        facts.push({
          id: 'save.dispatch',
          status: 'skipped',
          evidence: '平台已保存全文及图集与当前任务一致，本次没有重复存稿',
        })
      if (
        scope.currentStepId === 'save-draft' &&
        inspection.saveState === 'saved' &&
        inspection.bodyMatchesFrozen === true
      )
        facts.push({
          id: 'save.verify',
          status: 'completed',
          evidence: inspection.saveEvidence ?? '当前原稿全文和逐图保存回读一致',
        })
      for (const [name, label] of [
        ['exclusive', '头条首发'],
        ['music', '开启配乐'],
      ]) {
        const option = inspection.toutiaoOptions?.find((o) => o.label === label)
        facts.push({
          id: `toutiao.${name}.verify`,
          status: option?.checked === false ? 'completed' : 'waiting',
          evidence: `${label}：${option?.checked === false ? '未勾选' : option?.checked === true ? '已勾选' : '不可读'}；当前页面回读`,
          reason:
            option?.checked === false ? undefined : (option?.reason ?? '提交前必须关闭并回读'),
        })
      }
      if (inspection.toutiaoOptions?.find((o) => o.label === '开启配乐')?.checked === false)
        facts.push({
          id: 'toutiao.music.dispatch',
          status: 'skipped',
          evidence: '当前配乐原生复选框已关闭，无需点击；不会反向开启',
        })
      for (const [index, asset] of scope.assets.entries()) {
        const matched = Boolean(inspection.matchedAssets[asset.id])
        facts.push({
          id: `asset.${asset.id}.inspect`,
          status: matched ? 'completed' : 'waiting',
          evidence: `${asset.displayPath}；网页图集 ${inspection.editor.images.length} 张；${matched ? '已关联的平台图片在当前原稿中加载成功' : `第 ${index + 1} 张尚未与本地原图关联`}`,
          reason: matched
            ? undefined
            : '平台原稿未保留原文件名；请使用原图对应确认入口，不得按数量猜测或重复上传',
        })
        if (
          matched &&
          asset.manualResolution?.status === 'present' &&
          asset.uploadAttemptCount === 0
        ) {
          for (const action of ['open', 'dispatch'])
            facts.push({
              id: `asset.${asset.id}.${action}`,
              status: 'skipped',
              evidence: '用户确认原图对应后，Studio 回读已有图集；本次没有上传动作',
            })
          facts.push({
            id: `asset.${asset.id}.verify`,
            status: 'completed',
            evidence: `用户确认原图对应；当前平台标识 ${asset.platformUrl} 与可见原稿一致且加载成功`,
          })
        }
      }
    }
    if (
      scope.adapterId === 'juejin' &&
      ['fill-fields', 'publish'].includes(scope.currentStepId ?? '')
    )
      facts.push({
        id: 'fields.open',
        status: inspection.selectors.openPublishSettings
          ? 'waiting'
          : inspection.selectors.publish
            ? 'completed'
            : 'waiting',
        evidence: inspection.selectors.publish
          ? '掘金发布设置面板已打开；尚未执行最终提交'
          : '需要打开掘金分类、标签、摘要面板',
        reason: inspection.selectors.openPublishSettings ? '等待打开平台字段面板' : undefined,
      })
    if (
      scope.adapterId === 'bilibili' &&
      ['fill-fields', 'save-draft', 'publish'].includes(scope.currentStepId ?? '')
    )
      facts.push({
        id: 'bilibili.visibility.verify',
        status: inspection.bilibiliVisibility === 'public' ? 'completed' : 'waiting',
        evidence: `当前原生可见范围：${inspection.bilibiliVisibility ?? 'unknown'}`,
        reason:
          inspection.bilibiliVisibility === 'public'
            ? undefined
            : '尚未核验当前所有用户可见的选中状态；不允许发送',
      })
    if (scope.currentStepId === 'upload-assets') {
      const asset = scope.assets.find((a) => a.kind === 'local' && a.status !== 'uploaded')
      if (asset)
        facts.push({
          id: `asset.${asset.id}.open`,
          status: inspection.selectors.fileInput ? 'completed' : 'waiting',
          evidence: `${asset.displayPath} · ${inspection.selectors.fileInput ?? '正文上传面板尚未打开'}`,
          reason: inspection.selectors.fileInput
            ? undefined
            : '先打开正文图片上传面板；不能使用封面或反馈上传框',
        })
    }
    for (const field of ['zhihu', 'weibo', 'toutiao', 'bilibili'].includes(scope.adapterId)
      ? (['title'] as const)
      : (['title', 'summary', 'tags', 'category', 'cover'] as const)) {
      const expected =
        field === 'cover'
          ? (scope.assets.find((a) => a.id === scope.expectedFields.coverAssetId)?.platformUrl ??
            scope.expectedFields.coverAssetId)
          : scope.expectedFields[field]
      const required = Array.isArray(expected) ? expected.length > 0 : Boolean(expected)
      if (!required) {
        facts.push(
          {
            id: `field.${field}.inspect`,
            status: 'skipped',
            evidence: '本任务未配置此可选字段，不执行修改',
          },
          { id: `field.${field}.dispatch`, status: 'skipped', evidence: '未配置，不需要写入' },
          {
            id: `field.${field}.verify`,
            status: 'skipped',
            evidence: '未配置，不声明当前平台字段已核验',
          },
        )
        continue
      }
      const actual = inspection.fieldValues?.[field]
      const expectedText = Array.isArray(expected) ? expected.join(',') : String(expected)
      const matches = actual !== undefined && normalizeText(actual) === normalizeText(expectedText)
      facts.push({
        id: `field.${field}.inspect`,
        status: actual === undefined ? 'waiting' : 'completed',
        evidence: `期望 ${expectedText}；实际 ${actual ?? '不支持读取此字段'}`,
        ...(actual === undefined ? { reason: '当前平台字段不是受支持的唯一可读控件' } : {}),
      })
      facts.push({
        id: `field.${field}.verify`,
        status: matches ? 'completed' : 'waiting',
        evidence: `期望 ${expectedText}；实际 ${actual ?? '不可读'}`,
        ...(!matches
          ? { reason: actual === undefined ? '缺少字段回读证据' : '字段值尚不一致' }
          : {}),
      })
      if (matches)
        facts.push({
          id: `field.${field}.dispatch`,
          status: 'skipped',
          evidence: '当前字段已经与任务一致，无需再次填写',
        })
    }
    if (
      scope.adapterId === 'xiaohongshu' &&
      inspection.selectors.publish &&
      scope.publicationStatus === 'not-started'
    )
      facts.push({
        id: 'publication.verify',
        status: 'waiting',
        evidence: '尚未提交；等待本次提交回执后核验公开结果',
        reason: '等待本次发布回执',
      })
    if (scope.adapterId === 'xiaohongshu' && scope.publicationUrl)
      facts.push({
        id: 'publication.verify',
        status: 'waiting',
        evidence: `已取得本次提交回执 · ${scope.publicationUrl}`,
        reason: '等待公开页原账号、原文与逐张图片核验；只核验，不重复发布',
      })
    if (inspection.submissionUnavailableReason)
      facts.push(
        {
          id: 'publish.preflight',
          status: 'waiting',
          evidence: inspection.submissionUnavailableReason,
          reason: inspection.submissionUnavailableReason,
        },
        {
          id: 'publication.verify',
          status: 'waiting',
          evidence: '尚未派发公开发布；' + inspection.submissionUnavailableReason,
          reason: inspection.submissionUnavailableReason,
        },
      )
    if (inspection.publicationBlocker)
      facts.push({
        id: 'publication.verify',
        status: /未通过|不通过/u.test(inspection.publicationBlocker) ? 'failed' : 'waiting',
        evidence: `平台文章状态栏：${inspection.publicationBlocker} · ${inspection.url}`,
        reason: `平台${inspection.publicationBlocker}；作者可见不代表公开成功。查看平台原因后决定修改或申诉，不自动重发`,
      })
    const planRecorded = await this.webAffairService.recordArticlePublishingPlanResults(
      {
        workspaceId: scope.workspaceId,
        affairId: scope.affairId,
        attemptId: scope.attemptId,
        executionGeneration: scope.executionGeneration,
        launchOperationId: scope.launchOperationId,
        results: facts,
      },
      observationIsCurrent,
    )
    if (!planRecorded.success) return publishingEvidenceError(planRecorded.error.message)
    if (!observationIsCurrent()) return retryCurrentPage()
    this.attestations.set(this.attestationKey(context), {
      scope: currentScope,
      inspection,
      runtime,
      page,
      documentGeneration,
      editorDocumentGeneration,
    })
    while (this.attestations.size > 40) {
      const oldest = this.attestations.keys().next().value
      if (!oldest) break
      this.attestations.delete(oldest)
    }
    // The adapter really read the bound visible Page. Register that read in the existing
    // BrowserTask log so a verification-only Run is not mistaken for an idle claim.
    const readLog = this.browserTaskRuntime?.startActionLog?.({
      taskRunId: scope.browserTaskRunId,
      tabId: scope.tabId,
      action: 'article_publishing_inspect_page',
      paramsSummary: `Verified read: ${inspection.pageKind} ${inspection.url}`,
    })
    if (readLog) this.browserTaskRuntime?.succeedActionLog(readLog.id)
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
      !this.attestationRuntimeIsCurrent(attestation) ||
      Date.now() - Date.parse(inspection.observedAt) > 60_000
    ) {
      return publishingEvidenceError('平台页面证据已经过期或不属于当前执行代次')
    }
    const evidenceKind = trustedEvidenceKind(toolName, params)
    if (
      evidenceKind === 'published' &&
      !params.url &&
      !(
        params.outputRefs &&
        typeof params.outputRefs === 'object' &&
        (params.outputRefs as Record<string, unknown>).publicationUrl
      )
    )
      return publishingEvidenceError(
        '发布核验缺少结果 URL：检查点 completed 必须携带 outputRefs.publicationUrl=inspect.url；结束 Attempt 必须携带 url=inspect.url',
      )
    if (evidenceKind === 'published' && inspection.publicationBlocker)
      return publishingEvidenceError(`CSDN ${inspection.publicationBlocker}，不能标记公开发布成功`)
    if (!this.inspectionProves(evidenceKind, params, attestation)) {
      return publishingEvidenceError('当前 平台页面读回结果不能证明所报告的成功状态')
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
          isCurrent: () => this.attestationRuntimeIsCurrent(attestation),
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
          bodyMatchesFrozen: inspection.bodyMatchesFrozen,
        },
      },
    }
  }

  async resolveAllowedOrigins(input: ResolveExecutionInput): Promise<string[] | null> {
    const scope = await this.resolveExecution(input)
    if (scope) return publishingPlatform(scope.adapterId).origins
    return (await this.isArticleAffair(input)) ? [] : null
  }

  async classifyAction(
    task: BrowserTaskRun,
    actionType: string,
    params: Record<string, unknown>,
    page: ReturnType<PlaywrightBridge['getPage']>,
    context?: ToolExecutionContext,
  ): Promise<ArticlePublishingBrowserActionDecision | null> {
    const decision = await this.classifyActionDecision(task, actionType, params, page, context)
    if (
      decision &&
      ['handoff', 'unknown', 'runtime-error'].includes(decision.kind) &&
      'reason' in decision
    )
      await this.recordActionFailure(task, actionType, params, decision.reason, false, context)
    return decision
  }

  /** A real rejected/failed Browser action, not an Agent's description of progress. */
  async recordActionFailure(
    task: BrowserTaskRun,
    actionType: string,
    params: Record<string, unknown>,
    reason: string,
    dispatched: boolean,
    context?: ToolExecutionContext,
  ): Promise<void> {
    const scope = await this.resolveTaskScope(task, context, false)
    if (!scope) return
    const selectors = this.attestations.get(this.attestationKey(context))?.inspection.selectors
    const asset =
      Array.isArray(params.paths) && params.paths.length === 1
        ? scope.assets.find((a) => a.sourcePath === (params.paths as unknown[])[0])
        : undefined
    const field = (['title', 'summary', 'tags', 'category', 'cover'] as const).find(
      (key) => selectors?.[key] && selectors[key] === params.selector,
    )
    const openingAsset =
      scope.currentStepId === 'upload-assets' && selectors?.imageOpen === params.selector
        ? scope.assets.find((a) => a.kind === 'local' && a.status !== 'uploaded')
        : undefined
    const id =
      scope.adapterId === 'toutiao' && params.selector === TOUTIAO_DISABLE_MUSIC_SELECTOR
        ? `toutiao.music.${dispatched ? 'verify' : 'dispatch'}`
        : openingAsset
          ? `asset.${openingAsset.id}.open`
          : scope.currentStepId === 'open-editor' && selectors?.save === params.selector
            ? dispatched
              ? 'initial.anchor'
              : 'initial.save.dispatch'
            : asset
              ? `asset.${asset.id}.${dispatched ? 'verify' : 'dispatch'}`
              : scope.currentStepId === 'fill-body' && selectors?.body === params.selector
                ? `body.${dispatched ? 'verify' : 'dispatch'}`
                : scope.currentStepId === 'fill-fields' && field
                  ? `field.${field}.${dispatched ? 'verify' : 'dispatch'}`
                  : scope.currentStepId === 'save-draft'
                    ? `save.${dispatched ? 'verify' : 'dispatch'}`
                    : scope.currentStepId === 'publish'
                      ? dispatched
                        ? 'publication.verify'
                        : 'publish.dispatch'
                      : 'page.inspect'
    await this.webAffairService.recordArticlePublishingPlanResults(
      {
        workspaceId: scope.workspaceId,
        affairId: scope.affairId,
        attemptId: scope.attemptId,
        executionGeneration: scope.executionGeneration,
        launchOperationId: scope.launchOperationId,
        results: [
          {
            id,
            status: dispatched ? 'unknown' : 'failed',
            evidence: `${actionType} · ${asset?.displayPath ?? field ?? scope.currentStepId ?? '页面检查'} · ${dispatched ? '可能已派发，不能重放' : '动作被拒绝或尚未派发'}`,
            reason,
          },
        ],
      },
      () =>
        !context?.abortSignal?.aborted &&
        this.browserTaskRuntime?.getTask(task.id)?.status === 'running',
    )
  }

  private async classifyActionDecision(
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
        const failure = await this.runtimeResolutionFailure(task, context)
        const reason = failure.message
        console.warn('[ArticlePublishing] 适配器动作判定', {
          affairId: correlation.affairId,
          attemptId: correlation.affairAttemptId,
          adapter: 'unresolved',
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
    if (scope.currentOperation) {
      const reason =
        scope.currentOperation.definitionId === 'page.first-inspect'
          ? '当前 operation 只允许调用 article_publishing_inspect_page；其他 Browser 工具尚未开放'
          : '文章发布 Runtime 尚在准备，当前 operation 不开放 Browser 工具'
      return { kind: 'runtime-error', reason }
    }
    const isMutation = PAGE_MUTATION_ACTIONS.has(actionType)
    if (isMutation && !scope.writePermitted) {
      const reason = '草稿恢复正在收敛到最新 Page Runtime，当前禁止写入'
      console.warn('[ArticlePublishing] 适配器动作判定', {
        affairId: scope.affairId,
        attemptId: scope.attemptId,
        adapter: `${scope?.adapterId ?? 'unknown'}@1`,
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
    const visibleAnchor = parsePlatformDraftAnchor(pageUrl, scope.expectedPlatformDraftId)
    const boundDraftUrl = scope.draftUrl
    if (isMutation && visibleAnchor && !boundDraftUrl) {
      return {
        kind: 'runtime-error',
        reason: '当前数字草稿不是本任务首次保存产生的原稿，禁止认领或写入',
      }
    }
    if (
      isMutation &&
      !['weibo', 'bilibili'].includes(scope.adapterId) &&
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
      if (!isSamePlatformDraft(boundDraftUrl, pageUrl, scope.expectedPlatformDraftId)) {
        return this.stopDecision(
          scope,
          actionType,
          'unknown',
          '当前页面不是本 Attempt 已绑定的原草稿，已拒绝串稿写入',
          pageUrl,
        )
      }
    }
    if (!isMutation) {
      if (actionType === 'frameContent' && params.frameSelector) {
        const attestation = this.attestations.get(this.attestationKey(context))
        if (
          !attestation ||
          !this.attestationRuntimeIsCurrent(attestation) ||
          params.frameSelector !== attestation.inspection.editor.bodyFrameSelector ||
          params.selector !== attestation.inspection.selectors.body
        ) {
          return {
            kind: 'runtime-error',
            reason: '正文读取必须使用最新 inspect 签发的 iframe 和正文 selector',
          }
        }
      }
      return { kind: 'allow' }
    }
    if (!this.isRecognizedPageForStep(pageUrl, scope.currentStepId)) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        '当前页面不是适配器可核验的 平台文章发布页面',
        pageUrl,
      )
    }
    const dismissSelectors = this.attestations.get(this.attestationKey(context))?.inspection
      .selectors
    if (
      actionType === 'click' &&
      [dismissSelectors?.dismissAssistant, dismissSelectors?.dismissTagEditor].some(
        (s) => s && params.selector === s,
      )
    ) {
      return (
        this.validateAttestedSelector(scope, actionType, params, pageUrl, context) ?? {
          kind: 'allow',
        }
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
    if (scope.adapterId === 'toutiao' && params.selector === TOUTIAO_DISABLE_MUSIC_SELECTOR) {
      const attestation = this.attestations.get(this.attestationKey(context))
      const live = await readToutiaoPage(page)
      if (
        actionType !== 'click' ||
        scope.currentStepId !== 'publish' ||
        scope.publicationStatus !== 'not-started' ||
        !attestation ||
        !this.attestationRuntimeIsCurrent(attestation) ||
        context?.abortSignal?.aborted ||
        !live.editorRecognized ||
        live.url !== pageUrl ||
        live.uid !== scope.expectedPlatformAccountId ||
        !isSamePlatformDraft(scope.draftUrl ?? '', live.url, scope.expectedPlatformDraftId) ||
        normalizeText(live.title) !== normalizeText(scope.expectedTitle) ||
        live.options.find((o) => o.label === '开启配乐')?.checked !== true
      )
        return {
          kind: 'runtime-error',
          reason: '配乐当前未勾选或页面证据已变化；禁止再次切换，请重新 inspect',
        }
      return { kind: 'allow' }
    }
    const fieldPanel = this.attestations.get(this.attestationKey(context))?.inspection.selectors
      .openPublishSettings
    if (
      scope.adapterId === 'juejin' &&
      actionType === 'click' &&
      fieldPanel &&
      params.selector === fieldPanel
    )
      return { kind: 'allow' }
    const tagEditor = this.attestations.get(this.attestationKey(context))?.inspection.tagEditor
    if (scope.currentStepId === 'fill-fields' && tagEditor) {
      if (actionType === 'click' && params.selector === tagEditor.openSelector)
        return { kind: 'allow' }
      if (params.selector === tagEditor.inputSelector) {
        const pending = actionType === 'fill' ? String(params.value ?? '') : tagEditor.pendingValue
        if (!scope.expectedFields.tags.includes(pending))
          return { kind: 'runtime-error', reason: '只能填写任务冻结的文章标签' }
        if (actionType === 'fill') return { kind: 'allow' } // Search buffer, not an article field yet.
        if (actionType === 'press' && params.key === 'Enter') {
          if ((await page.locator(String(params.selector)).inputValue()) !== pending)
            return { kind: 'runtime-error', reason: '标签输入已变化，重新 inspect 后再提交' }
          return this.reserveSideEffect(
            scope,
            'save-draft',
            `autosave:fill-fields:tags:${randomUUID()}`,
            actionType,
            params,
            pageUrl,
          )
        }
        return {
          kind: 'runtime-error',
          reason: '标签只允许填写冻结值后在唯一输入框按 Enter，再回读文章标签',
        }
      }
    }
    if (scope.currentStepId === 'open-editor' && !boundDraftUrl) {
      const inspection = this.attestations.get(this.attestationKey(context))!.inspection
      const initialPage =
        inspection.url === 'https://mp.csdn.net/mp_blog/creation/editor' &&
        Boolean(inspection.platformAccountId)
      const snapshot = this.webAffairService.getProjectSnapshot(scope.workspaceId)
      const effects = snapshot.success
        ? snapshot.data.affairs.find((a) => a.id === scope.affairId)?.articlePublishing?.sideEffects
        : []
      const ownsEffect = (targetId: string) =>
        effects?.some(
          (effect) =>
            effect.targetId === targetId &&
            effect.executionGeneration === scope.executionGeneration &&
            effect.browserTaskRunId === task.id &&
            effect.status === 'dispatched',
        )
      const seed = scope.expectedTitle.trim().slice(0, 10)
      const selector = String(params.selector ?? '')
      if (
        initialPage &&
        inspection.editor.initialDraftBodyEmpty &&
        actionType === 'fill' &&
        selector === inspection.selectors.title &&
        !inspection.title.value.trim() &&
        params.value === scope.expectedTitle
      ) {
        return this.reserveSideEffect(
          scope,
          'save-draft',
          'initial-draft:title',
          actionType,
          params,
          pageUrl,
        )
      }
      if (
        initialPage &&
        inspection.editor.initialDraftBodyEmpty &&
        actionType === 'frameExecute' &&
        params.value === seed &&
        normalizeText(inspection.title.value) === normalizeText(scope.expectedTitle) &&
        ownsEffect('initial-draft:title')
      ) {
        return this.reserveSideEffect(
          scope,
          'save-draft',
          'initial-draft:body',
          actionType,
          params,
          pageUrl,
        )
      }
      if (
        initialPage &&
        inspection.editor.initialDraftBodyText === seed &&
        actionType === 'click' &&
        selector === inspection.selectors.save &&
        normalizeText(inspection.title.value) === normalizeText(scope.expectedTitle)
      ) {
        if (ownsEffect('initial-draft:body')) {
          return this.reserveSideEffect(
            scope,
            'save-draft',
            'initial-draft:save',
            actionType,
            params,
            pageUrl,
          )
        }
      }
      if (inspection.editor.recognized) {
        return {
          kind: 'runtime-error',
          reason:
            '首次草稿只允许依次填写冻结标题、标题前 10 字的建稿占位、保存一次；每步先重新检查，未知结果禁止重新创建',
        }
      }
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
        `autosave:${scope.currentStepId}:${scope.currentStepId === 'fill-fields' ? `${(['title', 'summary', 'tags', 'category', 'cover'] as const).find((field) => this.attestations.get(this.attestationKey(context))?.inspection.selectors[field] === params.selector) ?? 'unknown'}:` : ''}${randomUUID()}`,
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
        control =
          scope.adapterId === 'xiaohongshu' &&
          [XIAOHONGSHU_SAVE_SELECTOR, XIAOHONGSHU_PUBLISH_SELECTOR].includes(selector)
            ? {
                label: selector === XIAOHONGSHU_SAVE_SELECTOR ? '暂存离开' : '发布',
                type: 'button',
                role: 'button',
              }
            : await locator.evaluate((element) => {
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
    const semanticControl = this.attestedSemanticControl(context, selector)
    if (semanticControl === 'save-draft') {
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
    if (semanticControl !== 'publish') return { kind: 'allow' }
    if (['weibo', 'bilibili'].includes(scope.adapterId) && scope.allowPublish !== true)
      return this.stopDecision(
        scope,
        actionType,
        'handoff',
        '本任务只授权准备图文，禁止发送；需要在新任务中明确授权该账号和文章的单次提交',
        pageUrl,
      )
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
    sideEffectKey?: string,
    mutationSelector?: string,
  ): Promise<void> {
    if (!PAGE_MUTATION_ACTIONS.has(actionType) || !page) return
    const scope = await this.resolveTaskScope(task, context)
    if (!scope) return
    if (
      scope.adapterId === 'toutiao' &&
      scope.currentStepId === 'publish' &&
      actionType === 'click' &&
      mutationSelector === TOUTIAO_DISABLE_MUSIC_SELECTOR
    ) {
      const attestation = this.attestations.get(this.attestationKey(context))
      const result = await this.webAffairService.recordArticlePublishingPlanResults(
        {
          ...scope,
          results: [
            {
              id: 'toutiao.music.dispatch',
              status: 'completed',
              evidence:
                'Agent 对 Studio 签发的已勾选配乐标签点击已返回；是否关闭由下一次原生复选框回读判断',
            },
          ],
        },
        () =>
          !context?.abortSignal?.aborted &&
          Boolean(attestation && this.attestationRuntimeIsCurrent(attestation)),
      )
      if (!result.success) throw new Error(result.error.message)
      return
    }
    if (!sideEffectKey && ['fill-fields', 'upload-assets'].includes(scope.currentStepId ?? ''))
      return
    let mutatedField: 'title' | 'summary' | 'tags' | 'category' | 'cover' | undefined
    if (sideEffectKey) {
      const snapshot = this.webAffairService.getProjectSnapshot(scope.workspaceId)
      const effect = snapshot.success
        ? snapshot.data.affairs
            .find((a) => a.id === scope.affairId)
            ?.articlePublishing?.sideEffects.find((e) => e.key === sideEffectKey)
        : undefined
      let id: string | undefined
      if (effect?.kind === 'publish') id = 'publish.dispatch'
      else if (effect?.kind === 'upload-asset')
        id = `asset.${effect.targetId.replace(/:attempt-\d+$/u, '')}.dispatch`
      else if (effect?.targetId.startsWith('initial-draft:'))
        id = `initial.${effect.targetId.split(':')[1]}.dispatch`
      else if (effect?.targetId.startsWith('autosave:fill-body:')) id = 'body.dispatch'
      else if (effect?.targetId.startsWith('autosave:fill-fields:')) {
        const field = effect.targetId.split(':')[2]
        if (['title', 'summary', 'tags', 'category', 'cover'].includes(field)) {
          mutatedField = field as typeof mutatedField
          id = `field.${field}.dispatch`
        }
      } else if (effect?.targetId.startsWith('manual-save:')) id = 'save.dispatch'
      if (id)
        await this.webAffairService.recordArticlePublishingPlanResults(
          {
            workspaceId: scope.workspaceId,
            affairId: scope.affairId,
            attemptId: scope.attemptId,
            executionGeneration: scope.executionGeneration,
            launchOperationId: scope.launchOperationId,
            results: [
              {
                id,
                status: 'completed',
                evidence: `浏览器动作 ${actionType} 已返回；平台结果另行核验 · ${effect?.targetId}`,
              },
            ],
          },
          () =>
            !context?.abortSignal?.aborted &&
            Boolean(this.browserTaskRuntime?.getTask(task.id)?.status === 'running'),
        )
    }
    if (scope.currentStepId === 'open-editor' || scope.currentStepId === 'publish') return
    const runtime = this.runtimeSnapshot(scope, context)
    const documentGeneration = this.browserManager?.getViewRuntimeIdentity(
      task.tabId,
    )?.documentGeneration
    const url = page.url()
    const editorDocumentGeneration = this.adapter.documentGeneration(page)
    const isCurrent = () =>
      !context?.abortSignal?.aborted &&
      this.attestationRuntimeIsCurrent({
        scope,
        runtime,
        page,
        documentGeneration,
        editorDocumentGeneration,
        inspection: { url } as ArticlePublishingPageInspection,
      })
    if (['weibo', 'bilibili'].includes(scope.adapterId)) {
      const probe = await this.adapter.probe(page, undefined, undefined, scope.assets)
      if (
        !isCurrent() ||
        probe.platformAccountId !== scope.expectedPlatformAccountId ||
        !probe.editor.recognized
      )
        throw new Error('图文写入后账号或页面已变化，不能确认写入结果')
      if (scope.currentStepId === 'fill-body') {
        const matches = await this.verifyFrozenBody(scope, page, isCurrent)
        const result = await this.webAffairService.recordArticlePublishingPlanResults(
          {
            ...scope,
            results: [
              {
                id: 'body.verify',
                status: matches ? 'completed' : 'waiting',
                evidence: `当前图文正文 ${probe.editor.bodyTextLength} 字符；正文及逐图${matches ? '一致' : '尚未一致'}；无平台保存保证`,
                reason: matches ? undefined : '当前正文或图集与冻结稿件不符',
              },
            ],
          },
          isCurrent,
        )
        if (!result.success) throw new Error(result.error.message)
        if (!matches) throw new Error('图文正文或图集回读不一致，停止自动写入')
      }
      return
    }
    let observation: CsdnPageProbe | null = null
    let lastSaveObservation = ''
    // Real CSDN CKEditor starts its autosave timer 60s after a dirty change. Read only:
    // allow that interval plus response time, never click Save or replay the mutation here.
    const deadline = Date.now() + 75_000
    while (Date.now() < deadline) {
      if (!isCurrent()) throw new Error('保存读回前页面已变化，必须重新核验原草稿')
      const probe = await this.adapter.probe(page)
      if (!isCurrent()) throw new Error('保存读回期间页面已变化，结果未知，禁止重复派发')
      if (mutatedField) {
        const expected =
          mutatedField === 'cover'
            ? scope.assets.find((a) => a.id === scope.expectedFields.coverAssetId)?.platformUrl
            : scope.expectedFields[mutatedField]
        const expectedText = Array.isArray(expected) ? expected.join(',') : expected
        const actual = probe.fieldValues?.[mutatedField]
        const matches =
          expectedText !== undefined &&
          actual !== undefined &&
          normalizeText(actual) === normalizeText(expectedText)
        const result = await this.webAffairService.recordArticlePublishingPlanResults(
          {
            workspaceId: scope.workspaceId,
            affairId: scope.affairId,
            attemptId: scope.attemptId,
            executionGeneration: scope.executionGeneration,
            launchOperationId: scope.launchOperationId,
            results: [
              {
                id: `field.${mutatedField}.verify`,
                status: matches ? 'completed' : 'waiting',
                evidence: `期望 ${expectedText ?? '缺少已核验封面'}；实际 ${actual ?? '无法读取'}`,
                reason: matches ? undefined : '字段写后回读不匹配，不能完成字段步骤',
              },
            ],
          },
          isCurrent,
        )
        if (!result.success) throw new Error(result.error.message)
        // The field value has been observed; saving remains an independent read below.
        mutatedField = undefined
      }
      const actualSave = `账号 ${probe.platformAccountId ?? '不可读'} · draftId ${probe.draftId ?? '不可读'} · 标题 ${probe.title.value} · 正文 ${probe.editor.bodyTextLength} 字符 · 保存 ${probe.saveState}`
      if (
        actualSave !== lastSaveObservation &&
        ['fill-body', 'fill-fields', 'save-draft'].includes(scope.currentStepId ?? '')
      ) {
        lastSaveObservation = actualSave
        const result = await this.webAffairService.recordArticlePublishingPlanResults(
          {
            workspaceId: scope.workspaceId,
            affairId: scope.affairId,
            attemptId: scope.attemptId,
            executionGeneration: scope.executionGeneration,
            launchOperationId: scope.launchOperationId,
            results: [
              {
                id: scope.currentStepId === 'fill-body' ? 'body.verify' : 'save.verify',
                status: 'verifying',
                evidence: actualSave,
                reason:
                  probe.saveState === 'saved' ? undefined : '正在只读等待平台保存，不重复写入',
              },
            ],
          },
          isCurrent,
        )
        if (!result.success) throw new Error(result.error.message)
      }
      if (
        probe.editor.recognized &&
        probe.draftId &&
        probe.platformAccountId &&
        probe.saveState === 'saved'
      ) {
        observation = probe
        break
      }
      await page.waitForTimeout(1000)
    }
    if (!observation?.draftId || !observation.platformAccountId) {
      throw new Error('网页动作后无法读回同一账号、同一草稿和已保存状态')
    }
    if (
      scope.currentStepId === 'fill-body' &&
      scope.assets.length &&
      !(await this.verifyFrozenBody(scope, page, isCurrent))
    )
      throw new Error('正文或逐图位置与冻结原稿不一致，不能完成正文填写')
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
      isCurrent,
    )
    if (!recorded.success) throw new Error(recorded.error.message)
    if (['fill-body', 'fill-fields', 'save-draft'].includes(scope.currentStepId ?? '')) {
      const result = await this.webAffairService.recordArticlePublishingPlanResults(
        {
          workspaceId: scope.workspaceId,
          affairId: scope.affairId,
          attemptId: scope.attemptId,
          executionGeneration: scope.executionGeneration,
          launchOperationId: scope.launchOperationId,
          results: [
            {
              id: scope.currentStepId === 'fill-body' ? 'body.verify' : 'save.verify',
              status:
                scope.currentStepId !== 'fill-body' || observation.editor.bodyTextLength > 0
                  ? 'completed'
                  : 'waiting',
              evidence: `账号 ${observation.platformAccountId} · draftId ${observation.draftId} · 标题 ${observation.title.value} · 正文 ${observation.editor.bodyTextLength} 字符 · saved · ${observation.saveEvidence ?? '页面保存状态回读'}`,
            },
          ],
        },
        isCurrent,
      )
      if (!result.success) throw new Error(result.error.message)
    }
  }

  private async verifyFrozenBody(
    scope: ArticlePublishingExecutionScope,
    page: NonNullable<ReturnType<PlaywrightBridge['getPage']>>,
    isCurrent: () => boolean,
  ) {
    const snapshot = this.webAffairService.getProjectSnapshot(scope.workspaceId)
    const state = snapshot.success
      ? snapshot.data.affairs.find((a) => a.id === scope.affairId)?.articlePublishing
      : undefined
    if (!state) return false
    const observed = await this.adapter.verifyBody(
      page,
      await prepareArticleBody(state),
      scope.assets,
    )
    if (!isCurrent()) return false
    const results = state.assets
      .filter((a) => a.kind === 'local')
      .map((asset) => {
        const images = observed.images.filter((i) => i.src === asset.platformUrl)
        const matches = images.length === asset.occurrences.length && images.every((i) => i.matches)
        return {
          id: `asset.${asset.id}.${Boolean(parseBilibiliPublicationUrl(page.url())) || Boolean(parseToutiaoPublicationUrl(page.url())) || Boolean(parseWeiboPublicationUrl(page.url())) || page.url().startsWith('https://www.xiaohongshu.com/explore/') || page.url().startsWith('https://juejin.cn/post/') || page.url().startsWith('https://blog.csdn.net/') || /^https:\/\/zhuanlan\.zhihu\.com\/p\/\d+\/?$/u.test(page.url()) ? 'published' : 'placement'}`,
          status: matches ? ('completed' as const) : ('waiting' as const),
          evidence: ['xiaohongshu', 'weibo', 'toutiao', 'bilibili'].includes(scope.adapterId)
            ? `${asset.displayPath} · 图集 ${images.map((i) => `第 ${i.index + 1} 张：${i.matches ? '顺序、平台地址和加载通过' : '未匹配'}`).join('；')}`
            : `${asset.displayPath} · 期望 ${asset.occurrences.length} 处，实际对应 ${images.filter((i) => i.matches).length} 处；${images.map((i) => `第 ${i.index + 1} 张，前文 ${i.precedingCharacters} 字符，${i.matches ? (scope.adapterId === 'zhihu' ? '位置/地址/加载一致（知乎不保留替代文字）' : '位置/地址/替代文字/加载一致') : '不匹配'}`).join('；')}`,
          reason: matches
            ? undefined
            : scope.adapterId === 'xiaohongshu' &&
                page.url().startsWith('https://www.xiaohongshu.com/explore/')
              ? '发布后图片地址与上传记录不同，尚缺平台转换映射证据；请核对这张图，不得重传或重发'
              : '正文图片顺序、位置或加载结果未核验通过',
        }
      })
    if (!observed.textMatches)
      results.push({
        id:
          Boolean(parseBilibiliPublicationUrl(page.url())) ||
          Boolean(parseToutiaoPublicationUrl(page.url())) ||
          Boolean(parseWeiboPublicationUrl(page.url())) ||
          page.url().startsWith('https://www.xiaohongshu.com/explore/') ||
          page.url().startsWith('https://juejin.cn/post/') ||
          page.url().startsWith('https://blog.csdn.net/') ||
          /^https:\/\/zhuanlan\.zhihu\.com\/p\/\d+\/?$/u.test(page.url())
            ? 'publication.verify'
            : 'body.verify',
        status: 'waiting',
        evidence: observed.textEvidence,
        reason: '正文实际内容与冻结原稿不同',
      })
    const saved = await this.webAffairService.recordArticlePublishingPlanResults(
      { ...scope, results },
      isCurrent,
    )
    if (!saved.success) throw new Error(saved.error.message)
    return observed.matches
  }

  async prepareBodyWrite(task: BrowserTaskRun, context?: ToolExecutionContext) {
    const scope = await this.resolveTaskScope(task, context)
    if (
      !scope ||
      scope.currentStepId !== 'fill-body' ||
      (!scope.assets.length && !['weibo', 'bilibili'].includes(scope.adapterId))
    )
      return undefined
    const snapshot = this.webAffairService.getProjectSnapshot(scope.workspaceId)
    const state = snapshot.success
      ? snapshot.data.affairs.find((a) => a.id === scope.affairId)?.articlePublishing
      : undefined
    if (!state) throw new Error('冻结正文不存在')
    if (state.adapterId === 'weibo') {
      return (await prepareArticleMarkdown(state))
        .replace(/^# /u, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
        .trim()
    }
    if (state.adapterId === 'xiaohongshu' || state.adapterId === 'bilibili') {
      const markdown = await prepareArticleMarkdown(state)
      return markdown
        .replace(/^# [^\n]*\n/u, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
        .trim()
    }
    if (state.adapterId === 'juejin') {
      const page = this.playwrightBridge?.getPageById(scope.tabId)
      if (!page) throw new Error('掘金原稿页面不可用')
      const live = await page
        .locator('.bytemd-preview img')
        .evaluateAll((images) => images.map((e) => (e as HTMLImageElement).src))
      let markdown = await prepareArticleMarkdown(state)
      for (const asset of state.assets.filter((a) => a.kind === 'local')) {
        const current = live.find((src) => src.split('?')[0] === asset.platformUrl)
        if (!current || !asset.platformUrl)
          throw new Error(`原稿已核验图片无法对应：${asset.displayPath}`)
        markdown = markdown.split(asset.platformUrl).join(current)
      }
      return markdown
    }
    let html = await prepareArticleBody(state)
    if (state.adapterId === 'zhihu') {
      const page = this.playwrightBridge?.getPageById(scope.tabId)
      if (!page) throw new Error('知乎原稿页面不可用')
      const live = await page
        .locator('.public-DraftEditor-content img')
        .evaluateAll((images) => images.map((e) => (e as HTMLImageElement).src))
      for (const asset of state.assets.filter((a) => a.kind === 'local')) {
        const current = live.find((src) => src.split('?')[0] === asset.platformUrl)
        if (!current || !asset.platformUrl)
          throw new Error(`当前原稿无法取得已核验图片：${asset.displayPath}`)
        html = html
          .split(asset.platformUrl.replace(/&/gu, '&amp;'))
          .join(current.replace(/&/gu, '&amp;'))
      }
    }
    return html
  }

  async prepareImageUpload(
    task: BrowserTaskRun,
    sideEffectKey: string,
    page: ReturnType<PlaywrightBridge['getPage']>,
    context?: ToolExecutionContext,
  ) {
    const scope = await this.resolveTaskScope(task, context)
    if (!scope || !page || scope.currentStepId !== 'upload-assets') return null
    const snapshot = this.webAffairService.getProjectSnapshot(scope.workspaceId)
    const effect = snapshot.success
      ? snapshot.data.affairs
          .find((a) => a.id === scope.affairId)
          ?.articlePublishing?.sideEffects.find((e) => e.key === sideEffectKey)
      : undefined
    if (effect?.kind !== 'upload-asset') return null
    const assetId = effect.targetId.replace(/:attempt-\d+$/u, '')
    const before = await this.adapter.probe(page, undefined, undefined, scope.assets)
    if (
      !before.editor.imageEnumerationComplete ||
      (['weibo', 'bilibili'].includes(scope.adapterId)
        ? !before.platformAccountId ||
          before.platformAccountId !== scope.expectedPlatformAccountId ||
          before.editor.images.some((i) => !scope.assets.some((a) => a.platformUrl === i.src))
        : !before.draftId)
    )
      throw new Error('上传前正文图片无法完整枚举')
    const urls = new Set(before.editor.images.map((i) => i.src))
    const runtime = this.runtimeSnapshot(scope, context)
    const documentGeneration = this.browserManager?.getViewRuntimeIdentity(
      task.tabId,
    )?.documentGeneration
    const editorDocumentGeneration = this.adapter.documentGeneration(page)
    const isCurrent = () =>
      !context?.abortSignal?.aborted &&
      this.attestationRuntimeIsCurrent({
        scope,
        runtime,
        page,
        documentGeneration,
        editorDocumentGeneration,
        inspection: { url: before.url } as ArticlePublishingPageInspection,
      })
    const uploadReceipt = scope.adapterId === 'bilibili' ? observeBilibiliImageUpload(page) : null
    return {
      arm: () => uploadReceipt?.arm(),
      dispose: () => uploadReceipt?.dispose(),
      finish: async () => {
        const receivedUrl = await uploadReceipt?.finish()
        const observedAssets = receivedUrl
          ? scope.assets.map((a) => (a.id === assetId ? { ...a, platformUrl: receivedUrl } : a))
          : scope.assets
        const deadline = Date.now() + 30_000
        while (Date.now() < deadline) {
          if (!isCurrent()) throw new Error('图片上传后页面已改代，只能恢复核验，禁止重复上传')
          const after = await this.adapter.probe(page, undefined, undefined, observedAssets)
          if (!isCurrent()) throw new Error('图片回读证据已过期')
          const added = after.editor.images.filter((i) => !urls.has(i.src))
          if (added.length > 1) throw new Error('一次上传出现多张新图片，无法确定文件对应关系')
          if (
            added.length === 1 &&
            added[0].loaded &&
            after.editor.imageEnumerationComplete &&
            (scope.adapterId !== 'xiaohongshu' || after.saveState === 'saved') &&
            after.draftId === before.draftId &&
            after.platformAccountId === before.platformAccountId
          ) {
            uploadReceipt?.assertUnique()
            const recorded = await this.webAffairService.recordArticlePublishingImageObservation(
              {
                ...scope,
                sideEffectKey,
                assetId,
                platformUrl: added[0].src,
              },
              isCurrent,
            )
            if (!recorded.success) throw new Error(recorded.error.message)
            return
          }
          await page.waitForTimeout(500)
        }
        throw new Error('该文件上传后没有唯一已加载的正文图片；只核验，不重复上传')
      },
    }
  }

  async preparePublicationSubmit(
    task: BrowserTaskRun,
    sideEffectKey: string,
    page: ReturnType<PlaywrightBridge['getPage']>,
    context?: ToolExecutionContext,
  ) {
    const scope = await this.resolveTaskScope(task, context)
    if (scope?.adapterId === 'toutiao' && page && scope.currentStepId === 'publish') {
      const attestation = this.attestations.get(this.attestationKey(context))
      const isCurrent = () =>
        !context?.abortSignal?.aborted &&
        Boolean(attestation && this.attestationRuntimeIsCurrent(attestation))
      if (
        !isCurrent() ||
        scope.publicationStatus !== 'not-started' ||
        !scope.localAssetsReady ||
        !(await this.verifyFrozenBody(scope, page, isCurrent))
      )
        throw new Error('头条冻结正文或原图对应未通过，禁止提交')
      const live = await readToutiaoPage(page)
      if (
        !isCurrent() ||
        !live.editorRecognized ||
        !live.hasPublishControl ||
        !live.saved ||
        live.uid !== scope.expectedPlatformAccountId ||
        !isSamePlatformDraft(scope.draftUrl ?? '', live.url, scope.expectedPlatformDraftId) ||
        normalizeText(live.title) !== normalizeText(scope.expectedTitle) ||
        !live.imageEnumerationComplete ||
        live.images.length !== scope.assets.length ||
        live.images.some(
          (image, i) => !image.loaded || image.src !== scope.assets[i].platformUrl,
        ) ||
        live.options.length !== 9 ||
        live.options.some((o) => o.checked === null) ||
        live.options.slice(0, 2).some((o) => o.checked !== false)
      )
        throw new Error('头条提交前账号、原稿、保存、逐图或首发/配乐设置未同时核验通过')
      const recorded = await this.webAffairService.recordArticlePublishingPlanResults(
        {
          ...scope,
          results: [
            {
              id: 'publish.preflight',
              status: 'completed',
              evidence: `同账号 ${live.uid}、原 draftId ${scope.expectedPlatformDraftId}、冻结全文、${live.images.length} 张对应图与平台保存一致；首发=false、配乐=false；尚未派发提交`,
            },
          ],
        },
        isCurrent,
      )
      if (!recorded.success || !isCurrent()) throw new Error('头条提交前证据已变化，禁止派发')
      const observer = observeToutiaoSubmission(page, {
        uid: live.uid!,
        title: scope.expectedTitle,
        images: scope.assets.map((a) => a.platformUrl ?? ''),
      })
      return {
        arm: observer.arm,
        dispose: observer.dispose,
        finish: async () => {
          const result = await observer.finish()
          const recorded = await this.webAffairService.recordArticlePublishingPlanResults(
            {
              ...scope,
              results: [
                {
                  id: 'publication.verify',
                  status: 'waiting',
                  evidence: `平台提交返回成功，同账号、标题和逐张原图的管理页状态：${result.status}`,
                  reason: '提交已接收；下一步只核验公开正文与配图，禁止再次提交',
                },
              ],
            },
            () =>
              !context?.abortSignal?.aborted &&
              this.browserTaskRuntime?.getTask(task.id)?.status === 'running',
          )
          if (!recorded.success) throw new Error(recorded.error.message)
        },
      }
    }
    if (scope?.adapterId === 'bilibili' && page && scope.currentStepId === 'publish') {
      const attestation = this.attestations.get(this.attestationKey(context))
      const isCurrent = () =>
        !context?.abortSignal?.aborted &&
        Boolean(attestation && this.attestationRuntimeIsCurrent(attestation))
      const live = await readBilibiliComposer(page, scope.assets)
      if (
        !isCurrent() ||
        !scope.allowPublish ||
        scope.publicationStatus !== 'not-started' ||
        !scope.localAssetsReady ||
        !live.recognized ||
        live.uid !== scope.expectedPlatformAccountId ||
        live.visibility !== 'public' ||
        !live.publishSelector ||
        normalizeText(live.title) !== normalizeText(scope.expectedTitle) ||
        !live.imageEnumerationComplete ||
        live.images.length !== scope.assets.length ||
        live.images.some(
          (image, i) => !image.loaded || image.src !== scope.assets[i].platformUrl,
        ) ||
        !(await this.verifyFrozenBody(scope, page, isCurrent))
      )
        throw new Error('B站提交前账号、冻结正文、独立标题、公开设置或逐图证据未同时通过')
      if (!isCurrent()) throw new Error('B站提交前页面已改代')
      const observer = observeBilibiliSubmission(page, {
        uid: live.uid!,
        text: live.text,
        images: scope.assets.map((a) => a.platformUrl ?? ''),
      })
      let finishing: Promise<void> | undefined
      return {
        arm: observer.arm,
        dispose: observer.dispose,
        finish: (allowConfirmation = true) =>
          (finishing ??= (async () => {
            const receipt = allowConfirmation
              ? await finishBilibiliSubmission(page, observer, {
                  isCurrent,
                  revalidate: async () => {
                    const current = await readBilibiliComposer(page, scope.assets)
                    if (
                      !isCurrent() ||
                      !current.recognized ||
                      current.uid !== live.uid ||
                      current.visibility !== 'public' ||
                      !current.publishSelector ||
                      normalizeText(current.title) !== normalizeText(scope.expectedTitle) ||
                      normalizeText(current.text) !== normalizeText(live.text) ||
                      !current.imageEnumerationComplete ||
                      current.images.length !== scope.assets.length ||
                      current.images.some(
                        (image, i) => !image.loaded || image.src !== scope.assets[i].platformUrl,
                      ) ||
                      !(await this.verifyFrozenBody(scope, page, isCurrent))
                    )
                      throw new Error('B站首次确认前账号、冻结正文、标题或逐图证据变化；停止发送')
                  },
                  record: async (result) => {
                    const recorded = await this.webAffairService.recordArticlePublishingPlanResults(
                      { ...scope, results: [result] },
                      isCurrent,
                    )
                    if (!recorded.success) throw new Error(recorded.error.message)
                  },
                })
              : await observer.finish()
            const saved = await this.webAffairService.recordBilibiliSubmissionReceipt(
              {
                affairId: scope.affairId,
                attemptId: scope.attemptId,
                executionGeneration: scope.executionGeneration,
                browserTaskRunId: task.id,
                sideEffectKey,
                uid: receipt.uid,
                postId: receipt.id,
              },
              scope.workspaceId,
            )
            if (!saved.success) throw new Error(saved.error.message)
          })()),
      }
    }
    if (scope?.adapterId === 'weibo' && page && scope.currentStepId === 'publish') {
      if (scope.allowPublish !== true) throw new Error('本次微博提交未授权或步骤不符')
      const runtime = this.runtimeSnapshot(scope, context)
      const documentGeneration = this.browserManager?.getViewRuntimeIdentity(
        task.tabId,
      )?.documentGeneration
      const editorDocumentGeneration = this.adapter.documentGeneration(page)
      const url = page.url()
      const isCurrent = () =>
        !context?.abortSignal?.aborted &&
        this.attestationRuntimeIsCurrent({
          scope,
          runtime,
          page,
          documentGeneration,
          editorDocumentGeneration,
          inspection: { url } as ArticlePublishingPageInspection,
        })
      const live = await readWeiboComposer(page)
      const imageIds = live.images.map((image) => weiboImageIdentity(image.src))
      if (
        !live.recognized ||
        live.uid !== scope.expectedPlatformAccountId ||
        !live.privacy ||
        !live.imageEnumerationComplete ||
        imageIds.some((id) => !id) ||
        live.images.length !== scope.assets.length ||
        live.images.some(
          (image, index) => !image.loaded || image.src !== scope.assets[index].platformUrl,
        ) ||
        !(await this.verifyFrozenBody(scope, page, isCurrent))
      )
        throw new Error('微博提交前账号、冻结正文、逐图或公开设置未同时核验通过')
      if (!isCurrent()) throw new Error('微博提交前页面已改代，禁止派发')
      const observer = observeWeiboSubmission(page, {
        uid: live.uid!,
        text: live.text,
        imageIds: imageIds as string[],
      })
      return {
        arm: observer.arm,
        dispose: observer.dispose,
        finish: async () => {
          const receipt = await observer.finish()
          const saved = await this.webAffairService.recordWeiboSubmissionReceipt(
            {
              affairId: scope.affairId,
              attemptId: scope.attemptId,
              executionGeneration: scope.executionGeneration,
              browserTaskRunId: task.id,
              sideEffectKey,
              uid: receipt.uid,
              postId: receipt.id,
            },
            scope.workspaceId,
          )
          if (!saved.success) throw new Error(saved.error.message)
        },
      }
    }
    if (!scope || !page || scope.adapterId !== 'xiaohongshu' || scope.currentStepId !== 'publish')
      return null
    const live = await readXiaohongshuEditor(page)
    if (
      live.uid !== scope.expectedPlatformAccountId ||
      live.draftId !== scope.expectedPlatformDraftId ||
      live.title !== scope.expectedTitle ||
      !live.renderedMatches ||
      live.privacy?.type !== 0 ||
      live.scheduled
    )
      throw new Error('小红书提交前原账号、原稿、正文或公开设置不一致')
    if (
      live.images.length !== scope.assets.length ||
      live.images.some(
        (i, index) =>
          !i.loaded ||
          scope.assets[index].platformUrl !== `https://sns-creator-preview.xhscdn.com/${i.fileId}`,
      )
    )
      throw new Error('小红书提交前逐图记录不一致')
    const observer = observeXiaohongshuSubmission(page, {
      title: live.title,
      description: live.description,
      fileIds: live.images.map((i) => i.fileId),
    })
    let recorded = false
    return {
      arm: observer.arm,
      dispose: observer.dispose,
      finish: async () => {
        if (recorded) return
        const noteId = await observer.finish()
        const result = await this.webAffairService.recordXiaohongshuSubmissionReceipt(
          {
            affairId: scope.affairId,
            attemptId: scope.attemptId,
            executionGeneration: scope.executionGeneration,
            browserTaskRunId: task.id,
            sideEffectKey,
            draftId: live.draftId!,
            uid: live.uid!,
            noteId,
          },
          scope.workspaceId,
        )
        if (!result.success) throw new Error(result.error.message)
        recorded = true
      },
    }
  }

  async prepareInitialDraftSave(
    task: BrowserTaskRun,
    sideEffectKey: string,
    page: ReturnType<PlaywrightBridge['getPage']>,
    context?: ToolExecutionContext,
  ) {
    const scope = await this.resolveTaskScope(task, context)
    if (!scope || !page) throw new Error('网页保存观察准备时执行或页面身份已失效，禁止派发')
    if (scope.currentStepId !== 'open-editor' || scope.draftUrl) return null
    const snapshot = this.webAffairService.getProjectSnapshot(scope.workspaceId)
    const effect = snapshot.success
      ? snapshot.data.affairs
          .find((a) => a.id === scope.affairId)
          ?.articlePublishing?.sideEffects.find((e) => e.key === sideEffectKey)
      : undefined
    if (effect?.targetId !== 'initial-draft:save') return null
    const inspection = this.attestations.get(this.attestationKey(context))?.inspection
    if (
      !inspection?.platformAccountId ||
      inspection.editor.initialDraftBodyText !== scope.expectedTitle.trim().slice(0, 10)
    ) {
      throw new Error('首次草稿保存前缺少账号与短占位正文证据')
    }
    // CSDN opens an AI drawer over Save. Hit-test before consuming/dispatching the capability;
    // an occluded button is not an unknown platform save. No forced clicks or hidden DOM calls.
    if (!inspection.selectors.save) throw new Error('首次草稿缺少唯一保存控件')
    await page.locator(inspection.selectors.save).click({ trial: true, timeout: 3_000 })
    const observer = observeCsdnInitialDraftSave(page, scope.expectedTitle)
    let recorded = false
    return {
      arm: observer.arm,
      dispose: observer.dispose,
      finish: async (continueAfterSave: boolean) => {
        const result = await observer.result
        if (!result.draftId) throw new Error(result.error ?? '首次草稿结果未知')
        if (!recorded) {
          const anchor = await this.webAffairService.recordArticlePublishingDraftAnchor(
            scope.affairId,
            scope.attemptId,
            scope.executionGeneration,
            scope.launchOperationId,
            `https://mp.csdn.net/mp_blog/creation/editor/${result.draftId}`,
            scope.workspaceId,
            task.id,
            {
              sideEffectKey,
              platformAccountId: inspection.platformAccountId!,
              normalizedTitle: normalizeText(scope.expectedTitle),
            },
          )
          if (!anchor.success) throw new Error(anchor.error.message)
          recorded = true
        }
        if (!continueAfterSave) return
        const assertActive = () => {
          context?.abortSignal?.throwIfAborted()
          const current = this.browserTaskRuntime?.getTask(task.id)
          if (
            current?.status !== 'running' ||
            current.tabId !== scope.tabId ||
            current.correlation?.agentRunId !== context?.agentRunId ||
            current.correlation?.affairExecutionGeneration !== scope.executionGeneration ||
            current.correlation?.affairLaunchOperationId !== scope.launchOperationId ||
            this.browserManager?.getViewProfileId(task.tabId) !== task.correlation?.profileId ||
            !this.browserManager?.isViewVisible(task.tabId)
          ) {
            throw new Error('首次草稿已记录，任务已停止，不再操作网页')
          }
        }
        await new CsdnDraftRecoveryCoordinator(this.adapter).recoverExactDraft({
          expectedDraftId: result.draftId,
          expectedPlatformAccountId: inspection.platformAccountId!,
          expectedTitle: scope.expectedTitle,
          assertActive,
          navigate: async (url) => {
            assertActive()
            if (!this.browserManager || !this.playwrightBridge)
              throw new Error('草稿核验 Runtime 不可用')
            await this.browserManager.navigate(task.tabId, url)
            assertActive()
            await this.browserManager.ensurePlaywrightPage(task.tabId)
            await this.awaitRuntimeConvergence?.(scope.attemptId)
            assertActive()
            const current = this.playwrightBridge.getPageById(task.tabId)
            if (!current || current.isClosed()) throw new Error('首次草稿核验页面不可用')
            return current
          },
        })
        assertActive()
        // No checkpoint completion here. Agent must inspect the final Page and report verifying
        // then completed through the existing WebAffair transitions.
      },
    }
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

  async assertSideEffectDispatchAllowed(
    task: BrowserTaskRun,
    sideEffectKey: string,
    context?: ToolExecutionContext,
    dispatchPage?: ReturnType<PlaywrightBridge['getPageById']>,
  ): Promise<() => void> {
    const currentTask = this.browserTaskRuntime?.getTask(task.id)
    if (!currentTask || currentTask.status !== 'running') {
      throw new Error('网页副作用派发前 BrowserTask 已终止')
    }
    const scope = await this.resolveTaskScope(currentTask, context)
    if (!scope || scope.currentOperation) {
      throw new Error('网页副作用派发前执行身份或当前 operation 已变化')
    }
    const snapshot = this.webAffairService.getProjectSnapshot(scope.workspaceId)
    const affair = snapshot.success
      ? snapshot.data.affairs.find((candidate) => candidate.id === scope.affairId)
      : undefined
    const effect = affair?.articlePublishing?.sideEffects.find(
      (candidate) => candidate.key === sideEffectKey,
    )
    if (
      affair?.articlePublishing?.execution.status !== 'running' ||
      effect?.status !== 'reserved' ||
      !effect.consumedAt ||
      effect.executionGeneration !== scope.executionGeneration ||
      effect.browserTaskRunId !== scope.browserTaskRunId
    ) {
      throw new Error('网页副作用派发前授权已被取消、接管或改代')
    }
    const attestation = this.attestations.get(this.attestationKey(context))
    if (!attestation || !this.attestationRuntimeIsCurrent(attestation)) {
      throw new Error('网页副作用派发前页面证明已经失效')
    }
    const dispatched = await this.webAffairService.dispatchArticlePublishingSideEffect(
      scope.affairId,
      scope.attemptId,
      scope.executionGeneration,
      sideEffectKey,
      scope.browserTaskRunId,
      scope.workspaceId,
    )
    if (!dispatched.success) throw new Error(dispatched.error.message)
    // 返回同步闸门。调用方必须在 await 返回后、真正调用页面动作的同一段同步代码中执行。
    return () => {
      context?.abortSignal?.throwIfAborted()
      const latest = this.webAffairService.getProjectSnapshot(scope.workspaceId)
      const publishing = latest.success
        ? latest.data.affairs.find((candidate) => candidate.id === scope.affairId)
            ?.articlePublishing
        : undefined
      const effect = publishing?.sideEffects.find((candidate) => candidate.key === sideEffectKey)
      if (
        publishing?.execution.status !== 'running' ||
        publishing.execution.currentGeneration !== scope.executionGeneration ||
        publishing.execution.currentLaunchOperationId !== scope.launchOperationId ||
        publishing.executionProtocol.current ||
        effect?.status !== 'dispatched' ||
        (dispatchPage !== undefined && dispatchPage !== attestation.page) ||
        !this.attestationRuntimeIsCurrent(attestation)
      )
        throw new Error('网页副作用授权落盘后执行或页面已变化；禁止派发')
    }
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
    logFailure = true,
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
    return this.resolveExecution(
      {
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
      },
      logFailure,
    )
  }

  private async runtimeResolutionFailure(
    task: BrowserTaskRun,
    context?: ToolExecutionContext,
  ): Promise<ArticlePublishingOperationFailure> {
    const correlation = task.correlation
    const policy = context?.articlePublishingPolicy
    const snapshot = policy ? this.webAffairService.getProjectSnapshot(policy.workspaceId) : null
    const affair =
      snapshot?.success && policy
        ? snapshot.data.affairs.find((candidate) => candidate.id === policy.affairId)
        : undefined
    const attempt = affair?.attempts.find((candidate) => candidate.id === policy?.attemptId)
    const binding = attempt?.runtimeBindings.find(
      (candidate) => candidate.kind === 'browser-task' && candidate.status === 'active',
    )
    const page = this.playwrightBridge?.getPageBindingIdentity(task.tabId)
    const mismatches: NonNullable<ArticlePublishingOperationFailure['mismatches']> = []
    const compare = (
      field: string,
      expected: string | number | null | undefined,
      actual: string | number | null | undefined,
    ) => {
      if (expected === actual) return
      mismatches.push({ field, expected: expected ?? null, actual: actual ?? null })
    }
    compare('attemptId', policy?.attemptId, correlation?.affairAttemptId)
    compare('affair.kind', 'article-publishing', affair?.kind)
    compare(
      'adapter',
      affair?.articlePublishing &&
        ['csdn', 'zhihu', 'juejin', 'xiaohongshu', 'weibo', 'toutiao', 'bilibili'].includes(
          affair.articlePublishing.adapterId,
        )
        ? `${affair.articlePublishing.adapterId}@1`
        : 'supported-platform@1',
      affair?.articlePublishing
        ? `${affair.articlePublishing.adapterId}@${affair.articlePublishing.adapterVersion}`
        : undefined,
    )
    compare(
      'execution.currentAttemptId',
      policy?.attemptId,
      affair?.articlePublishing?.execution.currentAttemptId,
    )
    compare('execution.status', 'running', affair?.articlePublishing?.execution.status)
    compare('attempt.status', 'running-ai', attempt?.status)
    compare('accountId.publishing', correlation?.accountId, affair?.articlePublishing?.accountId)
    compare('accountId.attempt', correlation?.accountId, attempt?.accountId)
    compare(
      'executionGeneration',
      attempt?.executionGeneration ?? policy?.executionGeneration,
      correlation?.affairExecutionGeneration,
    )
    compare(
      'launchOperationId',
      attempt?.launchOperationId ?? policy?.launchOperationId,
      correlation?.affairLaunchOperationId,
    )
    compare('agentRunId', context?.agentRunId, correlation?.agentRunId)
    compare('browserTaskRunId', attempt?.browserTaskRunId, task.id)
    compare('tabId', binding?.kind === 'browser-task' ? binding.tabId : undefined, task.tabId)
    compare(
      'browserViewRuntimeGeneration',
      binding?.kind === 'browser-task' ? binding.browserViewRuntimeGeneration : undefined,
      correlation?.browserViewRuntimeGeneration,
    )
    compare(
      'webContentsId.browserTask',
      binding?.kind === 'browser-task' ? binding.webContentsId : undefined,
      correlation?.webContentsId,
    )
    compare(
      'playwrightConnectionGeneration.browserTask',
      binding?.kind === 'browser-task' ? binding.playwrightConnectionGeneration : undefined,
      correlation?.playwrightConnectionGeneration,
    )
    compare(
      'playwrightPageBindingGeneration.browserTask',
      binding?.kind === 'browser-task' ? binding.playwrightPageBindingGeneration : undefined,
      correlation?.playwrightPageBindingGeneration,
    )
    compare('webContentsId.currentPage', correlation?.webContentsId, page?.webContentsId)
    compare(
      'playwrightConnectionGeneration.currentPage',
      correlation?.playwrightConnectionGeneration,
      page?.connectionGeneration,
    )
    compare(
      'playwrightPageBindingGeneration.currentPage',
      correlation?.playwrightPageBindingGeneration,
      page?.generation,
    )
    const detail = mismatches.length
      ? mismatches
          .map(
            (mismatch) =>
              `${mismatch.field}：期望 ${String(mismatch.expected)}，实际 ${String(mismatch.actual)}`,
          )
          .join('；')
      : '事务、BrowserTask 或 Agent 外层身份不再属于当前执行代次'
    return {
      category: 'studio-runtime',
      code: 'studio_runtime.identity_mismatch',
      message: `文章发布 Page Runtime 尚未收敛：${detail}`,
      ...(mismatches.length ? { mismatches } : {}),
    }
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
      adapter: `${scope?.adapterId ?? 'unknown'}@1`,
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
      adapter: `${scope?.adapterId ?? 'unknown'}@1`,
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
    logFailure = true,
  ): Promise<ArticlePublishingExecutionScope | null> {
    const workspaceId = await this.resolveWorkspaceId(input.workspacePath)
    if (!workspaceId) {
      if (logFailure) this.logRuntimeResolutionFailure(input, ['workspace-not-resolved'])
      return null
    }
    const snapshot = this.webAffairService.getProjectSnapshot(workspaceId)
    if (!snapshot.success) {
      if (logFailure) this.logRuntimeResolutionFailure(input, ['workspace-snapshot-unavailable'])
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
    if (
      !publishing ||
      !['csdn', 'zhihu', 'juejin', 'xiaohongshu', 'weibo', 'toutiao', 'bilibili'].includes(
        publishing.adapterId,
      ) ||
      publishing?.adapterVersion !== 1
    ) {
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
      if (logFailure)
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
      adapterId: publishing.adapterId,
      workspaceId,
      workspacePath: input.workspacePath,
      affairId: affair.id,
      attemptId: attempt.id,
      accountId: input.accountId,
      currentStepId: publishing.execution.currentStepId,
      ...(publishing.executionProtocol?.current
        ? {
            currentOperation: {
              operationRunId: publishing.executionProtocol.current.operationRunId,
              revision: publishing.executionProtocol.current.revision,
              definitionId: publishing.executionProtocol.current.definitionId,
              status: publishing.executionProtocol.current.status,
            },
          }
        : {}),
      allowPublish: publishing.composer?.allowPublish,
      publicationStatus: publishing.publication.status,
      publicationUrl: publishing.publication.url,
      localAssetsReady: publishing.assets.every(
        (asset) => asset.kind !== 'local' || asset.status === 'uploaded',
      ),
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      browserTaskRunId: input.browserTaskRunId ?? attempt.browserTaskRunId ?? '',
      tabId: input.tabId ?? '',
      browserViewRuntimeGeneration: input.browserViewRuntimeGeneration ?? 0,
      webContentsId: input.webContentsId ?? 0,
      playwrightConnectionGeneration: input.playwrightConnectionGeneration ?? 0,
      playwrightPageBindingGeneration: input.playwrightPageBindingGeneration ?? 0,
      writePermitted,
      ...(permit?.id ? { writePermitId: permit.id } : {}),
      draftUrl: publishing.draft?.url,
      expectedPlatformAccountId:
        publishing.composer?.platformAccountId ?? publishing.draft?.platformAccountId,
      expectedPlatformDraftId: publishing.draft?.platformDraftId,
      expectedTitle: publishing.fields.title,
      expectedFields: publishing.fields,
      assets: publishing.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        sourcePath: asset.sourcePath,
        displayPath: asset.displayPath,
        platformUrl: asset.platformUrl,
        manualResolution: asset.manualResolution,
        status: asset.status,
        uploadAttemptCount: asset.uploadAttempts.length,
        uploadNeverDispatched:
          ['weibo', 'bilibili'].includes(publishing.adapterId) &&
          !publishing.sideEffects.some(
            (effect) =>
              effect.kind === 'upload-asset' &&
              effect.targetId.replace(/:attempt-\d+$/u, '') === asset.id &&
              Boolean(effect.dispatchedAt),
          ),
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
      !sameRuntimeSnapshot(attestation.runtime, this.runtimeSnapshot(scope, context)) ||
      !this.attestationRuntimeIsCurrent(attestation) ||
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
    const dismissAssistant =
      actionType === 'click' &&
      [selectors.dismissAssistant, selectors.dismissTagEditor].some(
        (s) => Boolean(s) && selector === s,
      )
    if (
      !dismissAssistant &&
      (actionType === 'frameExecute'
        ? (stepId !== 'fill-body' && !(stepId === 'open-editor' && !scope.draftUrl)) ||
          params.frameAction !== 'fill' ||
          !inspection.editor.bodyFrameSelector ||
          params.frameSelector !== inspection.editor.bodyFrameSelector ||
          selector !== selectors.body
        : stepId === 'fill-body' && Boolean(inspection.editor.bodyFrameSelector))
    ) {
      return {
        kind: 'runtime-error',
        reason:
          '正文 iframe 写入必须使用本次检查签发的 frameSelector 和正文 selector，且只允许 fill',
      }
    }
    const allowed =
      stepId === 'open-editor'
        ? scope.draftUrl
          ? [selectors.openEditor]
          : [selectors.openEditor, selectors.title, selectors.body, selectors.save]
        : stepId === 'upload-assets'
          ? [selectors.imageOpen, selectors.fileInput, selectors.uploadConfirm]
          : stepId === 'fill-body'
            ? [selectors.body]
            : stepId === 'fill-fields'
              ? [
                  selectors.openPublishSettings,
                  inspection.tagEditor?.inputSelector,
                  selectors.title,
                  selectors.summary,
                  selectors.tags,
                  inspection.tagEditor?.openSelector,
                  selectors.category,
                  selectors.cover,
                ]
              : stepId === 'save-draft'
                ? [selectors.save]
                : stepId === 'publish'
                  ? [selectors.openPublishSettings, selectors.disableMusic, selectors.publish]
                  : []
    const allowedSelectors = new Set(
      [...allowed, selectors.dismissAssistant, selectors.dismissTagEditor].filter(
        (value): value is string => Boolean(value),
      ),
    )
    if (!selector || !allowedSelectors.has(selector)) {
      return this.stopDecision(
        scope,
        actionType,
        'unknown',
        allowedSelectors.size === 0
          ? '平台适配器未识别当前步骤的唯一控件，已停止并等待人工处理'
          : '写入目标不是平台适配器本次读回签发的唯一 selector，已拒绝执行',
        pageUrl,
      )
    }
    return null
  }

  private attestedSemanticControl(
    context: ToolExecutionContext | undefined,
    selector: string,
  ): 'save-draft' | 'publish' | null {
    const selectors = this.attestations.get(this.attestationKey(context))?.inspection.selectors
    if (!selectors || !selector) return null
    if (selectors.save === selector) return 'save-draft'
    if (selectors.publish === selector) return 'publish'
    return null
  }

  private runtimeSnapshot(
    scope: ArticlePublishingExecutionScope,
    context?: ToolExecutionContext,
  ): ArticlePublishingRuntimeSnapshot {
    return {
      tabId: scope.tabId,
      browserViewRuntimeGeneration: scope.browserViewRuntimeGeneration,
      webContentsId: scope.webContentsId,
      playwrightConnectionGeneration: scope.playwrightConnectionGeneration,
      playwrightPageBindingGeneration: scope.playwrightPageBindingGeneration,
      ...(context?.agentRunId ? { agentRunId: context.agentRunId } : {}),
      ...(scope.browserTaskRunId ? { browserTaskRunId: scope.browserTaskRunId } : {}),
    }
  }

  private attestationRuntimeIsCurrent(attestation: TrustedPageAttestation): boolean {
    const task = attestation.runtime.browserTaskRunId
      ? this.browserTaskRuntime?.getTask(attestation.runtime.browserTaskRunId)
      : null
    const page = this.playwrightBridge?.getPageBindingIdentity(attestation.runtime.tabId)
    const visible = this.browserManager?.getViewRuntimeIdentity(attestation.runtime.tabId)
    return Boolean(
      task?.status === 'running' &&
      task.correlation?.agentRunId === attestation.runtime.agentRunId &&
      task.correlation?.affairExecutionGeneration === attestation.scope.executionGeneration &&
      task.correlation?.affairLaunchOperationId === attestation.scope.launchOperationId &&
      this.playwrightBridge?.getPageById(attestation.runtime.tabId) === attestation.page &&
      !attestation.page?.isClosed() &&
      (attestation.editorDocumentGeneration === undefined ||
        this.adapter.documentGeneration(attestation.page!) ===
          attestation.editorDocumentGeneration) &&
      attestation.page?.url() === attestation.inspection.url &&
      task.tabId === attestation.runtime.tabId &&
      task.correlation?.browserViewRuntimeGeneration ===
        attestation.runtime.browserViewRuntimeGeneration &&
      task.correlation?.webContentsId === attestation.runtime.webContentsId &&
      task.correlation?.playwrightConnectionGeneration ===
        attestation.runtime.playwrightConnectionGeneration &&
      task.correlation?.playwrightPageBindingGeneration ===
        attestation.runtime.playwrightPageBindingGeneration &&
      page?.webContentsId === attestation.runtime.webContentsId &&
      page.connectionGeneration === attestation.runtime.playwrightConnectionGeneration &&
      page.generation === attestation.runtime.playwrightPageBindingGeneration &&
      (visible === undefined ||
        (visible?.browserViewRuntimeGeneration ===
          attestation.runtime.browserViewRuntimeGeneration &&
          visible.webContentsId === attestation.runtime.webContentsId &&
          visible.documentGeneration === attestation.documentGeneration)) &&
      (!this.browserManager?.isViewVisible ||
        this.browserManager.isViewVisible(attestation.runtime.tabId)),
    )
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
        inspection.matchedAssets[assetId] === platformUrl,
      )
    }
    if (kind === 'asset-absent') {
      const assetId = String(params['assetId'] ?? '')
      const asset = scope.assets.find((candidate) => candidate.id === assetId)
      const absenceCanAuthorizeFirstUpload = Boolean(
        asset &&
        ((asset.status !== 'reconciling' && asset.uploadAttemptCount === 0) ||
          asset.manualResolution?.status === 'missing' ||
          (['weibo', 'bilibili'].includes(scope.adapterId) &&
            asset.uploadNeverDispatched === true)),
      )
      return Boolean(
        inspection.editor.recognized &&
        inspection.editor.imageEnumerationComplete &&
        asset &&
        absenceCanAuthorizeFirstUpload &&
        (!['xiaohongshu', 'weibo', 'toutiao', 'bilibili'].includes(scope.adapterId) ||
          inspection.editor.images.every((image) =>
            scope.assets.some((known) => known.platformUrl === image.src),
          )) &&
        !inspection.matchedAssets[assetId],
      )
    }
    if (kind === 'published') {
      return Boolean(
        this.resolvePublishedUrl(params, attestation) &&
        (!scope.assets.length || inspection.bodyMatchesFrozen === true),
      )
    }
    const stepId = String(params['stepId'] ?? '')
    if (['weibo', 'bilibili'].includes(scope.adapterId)) {
      if (['publish', 'verify-publication'].includes(stepId))
        return Boolean(
          scope.allowPublish &&
          scope.publicationUrl &&
          (scope.adapterId === 'bilibili'
            ? parseBilibiliPublicationUrl(inspection.url)?.url
            : parseWeiboPublicationUrl(inspection.url)?.url) === scope.publicationUrl &&
          inspection.pageKind === 'published-article' &&
          !inspection.publicationBlocker &&
          inspection.platformAccountId === scope.expectedPlatformAccountId &&
          inspection.bodyMatchesFrozen === true,
        )
      if (
        !inspection.editor.recognized ||
        inspection.platformAccountId !== scope.expectedPlatformAccountId
      )
        return false
      if (stepId === 'open-editor')
        return inspection.editor.bodyTextLength === 0 && inspection.editor.images.length === 0
      if (stepId === 'verify-account') return true
      if (stepId === 'upload-assets')
        return (
          scope.localAssetsReady &&
          inspection.editor.imageEnumerationComplete &&
          Object.keys(inspection.matchedAssets).length === scope.assets.length
        )
      if (['fill-body', 'fill-fields', 'save-draft'].includes(stepId))
        return (
          inspection.bodyMatchesFrozen === true &&
          (scope.adapterId !== 'bilibili' ||
            stepId === 'fill-body' ||
            inspection.bilibiliVisibility === 'public') &&
          ((scope.adapterId === 'bilibili' && stepId === 'fill-body') ||
            normalizeText(inspection.title.value) === normalizeText(scope.expectedTitle))
        )
      return false
    }
    if (stepId === 'open-editor') {
      return Boolean(
        inspection.editor.recognized &&
        scope.draftUrl &&
        isSamePlatformDraft(scope.draftUrl, inspection.url, scope.expectedPlatformDraftId) &&
        inspection.draftId &&
        inspection.platformAccountId &&
        inspection.saveState === 'saved' &&
        normalizeText(inspection.title.value) === normalizeText(scope.expectedTitle),
      )
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
      return Boolean(
        inspection.editor.recognized &&
        inspection.editor.bodyTextLength > 0 &&
        (!scope.assets.length || inspection.bodyMatchesFrozen === true),
      )
    }
    if (stepId === 'fill-fields') {
      return Boolean(
        inspection.editor.recognized &&
        normalizeText(inspection.title.value) === normalizeText(scope.expectedTitle) &&
        (['summary', 'tags', 'category', 'cover'] as const).every((field) => {
          const expected =
            field === 'cover'
              ? (scope.assets.find((a) => a.id === scope.expectedFields.coverAssetId)
                  ?.platformUrl ?? scope.expectedFields.coverAssetId)
              : scope.expectedFields[field]
          if (!expected || (Array.isArray(expected) && expected.length === 0)) return true
          const actual = inspection.fieldValues?.[field]
          return (
            actual !== undefined &&
            normalizeText(actual) ===
              normalizeText(Array.isArray(expected) ? expected.join(',') : expected)
          )
        }),
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
        !inspection.publicationBlocker &&
        (!scope.assets.length || inspection.bodyMatchesFrozen === true) &&
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
      scope.adapterId === 'toutiao' &&
      (!scope.publicationUrl ||
        scope.publicationUrl !== inspection.url ||
        requestedUrl !== scope.publicationUrl ||
        parseToutiaoPublicationUrl(inspection.url)?.id !== scope.expectedPlatformDraftId ||
        inspection.platformAccountId !== scope.expectedPlatformAccountId ||
        inspection.bodyMatchesFrozen !== true)
    )
      return null
    if (scope.adapterId === 'bilibili') {
      const receipt = parseBilibiliPublicationUrl(scope.publicationUrl ?? '')
      if (
        !scope.allowPublish ||
        !receipt ||
        receipt.url !== parseBilibiliPublicationUrl(inspection.url)?.url ||
        receipt.url !== parseBilibiliPublicationUrl(requestedUrl)?.url ||
        inspection.publishedArticleId !== receipt.id ||
        inspection.platformAccountId !== scope.expectedPlatformAccountId ||
        inspection.bodyMatchesFrozen !== true
      )
        return null
    }
    if (scope.adapterId === 'weibo') {
      const receipt = parseWeiboPublicationUrl(scope.publicationUrl ?? '')
      if (
        !scope.allowPublish ||
        !receipt ||
        receipt.url !== parseWeiboPublicationUrl(inspection.url)?.url ||
        receipt.url !== parseWeiboPublicationUrl(requestedUrl)?.url ||
        receipt.uid !== scope.expectedPlatformAccountId ||
        inspection.platformAccountId !== receipt.uid ||
        inspection.publishedArticleId !== receipt.id ||
        inspection.bodyMatchesFrozen !== true
      )
        return null
    }
    if (
      scope.adapterId === 'xiaohongshu' &&
      (!scope.publicationUrl ||
        new URL(scope.publicationUrl).pathname !== new URL(inspection.url).pathname ||
        new URL(inspection.url).origin !== 'https://www.xiaohongshu.com' ||
        inspection.platformAccountId !== scope.expectedPlatformAccountId ||
        inspection.publishedArticleId !== new URL(scope.publicationUrl).pathname.split('/').at(-1))
    )
      return null
    if (
      scope.adapterId === 'juejin' &&
      (!scope.expectedPlatformDraftId ||
        inspection.draftId !== scope.expectedPlatformDraftId ||
        inspection.platformAccountId !== scope.expectedPlatformAccountId)
    )
      return null
    if (
      scope.adapterId === 'zhihu' &&
      (!scope.expectedPlatformAccountId ||
        inspection.platformAccountId !== scope.expectedPlatformAccountId ||
        !scope.expectedPlatformDraftId ||
        inspection.publishedArticleId !== scope.expectedPlatformDraftId)
    )
      return null
    if (
      inspection.pageKind === 'published-article' &&
      !inspection.publicationBlocker &&
      (!scope.assets.length || inspection.bodyMatchesFrozen === true) &&
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
      publishing &&
      ['csdn', 'zhihu', 'juejin', 'xiaohongshu', 'weibo', 'toutiao', 'bilibili'].includes(
        publishing.adapterId,
      ) &&
      publishing.adapterVersion === 1 &&
      publishing.accountId === input.accountId &&
      attempt?.accountId === input.accountId,
    )
  }

  private isRecognizedPageForStep(rawUrl: string, stepId?: string): boolean {
    try {
      const u = new URL(rawUrl)
      if (rawUrl === 'https://t.bilibili.com/') return true
      if (
        ['publish', 'verify-publication'].includes(stepId ?? '') &&
        parseBilibiliPublicationUrl(rawUrl)
      )
        return true
      if (
        u.origin === 'https://mp.toutiao.com' &&
        parsePlatformDraftAnchor(rawUrl)?.adapterId === 'toutiao'
      )
        return true
      if (u.origin === 'https://weibo.com' && u.pathname === '/') return true
      if (
        ['publish', 'verify-publication'].includes(stepId ?? '') &&
        parseWeiboPublicationUrl(rawUrl)
      )
        return true
      if (u.origin === 'https://creator.xiaohongshu.com' && u.pathname === '/publish/publish')
        return true
      if (
        ['publish', 'verify-publication'].includes(stepId ?? '') &&
        ((u.origin === 'https://www.xiaohongshu.com' &&
          /^\/explore\/[a-f\d]{24}\/?$/iu.test(u.pathname)) ||
          (u.origin === 'https://creator.xiaohongshu.com' &&
            ['/publish/success', '/new/note-manager'].includes(u.pathname)))
      )
        return true
    } catch {
      return false
    }

    try {
      const url = new URL(rawUrl)
      if (
        !CSDN_ARTICLE_SUPPORTED_ORIGIN_SET.has(url.origin) &&
        !['https://www.zhihu.com', 'https://zhuanlan.zhihu.com', 'https://juejin.cn'].includes(
          url.origin,
        )
      )
        return false
      if (url.origin === 'https://juejin.cn')
        return stepId === 'verify-publication'
          ? /^\/post\/\d+\/?$/u.test(url.pathname)
          : /^\/editor\/drafts\/\d+\/?$/u.test(url.pathname)
      if (url.hostname.endsWith('.zhihu.com')) {
        if (stepId === 'verify-account' || stepId === 'verify-publication') return true
        return (
          url.hostname === 'zhuanlan.zhihu.com' &&
          (url.pathname === '/write' || /^\/p\/\d+\/edit$/u.test(url.pathname))
        )
      }
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

function sameRuntimeSnapshot(
  left: ArticlePublishingRuntimeSnapshot,
  right: ArticlePublishingRuntimeSnapshot,
): boolean {
  return (
    left.tabId === right.tabId &&
    left.browserViewRuntimeGeneration === right.browserViewRuntimeGeneration &&
    left.webContentsId === right.webContentsId &&
    left.playwrightConnectionGeneration === right.playwrightConnectionGeneration &&
    left.playwrightPageBindingGeneration === right.playwrightPageBindingGeneration &&
    left.agentRunId === right.agentRunId &&
    left.browserTaskRunId === right.browserTaskRunId
  )
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
