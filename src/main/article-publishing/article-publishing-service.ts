import { BILIBILI_BODY } from './bilibili-publishing-adapter'
import { hasBilibiliRetryAuthorization } from '../../shared/article-publishing/bilibili-retry'
import { parseBilibiliPublicationUrl } from './bilibili-publication'
import {
  canRetryEmptyBilibiliComposer,
  isEmptyBilibiliComposer,
} from './bilibili-composer-recovery'
import { prepareArticleBody } from './article-body'
import { parseWeiboPublicationUrl } from './weibo-publication'
import {
  readToutiaoPublicationReview,
  openToutiaoPublicationResult,
  TOUTIAO_PUBLICATION_MANAGEMENT_URL,
} from './toutiao-publication-review'
import { readXiaohongshuEditor } from './xiaohongshu-publishing-adapter'
import { PublishingAdapter, publishingPlatform } from './publishing-adapter'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  collectMarkdownDestinations,
  decodeMarkdownPath,
  isExternalMarkdownDestination,
  splitMarkdownDestinationSuffix,
} from '../../shared/markdown-document'
import type { FileService } from '../fs/file-service'
import type { WebAffairService } from '../web-affairs/web-affair-service'
import type { AgentBridge } from '../agent/agent-bridge'
import type { BrowserManager, BrowserPageRuntimeBindingIdentity } from '../browser/browser-manager'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { BrowserActionLog, BrowserTaskRun } from '../browser/browser-task-types'
import {
  isSamePlatformDraft,
  parsePlatformDraftAnchor,
} from '../../shared/article-publishing/platform-draft-anchor'
import type {
  ArticlePublishingAsset,
  ArticlePublishingState,
  ArticlePublishingSourcePreview,
  CreateArticlePublishingTaskInput,
  InspectArticlePublishingSourceInput,
  ManageArticlePublishingRuntimeInput,
  ResolveArticlePublishingAssetInput,
  StartArticlePublishingTaskInput,
  StartArticlePublishingTaskResult,
} from '../../shared/article-publishing/article-publishing-types'
import {
  createArticlePublishingTaskInputSchema,
  inspectArticlePublishingSourceInputSchema,
  manageArticlePublishingRuntimeInputSchema,
  resolveArticlePublishingAssetInputSchema,
  startArticlePublishingTaskInputSchema,
} from '../../shared/article-publishing/article-publishing-schema'
import type {
  WebAffair,
  WebAffairOperationResult,
  WebAffairProjectSnapshot,
  WebAffairRuntimeBinding,
} from '../../shared/web-affairs/web-affair-types'
import {
  CsdnDraftRecoveryCoordinator,
  type CsdnDraftRecoveryResult,
} from './csdn-draft-recovery-coordinator'

const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const RUNTIME_BIND_TIMEOUT_MS = 15_000
const OWNER_LEASE_MS = 60_000
const PROGRESS_LEASE_MS = 10 * 60_000
const RUNTIME_PROBE_MS = 60_000
const WATCHDOG_INTERVAL_MS = 10_000
const SUPPORTED_IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

interface ImageReference {
  destination: string
  start: number
  end: number
  alt: string
}

interface ArticlePublishingRuntimeDependencies {
  getAgentBridge: () => AgentBridge | null
  getBrowserManager: () => BrowserManager | null
  getBrowserTaskRuntime: () => BrowserTaskRuntime | null
  getPlaywrightBridge: () => PlaywrightBridge | null
}

interface ActivePublishingRuntime {
  workspaceId: string
  affairId: string
  attemptId: string
  executionGeneration: number
  launchOperationId: string
  conversationId: string
  agentRunId: string
  agentRuntimeBindingKey: string
  agentRuntimeEpoch: number
  browserTaskRunId: string
  tabId: string
  browserViewRuntimeGeneration: number
  webContentsId: number
  playwrightConnectionGeneration: number
  playwrightPageBindingGeneration: number
  lastOwnerAt: number
  lastProgressAt: number
  continuationUsed: boolean
}

export class ArticlePublishingService {
  private readonly activeRuntimes = new Map<string, ActivePublishingRuntime>()
  private readonly latestPageRuntimeIdentities = new Map<
    string,
    BrowserPageRuntimeBindingIdentity
  >()
  private runtimeObserversInstalled = false
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private runtimeDisposers: Array<() => void> = []
  private readonly runtimeRebindQueues = new Map<string, Promise<void>>()

  constructor(
    private readonly fileService: FileService,
    private readonly webAffairService: WebAffairService,
    private readonly resolveRealPath: (path: string) => Promise<string> = realpath,
    private readonly runtimeDependencies?: ArticlePublishingRuntimeDependencies,
    private readonly draftRecoveryCoordinator = new CsdnDraftRecoveryCoordinator(),
  ) {}

  dispose(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
    for (const dispose of this.runtimeDisposers.splice(0)) dispose()
    this.runtimeObserversInstalled = false
    this.activeRuntimes.clear()
    this.latestPageRuntimeIdentities.clear()
    this.runtimeRebindQueues.clear()
  }

  async awaitBrowserRuntimeConvergence(attemptId: string): Promise<void> {
    const runtime = this.activeRuntimes.get(attemptId)
    const latestIdentity = runtime ? this.latestPageRuntimeIdentities.get(runtime.tabId) : undefined
    if (latestIdentity) await this.scheduleBrowserRuntimeRebind(latestIdentity)
    const pending = this.runtimeRebindQueues.get(attemptId)
    if (pending) await pending
  }

  async inspectSource(
    rawInput: InspectArticlePublishingSourceInput,
  ): Promise<WebAffairOperationResult<ArticlePublishingSourcePreview>> {
    const parsed = inspectArticlePublishingSourceInputSchema.safeParse(rawInput)
    if (!parsed.success || parsed.data.workspaceRef.kind !== 'local') {
      return invalid('请先在本地工作空间选择 Markdown')
    }
    try {
      return {
        success: true,
        data: await this.buildPreview(parsed.data.markdownPath, parsed.data.workspaceRef.path),
      }
    } catch (error) {
      return invalid(error instanceof Error ? error.message : String(error))
    }
  }

