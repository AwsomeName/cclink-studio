import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright-core'
import type { AgentBridge } from '../agent/agent-bridge'
import type { BrowserManager } from '../browser/browser-manager'
import type {
  BrowserAccountRecoveryLease,
  BrowserTaskRuntime,
} from '../browser/browser-task-runtime'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { ToolExecutionContext } from '../agent-core/tools/types'
import type { WebAffairService } from '../web-affairs/web-affair-service'
import type {
  DecideImageResearchCandidateInput,
  WebAffair,
  WebAffairOperationResult,
} from '../../shared/web-affairs/web-affair-types'

interface ImageResearchDependencies {
  getAgentBridge: () => AgentBridge | null
  getBrowserManager: () => BrowserManager | null
  getBrowserTaskRuntime: () => BrowserTaskRuntime | null
  getPlaywrightBridge: () => PlaywrightBridge | null
}

interface ActiveImageResearchRuntime {
  workspaceId: string
  workspacePath: string
  affairId: string
  attemptId: string
  executionGeneration: number
  launchOperationId: string
  conversationId: string
  agentRunId: string
  browserTaskRunId: string
  tabId: string
  pageBindingGeneration: number
}

interface ResultReference {
  id: string
  runtime: ActiveImageResearchRuntime
  noteId: string
  title: string
  authorDisplayName?: string
}

interface ProposalReference {
  id: string
  runtime: ActiveImageResearchRuntime
  noteId: string
  imageIndex: number
  title: string
  authorDisplayName?: string
  visibleText: string[]
  sanitizedPageUrl: string
  reopenPath?: string
}

interface HeldCandidateLease {
  lease: BrowserAccountRecoveryLease
  affairId: string
  candidateId: string
  tabId: string
}

const XHS_ORIGIN = 'https://www.xiaohongshu.com'
const MAX_RESULTS = 10

export class ImageResearchService {
  private readonly activeByAttempt = new Map<string, ActiveImageResearchRuntime>()
  private readonly resultRefs = new Map<string, ResultReference>()
  private readonly proposalRefs = new Map<string, ProposalReference>()
  private readonly heldLeaseByAffair = new Map<string, HeldCandidateLease>()
  private readonly launchByOperation = new Map<
    string,
    Promise<WebAffairOperationResult<WebAffair>>
  >()
  private browserObserverInstalled = false
  private agentObserverDisposer: (() => void) | null = null

  constructor(
    private readonly webAffairService: WebAffairService,
    private readonly dependencies: ImageResearchDependencies,
  ) {}

  dispose(): void {
    const browserTaskRuntime = this.dependencies.getBrowserTaskRuntime()
    for (const held of this.heldLeaseByAffair.values()) {
      browserTaskRuntime?.releaseAccountRecoveryLease(held.lease.id)
    }
    this.heldLeaseByAffair.clear()
    this.activeByAttempt.clear()
    this.resultRefs.clear()
    this.proposalRefs.clear()
    this.launchByOperation.clear()
    this.agentObserverDisposer?.()
    this.agentObserverDisposer = null
  }

  async start(affairId: string, workspaceId: string): Promise<WebAffairOperationResult<WebAffair>> {
    const prepared = await this.webAffairService.startImageResearch(affairId, workspaceId)
    if (!prepared.success) return prepared
    return this.launchPrepared(prepared.data, workspaceId)
  }

  async retry(affairId: string, workspaceId: string): Promise<WebAffairOperationResult<WebAffair>> {
    return this.start(affairId, workspaceId)
  }

  async decide(
    input: DecideImageResearchCandidateInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const before = this.getAffair(input.affairId, workspaceId)
    const previous = before?.imageResearch?.candidates.find(
      (candidate) => candidate.id === input.candidateId,
    )
    if (previous?.decision) {
      return previous.decision === input.decision && before
        ? { success: true, data: before }
        : invalid('候选已经做出其他决定')
    }
    const decided = await this.webAffairService.decideImageResearchCandidate(input, workspaceId)
    if (!decided.success) return decided
    if (decided.data.imageResearch?.status === 'completed') {
      this.releaseHeldLease(input.affairId)
      return decided
    }
    return this.launchPrepared(decided.data, workspaceId)
  }

