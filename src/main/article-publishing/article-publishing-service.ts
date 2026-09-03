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
import { CSDN_ARTICLE_SUPPORTED_ORIGINS } from './article-publishing-browser-policy'
import {
  isSameCsdnDraft,
  parseCsdnDraftAnchor,
} from '../../shared/article-publishing/csdn-draft-anchor'
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
} from '../../shared/web-affairs/web-affair-types'
import {
  CsdnDraftRecoveryCoordinator,
  type CsdnDraftRecoveryResult,
} from './csdn-draft-recovery-coordinator'
import { CSDN_ARTICLE_MANAGEMENT_URL } from './csdn-publishing-adapter'

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
        ? parseCsdnDraftAnchor(publishing.draft.url)
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
        publishing.publication.status === 'result-unknown' &&
        publishing.draft?.platformDraftId,
      )
      const tabId = await browserManager.waitForAccountView(
        input.workspacePath,
        attempt.profileId,
        attempt.accountId,
        recoveryRequired || publicationRecoveryRequired
          ? CSDN_ARTICLE_MANAGEMENT_URL
          : (persistedDraftAnchor?.url ?? attempt.entryUrl),
        8_000,
        input.preferredBrowserTabId,
      )
      if (!tabId) throw new Error('账号浏览器 Tab 创建超时')
      let draftAnchor = persistedDraftAnchor
      const visibleUrl = browserManager.getCurrentURL(tabId)
      let recoveredDraft: CsdnDraftRecoveryResult | null = null
      let recoveredPublicationUrl: string | null = null
      const navigateForRecovery = async (url: string) => {
        await browserManager.navigate(tabId, url)
        await playwrightBridge.ensureConnected('article_publishing_draft_recovery')
        await browserManager.ensurePlaywrightPage(tabId)
        await playwrightBridge.switchToPage(tabId)
        const page = playwrightBridge.getPageById(tabId)
        if (!page || page.isClosed()) throw new Error('CSDN 恢复核验页面不可用')
        return page
      }
      if (publicationRecoveryRequired) {
        const expectedPlatformAccountId = publishing.draft?.platformAccountId
        if (!expectedPlatformAccountId) {
          throw new Error('发布结果未知，但任务缺少原 CSDN 账号；已停止自动核查')
        }
        const recoveredPublication = await this.draftRecoveryCoordinator.recoverExactPublication({
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
        recoveredDraft = await this.draftRecoveryCoordinator.recoverExactDraft({
          expectedDraftId: recovery.expectedDraftId,
          expectedPlatformAccountId,
          expectedTitle: recovery.expectedTitle,
          navigate: navigateForRecovery,
        })
        draftAnchor = parseCsdnDraftAnchor(recoveredDraft.url)
        if (!draftAnchor || draftAnchor.draftId !== recovery.expectedDraftId) {
          throw new Error('草稿恢复结果没有返回原平台草稿身份')
        }
      } else if (draftAnchor) {
        if (!isSameCsdnDraft(draftAnchor.url, visibleUrl)) {
          await browserManager.navigate(tabId, draftAnchor.url)
        }
        const restored = parseCsdnDraftAnchor(browserManager.getCurrentURL(tabId))
        if (!restored || restored.draftId !== draftAnchor.draftId) {
          throw new Error(`无法恢复原 CSDN 草稿 ${draftAnchor.draftId}，已拒绝在其他页面继续`)
        }
        draftAnchor = restored
      } else if (input.resumed && hasPlatformPublishingProgress(publishing)) {
        throw new Error('任务已有平台写入但缺少原草稿编号或账号；请重新创建发布任务')
      } else {
        await browserManager.navigate(tabId, attempt.entryUrl)
        const visibleDraftAnchor = parseCsdnDraftAnchor(browserManager.getCurrentURL(tabId))
        if (visibleDraftAnchor) {
          const recorded = await this.webAffairService.recordArticlePublishingDraftAnchor(
            input.affair.id,
            attempt.id,
            attempt.executionGeneration,
            attempt.launchOperationId,
            visibleDraftAnchor.url,
            input.workspaceId,
          )
          if (!recorded.success) throw new Error(recorded.error.message)
          draftAnchor = visibleDraftAnchor
        }
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
          ? `${input.prompt}\nmain 已按原草稿 ID、平台账号和标题锁定公开结果：publicationUrl=${recoveredPublicationUrl}；只允许读回并完成发布核验。`
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
              label: 'CSDN 发布页',
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
            const currentViewIdentity = browserManager.getViewRuntimeIdentity(tabId)
            const currentPageBinding = playwrightBridge.getPageBindingIdentity(tabId)
            if (
              !currentViewIdentity ||
              !currentPageBinding ||
              currentPageBinding.connectionGeneration !==
                playwrightBridge.getConnectionGeneration() ||
              currentPageBinding.webContentsId !== currentViewIdentity.webContentsId
            ) {
              throw new Error('BrowserTask 创建后页面 Runtime 身份未稳定绑定')
            }
            const pageIdentityChanged =
              currentViewIdentity.browserViewRuntimeGeneration !==
                viewIdentity.browserViewRuntimeGeneration ||
              currentViewIdentity.webContentsId !== viewIdentity.webContentsId ||
              currentPageBinding.connectionGeneration !== pageBinding.connectionGeneration ||
              currentPageBinding.generation !== pageBinding.generation
            if (pageIdentityChanged && recoveredDraft && recovery) {
              const page = playwrightBridge.getPageById(tabId)
              if (!page || page.isClosed()) {
                throw new Error('BrowserTask 创建后恢复草稿页面不可用')
              }
              const refreshedDraft = await this.draftRecoveryCoordinator.verifyExactDraftPage({
                page,
                expectedDraftId: recoveredDraft.draftId,
                expectedPlatformAccountId: recoveredDraft.platformAccountId,
                expectedTitle: recoveredDraft.normalizedTitle,
              })
              const refreshedPermit = await this.webAffairService.verifyArticlePublishingRecovery(
                {
                  affairId: input.affair.id,
                  attemptId: attempt.id,
                  executionGeneration: attempt.executionGeneration,
                  launchOperationId: attempt.launchOperationId,
                  recoveryOperationId: recovery.operationId,
                  draftId: refreshedDraft.draftId,
                  url: refreshedDraft.url,
                  platformAccountId: refreshedDraft.platformAccountId,
                  normalizedTitle: refreshedDraft.normalizedTitle,
                  saveState: 'saved',
                  tabId,
                  browserViewRuntimeGeneration: currentViewIdentity.browserViewRuntimeGeneration,
                  webContentsId: currentViewIdentity.webContentsId,
                  playwrightConnectionGeneration: currentPageBinding.connectionGeneration,
                  playwrightPageBindingGeneration: currentPageBinding.generation,
                },
                input.workspaceId,
              )
              if (!refreshedPermit.success) throw new Error(refreshedPermit.error.message)
            }
            const correlationPatch = {
              accountId: attempt.accountId,
              allowedOrigins: [...CSDN_ARTICLE_SUPPORTED_ORIGINS],
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
            const boundResult = await this.webAffairService.bindArticlePublishingRuntime(
              input.affair.id,
              attempt.id,
              attempt.executionGeneration,
              attempt.launchOperationId,
              [
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
              ],
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
            if (latestIdentity) this.scheduleBrowserRuntimeRebind(latestIdentity)
            resolveLaunchReady({
              affair: boundResult.data,
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
      browserManager.onPageRuntimeBound((identity) => this.scheduleBrowserRuntimeRebind(identity)),
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

  private scheduleBrowserRuntimeRebind(identity: BrowserPageRuntimeBindingIdentity): void {
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
        .catch((error) =>
          console.warn('[ArticlePublishing] Page Runtime 重绑定失败:', {
            affairId: runtime.affairId,
            attemptId: runtime.attemptId,
            tabId: runtime.tabId,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
        .finally(() => {
          if (this.runtimeRebindQueues.get(runtime.attemptId) === queued) {
            this.runtimeRebindQueues.delete(runtime.attemptId)
          }
        })
      this.runtimeRebindQueues.set(runtime.attemptId, queued)
    }
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

    const publishing = rebound.data.articlePublishing
    const recovery = publishing?.draft?.recovery
    if (
      publishing &&
      recovery?.executionGeneration === runtime.executionGeneration &&
      publishing.draft?.platformDraftId &&
      publishing.draft.platformAccountId
    ) {
      const page = playwrightBridge.getPageById(runtime.tabId)
      if (!page || page.isClosed()) throw new Error('Page Runtime 重绑定后恢复草稿页面不可用')
      const verifiedDraft = await this.draftRecoveryCoordinator.verifyExactDraftPage({
        page,
        expectedDraftId: publishing.draft.platformDraftId,
        expectedPlatformAccountId: publishing.draft.platformAccountId,
        expectedTitle: recovery.expectedTitle,
      })
      const currentView = browserManager.getViewRuntimeIdentity(runtime.tabId)
      const currentPage = playwrightBridge.getPageBindingIdentity(runtime.tabId)
      if (
        !currentView ||
        !currentPage ||
        currentView.browserViewRuntimeGeneration !== identity.browserViewRuntimeGeneration ||
        currentView.webContentsId !== identity.webContentsId ||
        currentPage.connectionGeneration !== identity.playwrightConnectionGeneration ||
        currentPage.generation !== identity.playwrightPageBindingGeneration ||
        currentPage.webContentsId !== identity.webContentsId
      ) {
        throw new Error('恢复草稿核验期间 Page Runtime 再次变化')
      }
      const permit = await this.webAffairService.verifyArticlePublishingRecovery(
        {
          affairId: runtime.affairId,
          attemptId: runtime.attemptId,
          executionGeneration: runtime.executionGeneration,
          launchOperationId: runtime.launchOperationId,
          recoveryOperationId: recovery.operationId,
          draftId: verifiedDraft.draftId,
          url: verifiedDraft.url,
          platformAccountId: verifiedDraft.platformAccountId,
          normalizedTitle: verifiedDraft.normalizedTitle,
          saveState: 'saved',
          tabId: runtime.tabId,
          browserViewRuntimeGeneration: identity.browserViewRuntimeGeneration,
          webContentsId: identity.webContentsId,
          playwrightConnectionGeneration: identity.playwrightConnectionGeneration,
          playwrightPageBindingGeneration: identity.playwrightPageBindingGeneration,
        },
        runtime.workspaceId,
      )
      if (!permit.success) throw new Error(permit.error.message)
    }
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
              ? '用户主动核验确认 Runtime 长期没有可验证进度，已转为人工处理'
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
        ? 'Runtime 仍响应但持续没有可验证进度，已转为人工处理'
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
      currentAttempt?.status === 'interrupted' ||
      (currentAttempt && publishing.execution.status === 'waiting-human'),
    )
    const result = await this.webAffairService.acquireArticlePublishingAttempt(
      affair.id,
      workspaceId,
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
      await agentBridge?.abort(runtime.conversationId, runtime.agentRunId).catch(() => undefined)
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
    return this.webAffairService.resolveArticlePublishingAsset(
      parsed.data.affairId,
      parsed.data.assetId,
      parsed.data.resolution,
      workspaceId,
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
    `图片共有 ${localAssets.length} 张。每张上传必须依次报告 uploading、waiting-platform、verifying；只有重新读取编辑器取得平台 URL 和页面证据后才能报告 uploaded。`,
    `文章发布动作由主进程根据当前事务、步骤、账号、页面和适配器三态核验；普通“确认上传”和已授权的单篇常规发布可继续，人工专属或未知动作会自动暂停。`,
    `单图最多 3 次安全尝试；派发后结果不明必须报告 result-unknown 并先对账，禁止盲目重复上传。`,
    `验证码、风控、法律/版权声明、账号或内容不一致、未知页面必须暂停给用户。`,
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