  private async launchRuntime(input: {
    affair: WebAffair
    attemptId: string
    resumed: boolean
    preferredBrowserTabId?: string
    prompt: string
    workspaceId: string
    workspacePath: string
  }): Promise<WebAffairOperationResult<StartArticlePublishingTaskResult>> {
    const dependencies = this.runtimeDependencies
    const agentBridge = dependencies?.getAgentBridge()
    const browserManager = dependencies?.getBrowserManager()
    const browserTaskRuntime = dependencies?.getBrowserTaskRuntime()
    const playwrightBridge = dependencies?.getPlaywrightBridge()
    if (!agentBridge || !browserManager || !browserTaskRuntime || !playwrightBridge) {
      throw new Error('Agent、BrowserTask 或 Playwright 主进程 Runtime 尚未就绪')
    }
    this.ensureRuntimeObservers(agentBridge, browserManager, browserTaskRuntime)
    const publishing = input.affair.articlePublishing
    const attempt = input.affair.attempts.find((candidate) => candidate.id === input.attemptId)
    if (!publishing || !attempt) throw new Error('文章发布运行状态不存在')

    const recordPlan = async (
      result: Pick<
        import('../../shared/article-publishing/article-publishing-types').ArticlePublishingDetailResult,
        'id' | 'status' | 'evidence' | 'reason'
      >,
    ) => {
      const recorded = await this.webAffairService.recordArticlePublishingPlanResults(
        {
          workspaceId: input.workspaceId,
          affairId: input.affair.id,
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
          results: [result],
        },
        () => true,
      )
      if (!recorded.success) throw new Error(recorded.error.message)
    }
    await recordPlan({
      id: 'account.resolve',
      status: 'completed',
      evidence: `账号 ${attempt.accountId} · Profile ${attempt.profileId}`,
    })
    await recordPlan({
      id: 'tab.acquire',
      status: 'running',
      evidence: '等待当前工作空间账号的可见 Tab',
    })
    const recoveryLease = input.resumed
      ? browserTaskRuntime.acquireAccountRecoveryLease({
          accountId: attempt.accountId,
          profileId: attempt.profileId,
          affairId: input.affair.id,
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
        })
      : null

    try {
      const persistedDraftAnchor = publishing.draft?.url
        ? parsePlatformDraftAnchor(publishing.draft.url, publishing.draft.platformDraftId)
        : null
      const recovery = publishing.draft?.recovery
      const recoveryRequired = Boolean(
        input.resumed &&
        recovery &&
        recovery.executionGeneration === attempt.executionGeneration &&
        recovery.status === 'locating',
      )
      const publicationRecoveryRequired = Boolean(
        input.resumed &&
        !hasBilibiliRetryAuthorization(publishing) &&
        (publishing.publication.status === 'result-unknown' ||
          (publishing.adapterId === 'toutiao' &&
            ['dispatched', 'verifying'].includes(publishing.publication.status))) &&
        (publishing.draft?.platformDraftId || ['weibo', 'bilibili'].includes(publishing.adapterId)),
      )
      const tabId = await browserManager.waitForAccountView(
        input.workspacePath,
        attempt.profileId,
        attempt.accountId,
        recoveryRequired || publicationRecoveryRequired
          ? publishingPlatform(publishing.adapterId).managementUrl
          : (persistedDraftAnchor?.url ?? attempt.entryUrl),
        8_000,
        input.preferredBrowserTabId,
      )
      if (!tabId) throw new Error('账号浏览器 Tab 创建超时')
      await recordPlan({
        id: 'tab.acquire',
        status: 'completed',
        evidence: `Tab ${tabId} · 账号 ${attempt.accountId} · Profile ${attempt.profileId}`,
      })
      let draftAnchor = persistedDraftAnchor
      const visibleUrl = browserManager.getCurrentURL(tabId)
      let recoveredDraft: CsdnDraftRecoveryResult | null = null
      let recoveredPublicationUrl: string | null = null
      const assertToutiaoRecoveryActive = () => {
        if (publishing.adapterId !== 'toutiao') return
        const snapshot = this.webAffairService.getProjectSnapshot(input.workspaceId)
        const current = snapshot.success
          ? snapshot.data.affairs.find((a) => a.id === input.affair.id)?.articlePublishing
          : undefined
        if (
          !current ||
          current.execution.currentAttemptId !== attempt.id ||
          current.execution.currentGeneration !== attempt.executionGeneration ||
          current.execution.currentLaunchOperationId !== attempt.launchOperationId ||
          ['cancelled', 'failed', 'interrupted', 'waiting-human', 'published'].includes(
            current.execution.status,
          )
        )
          throw new Error('头条原稿恢复已取消或执行代次变化，停止继续打开页面')
      }
      const navigateForRecovery = async (url: string) => {
        assertToutiaoRecoveryActive()
        await browserManager.navigate(tabId, url)
        await playwrightBridge.ensureConnected('article_publishing_draft_recovery')
        await browserManager.ensurePlaywrightPage(tabId)
        await playwrightBridge.switchToPage(tabId)
        const page = playwrightBridge.getPageById(tabId)
        if (!page || page.isClosed()) throw new Error('CSDN 恢复核验页面不可用')
        return page
      }
      if (hasBilibiliRetryAuthorization(publishing)) {
        // A restart loses the native temporary composer. This explicit retry may
        // rebuild only an observed empty composer; never overwrite a surviving one.
        await playwrightBridge.ensureConnected('bilibili_authorized_retry')
        await browserManager.ensurePlaywrightPage(tabId)
        const page = playwrightBridge.getPageById(tabId)
        await page?.locator(BILIBILI_BODY).waitFor({ state: 'visible', timeout: 8000 })
        if (
          !page ||
          !isEmptyBilibiliComposer(
            await new PublishingAdapter().probe(page),
            publishing.composer?.platformAccountId,
          )
        )
          throw new Error(
            '授权重建仅适用于同账号空白发布器；当前仍有图文或账号未核验，保留现场并停止',
          )
        await recordPlan({
          id: 'editor.open',
          status: 'completed',
          evidence: '用户另行授权原稿重建；main读到同账号空白发布器，旧未知发送记录保留',
        })
      } else if (publicationRecoveryRequired && publishing.adapterId === 'toutiao') {
        const page = await navigateForRecovery(TOUTIAO_PUBLICATION_MANAGEMENT_URL)
        const review = await readToutiaoPublicationReview(page, {
          uid: publishing.draft?.platformAccountId ?? '',
          title: publishing.fields.title,
          images: publishing.assets.map((asset) => asset.platformUrl ?? ''),
        })
        assertToutiaoRecoveryActive()
        if (!review.current || review.candidates.length !== 1)
          throw new Error(
            `头条结果只读核验尚未唯一对应原账号、原标题和逐张图片；${review.diagnostics.join('；')}`,
          )
        const actual = review.candidates[0]
        if (actual.status === '已发布' && !actual.urls.length) {
          actual.urls = [
            await openToutiaoPublicationResult(
              page,
              {
                uid: publishing.draft?.platformAccountId ?? '',
                title: publishing.fields.title,
                images: publishing.assets.map((asset) => asset.platformUrl ?? ''),
              },
              () => {
                try {
                  assertToutiaoRecoveryActive()
                  return true
                } catch {
                  return false
                }
              },
            ),
          ]
        }
        await recordPlan({
          id: 'publish.dispatch',
          status: 'completed',
          evidence: `本 Attempt 已派发一次提交；平台管理页已出现原账号、原标题和 ${actual.images.length} 张原图完全对应的作品`,
        })
        await recordPlan({
          id: 'publication.verify',
          status: 'waiting',
          evidence: `账号 ${publishing.draft?.platformAccountId}；${publishing.fields.title}；逐图 ${actual.images.length}/${publishing.assets.length} 地址、顺序和加载一致；平台状态 ${actual.status}${actual.urls.length ? `；实际链接 ${actual.urls.join('、')}` : ''}`,
          reason: `头条平台当前${actual.status}；只检查结果，禁止重复发布`,
        })
        if (actual.status !== '已发布' || actual.urls.length !== 1)
          throw new Error(
            `头条已接收本篇图文，管理页显示${actual.status}；公开结果尚待核验，不会重复发布`,
          )
        const located = await this.webAffairService.recordToutiaoPublicationLocation(
          {
            workspaceId: input.workspaceId,
            affairId: input.affair.id,
            attemptId: attempt.id,
            executionGeneration: attempt.executionGeneration,
            launchOperationId: attempt.launchOperationId,
            uid: publishing.draft?.platformAccountId ?? '',
            url: actual.urls[0],
            imageUrls: actual.images.map((i) => i.src),
          },
          () => {
            try {
              assertToutiaoRecoveryActive()
              return true
            } catch {
              return false
            }
          },
        )
        if (!located.success) throw new Error(located.error.message)
        await navigateForRecovery(actual.urls[0])
        const visibleResultTab = await browserManager.waitForAccountView(
          input.workspacePath,
          attempt.profileId,
          attempt.accountId,
          actual.urls[0],
          8_000,
          tabId,
        )
        assertToutiaoRecoveryActive()
        if (visibleResultTab !== tabId || !browserManager.isViewVisible(tabId))
          throw new Error('头条公开结果已找到，但原任务 Tab 尚未可见；保留只读核验')
        recoveredPublicationUrl = actual.urls[0]
        draftAnchor = null
      } else if (
        publicationRecoveryRequired &&
        ['weibo', 'bilibili'].includes(publishing.adapterId)
      ) {
        const parsed =
          publishing.adapterId === 'bilibili'
            ? parseBilibiliPublicationUrl(publishing.publication.url ?? '')
            : parseWeiboPublicationUrl(publishing.publication.url ?? '')
        const receipt = parsed && {
          ...parsed,
          uid: 'uid' in parsed ? parsed.uid : publishing.composer?.platformAccountId,
        }
        if (!receipt || !receipt.uid || receipt.uid !== publishing.composer?.platformAccountId)
          throw new Error('动态提交结果未知且缺少本次回执地址，只允许核验，不会再次发送')
        const page = await navigateForRecovery(receipt.url)
        const observed = await new PublishingAdapter().probe(page)
        if (
          observed.pageKind !== 'published-article' ||
          (publishing.adapterId !== 'bilibili' && observed.platformAccountId !== receipt.uid) ||
          observed.publishedArticleId !== receipt.id
        )
          throw new Error('本次动态回执页面尚不能核验内容及文章 ID；保留结果未知，不重复发送')
        recoveredPublicationUrl = receipt.url
        draftAnchor = null
      } else if (publicationRecoveryRequired) {
        const expectedPlatformAccountId = publishing.draft?.platformAccountId
        if (!expectedPlatformAccountId) {
          throw new Error('发布结果未知，但任务缺少原 CSDN 账号；已停止自动核查')
        }
        const recoveredPublication = await (
          publishing.adapterId !== 'csdn'
            ? new CsdnDraftRecoveryCoordinator(
                new PublishingAdapter(),
                publishingPlatform(publishing.adapterId).managementUrl,
              )
            : this.draftRecoveryCoordinator
        ).recoverExactPublication({
          ...((publishing.adapterId === 'juejin' &&
            /^https:\/\/juejin\.cn\/post\/\d+\/?$/u.test(visibleUrl)) ||
          (publishing.adapterId === 'zhihu' &&
            /^https:\/\/zhuanlan\.zhihu\.com\/p\/(\d+)\/?$/u.exec(visibleUrl)?.[1] ===
              publishing.draft?.platformDraftId)
            ? { visiblePublicationUrl: visibleUrl }
            : {}),
          ...(publishing.adapterId === 'xiaohongshu' && publishing.publication.url
            ? {
                visiblePublicationUrl: (() => {
                  const recorded = new URL(publishing.publication.url)
                  const visible = new URL(visibleUrl)
                  return visible.origin === recorded.origin &&
                    visible.pathname === recorded.pathname &&
                    !visible.username &&
                    !visible.password
                    ? visible.href
                    : recorded.href
                })(),
              }
            : {}),
          expectedPlatformAccountId,
          expectedTitle: publishing.fields.title,
          navigate: navigateForRecovery,
        })
        recoveredPublicationUrl = recoveredPublication.url
        draftAnchor = null
      } else if (recoveryRequired && recovery) {
        const expectedPlatformAccountId = publishing.draft?.platformAccountId
        if (!expectedPlatformAccountId) {
          throw new Error('任务缺少原 CSDN 账号；已在启动 Agent 前停止恢复')
        }
        recoveredDraft = await (
          publishing.adapterId !== 'csdn'
            ? new CsdnDraftRecoveryCoordinator(
                new PublishingAdapter(),
                publishingPlatform(publishing.adapterId).managementUrl,
              )
            : this.draftRecoveryCoordinator
        ).recoverExactDraft({
          observe: recordPlan,
          assertActive: assertToutiaoRecoveryActive,
          expectedDraftId: recovery.expectedDraftId,
          expectedPlatformAccountId,
          expectedTitle: recovery.expectedTitle,
          navigate: navigateForRecovery,
        })
        draftAnchor = parsePlatformDraftAnchor(recoveredDraft.url, recoveredDraft.draftId)
        if (!draftAnchor || draftAnchor.draftId !== recovery.expectedDraftId) {
          throw new Error('草稿恢复结果没有返回原平台草稿身份')
        }
        if (publishing.adapterId === 'toutiao') {
          assertToutiaoRecoveryActive()
          const restoredTab = await browserManager.waitForAccountView(
            input.workspacePath,
            attempt.profileId,
            attempt.accountId,
            recoveredDraft.url,
            8_000,
            tabId,
          )
          assertToutiaoRecoveryActive()
          if (restoredTab !== tabId || !browserManager.isViewVisible(tabId))
            throw new Error('头条原稿已找回，但原任务 Tab 尚未重新可见；停止开放 Agent 工具')
        }
      } else if (draftAnchor) {
        if (!isSamePlatformDraft(draftAnchor.url, visibleUrl, draftAnchor.draftId)) {
          await browserManager.navigate(tabId, draftAnchor.url)
        }
        const restored = parsePlatformDraftAnchor(
          browserManager.getCurrentURL(tabId),
          draftAnchor.draftId,
        )
        if (!restored || restored.draftId !== draftAnchor.draftId) {
          throw new Error(`无法恢复原 CSDN 草稿 ${draftAnchor.draftId}，已拒绝在其他页面继续`)
        }
        draftAnchor = restored
      } else if (
        ['weibo', 'bilibili'].includes(publishing.adapterId) &&
        input.resumed &&
        (publishing.sideEffects.some((effect) => Boolean(effect.dispatchedAt)) ||
          publishing.assets.some(
            (asset) => Boolean(asset.platformUrl) || asset.status === 'uploaded',
          ))
      ) {
        if (publishing.adapterId === 'bilibili') {
          await playwrightBridge.ensureConnected('bilibili_empty_retry_check')
          await browserManager.ensurePlaywrightPage(tabId)
          const page = playwrightBridge.getPageById(tabId)
          if (!page) throw new Error('B站原账号页面尚未连接，不能核验重试条件')
          const probe = await new PublishingAdapter().probe(page)
          if (!canRetryEmptyBilibiliComposer(publishing, probe))
            throw new Error('B站临时编辑器已有内容或上传结果尚未核清；不会重填、重传或再次发送')
          await recordPlan({
            id: 'editor.open',
            status: 'completed',
            evidence: '原账号编辑器当前为空；此前上传已经明确核对为缺失，仅允许继续未完成的上传',
          })
        } else {
          throw new Error(
            '当前临时编辑器没有可恢复草稿身份。当前版本停止恢复；请保留页面现场，不会重填、重传或再次发送。',
          )
        }
      } else if (
        !['weibo', 'bilibili'].includes(publishing.adapterId) &&
        input.resumed &&
        hasPlatformPublishingProgress(publishing)
      ) {
        throw new Error('任务已有平台写入但缺少原草稿编号或账号；请重新创建发布任务')
      } else {
        // Account entry URLs may point at the creator home. Use the real CSDN new-editor
        // entry only for a task with no platform progress; recovery above always finds its draft.
        await recordPlan({
          id: 'editor.open',
          status: 'running',
          evidence: publishingPlatform(publishing.adapterId).editorUrl,
        })
        if (
          !['weibo', 'bilibili'].includes(publishing.adapterId) ||
          browserManager.getCurrentURL(tabId) !== publishingPlatform(publishing.adapterId).editorUrl
        )
          await browserManager.navigate(tabId, publishingPlatform(publishing.adapterId).editorUrl)
        await recordPlan({
          id: 'editor.open',
          status: 'completed',
          evidence: browserManager.getCurrentURL(tabId),
        })
        // A cached URL, recent-draft redirect or reused account Tab is not ownership evidence.
        // Only this task's guarded first-save response may establish a new draft identity.
      }
      await playwrightBridge.ensureConnected('article_publishing_launch')
      await browserManager.ensurePlaywrightPage(tabId)
      await playwrightBridge.switchToPage(tabId)
      const viewIdentity = browserManager.getViewRuntimeIdentity(tabId)
      const pageBinding = playwrightBridge.getPageBindingIdentity(tabId)
      if (
        !viewIdentity ||
        !pageBinding ||
        pageBinding.connectionGeneration !== playwrightBridge.getConnectionGeneration() ||
        pageBinding.webContentsId !== viewIdentity.webContentsId
      ) {
        throw new Error('账号浏览器 Runtime 身份未稳定绑定')
      }
      if (recoveredDraft && recovery) {
        const verified = await this.webAffairService.verifyArticlePublishingRecovery(
          {
            affairId: input.affair.id,
            attemptId: attempt.id,
            executionGeneration: attempt.executionGeneration,
            launchOperationId: attempt.launchOperationId,
            recoveryOperationId: recovery.operationId,
            draftId: recoveredDraft.draftId,
            url: recoveredDraft.url,
            platformAccountId: recoveredDraft.platformAccountId,
            normalizedTitle: recoveredDraft.normalizedTitle,
            saveState: 'saved',
            tabId,
            browserViewRuntimeGeneration: viewIdentity.browserViewRuntimeGeneration,
            webContentsId: viewIdentity.webContentsId,
            playwrightConnectionGeneration: pageBinding.connectionGeneration,
            playwrightPageBindingGeneration: pageBinding.generation,
          },
          input.workspaceId,
          { issueWritePermit: false },
        )
        if (!verified.success) throw new Error(verified.error.message)
      }

      const conversationId = `article-publishing-${input.affair.id}`
      const runId = `run-${attempt.launchOperationId}`
      const terminalIdentity = agentBridge.getRuntimeIdentity(conversationId)
      let bound = false
      let boundAffair: WebAffair | null = null
      let launchedRunId: string | null = null
      let launchedBrowserTaskId: string | null = null
      let terminalEvent: { type: 'complete' | 'error'; reason: string } | null = null
      let terminalReconciliation: Promise<void> | null = null
      let disposed = false
      let dispose = (): void => undefined
      let resolveLaunchReady: (result: StartArticlePublishingTaskResult) => void = () => undefined
      let rejectLaunchReady: (error: Error) => void = () => undefined
      const launchReady = new Promise<StartArticlePublishingTaskResult>((resolve, reject) => {
        resolveLaunchReady = resolve
        rejectLaunchReady = reject
      })
      const reconcileTerminalOnce = (terminal: {
        type: 'complete' | 'error'
        reason: string
      }): Promise<void> => {
        if (terminalReconciliation) return terminalReconciliation
        disposed = true
        dispose()
        terminalReconciliation = this.reconcileAgentTerminal(
          input,
          conversationId,
          runId,
          terminalIdentity,
          terminal,
        ).finally(() => {
          this.activeRuntimes.delete(attempt.id)
        })
        return terminalReconciliation
      }
      dispose = agentBridge.onRuntimeEvent((event) => {
        if (event.conversationId === conversationId && event.runId === runId) {
          this.observeAgentActivity(input.attemptId, event.type === 'stream')
        }
        if (
          disposed ||
          event.conversationId !== conversationId ||
          event.runId !== runId ||
          (event.type !== 'complete' && event.type !== 'error')
        ) {
          return
        }
        terminalEvent = {
          type: event.type,
          reason:
            event.type === 'complete'
              ? 'Agent Run 已结束，但发布事务尚未取得统一终态'
              : extractRuntimeError(event.data),
        }
        if (bound) {
          void reconcileTerminalOnce(terminalEvent)
        }
      })

      try {
        const agentPrompt = recoveredPublicationUrl
          ? `${input.prompt}\nmain 已按任务绑定的原稿或提交回执、平台账号和标题锁定公开结果：publicationUrl=${recoveredPublicationUrl}；只允许读回并完成发布核验。`
          : draftAnchor
            ? `${input.prompt}\nmain 已锁定平台草稿：draftUrl=${draftAnchor.url}；任何写入前必须确认当前页仍是该草稿，禁止切换到新稿或其他文章。`
            : input.prompt
        const runPromise = agentBridge.sendMessage(agentPrompt, conversationId, {
          runId,
          sessionId: null,
          workspaceRef: { kind: 'local', path: input.workspacePath },
          articlePublishingPolicy: {
            origin: 'article-publishing',
            workspaceId: input.workspaceId,
            affairId: input.affair.id,
            attemptId: attempt.id,
            executionGeneration: attempt.executionGeneration,
            launchOperationId: attempt.launchOperationId,
          },
          allowedTools: [
            'mcp__cclink_studio__browser_screenshot',
            'mcp__cclink_studio__browser_title',
            'mcp__cclink_studio__browser_input_value',
            'mcp__cclink_studio__browser_wait_for_selector',
            'mcp__cclink_studio__browser_click',
            'mcp__cclink_studio__browser_fill',
            'mcp__cclink_studio__browser_frame_execute',
            'mcp__cclink_studio__browser_select',
            'mcp__cclink_studio__browser_check',
            'mcp__cclink_studio__browser_uncheck',
            'mcp__cclink_studio__browser_press',
            'mcp__cclink_studio__browser_upload_file',
            'mcp__cclink_studio__browser_wait_for_navigation',
            'mcp__cclink_studio__browser_get_tab_info',
            'mcp__cclink_studio__editor_read',
            'mcp__cclink_studio__editor_list',
            'mcp__cclink_studio__web_affair_get',
            'mcp__cclink_studio__article_publishing_inspect_page',
            'mcp__cclink_studio__article_publishing_report_checkpoint',
            'mcp__cclink_studio__article_publishing_report_asset',
            'mcp__cclink_studio__web_affair_finish_attempt',
          ],
          disableBuiltinTools: true,
          resources: [
            {
              id: `browser-${tabId}`,
              kind: 'browser',
              label: `${publishingPlatform(publishing.adapterId).label}发布页`,
              ref: { type: 'browser', tabId, workspaceKey: input.workspacePath },
            },
          ],
          onRunPrepared: async (prepared) => {
            if (disposed) throw new Error('文章发布启动已经超时或取消')
            if (prepared.runId !== runId || !prepared.browserTaskRunId) {
              throw new Error('Agent 启动前没有创建绑定账号页的 BrowserTask')
            }
            launchedRunId = prepared.runId
            launchedBrowserTaskId = prepared.browserTaskRunId
            const browserTask = browserTaskRuntime.getTask(prepared.browserTaskRunId)
            if (!browserTask || browserTask.tabId !== tabId || browserTask.status !== 'running') {
              throw new Error('Agent 启动前的 BrowserTask 身份不匹配')
            }
            let currentViewIdentity = browserManager.getViewRuntimeIdentity(tabId)
            let currentPageBinding = playwrightBridge.getPageBindingIdentity(tabId)
            if (
              !currentViewIdentity ||
              !currentPageBinding ||
              currentPageBinding.connectionGeneration !==
                playwrightBridge.getConnectionGeneration() ||
              currentPageBinding.webContentsId !== currentViewIdentity.webContentsId
            ) {
              throw new Error('BrowserTask 创建后页面 Runtime 身份未稳定绑定')
            }
            let launchRecoveryVerification:
              | {
                  recoveryOperationId: string
                  draftId: string
                  url: string
                  platformAccountId: string
                  normalizedTitle: string
                  images?: Array<{ src: string; loaded?: boolean }>
                  imageEnumerationComplete?: boolean
                  saveState: 'saved'
                }
              | undefined
            if (recoveredDraft && recovery) {
              for (
                let verificationAttempt = 1;
                verificationAttempt <= 3;
                verificationAttempt += 1
              ) {
                const sampledView = currentViewIdentity
                const sampledPage = currentPageBinding
                const page = playwrightBridge.getPageById(tabId)
                if (!page || page.isClosed()) {
                  throw new Error('BrowserTask 创建后恢复草稿页面不可用')
                }
                const refreshedDraft = await (
                  publishing.adapterId !== 'csdn'
                    ? new CsdnDraftRecoveryCoordinator(new PublishingAdapter())
                    : this.draftRecoveryCoordinator
                ).verifyExactDraftPage({
                  page,
                  expectedDraftId: recoveredDraft.draftId,
                  expectedPlatformAccountId: recoveredDraft.platformAccountId,
                  expectedTitle: recoveredDraft.normalizedTitle,
                })
                const verifiedView = browserManager.getViewRuntimeIdentity(tabId)
                const verifiedPage = playwrightBridge.getPageBindingIdentity(tabId)
                if (!verifiedView || !verifiedPage) {
                  throw new Error('恢复草稿核验后 Page Runtime 不可用')
                }
                if (
                  sampledView.browserViewRuntimeGeneration ===
                    verifiedView.browserViewRuntimeGeneration &&
                  sampledView.webContentsId === verifiedView.webContentsId &&
                  sampledView.documentGeneration === verifiedView.documentGeneration &&
                  playwrightBridge.getPageById(tabId) === page &&
                  sampledPage.connectionGeneration === verifiedPage.connectionGeneration &&
                  sampledPage.generation === verifiedPage.generation &&
                  verifiedPage.webContentsId === verifiedView.webContentsId
                ) {
                  currentViewIdentity = verifiedView
                  currentPageBinding = verifiedPage
                  launchRecoveryVerification = {
                    recoveryOperationId: recovery.operationId,
                    draftId: refreshedDraft.draftId,
                    url: refreshedDraft.url,
                    platformAccountId: refreshedDraft.platformAccountId,
                    normalizedTitle: refreshedDraft.normalizedTitle,
                    images: refreshedDraft.images,
                    imageEnumerationComplete: refreshedDraft.imageEnumerationComplete,
                    saveState: 'saved',
                  }
                  break
                }
                currentViewIdentity = verifiedView
                currentPageBinding = verifiedPage
              }
              if (!launchRecoveryVerification) {
                throw new Error('恢复草稿核验期间 Page Runtime 连续改代，已停止启动 Agent')
              }
            }
            const correlationPatch = {
              accountId: attempt.accountId,
              allowedOrigins: publishingPlatform(publishing.adapterId).origins,
              affairId: input.affair.id,
              affairNodeId: attempt.nodeId,
              affairAttemptId: attempt.id,
              affairExecutionGeneration: attempt.executionGeneration,
              affairLaunchOperationId: attempt.launchOperationId,
              browserViewRuntimeGeneration: currentViewIdentity.browserViewRuntimeGeneration,
              webContentsId: currentViewIdentity.webContentsId,
              playwrightConnectionGeneration: currentPageBinding.connectionGeneration,
              playwrightPageBindingGeneration: currentPageBinding.generation,
            }
            if (recoveryLease) {
              browserTaskRuntime.transferAccountRecoveryLeaseToTask(
                recoveryLease.id,
                browserTask.id,
                correlationPatch,
              )
            } else {
              browserTaskRuntime.updateCorrelation(browserTask.id, correlationPatch)
            }
            const boundAt = new Date().toISOString()
            const common = {
              attemptId: attempt.id,
              executionGeneration: attempt.executionGeneration,
              launchOperationId: attempt.launchOperationId,
              status: 'active' as const,
              boundAt,
              lastObservedAt: boundAt,
            }
            const runtimeBindings: WebAffairRuntimeBinding[] = [
              {
                ...common,
                id: randomUUID(),
                kind: 'agent-run',
                conversationId,
                agentRunId: prepared.runId,
                agentRuntimeEpoch: terminalIdentity.agentRuntimeEpoch,
                agentRuntimeBindingKey: terminalIdentity.agentRuntimeBindingKey,
              },
              {
                ...common,
                id: randomUUID(),
                kind: 'browser-tab',
                tabId,
                browserViewRuntimeGeneration: currentViewIdentity.browserViewRuntimeGeneration,
                webContentsId: currentViewIdentity.webContentsId,
              },
              {
                ...common,
                id: randomUUID(),
                kind: 'browser-task',
                browserTaskRunId: browserTask.id,
                tabId,
                browserViewRuntimeGeneration: currentViewIdentity.browserViewRuntimeGeneration,
                webContentsId: currentViewIdentity.webContentsId,
                playwrightConnectionGeneration: currentPageBinding.connectionGeneration,
                playwrightPageBindingGeneration: currentPageBinding.generation,
              },
            ]
            const boundResult = launchRecoveryVerification
              ? await this.webAffairService.bindArticlePublishingRuntime(
                  input.affair.id,
                  attempt.id,
                  attempt.executionGeneration,
                  attempt.launchOperationId,
                  runtimeBindings,
                  input.workspaceId,
                  launchRecoveryVerification,
                )
              : await this.webAffairService.bindArticlePublishingRuntime(
                  input.affair.id,
                  attempt.id,
                  attempt.executionGeneration,
                  attempt.launchOperationId,
                  runtimeBindings,
                  input.workspaceId,
                )
            if (!boundResult.success) throw new Error(boundResult.error.message)
            boundAffair = boundResult.data
            bound = true
            const observedAt = Date.now()
            this.activeRuntimes.set(attempt.id, {
              workspaceId: input.workspaceId,
              affairId: input.affair.id,
              attemptId: attempt.id,
              executionGeneration: attempt.executionGeneration,
              launchOperationId: attempt.launchOperationId,
              conversationId,
              agentRunId: prepared.runId,
              agentRuntimeBindingKey: terminalIdentity.agentRuntimeBindingKey,
              agentRuntimeEpoch: terminalIdentity.agentRuntimeEpoch,
              browserTaskRunId: browserTask.id,
              tabId,
              browserViewRuntimeGeneration: currentViewIdentity.browserViewRuntimeGeneration,
              webContentsId: currentViewIdentity.webContentsId,
              playwrightConnectionGeneration: currentPageBinding.connectionGeneration,
              playwrightPageBindingGeneration: currentPageBinding.generation,
              lastOwnerAt: observedAt,
              lastProgressAt: observedAt,
              continuationUsed: false,
            })
            const latestIdentity = this.latestPageRuntimeIdentities.get(tabId)
            if (latestIdentity) await this.scheduleBrowserRuntimeRebind(latestIdentity)
            const pendingRebind = this.runtimeRebindQueues.get(attempt.id)
            if (pendingRebind) await pendingRebind
            const settledRuntime = this.activeRuntimes.get(attempt.id)
            const settledTask = browserTaskRuntime.getTask(browserTask.id)
            const settledView = browserManager.getViewRuntimeIdentity(tabId)
            const settledPage = playwrightBridge.getPageBindingIdentity(tabId)
            if (
              settledRuntime?.browserTaskRunId !== browserTask.id ||
              settledTask?.status !== 'running' ||
              settledTask.correlation?.browserViewRuntimeGeneration !==
                settledRuntime.browserViewRuntimeGeneration ||
              settledTask.correlation?.webContentsId !== settledRuntime.webContentsId ||
              settledTask.correlation?.playwrightConnectionGeneration !==
                settledRuntime.playwrightConnectionGeneration ||
              settledTask.correlation?.playwrightPageBindingGeneration !==
                settledRuntime.playwrightPageBindingGeneration ||
              settledView?.browserViewRuntimeGeneration !==
                settledRuntime.browserViewRuntimeGeneration ||
              settledView.webContentsId !== settledRuntime.webContentsId ||
              settledPage?.webContentsId !== settledRuntime.webContentsId ||
              settledPage.connectionGeneration !== settledRuntime.playwrightConnectionGeneration ||
              settledPage.generation !== settledRuntime.playwrightPageBindingGeneration
            ) {
              throw new Error('Agent 工具开放前 Page Runtime 尚未收敛到同一精确身份')
            }
            const settledSnapshot = this.webAffairService.getProjectSnapshot(input.workspaceId)
            const settledAffair = settledSnapshot.success
              ? settledSnapshot.data.affairs.find((candidate) => candidate.id === input.affair.id)
              : undefined
            if (!settledAffair) throw new Error('Agent 工具开放前无法读取发布事务')
            boundAffair = settledAffair
            resolveLaunchReady({
              affair: settledAffair,
              attemptId: attempt.id,
              resumed: input.resumed,
              executionGeneration: attempt.executionGeneration,
              launchOperationId: attempt.launchOperationId,
              conversationId,
              agentRunId: prepared.runId,
              browserTaskRunId: browserTask.id,
              browserTabId: tabId,
              agentPrompt,
            })
          },
        })
        void runPromise
          .then(() => {
            // sendMessage() resolves after the backend accepted the run. The actual terminal
            // state is emitted independently through onRuntimeEvent and is the only terminal
            // source allowed to reconcile the publishing Attempt.
            if (!bound || !boundAffair || launchedBrowserTaskId === null) {
              rejectLaunchReady(new Error('Agent Runtime 未在执行前完成持久绑定'))
            }
          })
          .catch((error) => {
            const reason = error instanceof Error ? error.message : String(error)
            if (bound) {
              void reconcileTerminalOnce(
                terminalEvent ?? { type: 'error', reason: `Agent Run 后台执行失败：${reason}` },
              )
              return
            }
            disposed = true
            dispose()
            if (launchedBrowserTaskId) {
              try {
                browserTaskRuntime.cancelTask(launchedBrowserTaskId)
              } catch {
                // BrowserTask 可能已由 AgentBridge 收敛。
              }
            }
            rejectLaunchReady(error instanceof Error ? error : new Error(reason))
          })
        return {
          success: true,
          data: await withTimeout(
            launchReady,
            RUNTIME_BIND_TIMEOUT_MS,
            'Agent Runtime 未在 15 秒内完成持久绑定',
          ),
        }
      } catch (error) {
        disposed = true
        dispose()
        if (!bound && launchedBrowserTaskId) {
          try {
            browserTaskRuntime.cancelTask(launchedBrowserTaskId)
          } catch {
            // 启动回滚只取消本次精确 task；已终态或已被 owner 清理时无需重复处理。
          }
        }
        if (!bound) {
          await agentBridge.abort(conversationId, launchedRunId ?? runId).catch(() => undefined)
        }
        throw error
      }
    } finally {
      if (recoveryLease) browserTaskRuntime.releaseAccountRecoveryLease(recoveryLease.id)
    }
  }