  async cancel(
    affairId: string,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const active = [...this.activeByAttempt.values()].find((item) => item.affairId === affairId)
    if (active) {
      await this.dependencies
        .getAgentBridge()
        ?.abort(active.conversationId, active.agentRunId)
        .catch(() => undefined)
      this.activeByAttempt.delete(active.attemptId)
    }
    this.releaseHeldLease(affairId)
    this.invalidateAffairReferences(affairId)
    return this.webAffairService.cancelImageResearch(affairId, workspaceId)
  }

  async openCandidate(
    affairId: string,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const affair = this.getAffair(affairId, workspaceId)
    const research = affair?.imageResearch
    const attempt = affair?.attempts[0]
    const candidate = research?.candidates.find((item) => item.id === research.currentCandidateId)
    if (!affair || !research || !attempt || !candidate) return invalid('没有等待处理的候选')
    const existing = this.heldLeaseByAffair.get(affairId)
    if (existing?.candidateId === candidate.id) return { success: true, data: affair }
    const browserManager = this.dependencies.getBrowserManager()
    const browserTaskRuntime = this.dependencies.getBrowserTaskRuntime()
    const playwrightBridge = this.dependencies.getPlaywrightBridge()
    if (!browserManager || !browserTaskRuntime || !playwrightBridge) {
      return unavailable('浏览器运行尚未就绪')
    }
    if (affair.workspaceRef.kind !== 'local') return invalid('图片调研只支持本地工作空间')
    const lease = browserTaskRuntime.acquireAccountRecoveryLease({
      accountId: attempt.accountId,
      profileId: attempt.profileId,
      affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
    })
    try {
      const targetUrl = candidate.reopenPath ? `${XHS_ORIGIN}${candidate.reopenPath}` : null
      if (!targetUrl) throw new Error('该候选没有可恢复路径；仍可直接确认已保存或跳过')
      const tabId = await browserManager.waitForAccountView(
        affair.workspaceRef.path,
        attempt.profileId,
        attempt.accountId,
        targetUrl,
        8_000,
      )
      if (!tabId) throw new Error('候选页面打开超时')
      await browserManager.navigate(tabId, targetUrl)
      await this.preparePage(tabId, playwrightBridge, browserManager)
      const page = playwrightBridge.getPageById(tabId)
      if (!page || (await this.readCurrentNoteId(page)) !== candidate.noteId) {
        throw new Error('无法重新定位原候选笔记；仍可确认已保存或跳过')
      }
      await this.moveToImageIndex(page, candidate.imageIndex)
      this.heldLeaseByAffair.set(affairId, { lease, affairId, candidateId: candidate.id, tabId })
      this.installBrowserObserver(browserManager)
      return { success: true, data: affair }
    } catch (error) {
      browserTaskRuntime.releaseAccountRecoveryLease(lease.id)
      return invalid(error instanceof Error ? error.message : String(error))
    }
  }

  closeCandidate(affairId: string, workspaceId: string): WebAffairOperationResult<WebAffair> {
    const affair = this.getAffair(affairId, workspaceId)
    if (!affair?.imageResearch) return invalid('图片调研事务不存在')
    const held = this.heldLeaseByAffair.get(affairId)
    if (held) {
      this.dependencies.getBrowserManager()?.destroyView(held.tabId)
      this.releaseHeldLease(affairId)
    }
    return { success: true, data: affair }
  }