  private ensureRuntimeObservers(
    agentBridge: AgentBridge,
    browserManager: BrowserManager,
    browserTaskRuntime: BrowserTaskRuntime,
  ): void {
    if (this.runtimeObserversInstalled) return
    this.runtimeObserversInstalled = true
    this.runtimeDisposers.push(
      browserTaskRuntime.onTaskChanged((task) => this.observeBrowserTask(task)),
      browserTaskRuntime.onActionLogChanged((log) => this.observeBrowserAction(log)),
      browserManager.onPageRuntimeBound((identity) => {
        void this.scheduleBrowserRuntimeRebind(identity).catch((error) =>
          console.warn('[ArticlePublishing] Page Runtime 重绑定失败:', {
            tabId: identity.tabId,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }),
      agentBridge.onRuntimeEvent((event) => {
        if (!event.runId) return
        for (const runtime of this.activeRuntimes.values()) {
          if (runtime.conversationId !== event.conversationId || runtime.agentRunId !== event.runId)
            continue
          runtime.lastOwnerAt = Date.now()
          if (event.type === 'stream') runtime.lastProgressAt = runtime.lastOwnerAt
        }
      }),
    )
    this.watchdogTimer = setInterval(() => void this.runWatchdog(), WATCHDOG_INTERVAL_MS)
    this.watchdogTimer.unref?.()
  }

  private scheduleBrowserRuntimeRebind(identity: BrowserPageRuntimeBindingIdentity): Promise<void> {
    const latest = this.latestPageRuntimeIdentities.get(identity.tabId)
    if (
      !latest ||
      identity.browserViewRuntimeGeneration > latest.browserViewRuntimeGeneration ||
      (identity.browserViewRuntimeGeneration === latest.browserViewRuntimeGeneration &&
        identity.webContentsId === latest.webContentsId &&
        (identity.playwrightConnectionGeneration > latest.playwrightConnectionGeneration ||
          (identity.playwrightConnectionGeneration === latest.playwrightConnectionGeneration &&
            identity.playwrightPageBindingGeneration >= latest.playwrightPageBindingGeneration)))
    ) {
      this.latestPageRuntimeIdentities.set(identity.tabId, identity)
    }
    const pending: Promise<void>[] = []
    for (const runtime of this.activeRuntimes.values()) {
      if (!this.isNewerPageRuntimeIdentity(runtime, identity)) continue
      const browserTaskRuntime = this.runtimeDependencies?.getBrowserTaskRuntime()
      if (!browserTaskRuntime) continue
      const task = browserTaskRuntime?.getTask(runtime.browserTaskRunId)
      if (
        task?.status !== 'running' ||
        task.correlation?.affairExecutionGeneration !== runtime.executionGeneration ||
        task.correlation?.affairLaunchOperationId !== runtime.launchOperationId
      ) {
        continue
      }
      // Synchronously move the BrowserTask fence first. Until the durable WebAffair binding
      // catches up, policy resolution fails closed instead of allowing the old permit to write
      // through a newly claimed Page.
      browserTaskRuntime.updateCorrelation(runtime.browserTaskRunId, {
        browserViewRuntimeGeneration: identity.browserViewRuntimeGeneration,
        webContentsId: identity.webContentsId,
        playwrightConnectionGeneration: identity.playwrightConnectionGeneration,
        playwrightPageBindingGeneration: identity.playwrightPageBindingGeneration,
      })
      const previous = this.runtimeRebindQueues.get(runtime.attemptId) ?? Promise.resolve()
      const queued = previous
        .catch(() => undefined)
        .then(() => this.rebindBrowserRuntime(runtime, identity))
        .catch(async (error) => {
          await this.recordRuntimeRebindFailure(runtime, identity, error)
          throw error
        })
        .finally(() => {
          if (this.runtimeRebindQueues.get(runtime.attemptId) === queued) {
            this.runtimeRebindQueues.delete(runtime.attemptId)
          }
        })
      this.runtimeRebindQueues.set(runtime.attemptId, queued)
      pending.push(queued)
    }
    return Promise.all(pending).then(() => undefined)
  }

  private async recordRuntimeRebindFailure(
    runtime: ActivePublishingRuntime,
    identity: BrowserPageRuntimeBindingIdentity,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    const snapshot = this.webAffairService.getProjectSnapshot(runtime.workspaceId)
    const current = snapshot.success
      ? snapshot.data.affairs.find((affair) => affair.id === runtime.affairId)?.articlePublishing
          ?.executionProtocol.current
      : undefined
    if (!current) return
    await this.webAffairService.failArticlePublishingCurrentOperation({
      workspaceId: runtime.workspaceId,
      affairId: runtime.affairId,
      attemptId: runtime.attemptId,
      executionGeneration: runtime.executionGeneration,
      launchOperationId: runtime.launchOperationId,
      expectedOperationRunId: current.operationRunId,
      expectedOperationRevision: current.revision,
      failure: {
        category: 'studio-runtime',
        code: 'studio_runtime.page_rebind_failed',
        message: `Page Runtime 重绑定失败：${message}`,
        mismatches: [
          {
            field: 'browserViewRuntimeGeneration',
            expected: identity.browserViewRuntimeGeneration,
            actual: runtime.browserViewRuntimeGeneration,
          },
          {
            field: 'webContentsId',
            expected: identity.webContentsId,
            actual: runtime.webContentsId,
          },
          {
            field: 'playwrightConnectionGeneration',
            expected: identity.playwrightConnectionGeneration,
            actual: runtime.playwrightConnectionGeneration,
          },
          {
            field: 'playwrightPageBindingGeneration',
            expected: identity.playwrightPageBindingGeneration,
            actual: runtime.playwrightPageBindingGeneration,
          },
        ],
      },
    })
  }

  private async rebindBrowserRuntime(
    runtime: ActivePublishingRuntime,
    identity: BrowserPageRuntimeBindingIdentity,
  ): Promise<void> {
    if (this.activeRuntimes.get(runtime.attemptId) !== runtime) return
    if (!this.isNewerPageRuntimeIdentity(runtime, identity)) return
    const browserTaskRuntime = this.runtimeDependencies?.getBrowserTaskRuntime()
    const browserManager = this.runtimeDependencies?.getBrowserManager()
    const playwrightBridge = this.runtimeDependencies?.getPlaywrightBridge()
    if (!browserTaskRuntime || !browserManager || !playwrightBridge) return
    const task = browserTaskRuntime.getTask(runtime.browserTaskRunId)
    if (
      task?.status !== 'running' ||
      task.correlation?.affairExecutionGeneration !== runtime.executionGeneration ||
      task.correlation?.affairLaunchOperationId !== runtime.launchOperationId
    ) {
      return
    }

    const snapshot = this.webAffairService.getProjectSnapshot(runtime.workspaceId)
    const affair = snapshot.success
      ? snapshot.data.affairs.find((candidate) => candidate.id === runtime.affairId)
      : undefined
    const publishingBeforeRebind = affair?.articlePublishing
    const recovery = publishingBeforeRebind?.draft?.recovery
    let recoveryVerification:
      | {
          recoveryOperationId: string
          draftId: string
          url: string
          platformAccountId: string
          normalizedTitle: string
          saveState: 'saved'
        }
      | undefined
    if (
      recovery?.executionGeneration === runtime.executionGeneration &&
      publishingBeforeRebind?.draft?.platformDraftId &&
      publishingBeforeRebind.draft.platformAccountId
    ) {
      const page = playwrightBridge.getPageById(runtime.tabId)
      if (!page || page.isClosed()) throw new Error('Page Runtime 重绑定后恢复草稿页面不可用')
      const observedView = browserManager.getViewRuntimeIdentity(runtime.tabId)
      const verifiedDraft = await (
        publishingBeforeRebind.adapterId !== 'csdn'
          ? new CsdnDraftRecoveryCoordinator(new PublishingAdapter())
          : this.draftRecoveryCoordinator
      ).verifyExactDraftPage({
        page,
        expectedDraftId: publishingBeforeRebind.draft.platformDraftId,
        expectedPlatformAccountId: publishingBeforeRebind.draft.platformAccountId,
        expectedTitle: recovery.expectedTitle,
      })
      const currentView = browserManager.getViewRuntimeIdentity(runtime.tabId)
      const currentPage = playwrightBridge.getPageBindingIdentity(runtime.tabId)
      if (
        !currentView ||
        !currentPage ||
        currentView.browserViewRuntimeGeneration !== identity.browserViewRuntimeGeneration ||
        currentView.documentGeneration !== observedView?.documentGeneration ||
        playwrightBridge.getPageById(runtime.tabId) !== page ||
        currentView.webContentsId !== identity.webContentsId ||
        currentPage.connectionGeneration !== identity.playwrightConnectionGeneration ||
        currentPage.generation !== identity.playwrightPageBindingGeneration ||
        currentPage.webContentsId !== identity.webContentsId
      ) {
        throw new Error('恢复草稿核验期间 Page Runtime 再次变化')
      }
      recoveryVerification = {
        recoveryOperationId: recovery.operationId,
        draftId: verifiedDraft.draftId,
        url: verifiedDraft.url,
        platformAccountId: verifiedDraft.platformAccountId,
        normalizedTitle: verifiedDraft.normalizedTitle,
        saveState: 'saved',
      }
    }

    const rebound = await this.webAffairService.rebindArticlePublishingBrowserRuntime({
      workspaceId: runtime.workspaceId,
      affairId: runtime.affairId,
      attemptId: runtime.attemptId,
      executionGeneration: runtime.executionGeneration,
      launchOperationId: runtime.launchOperationId,
      browserTaskRunId: runtime.browserTaskRunId,
      tabId: runtime.tabId,
      previousBrowserViewRuntimeGeneration: runtime.browserViewRuntimeGeneration,
      previousWebContentsId: runtime.webContentsId,
      browserViewRuntimeGeneration: identity.browserViewRuntimeGeneration,
      webContentsId: identity.webContentsId,
      previousPlaywrightConnectionGeneration: runtime.playwrightConnectionGeneration,
      previousPlaywrightPageBindingGeneration: runtime.playwrightPageBindingGeneration,
      playwrightConnectionGeneration: identity.playwrightConnectionGeneration,
      playwrightPageBindingGeneration: identity.playwrightPageBindingGeneration,
      ...(recoveryVerification ? { recoveryVerification } : {}),
    })
    if (!rebound.success) throw new Error(rebound.error.message)

    browserTaskRuntime.updateCorrelation(runtime.browserTaskRunId, {
      browserViewRuntimeGeneration: identity.browserViewRuntimeGeneration,
      webContentsId: identity.webContentsId,
      playwrightConnectionGeneration: identity.playwrightConnectionGeneration,
      playwrightPageBindingGeneration: identity.playwrightPageBindingGeneration,
    })
    runtime.browserViewRuntimeGeneration = identity.browserViewRuntimeGeneration
    runtime.webContentsId = identity.webContentsId
    runtime.playwrightConnectionGeneration = identity.playwrightConnectionGeneration
    runtime.playwrightPageBindingGeneration = identity.playwrightPageBindingGeneration
    runtime.lastOwnerAt = Date.now()

    console.info('[ArticlePublishing] Page Runtime owner 已收敛到当前绑定:', {
      affairId: runtime.affairId,
      attemptId: runtime.attemptId,
      tabId: runtime.tabId,
      browserViewRuntimeGeneration: runtime.browserViewRuntimeGeneration,
      webContentsId: runtime.webContentsId,
      playwrightConnectionGeneration: runtime.playwrightConnectionGeneration,
      playwrightPageBindingGeneration: runtime.playwrightPageBindingGeneration,
    })
    await this.probeRuntime(runtime)
  }

  private isNewerPageRuntimeIdentity(
    runtime: ActivePublishingRuntime,
    identity: BrowserPageRuntimeBindingIdentity,
  ): boolean {
    if (runtime.tabId !== identity.tabId) return false
    if (identity.browserViewRuntimeGeneration < runtime.browserViewRuntimeGeneration) return false
    if (
      identity.browserViewRuntimeGeneration === runtime.browserViewRuntimeGeneration &&
      identity.webContentsId !== runtime.webContentsId
    ) {
      return false
    }
    if (identity.playwrightConnectionGeneration < runtime.playwrightConnectionGeneration) {
      return false
    }
    if (
      identity.playwrightConnectionGeneration === runtime.playwrightConnectionGeneration &&
      identity.playwrightPageBindingGeneration <= runtime.playwrightPageBindingGeneration
    ) {
      return false
    }
    return true
  }

  private observeAgentActivity(attemptId: string, progress: boolean): void {
    const runtime = this.activeRuntimes.get(attemptId)
    if (!runtime) return
    runtime.lastOwnerAt = Date.now()
    if (progress) runtime.lastProgressAt = runtime.lastOwnerAt
  }

  private observeBrowserTask(task: BrowserTaskRun): void {
    const attemptId = task.correlation?.affairAttemptId
    const runtime = attemptId ? this.activeRuntimes.get(attemptId) : undefined
    if (!runtime || task.id !== runtime.browserTaskRunId) return
    if (
      task.correlation?.affairExecutionGeneration !== runtime.executionGeneration ||
      task.correlation?.affairLaunchOperationId !== runtime.launchOperationId
    )
      return
    runtime.lastOwnerAt = Date.now()
    if (task.status === 'running') runtime.lastProgressAt = runtime.lastOwnerAt
  }

  private observeBrowserAction(log: BrowserActionLog): void {
    const runtime = [...this.activeRuntimes.values()].find(
      (candidate) => candidate.browserTaskRunId === log.taskRunId,
    )
    if (!runtime) return
    runtime.lastOwnerAt = Date.now()
    runtime.lastProgressAt = runtime.lastOwnerAt
  }

  private async runWatchdog(): Promise<void> {
    for (const runtime of [...this.activeRuntimes.values()]) {
      await this.probeRuntime(runtime).catch((error) =>
        console.warn('[ArticlePublishing] Runtime 看门狗核验失败:', error),
      )
    }
  }

  private async probeRuntime(
    runtime: ActivePublishingRuntime,
    trigger: 'watchdog' | 'user-check' = 'watchdog',
  ): Promise<void> {
    const dependencies = this.runtimeDependencies
    const agentBridge = dependencies?.getAgentBridge()
    const browserManager = dependencies?.getBrowserManager()
    const browserTaskRuntime = dependencies?.getBrowserTaskRuntime()
    const playwrightBridge = dependencies?.getPlaywrightBridge()
    if (!agentBridge || !browserManager || !browserTaskRuntime || !playwrightBridge) return

    const snapshot = this.webAffairService.getProjectSnapshot(runtime.workspaceId)
    const affair = snapshot.success
      ? snapshot.data.affairs.find((candidate) => candidate.id === runtime.affairId)
      : undefined
    const attempt = affair?.attempts.find((candidate) => candidate.id === runtime.attemptId)
    const execution = affair?.articlePublishing?.execution
    if (
      !attempt ||
      attempt.executionGeneration !== runtime.executionGeneration ||
      attempt.launchOperationId !== runtime.launchOperationId ||
      !['running-ai', 'checking-runtime'].includes(attempt.status)
    ) {
      this.activeRuntimes.delete(runtime.attemptId)
      return
    }

    const agent = agentBridge.getRunStatus(runtime.conversationId, runtime.agentRunId)
    const agentIdentity = agentBridge.getRuntimeIdentity(runtime.conversationId)
    const task = browserTaskRuntime.getTask(runtime.browserTaskRunId)
    const view = browserManager.getViewRuntimeIdentity(runtime.tabId)
    const page = playwrightBridge.getPageBindingIdentity(runtime.tabId)
    const ownerHealthy = Boolean(
      agent?.status === 'running' &&
      agentIdentity.agentRuntimeEpoch === runtime.agentRuntimeEpoch &&
      agentIdentity.agentRuntimeBindingKey === runtime.agentRuntimeBindingKey &&
      task?.status === 'running' &&
      task.correlation?.affairExecutionGeneration === runtime.executionGeneration &&
      task.correlation?.affairLaunchOperationId === runtime.launchOperationId &&
      view?.browserViewRuntimeGeneration === runtime.browserViewRuntimeGeneration &&
      view.webContentsId === runtime.webContentsId &&
      page?.generation === runtime.playwrightPageBindingGeneration &&
      page.webContentsId === runtime.webContentsId &&
      playwrightBridge.isConnected() &&
      playwrightBridge.getConnectionGeneration() === runtime.playwrightConnectionGeneration,
    )
    const now = Date.now()
    if (ownerHealthy) runtime.lastOwnerAt = now
    const ownerExpired = !ownerHealthy || now - runtime.lastOwnerAt >= OWNER_LEASE_MS
    const progressExpired = now - runtime.lastProgressAt >= PROGRESS_LEASE_MS

    if (
      trigger === 'user-check' &&
      (execution?.status === 'running' || execution?.status === 'checking-runtime')
    ) {
      await this.submitRuntimeReconciliation(runtime, {
        phase: ownerHealthy && !progressExpired ? 'user-healthy' : 'user-resolved',
        source: 'user-check',
        observedStatus:
          ownerHealthy && !progressExpired
            ? 'healthy'
            : ownerHealthy
              ? 'owner-alive-no-progress'
              : 'owner-lost',
        reasonCode:
          ownerHealthy && !progressExpired
            ? 'RUNTIME_HEALTHY'
            : ownerHealthy
              ? 'NO_VERIFIABLE_PROGRESS'
              : 'RUNTIME_ORPHAN_CONFIRMED',
        reason:
          ownerHealthy && !progressExpired
            ? '用户主动核验已确认当前 Agent、BrowserTask、Tab 与 CDP 绑定健康'
            : ownerHealthy
              ? '用户主动核验确认 Runtime 长期没有可验证进度，已安全中断；可从当前步骤重试'
              : '用户主动核验确认当前运行绑定失主，任务已安全中断',
        observedAt: now,
      })
      return
    }

    if (execution?.status === 'running' && (ownerExpired || progressExpired)) {
      await this.submitRuntimeReconciliation(runtime, {
        phase: 'suspected',
        observedStatus: ownerHealthy ? 'owner-alive' : 'owner-lost',
        reasonCode: ownerHealthy ? 'PROGRESS_LEASE_EXPIRED' : 'RUNTIME_OWNER_LOST',
        reason: ownerHealthy
          ? 'Runtime 仍响应但任务长期没有可验证进度，已冻结网页写入并等待核验'
          : 'Agent、BrowserTask、Tab 或 CDP 的当前绑定已失效，正在核验',
        observedAt: now,
      })
      return
    }
    if (execution?.status !== 'checking-runtime') return
    const suspectedAt = Date.parse(execution.runtimeCheck?.suspectedAt ?? '')
    if (ownerHealthy && !progressExpired) {
      await this.submitRuntimeReconciliation(runtime, {
        phase: 'healthy',
        source: 'user-check',
        observedStatus: 'healthy',
        reasonCode: 'RUNTIME_HEALTHY',
        reason: '主进程已重新确认当前 Agent、BrowserTask、Tab 与 CDP 绑定健康',
        observedAt: now,
      })
      return
    }
    if (Number.isFinite(suspectedAt) && now - suspectedAt < RUNTIME_PROBE_MS) return
    await this.submitRuntimeReconciliation(runtime, {
      phase: 'resolved',
      observedStatus: ownerHealthy ? 'owner-alive-no-progress' : 'owner-lost',
      reasonCode: ownerHealthy ? 'NO_VERIFIABLE_PROGRESS' : 'RUNTIME_ORPHAN_CONFIRMED',
      reason: ownerHealthy
        ? 'Runtime 仍响应但持续没有可验证进度，已安全中断；可从当前步骤重试'
        : '主进程已确认当前运行绑定失主，任务已安全中断',
      observedAt: now,
    })
  }

  private async submitRuntimeReconciliation(
    runtime: ActivePublishingRuntime,
    input: {
      phase: string
      source?: 'lease-expired' | 'user-check'
      observedStatus: string
      reasonCode: string
      reason: string
      observedAt: number
    },
  ): Promise<void> {
    const eventId = stableRuntimeEventId(
      runtime.attemptId,
      runtime.executionGeneration,
      runtime.launchOperationId,
      `watchdog:${input.phase}:${input.reasonCode}:${Math.floor(input.observedAt / RUNTIME_PROBE_MS)}`,
    )
    let lastError: string | undefined
    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
      const result = await this.webAffairService.reconcileArticlePublishingRuntime({
        eventId,
        workspaceId: runtime.workspaceId,
        affairId: runtime.affairId,
        attemptId: runtime.attemptId,
        executionGeneration: runtime.executionGeneration,
        launchOperationId: runtime.launchOperationId,
        source: input.source ?? 'lease-expired',
        observedAt: new Date(input.observedAt).toISOString(),
        observedStatus: input.observedStatus,
        lastOwnerAt: new Date(runtime.lastOwnerAt).toISOString(),
        lastProgressAt: new Date(runtime.lastProgressAt).toISOString(),
        probeDeadline: new Date(input.observedAt + RUNTIME_PROBE_MS).toISOString(),
        reasonCode: input.reasonCode,
        reason: input.reason,
      })
      if (result.success) return
      lastError = result.error.message
      if (result.error.code !== 'STORAGE_UNAVAILABLE') break
      await new Promise((resolve) => setTimeout(resolve, attemptNumber * 250))
    }
    console.warn('[ArticlePublishing] Runtime 收敛重试失败', {
      affairId: runtime.affairId,
      attemptId: runtime.attemptId,
      generation: runtime.executionGeneration,
      reasonCode: input.reasonCode,
      error: lastError,
    })
  }

  private async reconcileAgentTerminal(
    input: {
      affair: WebAffair
      attemptId: string
      workspaceId: string
    },
    conversationId: string,
    runId: string,
    runtimeIdentity: { agentRuntimeBindingKey: string; agentRuntimeEpoch: number },
    terminal: { type: 'complete' | 'error'; reason: string },
  ): Promise<void> {
    const attempt = input.affair.attempts.find((candidate) => candidate.id === input.attemptId)
    if (!attempt) return
    const eventId = stableRuntimeEventId(
      attempt.id,
      attempt.executionGeneration,
      attempt.launchOperationId,
      `agent:${conversationId}:${runId}:${terminal.type}`,
    )
    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
      const result = await this.webAffairService.reconcileArticlePublishingRuntime({
        eventId,
        workspaceId: input.workspaceId,
        affairId: input.affair.id,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        launchOperationId: attempt.launchOperationId,
        source: 'agent-terminal',
        observedAt: new Date().toISOString(),
        runtimeIdentity: {
          kind: 'agent-run',
          conversationId,
          agentRunId: runId,
          ...runtimeIdentity,
        },
        observedStatus: terminal.type,
        reasonCode: terminal.type === 'complete' ? 'AGENT_COMPLETED' : 'AGENT_FAILED',
        reason: terminal.reason,
      })
      if (result.success || result.error.code === 'NOT_FOUND') return
      if (result.error.code !== 'STORAGE_UNAVAILABLE' || attemptNumber === 3) {
        console.warn('[ArticlePublishing] Agent 终态统一收敛失败', result.error)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, attemptNumber * 250))
    }
  }

  async createTask(
    rawInput: CreateArticlePublishingTaskInput,
    workspaceId: string,
  ): Promise<
    WebAffairOperationResult<import('../../shared/web-affairs/web-affair-types').WebAffair>
  > {
    const parsed = createArticlePublishingTaskInputSchema.safeParse(rawInput)
    if (!parsed.success || parsed.data.workspaceRef.kind !== 'local') {
      return invalid('文章发布草稿参数无效')
    }
    const previewResult = await this.inspectSource({
      workspaceRef: parsed.data.workspaceRef,
      markdownPath: parsed.data.markdownPath,
    })
    if (!previewResult.success) return previewResult
    if (previewResult.data.blockers.length > 0) {
      return invalid(previewResult.data.blockers.join('；'))
    }
    return this.webAffairService.createArticlePublishingAffair(
      {
        preview: previewResult.data,
        existingDraft: parsed.data.existingDraft,
        composer: parsed.data.composer,
        reviseDraftFromAffairId: parsed.data.reviseDraftFromAffairId,
        accountId: parsed.data.accountId,
        fields: parsed.data.fields,
        workspaceRef: parsed.data.workspaceRef,
      },
      workspaceId,
    )
  }

  async startTask(
    rawInput: StartArticlePublishingTaskInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<StartArticlePublishingTaskResult>> {
    const parsed = startArticlePublishingTaskInputSchema.safeParse(rawInput)
    if (!parsed.success || parsed.data.workspaceRef.kind !== 'local') {
      return invalid('启动文章发布参数无效')
    }
    const snapshot = this.webAffairService.getProjectSnapshot(workspaceId)
    if (!snapshot.success) return snapshot
    const affair = snapshot.data.affairs.find(
      (item) => item.id === parsed.data.affairId && item.kind === 'article-publishing',
    )
    const publishing = affair?.articlePublishing
    if (!affair || !publishing) return notFound('文章发布事务不存在')
    const preview = await this.buildPreview(
      publishing.source.markdownPath,
      parsed.data.workspaceRef.path,
    ).catch(() => null)
    if (
      !preview ||
      preview.source.modifiedAt !== publishing.source.modifiedAt ||
      preview.source.size !== publishing.source.size
    ) {
      return invalid('源 Markdown 已变化，不能恢复旧 Attempt；请以新内容创建发布任务')
    }
    const currentAssets = preview.assets
      .map((asset) => [asset.id, asset.sourcePath, asset.size, asset.modifiedAt])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    const frozenAssets = publishing.assets
      .map((asset) => [asset.id, asset.sourcePath, asset.size, asset.modifiedAt])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    if (JSON.stringify(currentAssets) !== JSON.stringify(frozenAssets)) {
      return invalid('正文图片已变化，不能恢复旧 Attempt；请重新创建发布任务')
    }

    const currentAttempt = publishing.execution.currentAttemptId
      ? affair.attempts.find((attempt) => attempt.id === publishing.execution.currentAttemptId)
      : undefined
    const resumed = Boolean(
      publishing.draft?.platformDraftId ||
      currentAttempt?.status === 'interrupted' ||
      (currentAttempt && publishing.execution.status === 'waiting-human'),
    )
    const result = await this.webAffairService.acquireArticlePublishingAttempt(
      affair.id,
      workspaceId,
      parsed.data.bilibiliRetry,
    )
    if (!result.success) return result
    const attemptId = result.data.articlePublishing?.execution.currentAttemptId
    const attempt = attemptId
      ? result.data.attempts.find((item) => item.id === attemptId)
      : undefined
    if (!attempt) return invalid('发布 Attempt 创建失败')
    const prompt = buildAgentPrompt(result.data, attempt.id)
    try {
      return await this.launchRuntime({
        affair: result.data,
        attemptId: attempt.id,
        resumed,
        preferredBrowserTabId: resumed ? currentAttempt?.tabId : undefined,
        prompt,
        workspaceId,
        workspacePath: parsed.data.workspaceRef.path,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const eventId = stableRuntimeEventId(
        attempt.id,
        attempt.executionGeneration,
        attempt.launchOperationId,
        'launch-timeout',
      )
      await this.webAffairService.reconcileArticlePublishingRuntime({
        eventId,
        workspaceId,
        affairId: affair.id,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        launchOperationId: attempt.launchOperationId,
        source: 'launch-timeout',
        observedAt: new Date().toISOString(),
        reasonCode: 'MAIN_LAUNCH_FAILED',
        reason,
      })
      return invalid(`发布 Runtime 启动失败：${reason}；已恢复为可继续状态`)
    }
  }

  /** Read the current published page again without reopening an execution or permitting writes. */
  async verifyPublishedResult(
    rawInput: ManageArticlePublishingRuntimeInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const validated = this.resolveRuntimeCommand(rawInput, workspaceId)
    if (!validated.success) return validated
    const { affair, attempt } = validated.data
    const publishing = affair.articlePublishing!
    const manager = this.runtimeDependencies?.getBrowserManager()
    const bridge = this.runtimeDependencies?.getPlaywrightBridge()
    if (
      publishing.adapterId !== 'toutiao' ||
      publishing.publication.status !== 'published' ||
      attempt.status !== 'succeeded' ||
      !publishing.publication.url ||
      !attempt.tabId ||
      !manager ||
      !bridge
    )
      return invalid('只能重新读取已发布头条任务的原绑定页面')
    try {
      const tabId = await manager.waitForAccountView(
        rawInput.workspaceRef.kind === 'local' ? rawInput.workspaceRef.path : '',
        attempt.profileId,
        attempt.accountId,
        publishing.publication.url,
        8000,
        attempt.tabId,
      )
      if (tabId !== attempt.tabId) return invalid('已发布作品的原任务页面尚未可见')
      await bridge.ensureConnected('article_publishing_verify_published')
      await manager.ensurePlaywrightPage(tabId)
      const page = bridge.getPageById(tabId)
      const identity = manager.getViewRuntimeIdentity(tabId)
      if (!page || !identity || page.url() !== publishing.publication.url)
        return invalid('请先在原任务网页打开本篇已发布作品')
      const isCurrent = () => {
        const current = manager.getViewRuntimeIdentity(tabId)
        return (
          manager.isViewVisible(tabId) &&
          bridge.getPageById(tabId) === page &&
          !page.isClosed() &&
          page.url() === publishing.publication.url &&
          current?.webContentsId === identity.webContentsId &&
          current?.browserViewRuntimeGeneration === identity.browserViewRuntimeGeneration &&
          current?.documentGeneration === identity.documentGeneration
        )
      }
      const observed = await new PublishingAdapter().verifyBody(
        page,
        await prepareArticleBody(publishing),
      )
      if (!isCurrent() || !observed.matches)
        return invalid('公开全文或逐张图片尚未通过当前页面核验；保留原完成记录，不重新发布')
      return this.webAffairService.recordPublishedArticleImages(
        {
          ...rawInput,
          workspaceId,
          url: page.url(),
          images: observed.images.map((i) => ({
            src: i.src,
            actualSrc: i.actualSrc,
            matches: i.matches,
          })),
        },
        isCurrent,
      )
    } catch (error) {
      return invalid(error instanceof Error ? error.message : String(error))
    }
  }

  async checkRuntime(
    rawInput: ManageArticlePublishingRuntimeInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const validated = this.resolveRuntimeCommand(rawInput, workspaceId)
    if (!validated.success) return validated
    const runtime = this.activeRuntimes.get(validated.data.attempt.id)
    if (runtime) {
      await this.probeRuntime(runtime, 'user-check')
      const refreshed = this.webAffairService.getProjectSnapshot(workspaceId)
      const affair = refreshed.success
        ? refreshed.data.affairs.find((candidate) => candidate.id === rawInput.affairId)
        : undefined
      return affair ? { success: true, data: affair } : notFound('文章发布事务不存在')
    }
    return this.webAffairService.reconcileArticlePublishingRuntime({
      ...this.runtimeCommandIdentity(validated.data.attempt, workspaceId, rawInput.affairId),
      eventId: stableRuntimeEventId(
        rawInput.attemptId,
        rawInput.executionGeneration,
        rawInput.launchOperationId,
        'user-check:owner-lost',
      ),
      source: 'user-check',
      observedAt: new Date().toISOString(),
      observedStatus: 'owner-lost',
      reasonCode: 'RUNTIME_OWNER_NOT_FOUND',
      reason: '主进程未找到与当前执行代次精确匹配的 Runtime，已安全中断',
    })
  }

  async continueRuntime(
    rawInput: ManageArticlePublishingRuntimeInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const validated = this.resolveRuntimeCommand(rawInput, workspaceId)
    if (!validated.success) return validated
    const runtime = this.activeRuntimes.get(validated.data.attempt.id)
    if (!runtime || !(await this.isRuntimeHealthy(runtime))) {
      return invalid('当前 Runtime 绑定不健康，不能继续；请先核验网页现场后从中断处恢复')
    }
    if (runtime.continuationUsed) {
      return invalid('当前执行代次已经使用过一次有界继续等待；请立即核验或终止任务')
    }
    runtime.continuationUsed = true
    const now = Date.now()
    runtime.lastOwnerAt = now
    runtime.lastProgressAt = now
    try {
      const result = await this.webAffairService.reconcileArticlePublishingRuntime({
        ...this.runtimeCommandIdentity(validated.data.attempt, workspaceId, rawInput.affairId),
        eventId: stableRuntimeEventId(
          rawInput.attemptId,
          rawInput.executionGeneration,
          rawInput.launchOperationId,
          `user-continue:${now}`,
        ),
        source: 'user-check',
        observedAt: new Date(now).toISOString(),
        observedStatus: 'healthy',
        reasonCode: 'USER_CONTINUE_CONFIRMED',
        reason: '用户确认继续等待，主进程已复核当前 Runtime 绑定健康',
      })
      if (!result.success) runtime.continuationUsed = false
      return result
    } catch (error) {
      runtime.continuationUsed = false
      throw error
    }
  }

  async terminateRuntime(
    rawInput: ManageArticlePublishingRuntimeInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const validated = this.resolveRuntimeCommand(rawInput, workspaceId)
    if (!validated.success) return validated
    const runtime = this.activeRuntimes.get(validated.data.attempt.id)
    if (runtime) {
      const agentBridge = this.runtimeDependencies?.getAgentBridge()
      const browserTaskRuntime = this.runtimeDependencies?.getBrowserTaskRuntime()
      try {
        browserTaskRuntime?.cancelTask(runtime.browserTaskRunId)
      } catch {
        // Runtime 可能已经先结束；持久终止仍由下方统一 reducer 完成。
      }
      // BrowserTask is already fenced synchronously. Persist the publishing stop
      // independently of the Agent cancellation receipt (which may wait on its store).
      // Agent process termination remains owned and reported by AgentBridge.
      void agentBridge?.abort(runtime.conversationId, runtime.agentRunId).catch(() => {
        console.warn('[ArticlePublishing] 发布写入已停止，Agent 取消请求尚未确认', {
          affairId: runtime.affairId,
          attemptId: runtime.attemptId,
          executionGeneration: runtime.executionGeneration,
          agentRunId: runtime.agentRunId,
        })
      })
      this.activeRuntimes.delete(runtime.attemptId)
    }
    return this.webAffairService.reconcileArticlePublishingRuntime({
      ...this.runtimeCommandIdentity(validated.data.attempt, workspaceId, rawInput.affairId),
      eventId: stableRuntimeEventId(
        rawInput.attemptId,
        rawInput.executionGeneration,
        rawInput.launchOperationId,
        'user-cancel',
      ),
      source: 'user-cancel',
      observedAt: new Date().toISOString(),
      observedStatus: 'cancelled',
      reasonCode: 'USER_CANCELLED',
      reason: '用户已终止当前发布任务',
    })
  }

  async resolveAsset(
    rawInput: ResolveArticlePublishingAssetInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const parsed = resolveArticlePublishingAssetInputSchema.safeParse(rawInput)
    if (!parsed.success || parsed.data.workspaceRef.kind !== 'local') {
      return invalid('图片人工确认参数无效')
    }
    const snapshot = this.webAffairService.getProjectSnapshot(workspaceId)
    const affair = snapshot.success
      ? snapshot.data.affairs.find((a) => a.id === parsed.data.affairId)
      : undefined
    const state = affair?.articlePublishing
    const workspacePath = parsed.data.workspaceRef.path
    if (state?.adapterId === 'bilibili' && parsed.data.resolution === 'missing') {
      const attempt = affair?.attempts.find((a) => a.id === state.execution.currentAttemptId)
      const manager = this.runtimeDependencies?.getBrowserManager()
      const bridge = this.runtimeDependencies?.getPlaywrightBridge()
      const tabId = attempt?.tabId
      const page = tabId ? bridge?.getPageById(tabId) : undefined
      if (
        !page ||
        !attempt ||
        !tabId ||
        !manager?.isViewVisible(tabId) ||
        manager.getViewProfileId(tabId) !== attempt.profileId ||
        manager.getViewAccountId(tabId) !== state.accountId ||
        manager.getViewWorkspaceKey(tabId) !== workspacePath ||
        state.publication.status !== 'not-started' ||
        state.execution.currentStepId !== 'upload-assets'
      )
        return invalid('必须在原账号的可见空白编辑器核验缺图，且不能存在发布动作')
      const probe = await new PublishingAdapter().probe(page)
      if (!isEmptyBilibiliComposer(probe, state.composer?.platformAccountId))
        return invalid('B站编辑器仍有内容或无法完整核验，不能把首图标记为缺失')
    }
    let observation: { platformUrl: string; isCurrent: () => boolean } | undefined
    if (state && state.adapterId !== 'csdn' && parsed.data.resolution === 'present') {
      const attempt = affair?.attempts.find((a) => a.id === state.execution.currentAttemptId)
      const manager = this.runtimeDependencies?.getBrowserManager()
      const bridge = this.runtimeDependencies?.getPlaywrightBridge()
      const tabId =
        attempt?.tabId ?? manager?.getActiveViewIdForWorkspace(parsed.data.workspaceRef.path)
      const page = tabId ? bridge?.getPageById(tabId) : undefined
      if (
        !page ||
        !attempt ||
        !tabId ||
        !manager?.isViewVisible(tabId) ||
        manager.getViewProfileId(tabId) !== attempt.profileId ||
        manager.getViewAccountId(tabId) !== state.accountId ||
        manager.getViewWorkspaceKey(tabId) !== parsed.data.workspaceRef.path
      )
        return invalid('请打开本任务原稿后再确认图片')
      const adapter = new PublishingAdapter()
      const generation = adapter.documentGeneration(page)
      const probe = await adapter.probe(page)
      const selected = state.assets.find((a) => a.id === parsed.data.assetId)
      const importingExisting =
        ['xiaohongshu', 'toutiao'].includes(state.adapterId) &&
        selected?.status === 'pending' &&
        selected.uploadAttempts.length === 0 &&
        state.draft?.recovery?.status === 'verified'
      const liveGallery =
        importingExisting && state.adapterId === 'xiaohongshu'
          ? await readXiaohongshuEditor(page)
          : undefined
      const importingToutiao = importingExisting && state.adapterId === 'toutiao'
      const position = state.assets.findIndex((a) => a.id === selected?.id)
      const unknown = state.assets.filter((a) =>
        ['result-unknown', 'reconciling'].includes(a.status),
      )
      const unassigned = probe.editor.images.filter(
        (i, index) =>
          i.loaded &&
          !state.assets.some((a) => a.platformUrl === i.src) &&
          (!importingToutiao || index === position),
      )
      if (
        probe.draftId !== state.draft?.platformDraftId ||
        probe.platformAccountId !== state.draft?.platformAccountId ||
        probe.title.value !== state.fields.title ||
        probe.saveState !== 'saved' ||
        (importingToutiao
          ? !['waiting-human', 'interrupted'].includes(state.execution.status) ||
            !probe.editor.imageEnumerationComplete ||
            state.assets.some((a) => a.kind !== 'local' || a.occurrences.length !== 1) ||
            probe.editor.images.length !== state.assets.length ||
            new Set(probe.editor.images.map((i) => i.src)).size !== state.assets.length ||
            state.assets.some(
              (a, index) => a.platformUrl && a.platformUrl !== probe.editor.images[index]?.src,
            )
          : importingExisting
            ? !liveGallery?.images.some(
                (img) =>
                  img.loaded &&
                  img.name === selected?.sourcePath.split('/').at(-1) &&
                  unassigned.some(
                    (u) => u.src === `https://sns-creator-preview.xhscdn.com/${img.fileId}`,
                  ),
              )
            : unknown.length !== 1 || unknown[0].id !== parsed.data.assetId) ||
        unassigned.length !== 1
      )
        return invalid('原稿或图片无法唯一对应，请保留现场；不会猜测图片地址')
      observation = {
        platformUrl: unassigned[0].src,
        isCurrent: () => {
          const current = this.webAffairService.getProjectSnapshot(workspaceId)
          const now = current.success
            ? current.data.affairs.find((a) => a.id === affair?.id)?.articlePublishing
            : undefined
          return Boolean(
            now?.execution.currentGeneration === state.execution.currentGeneration &&
            page.url() === probe.url &&
            adapter.documentGeneration(page) === generation &&
            bridge?.getPageById(tabId) === page &&
            manager.isViewVisible(tabId) &&
            manager.getViewProfileId(tabId) === attempt.profileId &&
            manager.getViewAccountId(tabId) === state.accountId &&
            manager.getViewWorkspaceKey(tabId) === workspacePath,
          )
        },
      }
    }
    return this.webAffairService.resolveArticlePublishingAsset(
      parsed.data.affairId,
      parsed.data.assetId,
      parsed.data.resolution,
      workspaceId,
      observation,
    )
  }

  private resolveRuntimeCommand(
    rawInput: ManageArticlePublishingRuntimeInput,
    workspaceId: string,
  ): WebAffairOperationResult<{ affair: WebAffair; attempt: WebAffair['attempts'][number] }> {
    const parsed = manageArticlePublishingRuntimeInputSchema.safeParse(rawInput)
    if (!parsed.success) return invalid('文章发布 Runtime 命令参数无效')
    const snapshot = this.webAffairService.getProjectSnapshot(workspaceId)
    if (!snapshot.success) return snapshot
    const affair = snapshot.data.affairs.find((candidate) => candidate.id === parsed.data.affairId)
    const attempt = affair?.attempts.find((candidate) => candidate.id === parsed.data.attemptId)
    if (!affair?.articlePublishing || !attempt) return notFound('文章发布 Attempt 不存在')
    if (
      attempt.executionGeneration !== parsed.data.executionGeneration ||
      attempt.launchOperationId !== parsed.data.launchOperationId ||
      affair.articlePublishing.execution.currentAttemptId !== attempt.id
    ) {
      return invalid('页面中的执行代次已经过期，请刷新后重试')
    }
    return { success: true, data: { affair, attempt } }
  }

  private runtimeCommandIdentity(
    attempt: WebAffair['attempts'][number],
    workspaceId: string,
    affairId: string,
  ) {
    return {
      workspaceId,
      affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
    }
  }

  private async isRuntimeHealthy(runtime: ActivePublishingRuntime): Promise<boolean> {
    const agentBridge = this.runtimeDependencies?.getAgentBridge()
    const browserManager = this.runtimeDependencies?.getBrowserManager()
    const browserTaskRuntime = this.runtimeDependencies?.getBrowserTaskRuntime()
    const playwrightBridge = this.runtimeDependencies?.getPlaywrightBridge()
    if (!agentBridge || !browserManager || !browserTaskRuntime || !playwrightBridge) return false
    const agent = agentBridge.getRunStatus(runtime.conversationId, runtime.agentRunId)
    const agentIdentity = agentBridge.getRuntimeIdentity(runtime.conversationId)
    const task = browserTaskRuntime.getTask(runtime.browserTaskRunId)
    const view = browserManager.getViewRuntimeIdentity(runtime.tabId)
    const page = playwrightBridge.getPageBindingIdentity(runtime.tabId)
    return Boolean(
      agent?.status === 'running' &&
      agentIdentity.agentRuntimeEpoch === runtime.agentRuntimeEpoch &&
      agentIdentity.agentRuntimeBindingKey === runtime.agentRuntimeBindingKey &&
      task?.status === 'running' &&
      task.correlation?.affairExecutionGeneration === runtime.executionGeneration &&
      task.correlation?.affairLaunchOperationId === runtime.launchOperationId &&
      view?.browserViewRuntimeGeneration === runtime.browserViewRuntimeGeneration &&
      view.webContentsId === runtime.webContentsId &&
      page?.generation === runtime.playwrightPageBindingGeneration &&
      page.webContentsId === runtime.webContentsId &&
      playwrightBridge.isConnected() &&
      playwrightBridge.getConnectionGeneration() === runtime.playwrightConnectionGeneration,
    )
  }

  private async buildPreview(
    markdownPath: string,
    workspacePath: string,
  ): Promise<ArticlePublishingSourcePreview> {
    if (!/\.(?:md|markdown)$/iu.test(markdownPath)) throw new Error('只支持 Markdown 文件')
    const [realWorkspacePath, realMarkdownPath] = await Promise.all([
      this.resolveRealPath(workspacePath),
      this.resolveRealPath(markdownPath),
    ])
    if (!isPathWithin(realWorkspacePath, realMarkdownPath)) {
      throw new Error('Markdown 必须位于当前工作空间内')
    }
    const snapshot = await this.fileService.readTextDocument(realMarkdownPath)
    if (snapshot.size > MAX_SOURCE_BYTES) throw new Error('Markdown 超过 10MB 限制')
    const blockers: string[] = []
    const warnings: string[] = []
    const byIdentity = new Map<string, ArticlePublishingAsset>()
    for (const reference of collectImageReferences(snapshot.content)) {
      if (isExternalMarkdownDestination(reference.destination)) {
        const current = byIdentity.get(`remote:${reference.destination}`)
        const occurrence = { start: reference.start, end: reference.end, alt: reference.alt }
        if (current) current.occurrences.push(occurrence)
        else {
          byIdentity.set(`remote:${reference.destination}`, {
            id: `remote:${reference.destination}`,
            kind: 'remote',
            sourcePath: reference.destination,
            displayPath: reference.destination,
            occurrences: [occurrence],
            status: 'uploaded',
            platformUrl: reference.destination,
            uploadAttempts: [],
          })
        }
        warnings.push(`外链图片不会转存：${reference.destination}`)
        continue
      }
      const rawPath = splitMarkdownDestinationSuffix(reference.destination).path
      const absolutePath = resolve(dirname(realMarkdownPath), decodeMarkdownPath(rawPath))
      const extension = extname(absolutePath).toLowerCase()
      const mediaType = SUPPORTED_IMAGE_TYPES.get(extension)
      if (!mediaType) {
        blockers.push(`不支持的图片格式：${rawPath}`)
        continue
      }
      try {
        const realAssetPath = await this.resolveRealPath(absolutePath)
        if (!isPathWithin(realWorkspacePath, realAssetPath)) {
          blockers.push(`图片超出当前工作空间：${rawPath}`)
          continue
        }
        const metadata = await this.fileService.stat(realAssetPath)
        if (metadata.type !== 'file') throw new Error('图片路径不是文件')
        if (metadata.size > MAX_IMAGE_BYTES) {
          blockers.push(`图片超过 20MB：${rawPath}`)
          continue
        }
        const identity = `local:${realAssetPath}`
        const occurrence = { start: reference.start, end: reference.end, alt: reference.alt }
        const current = byIdentity.get(identity)
        if (current) current.occurrences.push(occurrence)
        else {
          byIdentity.set(identity, {
            id: `local:${relative(realWorkspacePath, realAssetPath)}`,
            kind: 'local',
            sourcePath: realAssetPath,
            displayPath:
              relative(dirname(realMarkdownPath), realAssetPath) || basename(realAssetPath),
            mediaType,
            size: metadata.size,
            modifiedAt: metadata.modifiedAt,
            occurrences: [occurrence],
            status: 'pending',
            uploadAttempts: [],
          })
        }
      } catch (error) {
        blockers.push(
          `图片不可用：${rawPath}（${error instanceof Error ? error.message : String(error)}）`,
        )
      }
    }
    return {
      source: {
        markdownPath: snapshot.path,
        modifiedAt: snapshot.modifiedAt,
        size: snapshot.size,
      },
      title: extractTitle(snapshot.content, markdownPath),
      summary: extractSummary(snapshot.content),
      assets: [...byIdentity.values()],
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
    }
  }
}

function collectImageReferences(markdown: string): ImageReference[] {
  const references: ImageReference[] = collectMarkdownDestinations(markdown)
    .filter((destination) => destination.image)
    .map((destination) => ({
      destination: destination.value,
      start: destination.start,
      end: destination.end,
      alt: extractInlineAlt(markdown, destination.start),
    }))
  const definitions = new Map<string, string>()
  for (const match of markdown.matchAll(
    /^ {0,3}\[([^\n\x5d]+)\]:\s*(?:<([^>\n]+)>|([^\s\n]+))/gimu,
  )) {
    definitions.set(match[1].trim().toLowerCase(), match[2] ?? match[3] ?? '')
  }
  for (const match of markdown.matchAll(/!\[([^\n\x5d]*)\]\[([^\n\x5d]+)\]/gu)) {
    const destination = definitions.get(match[2].trim().toLowerCase())
    if (!destination) continue
    references.push({
      destination,
      start: match.index,
      end: match.index + match[0].length,
      alt: match[1],
    })
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu)) {
    const alt = /\balt\s*=\s*["']([^"']*)["']/iu.exec(match[0])?.[1] ?? ''
    references.push({
      destination: match[1],
      start: match.index,
      end: match.index + match[0].length,
      alt,
    })
  }
  return references.sort((left, right) => left.start - right.start)
}

function extractInlineAlt(markdown: string, destinationStart: number): string {
  const prefix = markdown.slice(Math.max(0, destinationStart - 1_000), destinationStart)
  return /!\[([^\n\x5d]*)\]\(\s*(?:<)?[^\n]*$/u.exec(prefix)?.[1] ?? ''
}

function extractTitle(markdown: string, markdownPath: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/u.exec(markdown)?.[1]
  const frontmatterTitle = frontmatter
    ? /^title:\s*["']?(.+?)["']?\s*$/imu.exec(frontmatter)?.[1]?.trim()
    : undefined
  const heading = /^#\s+(.+)$/mu.exec(markdown)?.[1]?.trim()
  return frontmatterTitle || heading || basename(markdownPath).replace(/\.(?:md|markdown)$/iu, '')
}

function extractSummary(markdown: string): string {
  const body = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u, '')
  return (
    body
      .split(/\n\s*\n/u)
      .map((paragraph) =>
        paragraph
          .replace(/^#+\s+/u, '')
          .replace(/!\[[^\x5d]*\]\([^)]*\)/gu, '')
          .trim(),
      )
      .find((paragraph) => paragraph && !paragraph.startsWith('```')) ?? ''
  ).slice(0, 500)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
    timeout.unref?.()
    void promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  )
}

function buildAgentPrompt(
  affair: import('../../shared/web-affairs/web-affair-types').WebAffair,
  attemptId: string,
): string {
  const publishing = affair.articlePublishing!
  const localAssets = publishing.assets.filter((asset) => asset.kind === 'local')
  if (publishing.adapterId === 'toutiao')
    return [
      '执行用户授权的头条微头条原稿任务，使用绑定原账号原 draftId，不新建、不重复上传或提交。',
      `affairId=${affair.id}; attemptId=${attemptId}; accountId=${publishing.accountId}; draftId=${publishing.draft?.platformDraftId}`,
      `sourceMarkdownPath=${publishing.source.markdownPath}`,
      '先 web_affair_get，再 article_publishing_inspect_page。只使用主进程签发的当前 selectors；禁止 evaluate、网络日志、shell、坐标或猜控件。',
      '主进程已持久且当前 matchedAssets 已复核的原图对应关系，无需重新要求用户确认。每个检查点分别 running、重新 inspect、verifying、重新 inspect、completed；以返回的新 currentStepId 继续。已有 uploaded 图片且 matchedAssets 对应齐全时完成 upload-assets；bodyMatchesFrozen=true 时不重填，完成 fill-body；标题一致时完成 fill-fields；saveState=saved 且正文图集一致时不重复保存，完成 save-draft。不可因之后的配乐尚未处理而提前停止这些已能核验的步骤。',
      '原稿保存由 Studio 比较平台回读的全文、draftId 和逐图地址，不由你报告成功。已在其他平台发布，不得声明头条首发。配乐在重新加载后可能重置，必须在最后保存之后、提交之前重新核验。作品声明不得代用户选择。',
      '到 publish 检查点，若 inspect 签发 selectors.disableMusic，先按需 click selectors.dismissAssistant 关闭遮挡，再重新 inspect 并 click 最新 selectors.disableMusic 一次，随后 inspect 回读 checked=false；不重复切换，不沿用旧 selector。没有 selectors.publish 时停止并报告其具体原因，不绕过主进程。',
      '已有图集但未关联冻结原图时，不能猜 matchedAssets 或重复上传。在 publish 且配乐已关闭后，只 click 最新 inspect.selectors.publish 一次。工具返回结果未知时，只 inspect 当前结果及读取页面，不得重发；保留主进程记录的实际响应证据。只有公开结果实际核验通过才能完成任务。当前步骤确实缺证据时报告 waiting-human，error={code:"toutiao_evidence_missing",message:"inspect 返回的具体缺口"}；不绕过工具限制。',
      '检查点按 currentStepId 串行 running→verifying→completed；只有主进程实际证据通过才完成。保存不是发布，未知提交只能核验，不得再次点击发布。',
    ].join('\n')
  if (publishing.adapterId === 'bilibili')
    return [
      hasBilibiliRetryAuthorization(publishing)
        ? '用户已明确接受可能重复，另行授权本任务同一冻结原稿重建并提交一次。旧publication仍结果未知，不能将它报告未发送；本次仅按main新代次签发的控件执行，失败不能自行重试。'
        : '执行 B站图文动态准备及单篇授权发布，不能重复发送；只按 main 当前步骤执行。',
      `affairId=${affair.id}; attemptId=${attemptId}; accountId=${publishing.accountId}; targetUID=${publishing.composer?.platformAccountId}`,
      `sourceMarkdownPath=${publishing.source.markdownPath}`,
      '先 web_affair_get，再 article_publishing_inspect_page；只使用当前 inspect 返回的 selector。检查点 pending→running→verifying→completed 必须串行；已完成不重做。每次动作前和报告前重新 inspect。',
      'upload-assets：每张图单独 uploading→browser_upload_file(selector=selectors.fileInput,paths=[该张冻结文件])→waiting-platform→verifying→inspect 匹配后 uploaded。fileInput 是 Studio 核验过的 B站图标上传入口，工具接管文件选择器；禁止先 browser_click 它、手选文件或重复上传未知结果。',
      'fill-body 使用 browser_fill(selectors.body)，由 main 注入冻结正文，标题单独在 fill-fields 填写 selectors.title。不写 Markdown 图片语法。正文和逐图必须由 main 实际核验。',
      '没有持久草稿，save-draft 只做同 UID、当前正文和逐图复核；不得伪造保存或草稿ID。',
      'fill-fields 填写独立标题后，若 bilibiliVisibility=unknown，click 当前 selectors.openPublishSettings 后重新 inspect，再按最新 selector 展开可见范围，直到 main 读到 public。不得点击选项改变可见范围；private 或缺少入口则报告具体阻塞。',
      '仅到 publish 检查点时：尚无 selectors.publish 或 submissionUnavailableReason 非空，说明发布适配尚未通过；报告 waiting-human 并附 error={code:"bilibili_submission_unavailable",message:实际原因} 后结束。之前按顺序完成准备步骤，不得自行寻找或点击发布。',
      '禁止 evaluate、shell、网络工具、猜URL/selector。遇到具体失败报告一次后结束，不擅自重建或重绑重试。',
    ].join('\n')
  if (publishing.adapterId === 'weibo')
    return [
      publishing.composer?.allowPublish
        ? '执行用户授权的微博单篇图文任务，只允许提交一次；结果未知不重发。'
        : '执行微博图文准备任务；本任务禁止提交，不得点击发送，也不得建议用户发送这篇已发布的验收稿。',
      `affairId=${affair.id}; attemptId=${attemptId}; accountId=${publishing.accountId}; targetUID=${publishing.composer?.platformAccountId}`,
      `sourceMarkdownPath=${publishing.source.markdownPath}`,
      '先 web_affair_get，再 article_publishing_inspect_page；按主进程 currentStepId 顺序执行。每次动作和回报前重新 inspect，只用 main 返回的 selector，不猜选择器、不使用 evaluate、shell、网络日志或鼠标坐标。',
      '检查点状态回报必须串行：pending→running→verifying→completed；每次成功返回后读取新的 currentStepId，不能并行回报两个检查点，也不能 running 直接 completed。已完成的检查点不回报、不重做。',
      '恢复后图片为 reconciling 时，只有最新 inspect 已完整枚举且主进程证实未派发的缺失图片才可报告 uploading，并附 evidence 说明当前缺失。已有上传地址或未知派发结果禁止重试。selector 必须逐字复制最近一次 inspect 的 selectors.fileInput，不复制 bodySelector 或旧调用参数。',
      'upload-assets：没有 fileInput 但有 selectors.imageOpen 时可先点击一次图片入口，再 inspect。每张冻结图片先报告 uploading，向 selectors.fileInput 上传一个文件，再报告 waiting-platform/verifying；main 后置核验唯一新增图片；inspect 的 matchedAssets 一致才报告 uploaded。没有签发控件则停止，不重复上传。',
      'fill-body：browser_fill 使用 selectors.body，main 注入冻结正文，保留首行标题，图片独立图集。不得自己改写正文。',
      'fill-fields 只回读首行标题。save-draft 在此平台表示当前图文的提交前复核，不是保存；不点击保存，不伪造 draftId 或 saved。主进程会逐图核验当前现场。',
      publishing.composer?.allowPublish
        ? '到 publish 时最新 inspect 必须证明正文、逐图、公开设置通过；只 click selectors.publish 一次。主进程绑定本次准确图文请求的回执，inspect.publishedLinks 返回本次作品地址。browser_navigate 该地址，再 inspect 核验 UID、作品 ID、全文和每张图片。公开页核验后完成 publish，然后 verify-publication completed 携带 outputRefs={publicationUrl:inspect.url}；最后 finish_attempt(outcome=succeeded,url=inspect.url)。没有回执、审核中、正文或图片不符均 waiting-human，绝不能再次发送。'
        : '准备步骤完成后到 publish 报告 waiting-human，原因=本任务未授权提交，当前只准备不发送。然后结束本次运行，不能回报发布成功，也不要引导用户手动重发。',
      '报告 failed / waiting-human 必须传 error={code:"weibo_preparation_blocked",message:"实际卡点"}，evidence 只补充观察事实。inspect 已给出内容或权限卡点后不重复截图、提取或猜测；一次正确的失败或等待回报后结束，不调用 finish_attempt(succeeded)。',
    ].join('\n')
  if (publishing.adapterId === 'xiaohongshu')
    return [
      '执行小红书单篇图文任务，复用绑定原账号原本地草稿，不新建、不重复提交。',
      `affairId=${affair.id}; attemptId=${attemptId}; accountId=${publishing.accountId}`,
      `sourceMarkdownPath=${publishing.source.markdownPath}`,
      '先 web_affair_get，再 article_publishing_inspect_page；每次动作前和回报前重新 inspect，只用 main 签发的 selector。按 currentStepId 顺序 running → verifying → completed；inspect 可能推进步骤，重新读取再继续。',
      'Studio 从草稿箱的图文笔记分类恢复精确 draftId，并核对 UID、标题、本地保存全文及图集。登录失效、原稿不唯一或 ID 不符必须停住。',
      '小红书图集与正文分开：每张图报告 uploading，向 selectors.fileInput 上传一个冻结文件，报告 waiting-platform/verifying；main 等待真实上传并回读同一平台本地草稿，核验 fileId、尺寸及加载后才报告 uploaded。结果未知不重复上传；已有未归属图片先报告需要用户核对，不能猜对应关系。',
      'fill-body 使用 browser_fill(selector=selectors.body,value=原 Markdown)，main 去掉标题和图片标记，只填写冻结正文；保持三张图集顺序。禁止 browser_evaluate、操作平台内部 store 或猜按钮。',
      'fill-fields 只核对冻结标题；不代用户勾选原创或版权声明。平台自动保存到本机草稿库，已保存时无需点击暂存离开；只有 inspect.saveState=saved 且原账号、原稿、全文、逐图一致才能完成 save-draft。',
      'publish 只点击 selectors.publish 一次；缺少授权、出现声明、验证码或未识别弹窗时报告具体原因并等待用户。暂存离开绝不是发布。',
      '提交后从 inspect.publishedLinks 读取主进程绑定本次回执的作品链接，完成 publish 检查点后 browser_navigate 打开该链接，再 inspect 核验原账号、作品 ID、正文和逐图。不得按同名标题猜作品。',
      'result-unknown 不得再次发布。缺少平台结果或图文核验时不得回报 succeeded；出现审核中/未通过据实报告。verify-publication completed 必须携带 outputRefs={publicationUrl:inspect.url}，最后 web_affair_finish_attempt(outcome=succeeded,url=inspect.url)。',
    ].join('\n')
  if (publishing.adapterId === 'juejin')
    return [
      '执行用户授权的掘金单篇三图文章发布，复用绑定的原账号原稿，不新建、不重复提交。',
      `affairId=${affair.id}; attemptId=${attemptId}; accountId=${publishing.accountId}`,
      `sourceMarkdownPath=${publishing.source.markdownPath}`,
      '先 web_affair_get，再 article_publishing_inspect_page；每个动作前和回报前重新 inspect，只使用 main 返回的 selector。按 currentStepId 顺序 running → verifying → completed；inspect 可能推进步骤，每次重新读当前步骤。',
      '单图次数以 asset.uploadAttempts 数组长度为准；sideEffect.targetId 中的 attempt 编号不是已尝试次数。上限仍为三次，不得改状态绕过。',
      '每张本地图片：报告 uploading，向 selectors.fileInput 上传一个冻结文件，报告 waiting-platform/verifying，inspect 的 matchedAssets 对应地址确认后才报告 uploaded。不要打开系统文件选择器，不重复上传结果未知图片。',
      'fill-body 调 browser_fill(selector=selectors.body,value=原 Markdown)，main 注入冻结全文和已核验图片。不要操作 DOM 或调用 browser_evaluate。正文及每张图位置通过且 saved 才完成。',
      'fill-fields：有 selectors.openPublishSettings 时先点击打开字段面板，这不是提交。标题/摘要不同时 fill 对应 selector；分类不同时 click selectors.category；标签不同时 fill tagEditor.inputSelector=冻结标签，再 inspect 后 click selectors.tags。所有已匹配字段不重写。',
      'save-draft 等待 inspect.saveState=saved，并再次核对所有冻结字段。',
      'publish：如需要先点击 selectors.openPublishSettings，再 inspect；只点击 selectors.publish（确定并发布）一次。出现验证码、声明或未知弹窗停住并报具体原因，不猜测下一按钮。',
      '发布后只核验，禁止重复发布；通过 inspect.publishedLinks 或实际公开页核验原账号、原文、三图。结果未知只查，不能重发。',
      'verify-publication 完成必须携带 outputRefs={publicationUrl:inspect.url}，最后 web_affair_finish_attempt(outcome=succeeded,url=inspect.url,summary=真实结果)。保存不能当发布成功。',
    ].join('\n')
  if (publishing.adapterId === 'zhihu')
    return [
      '执行用户已授权的知乎单篇图文提交。使用当前绑定原稿，不新建、不换账号。',
      `affairId=${affair.id}; attemptId=${attemptId}; accountId=${publishing.accountId}`,
      `sourceMarkdownPath=${publishing.source.markdownPath}`,
      '先 web_affair_get，再 article_publishing_inspect_page。每次动作前和完成回报前重新 inspect，只使用适配器签发的唯一 selector。',
      '按 currentStepId 顺序执行。检查点 running → verifying → completed；inspect 可能自动推进，继续前重新读取当前步骤。已经完成的步骤不得重报或倒退。',
      '原稿管理页恢复与账号、标题、draftId、保存核验由 Studio 执行；缺失证据必须停止，不猜测 selector。',
      '每张本地图片：报告 uploading，向 selectors.fileInput 上传该冻结文件，报告 waiting-platform/verifying，再 inspect 读取 matchedAssets[assetId] 后报告 uploaded。fileInput 已提供就直接上传，不点击图片按钮弹出系统选择器。上传结果未知只核验，不重复上传。',
      '全部图片上传后，fill-body 使用 browser_fill(selector=selectors.body,value=原 Markdown)。Studio 会在派发边界把冻结全文与已核验的平台图片送入知乎正文编辑器，保持图片位置。不要自行 browser_evaluate 或操作 DOM。',
      '若 inspect.bodyMatchesFrozen=true 且 saveState=saved，直接核验完成，不重写正文。知乎没有显式保存按钮，必须等待 inspect.saveState=saved，不能把字数非零当保存成功。',
      'fill-fields 只核验冻结标题；保持现有无声明，不代用户作原创、版权等声明。保存回读通过后完成 save-draft。',
      'publish 时只点击 inspect.selectors.publish 一次。出现声明、验证码、风控或未知弹窗立即报告具体卡点，不猜下一按钮。',
      '提交后只读核验：打开 inspect.publishedLinks 中与原稿 ID 一致的文章链接，inspect 核对账号、ID、标题、正文及三图。publicationBlocker 非空则报告等待原因，不能回报发布成功。',
      '若 publication.status=result-unknown 或 dispatched/verifying，只允许核验，禁止再次发布。全部真实证据通过后回报 article_publishing_report_checkpoint(stepId=verify-publication,status=verifying)，再回报 completed，completed 必须携带 outputRefs={publicationUrl:inspect.url}。最后 web_affair_finish_attempt(outcome=succeeded,url=inspect.url,summary=真实核验结果)。缺少 outputRefs.publicationUrl 不能完成结果核验。',
    ].join('\n')
  const currentStep =
    publishing.checkpoints.find(
      (checkpoint) => checkpoint.stepId === publishing.execution.currentStepId,
    ) ?? publishing.checkpoints.find((checkpoint) => checkpoint.status !== 'completed')
  const resultVerificationOnly =
    publishing.publication.status === 'result-unknown' ||
    publishing.execution.currentStepId === 'verify-publication'
  return [
    `执行一条已由用户在 Studio 明确启动的 CSDN 单篇文章发布事务。`,
    `affairId=${affair.id}`,
    `attemptId=${attemptId}`,
    `accountId=${publishing.accountId}`,
    `sourceMarkdownPath=${publishing.source.markdownPath}`,
    `从检查点 ${currentStep?.stepId ?? 'verify-publication'} 开始；已完成检查点和已核验图片不得重放。`,
    ...(resultVerificationOnly
      ? [
          `本次只允许读取页面并核验既有发布结果；禁止填写、上传、保存或再次点击发布。找到现有文章后只回写 URL 和证据。`,
        ]
      : []),
    `main 已把可见账号页、Agent Run 和 BrowserTask 精确绑定到本次执行代次；禁止另开账号页。先调用 web_affair_get 读取冻结状态。`,
    `每个检查点开始和成功回报前都调用 article_publishing_inspect_page；只使用 csdn@1 返回的唯一 selector 和页面证据。适配器返回 unsupported 或没有 selector 时立即转人工，禁止自行枚举或猜测 CSDN selector。`,
    `若 inspect 返回 selectors.dismissAssistant，先用 browser_click 点击它收起挡住编辑器的 CSDN AI 助手，再重新 inspect；不要进入 AI Chat iframe，不用强制点击或猜测关闭按钮。`,
    `open-editor 必须取得本任务 draftId 和已保存证据才完成。全新空白编辑器没有 draftId 时：先用 browser_fill 向 selectors.title 填写冻结标题；重新 inspect；再用 browser_frame_execute（frameAction=fill）向签发的正文 iframe 填写冻结标题 trim 后的前 10 个字符作为建稿占位；重新 inspect；最后 browser_click 点击 selectors.save 一次。CSDN 保存要求正文非空，该短占位低于自动保存阈值，不算 fill-body 完成。主进程记录真实保存响应中的编号并从草稿箱找回同稿；之后重新 inspect。禁止新建第二份或跳过 open-editor；后续 fill-body 必须用完整原文替换占位。`,
    `检查点状态按 running → verifying → completed 回报，不能从 running 直接 completed。恢复时先读当前状态，已 completed 的步骤不得退回或重报。`,
    `若 inspect 返回 editor.bodyFrameSelector，正文只用 browser_frame_execute，frameAction=fill，frameSelector=该值，selector=selectors.body；不得操作旁边的 AI Chat iframe。保存按钮不代表已保存，必须读回 saveState=saved 后才能报告保存完成。`,
    `核对已有正文时，使用 browser_frame_content，frameSelector=inspect 返回的 editor.bodyFrameSelector，selector=selectors.body，读取正文文本与源 Markdown 比对；不要猜 frameUrl/frameName，iframe 可能没有独立 URL。不要使用 browser_evaluate，不要把 bodyTextLength 非零当成完整正文证据；已有完整正文无需重填。若 inspect.bodyMatchesFrozen=true 且 saveState=saved，Studio 已完成正文和逐图位置核验，直接继续检查点核验，不重复填写。`,
    `fill-fields 若 inspect 返回 tagEditor：先点击 openSelector，重新 inspect；用 browser_fill 在 inputSelector 填入一个尚缺失的冻结 tags 值，再 inspect；用 browser_press（selector=inputSelector,key=Enter）提交这个标签，再 inspect 核验 fieldValues.tags。输入框里的搜索词不算已添加标签；不得用无目标的 browser_press_key。`,
    '若 inspect 返回 selectors.dismissTagEditor 且冻结标签已经全部匹配，用 browser_click 点击该唯一关闭按钮，再 inspect 确认面板关闭后继续保存或发布，避免下拉层挡住按钮。不要使用无目标 Escape。',
    `每次 inspect 可能由 main 推进检查点。inspect 后先读取 web_affair_get 的 currentStepId/current operation，再选择动作，不回报旧检查点。`,
    `图片共有 ${localAssets.length} 张。每张上传必须依次报告 uploading、waiting-platform、verifying；只有重新读取编辑器取得平台 URL 和页面证据后才能报告 uploaded。`,
    `正文图片使用 selectors.imageOpen 打开图片上传面板，重新 inspect 后向 selectors.fileInput 单次上传一个冻结文件；封面和反馈上传框不属于正文。上传返回后重新 inspect，从 matchedAssets[assetId] 读取主进程观察到的平台地址，不能自行挑选另一张图片 URL。主进程会核验该文件上传后唯一新增且已加载的图片。`,
    `有图片的 fill-body 仍使用 browser_frame_execute(frameAction=fill) 向签发正文区域填写原 Markdown；Studio 将使用冻结原文件及已核验图片地址写入格式化正文，逐图验证原文位置、顺序、替代文字和加载，再读回服务端保存。不可另行 browser_evaluate、粘贴图片或更换编辑器。`,
    `文章发布动作由主进程根据当前事务、步骤、账号、页面和适配器三态核验；普通“确认上传”和已授权的单篇常规发布可继续，人工专属或未知动作会自动暂停。`,
    `单图最多 3 次安全尝试；派发后结果不明必须报告 result-unknown 并先对账，禁止盲目重复上传。`,
    `验证码、风控、法律/版权声明、账号或内容不一致、未知页面必须暂停给用户。`,
    'inspect.publicationBlocker 是平台状态栏的真实阻塞；审核未通过、审核中或仅自己可见都不得回报成功。调用 article_publishing_report_checkpoint 将 verify-publication 设为 waiting-human，error={code:"PLATFORM_REVIEW_BLOCKED",message:该平台原因}，携带当前页面证据转人工，保留已派发记录，不重发、不擅自改文或申诉。',
    `verify-publication 是 Agent 必须自动执行的只读核验，不要求用户确认。成功页不是核验终点：用 browser_navigate 打开 inspect.publishedLinks 中匹配当前账号和原稿 ID 的唯一文章链接，再 inspect 核对 published-article、账号、标题和 URL；可信证据齐全后回报 checkpoint verifying/completed 和 web_affair_finish_attempt(outcome=succeeded, url=actual URL)。审核中、不可访问或不匹配则报告具体等待原因，绝不重发。`,
    `发布动作派发后必须立即进入结果核验；断线或证据不足只报告 result-unknown，禁止再次点击发布。`,
  ].join('\n')
}

function hasPlatformPublishingProgress(publishing: ArticlePublishingState): boolean {
  if (publishing.sideEffects.length > 0) return true
  if (publishing.assets.some((asset) => asset.status !== 'pending')) return true
  return publishing.checkpoints.some(
    (checkpoint) =>
      !['verify-account', 'open-editor'].includes(checkpoint.stepId) &&
      checkpoint.status !== 'pending',
  )
}

function invalid<T>(message: string): WebAffairOperationResult<T> {
  return { success: false, error: { code: 'INVALID_INPUT', message } }
}

function stableRuntimeEventId(
  attemptId: string,
  executionGeneration: number,
  launchOperationId: string,
  event: string,
): string {
  return `${attemptId}:g${executionGeneration}:${launchOperationId}:${event}`
}

function extractRuntimeError(data: unknown): string {
  if (data instanceof Error) return data.message
  if (data && typeof data === 'object') {
    const message = (data as { message?: unknown; error?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim()
    const error = (data as { error?: unknown }).error
    if (typeof error === 'string' && error.trim()) return error.trim()
  }
  return 'Agent Run 异常结束，发布结果尚未核验'
}

function notFound<T>(message: string): WebAffairOperationResult<T> {
  return { success: false, error: { code: 'NOT_FOUND', message } }
}

export function articlePublishingAffairs(snapshot: WebAffairProjectSnapshot) {
  return snapshot.affairs.filter(
    (affair) => affair.kind === 'article-publishing' && Boolean(affair.articlePublishing),
  )
}