  async search(query: string, context?: ToolExecutionContext): Promise<unknown> {
    const runtime = this.requireRuntime(context)
    const affair = this.getAffair(runtime.affairId, runtime.workspaceId)
    if (!affair?.imageResearch?.searchTerms.includes(query.trim())) {
      return invalid('搜索词不在任务冻结配置中')
    }
    const page = this.requirePage(runtime)
    await page.goto(`${XHS_ORIGIN}/search_result?keyword=${encodeURIComponent(query.trim())}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    })
    await page.waitForTimeout(800)
    this.invalidateRuntimeReferences(runtime)
    return this.inspectPage(context)
  }

  async inspectPage(context?: ToolExecutionContext): Promise<unknown> {
    const runtime = this.requireRuntime(context)
    const page = this.requirePage(runtime)
    const noteId = await this.readCurrentNoteId(page)
    if (!noteId) {
      const results = await this.readSearchResults(page, runtime)
      const loginRequired =
        (await page.locator('text=登录后查看搜索结果').count()) > 0 ||
        (await page.locator('input[placeholder*="手机号"]').count()) > 0
      return {
        success: true,
        data: {
          pageType: loginRequired
            ? 'login-required'
            : results.length > 0
              ? 'search-results'
              : 'unknown',
          results: results.map(({ id: resultRef, title, authorDisplayName }) => ({
            resultRef,
            title,
            ...(authorDisplayName ? { authorDisplayName } : {}),
          })),
        },
      }
    }
    const detail = await this.readNoteDetail(page, noteId)
    const proposalToken = randomUUID()
    const proposal: ProposalReference = { id: proposalToken, runtime, ...detail }
    this.proposalRefs.set(proposalToken, proposal)
    return {
      success: true,
      data: {
        pageType: 'note-detail',
        noteId: detail.noteId,
        title: detail.title,
        authorDisplayName: detail.authorDisplayName,
        imageIndex: detail.imageIndex,
        totalImages: detail.totalImages,
        visibleText: detail.visibleText,
        proposalToken,
      },
    }
  }

  async openResult(resultRef: string, context?: ToolExecutionContext): Promise<unknown> {
    const runtime = this.requireRuntime(context)
    const reference = this.resultRefs.get(resultRef)
    if (!reference || !sameRuntime(reference.runtime, runtime)) {
      return invalid('搜索结果引用已过期，请重新 inspect')
    }
    this.assertPageBinding(runtime)
    const page = this.requirePage(runtime)
    const anchor = page
      .locator(`a[href*="${cssEscape(reference.noteId)}"]`)
      .filter({ visible: true })
      .first()
    if ((await anchor.count()) === 0) return invalid('搜索列表已变化，请重新 inspect')
    await anchor.click({ timeout: 8_000 })
    await page.waitForTimeout(800)
    const openedNoteId = await this.readCurrentNoteId(page)
    if (openedNoteId !== reference.noteId) {
      return invalid('搜索结果已变化且打开的笔记身份不匹配，请重新 inspect')
    }
    this.invalidateRuntimeReferences(runtime)
    return this.inspectPage(context)
  }

  async propose(proposalToken: string, context?: ToolExecutionContext): Promise<unknown> {
    const runtime = this.requireRuntime(context)
    const proposal = this.proposalRefs.get(proposalToken)
    if (!proposal || !sameRuntime(proposal.runtime, runtime)) {
      return invalid('候选 token 已过期，请重新 inspect')
    }
    this.assertPageBinding(runtime)
    const page = this.requirePage(runtime)
    const current = await this.readNoteDetail(page, proposal.noteId)
    if (current.noteId !== proposal.noteId || current.imageIndex !== proposal.imageIndex) {
      return invalid('页面已切换到其他笔记或图片，请重新 inspect')
    }
    const persisted = await this.webAffairService.proposeImageResearchCandidate(
      {
        affairId: runtime.affairId,
        attemptId: runtime.attemptId,
        executionGeneration: runtime.executionGeneration,
        launchOperationId: runtime.launchOperationId,
        noteId: proposal.noteId,
        imageIndex: proposal.imageIndex,
        title: proposal.title,
        authorDisplayName: proposal.authorDisplayName,
        visibleText: proposal.visibleText,
        sanitizedPageUrl: proposal.sanitizedPageUrl,
        reopenPath: proposal.reopenPath,
      },
      runtime.workspaceId,
    )
    if (persisted.success) {
      this.dependencies.getBrowserTaskRuntime()?.finishTask(runtime.browserTaskRunId)
      this.activeByAttempt.delete(runtime.attemptId)
      this.invalidateRuntimeReferences(runtime)
    }
    return persisted
  }

  private async launchPrepared(
    affair: WebAffair,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const attempt = affair.attempts[0]
    if (!attempt) return invalid('图片调研运行状态不完整')
    const existingRuntime = this.activeByAttempt.get(attempt.id)
    if (
      existingRuntime?.executionGeneration === attempt.executionGeneration &&
      existingRuntime.launchOperationId === attempt.launchOperationId
    ) {
      return { success: true, data: affair }
    }
    const existingLaunch = this.launchByOperation.get(attempt.launchOperationId)
    if (existingLaunch) return existingLaunch
    const launch = this.doLaunchPrepared(affair, workspaceId).finally(() => {
      this.launchByOperation.delete(attempt.launchOperationId)
    })
    this.launchByOperation.set(attempt.launchOperationId, launch)
    return launch
  }

  private async doLaunchPrepared(
    affair: WebAffair,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<WebAffair>> {
    const attempt = affair.attempts[0]
    const research = affair.imageResearch
    const agentBridge = this.dependencies.getAgentBridge()
    const browserManager = this.dependencies.getBrowserManager()
    const browserTaskRuntime = this.dependencies.getBrowserTaskRuntime()
    const playwrightBridge = this.dependencies.getPlaywrightBridge()
    if (!attempt || !research || affair.workspaceRef.kind !== 'local') {
      return invalid('图片调研运行状态不完整')
    }
    if (!agentBridge || !browserManager || !browserTaskRuntime || !playwrightBridge) {
      return unavailable('Agent 或浏览器运行尚未就绪')
    }
    this.installAgentObserver(agentBridge)
    const held = this.heldLeaseByAffair.get(affair.id)
    const workspacePath = affair.workspaceRef.path
    let launchLease: BrowserAccountRecoveryLease | null = null
    try {
      launchLease =
        held?.lease ??
        browserTaskRuntime.acquireAccountRecoveryLease({
          accountId: attempt.accountId,
          profileId: attempt.profileId,
          affairId: affair.id,
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
        })
      const tabId = await browserManager.waitForAccountView(
        workspacePath,
        attempt.profileId,
        attempt.accountId,
        attempt.entryUrl,
        8_000,
        held?.tabId,
      )
      if (!tabId) throw new Error('小红书账号页面打开超时')
      await this.preparePage(tabId, playwrightBridge, browserManager)
      const pageBinding = playwrightBridge.getPageBindingIdentity(tabId)
      if (!pageBinding) throw new Error('小红书页面运行身份不可用')
      const conversationId = `image-research-${affair.id}`
      const agentRunId = `run-${attempt.launchOperationId}`
      const prompt = buildPrompt(affair)
      await agentBridge.sendMessage(prompt, conversationId, {
        runId: agentRunId,
        sessionId: null,
        workspaceRef: affair.workspaceRef,
        imageResearchPolicy: {
          origin: 'image-research',
          workspaceId,
          affairId: affair.id,
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
        },
        allowedTools: [
          'mcp__cclink_studio__image_research_search',
          'mcp__cclink_studio__image_research_inspect_page',
          'mcp__cclink_studio__image_research_open_result',
          'mcp__cclink_studio__image_research_propose',
        ],
        disableBuiltinTools: true,
        resources: [
          {
            id: `browser-${tabId}`,
            kind: 'browser',
            label: '可见小红书页面',
            ref: { type: 'browser', tabId, workspaceKey: affair.workspaceRef.path },
          },
        ],
        onRunPrepared: async (prepared) => {
          if (prepared.runId !== agentRunId || !prepared.browserTaskRunId) {
            throw new Error('图片调研启动前没有创建 BrowserTask')
          }
          const correlation = {
            workspaceKey: workspacePath,
            conversationId,
            agentRunId,
            profileId: attempt.profileId,
            accountId: attempt.accountId,
            affairId: affair.id,
            affairNodeId: attempt.nodeId,
            affairAttemptId: attempt.id,
            affairExecutionGeneration: attempt.executionGeneration,
            affairLaunchOperationId: attempt.launchOperationId,
            browserViewRuntimeGeneration:
              browserManager.getViewRuntimeIdentity(tabId)?.browserViewRuntimeGeneration,
            webContentsId: browserManager.getViewRuntimeIdentity(tabId)?.webContentsId,
            playwrightConnectionGeneration: pageBinding.connectionGeneration,
            playwrightPageBindingGeneration: pageBinding.generation,
          }
          const bound = await this.webAffairService.bindImageResearchAttempt(
            {
              workspaceRef: affair.workspaceRef,
              affairId: affair.id,
              attemptId: attempt.id,
              tabId,
              conversationId,
              agentRunId,
              browserTaskRunId: prepared.browserTaskRunId,
            },
            workspaceId,
          )
          if (!bound.success) throw new Error(bound.error.message)
          if (!launchLease) throw new Error('图片调研账号租约已失效')
          browserTaskRuntime.transferAccountRecoveryLeaseToTask(
            launchLease.id,
            prepared.browserTaskRunId,
            correlation,
          )
          if (held) {
            this.heldLeaseByAffair.delete(affair.id)
          }
          this.activeByAttempt.set(attempt.id, {
            workspaceId,
            workspacePath,
            affairId: affair.id,
            attemptId: attempt.id,
            executionGeneration: attempt.executionGeneration,
            launchOperationId: attempt.launchOperationId,
            conversationId,
            agentRunId,
            browserTaskRunId: prepared.browserTaskRunId,
            tabId,
            pageBindingGeneration: pageBinding.generation,
          })
        },
      })
      const latest = this.getAffair(affair.id, workspaceId)
      return latest ? { success: true, data: latest } : invalid('图片调研事务不存在')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (held) this.releaseHeldLease(affair.id)
      else if (launchLease) browserTaskRuntime.releaseAccountRecoveryLease(launchLease.id)
      return this.webAffairService.markImageResearchNeedsAttention(
        affair.id,
        attempt.id,
        message,
        workspaceId,
      )
    }
  }

  private getAffair(affairId: string, workspaceId: string): WebAffair | null {
    const snapshot = this.webAffairService.getProjectSnapshot(workspaceId)
    return snapshot.success
      ? structuredClone(snapshot.data.affairs.find((item) => item.id === affairId) ?? null)
      : null
  }

  private requireRuntime(context?: ToolExecutionContext): ActiveImageResearchRuntime {
    const policy = context?.imageResearchPolicy
    if (!policy || !context?.agentRunId) throw new Error('当前工具会话没有图片调研执行身份')
    const runtime = this.activeByAttempt.get(policy.attemptId)
    if (
      !runtime ||
      policy.workspaceId !== runtime.workspaceId ||
      policy.affairId !== runtime.affairId ||
      policy.executionGeneration !== runtime.executionGeneration ||
      policy.launchOperationId !== runtime.launchOperationId ||
      context.agentRunId !== runtime.agentRunId
    ) {
      throw new Error('图片调研工具来自旧 generation 或错误任务')
    }
    const task = this.dependencies.getBrowserTaskRuntime()?.getTask(runtime.browserTaskRunId)
    if (!task || task.status !== 'running' || task.tabId !== runtime.tabId) {
      throw new Error('图片调研 BrowserTask 已结束')
    }
    this.assertPageBinding(runtime)
    return runtime
  }

  private assertPageBinding(runtime: ActiveImageResearchRuntime): void {
    const binding = this.dependencies.getPlaywrightBridge()?.getPageBindingIdentity(runtime.tabId)
    if (!binding || binding.generation !== runtime.pageBindingGeneration) {
      throw new Error('页面已经重新绑定，请重试本轮搜索')
    }
  }

  private requirePage(runtime: ActiveImageResearchRuntime): Page {
    const page = this.dependencies.getPlaywrightBridge()?.getPageById(runtime.tabId)
    if (!page || page.isClosed()) throw new Error('小红书页面不可用')
    return page
  }

  private async preparePage(
    tabId: string,
    playwrightBridge: PlaywrightBridge,
    browserManager: BrowserManager,
  ): Promise<void> {
    await playwrightBridge.ensureConnected('image_research')
    await browserManager.ensurePlaywrightPage(tabId)
    await playwrightBridge.switchToPage(tabId)
  }

  private async readSearchResults(
    page: Page,
    runtime: ActiveImageResearchRuntime,
  ): Promise<ResultReference[]> {
    const anchors = page.locator(
      'a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/search_result/"]',
    )
    const count = Math.min(await anchors.count(), 80)
    const results: ResultReference[] = []
    const seen = new Set<string>()
    for (let index = 0; index < count && results.length < MAX_RESULTS; index += 1) {
      const anchor = anchors.nth(index)
      if (!(await anchor.isVisible().catch(() => false))) continue
      const href = await anchor.getAttribute('href')
      const noteId = parseXiaohongshuNoteId(href ?? '')
      if (!noteId || seen.has(noteId)) continue
      const text = boundedText(await anchor.innerText().catch(() => ''), 500)
      if (!text) continue
      const lines = text
        .split(/\n+/)
        .map((item) => item.trim())
        .filter(Boolean)
      const reference: ResultReference = {
        id: randomUUID(),
        runtime: { ...runtime },
        noteId,
        title: lines[0] ?? '未命名笔记',
        authorDisplayName: lines.length > 1 ? lines[lines.length - 1] : undefined,
      }
      this.resultRefs.set(reference.id, reference)
      results.push(reference)
      seen.add(noteId)
    }
    return results
  }

  private async readCurrentNoteId(page: Page): Promise<string | null> {
    const fromUrl = parseXiaohongshuNoteId(page.url())
    if (fromUrl) return fromUrl
    const identityNodes = page.locator(
      '[role="dialog"] [data-note-id], [class*="note-detail"] [data-note-id]',
    )
    const identityCount = Math.min(await identityNodes.count(), 10)
    for (let index = 0; index < identityCount; index += 1) {
      const node = identityNodes.nth(index)
      if (!(await node.isVisible().catch(() => false))) continue
      const noteId = (await node.getAttribute('data-note-id'))?.trim()
      if (noteId && /^[a-zA-Z0-9_-]{6,200}$/.test(noteId)) return noteId
    }
    const visibleAnchors = page.locator(
      '[role="dialog"] a[href*="/explore/"], [class*="note-detail"] a[href*="/explore/"]',
    )
    const count = Math.min(await visibleAnchors.count(), 20)
    for (let index = 0; index < count; index += 1) {
      const anchor = visibleAnchors.nth(index)
      if (!(await anchor.isVisible().catch(() => false))) continue
      const noteId = parseXiaohongshuNoteId((await anchor.getAttribute('href')) ?? '')
      if (noteId) return noteId
    }
    return null
  }

  private async readNoteDetail(page: Page, expectedNoteId: string) {
    const noteId = await this.readCurrentNoteId(page)
    if (!noteId || noteId !== expectedNoteId) throw new Error('当前详情页笔记身份不匹配')
    const visibleText = await this.readVisibleText(page)
    const title = visibleText[0] ?? (boundedText(await page.title(), 500) || '未命名笔记')
    const author = await firstVisibleText(page, [
      '[role="dialog"] [class*="author"]',
      '[class*="note"] [class*="author"]',
      '[class*="user-name"]',
    ])
    const { imageIndex, totalImages } = await this.readCarouselPosition(page)
    const sanitizedPageUrl = `${XHS_ORIGIN}/explore/${encodeURIComponent(noteId)}`
    return {
      noteId,
      imageIndex,
      totalImages,
      title,
      authorDisplayName: author || undefined,
      visibleText,
      sanitizedPageUrl,
      reopenPath: `/explore/${encodeURIComponent(noteId)}`,
    }
  }

  private async readVisibleText(page: Page): Promise<string[]> {
    const selectors = [
      '[role="dialog"] h1',
      '[role="dialog"] [class*="title"]',
      '[role="dialog"] [class*="desc"]',
      '[role="dialog"] [class*="tag"]',
      '[class*="note"] [class*="title"]',
      '[class*="note"] [class*="desc"]',
    ]
    const output: string[] = []
    let total = 0
    for (const selector of selectors) {
      const locator = page.locator(selector)
      const count = Math.min(await locator.count(), 20)
      for (let index = 0; index < count && output.length < 20; index += 1) {
        const item = locator.nth(index)
        if (!(await item.isVisible().catch(() => false))) continue
        const value = boundedText(await item.innerText().catch(() => ''), 500)
        if (!value || output.includes(value) || total + value.length > 2_000) continue
        output.push(value)
        total += value.length
      }
    }
    return output
  }

  private async readCarouselPosition(
    page: Page,
  ): Promise<{ imageIndex: number; totalImages: number }> {
    const dots = page.locator(
      '[role="dialog"] .swiper-pagination-bullet, [role="dialog"] [class*="indicator"] [class*="dot"]',
    )
    const count = Math.min(await dots.count(), 500)
    let active = 0
    for (let index = 0; index < count; index += 1) {
      const className = (await dots.nth(index).getAttribute('class')) ?? ''
      if (/active|current|selected/i.test(className)) {
        active = index
        break
      }
    }
    return { imageIndex: active, totalImages: Math.max(1, count) }
  }

  private async moveToImageIndex(page: Page, target: number): Promise<void> {
    if (target <= 0) return
    const next = page
      .locator('[role="dialog"] button[aria-label*="下一"], [role="dialog"] [class*="next"]')
      .first()
    for (let index = 0; index < target; index += 1) {
      if ((await next.count()) === 0 || !(await next.isVisible().catch(() => false))) break
      await next.click({ timeout: 3_000 })
      await page.waitForTimeout(150)
    }
  }

  private installBrowserObserver(browserManager: BrowserManager): void {
    if (this.browserObserverInstalled) return
    this.browserObserverInstalled = true
    browserManager.onViewDestroyed((tabId) => {
      for (const [affairId, held] of this.heldLeaseByAffair) {
        if (held.tabId === tabId) this.releaseHeldLease(affairId)
      }
    })
  }

  private installAgentObserver(agentBridge: AgentBridge): void {
    if (this.agentObserverDisposer) return
    this.agentObserverDisposer = agentBridge.onRuntimeEvent((event) => {
      if (event.type !== 'complete' && event.type !== 'error') return
      const runtime = [...this.activeByAttempt.values()].find(
        (item) => item.conversationId === event.conversationId && item.agentRunId === event.runId,
      )
      if (!runtime) return
      this.activeByAttempt.delete(runtime.attemptId)
      this.invalidateRuntimeReferences(runtime)
      this.dependencies.getBrowserTaskRuntime()?.finishTask(runtime.browserTaskRunId)
      const affair = this.getAffair(runtime.affairId, runtime.workspaceId)
      if (affair?.imageResearch?.status !== 'searching') return
      const reason =
        event.type === 'error'
          ? 'Agent 搜索失败；请处理登录或页面问题后重试'
          : 'Agent 本轮没有提出候选；请重试或结束任务'
      void this.webAffairService.markImageResearchNeedsAttention(
        runtime.affairId,
        runtime.attemptId,
        reason,
        runtime.workspaceId,
      )
    })
  }

  private releaseHeldLease(affairId: string): void {
    const held = this.heldLeaseByAffair.get(affairId)
    if (!held) return
    this.dependencies.getBrowserTaskRuntime()?.releaseAccountRecoveryLease(held.lease.id)
    this.heldLeaseByAffair.delete(affairId)
  }

  private invalidateRuntimeReferences(runtime: ActiveImageResearchRuntime): void {
    for (const [id, reference] of this.resultRefs) {
      if (sameRuntime(reference.runtime, runtime)) this.resultRefs.delete(id)
    }
    for (const [id, reference] of this.proposalRefs) {
      if (sameRuntime(reference.runtime, runtime)) this.proposalRefs.delete(id)
    }
  }

  private invalidateAffairReferences(affairId: string): void {
    for (const [id, reference] of this.resultRefs) {
      if (reference.runtime.affairId === affairId) this.resultRefs.delete(id)
    }
    for (const [id, reference] of this.proposalRefs) {
      if (reference.runtime.affairId === affairId) this.proposalRefs.delete(id)
    }
  }
}

function buildPrompt(affair: WebAffair): string {
  const research = affair.imageResearch
  return [
    '你正在执行小红书图片调研。每轮只能提出一张候选，然后立即结束本轮。',
    `搜索词只能从以下冻结列表选择：${research?.searchTerms.join('、') ?? ''}。`,
    '依次调用 image_research_search、image_research_inspect_page、image_research_open_result。',
    '只能根据工具返回的标题、作者和有限可见文字判断；不要声称看到了图片内容。',
    '选定当前笔记和图片序号后调用 image_research_propose；成功后不要再调用任何工具。',
    '遇到登录、验证码、未知页面、空结果或页面身份拒绝时停止，不要猜 selector 或绕过限制。',
  ].join('\n')
}

export function parseXiaohongshuNoteId(value: string): string | null {
  const match = value.match(/\/(?:explore|discovery\/item|search_result)\/([a-zA-Z0-9_-]{6,200})/)
  return match?.[1] ?? null
}

function boundedText(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

async function firstVisibleText(page: Page, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      const text = boundedText(await locator.innerText().catch(() => ''), 200)
      if (text) return text
    }
  }
  return ''
}

function sameRuntime(left: ActiveImageResearchRuntime, right: ActiveImageResearchRuntime): boolean {
  return (
    left.affairId === right.affairId &&
    left.attemptId === right.attemptId &&
    left.executionGeneration === right.executionGeneration &&
    left.launchOperationId === right.launchOperationId &&
    left.tabId === right.tabId &&
    left.browserTaskRunId === right.browserTaskRunId &&
    left.pageBindingGeneration === right.pageBindingGeneration
  )
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

function invalid<T>(message: string): WebAffairOperationResult<T> {
  return { success: false, error: { code: 'INVALID_TRANSITION', message } }
}

function unavailable<T>(message: string): WebAffairOperationResult<T> {
  return { success: false, error: { code: 'SERVICE_UNAVAILABLE', message } }
}
