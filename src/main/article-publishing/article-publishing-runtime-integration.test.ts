import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import { WebAffairService } from '../web-affairs/web-affair-service'
import { WebAffairStore } from '../web-affairs/web-affair-store'
import { ArticlePublishingBrowserPolicy } from './article-publishing-browser-policy'
import { ArticlePublishingService } from './article-publishing-service'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'
const WEBSITE_ID = '33333333-3333-4333-8333-333333333333'
const PRINCIPAL_ID = '44444444-4444-4444-8444-444444444444'
const OLD_TASK_ID = '55555555-5555-4555-8555-555555555555'
const DRAFT_URL = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'

describe('article publishing Runtime cross-service convergence', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it.each(['continue', 'cancel-after-persist', 'reload-after-persist'] as const)(
    'recovers 31 → 32 and continues the original steps: %s',
    async (scenario) => {
      const directory = await mkdtemp(join(tmpdir(), 'cclink-publishing-convergence-'))
      directories.push(directory)
      const markdownPath = join(directory, 'article.md')
      await writeFile(markdownPath, '# Article')
      const metadata = await stat(markdownPath)
      const webAffairService = createWebAffairService(directory)
      await webAffairService.load()
      const affair = await createRecoverableAffair(
        webAffairService,
        directory,
        markdownPath,
        metadata.mtimeMs,
        metadata.size,
      )

      const browserTaskRuntime = new BrowserTaskRuntime({ isDestroyed: () => true } as never)
      let currentUrl = 'https://mp.csdn.net/mp_blog/manage/article'
      let viewIdentity = {
        browserViewRuntimeGeneration: 31,
        webContentsId: 310,
        documentGeneration: 1,
      }
      let pageBinding = { generation: 31, connectionGeneration: 31, webContentsId: 310 }
      let pageRuntimeBound: ((identity: PageRuntimeIdentity) => void) | undefined
      const page = {
        fill: vi.fn(async () => undefined),
        isClosed: () => false,
        url: () => currentUrl,
        evaluate: async () => ({
          url: currentUrl,
          pageKind: 'editor',
          bodySelector: '#body',
          bodyTextLength: 100,
          accountHrefCandidates: ['https://blog.csdn.net/test-user'],
          imageEnumerationComplete: true,
          images: [],
          titleSelector: '#title',
          titleValue: 'Article',
          selectors: { body: '#body', title: '#title' },
          saveStatusTexts: ['草稿已保存'],
          publishedLinks: [],
        }),
      }
      const browserManager = {
        waitForAccountView: vi.fn(async () => 'tab-a'),
        getCurrentURL: vi.fn(() => currentUrl),
        navigate: vi.fn(async (_tabId: string, url: string) => {
          currentUrl = url
        }),
        ensurePlaywrightPage: vi.fn(async () => undefined),
        getViewRuntimeIdentity: vi.fn(() => ({ ...viewIdentity })),
        isViewVisible: vi.fn(() => true),
        onPageRuntimeBound: vi.fn((callback: (identity: PageRuntimeIdentity) => void) => {
          pageRuntimeBound = callback
          return () => undefined
        }),
      }
      const playwrightBridge = {
        ensureConnected: vi.fn(async () => undefined),
        switchToPage: vi.fn(async () => undefined),
        getConnectionGeneration: vi.fn(() => pageBinding.connectionGeneration),
        getPageBindingIdentity: vi.fn(() => ({ ...pageBinding })),
        getPageById: vi.fn(() => page),
        isConnected: vi.fn(() => true),
      }
      const recoveryGenerationSeen: number[] = []
      const draftRecoveryCoordinator = {
        recoverExactDraft: vi.fn(
          async ({ navigate }: { navigate: (url: string) => Promise<unknown> }) => {
            await navigate('https://mp.csdn.net/mp_blog/manage/article')
            await navigate(DRAFT_URL)
            recoveryGenerationSeen.push(pageBinding.generation)
            return exactDraft()
          },
        ),
        verifyExactDraftPage: vi.fn(async () => {
          recoveryGenerationSeen.push(pageBinding.generation)
          return exactDraft()
        }),
      }
      let runPrepared = false
      const agentBridge = {
        onRuntimeEvent: vi.fn(() => () => undefined),
        getRuntimeIdentity: vi.fn(() => ({
          agentRuntimeBindingKey: 'agent-binding-32',
          agentRuntimeEpoch: 32,
        })),
        sendMessage: vi.fn(
          async (
            _prompt: string,
            conversationId: string,
            options: {
              runId: string
              onRunPrepared: (prepared: {
                conversationId: string
                runId: string
                browserTaskRunId: string
              }) => Promise<void>
            },
          ) => {
            const task = browserTaskRuntime.startTask({
              tabId: 'tab-a',
              goal: 'publish',
              correlation: {
                workspaceKey: directory,
                conversationId,
                agentRunId: options.runId,
                agentSessionRef: null,
                profileId: 'csdn-profile',
              },
            })
            viewIdentity = {
              browserViewRuntimeGeneration: 32,
              webContentsId: 320,
              documentGeneration: 2,
            }
            pageBinding = { generation: 32, connectionGeneration: 32, webContentsId: 320 }
            pageRuntimeBound?.({
              tabId: 'tab-a',
              browserViewRuntimeGeneration: 32,
              webContentsId: 320,
              playwrightConnectionGeneration: 32,
              playwrightPageBindingGeneration: 32,
            })
            await options.onRunPrepared({
              conversationId,
              runId: options.runId,
              browserTaskRunId: task.id,
            })
            runPrepared = true
            return { runId: options.runId }
          },
        ),
        getRunStatus: vi.fn(() => ({ status: 'running' })),
      }
      const fileService = {
        readTextDocument: vi.fn(async () => ({
          path: markdownPath,
          content: '# Article',
          size: metadata.size,
          modifiedAt: metadata.mtimeMs,
        })),
      }
      const publishingService = new ArticlePublishingService(
        fileService as never,
        webAffairService,
        async (path) => path,
        {
          getAgentBridge: () => agentBridge as never,
          getBrowserManager: () => browserManager as never,
          getBrowserTaskRuntime: () => browserTaskRuntime,
          getPlaywrightBridge: () => playwrightBridge as never,
        },
        draftRecoveryCoordinator as never,
      )
      try {
        const launch = await publishingService.startTask(
          { workspaceRef: { kind: 'local', path: directory }, affairId: affair.id },
          WORKSPACE_ID,
        )
        if (!launch.success) throw new Error(launch.error.message)
        expect(runPrepared).toBe(true)
        expect(recoveryGenerationSeen).toEqual([31, 32])
        expect(browserTaskRuntime.getTask(launch.data.browserTaskRunId)?.correlation).toMatchObject(
          {
            browserViewRuntimeGeneration: 32,
            webContentsId: 320,
            playwrightConnectionGeneration: 32,
            playwrightPageBindingGeneration: 32,
          },
        )
        const beforeInspect = webAffairService.getProjectSnapshot(WORKSPACE_ID)
        if (!beforeInspect.success) throw new Error(beforeInspect.error.message)
        expect(
          beforeInspect.data.affairs[0].articlePublishing?.executionProtocol.current,
        ).toMatchObject({
          definitionId: 'page.first-inspect',
          status: 'ready',
          runtime: {
            browserViewRuntimeGeneration: 32,
            webContentsId: 320,
            playwrightConnectionGeneration: 32,
            playwrightPageBindingGeneration: 32,
          },
        })

        const policy = new ArticlePublishingBrowserPolicy(
          webAffairService,
          async () => WORKSPACE_ID,
          playwrightBridge as never,
          browserTaskRuntime,
          async (attemptId) => publishingService.awaitBrowserRuntimeConvergence(attemptId),
          browserManager as never,
        )
        const abort = new AbortController()
        const context = {
          abortSignal: abort.signal,
          conversationId: launch.data.conversationId,
          agentRunId: launch.data.agentRunId,
          trustedWorkspace: { kind: 'local', rootPath: directory, workspaceKey: directory },
          articlePublishingPolicy: {
            origin: 'article-publishing',
            workspaceId: WORKSPACE_ID,
            affairId: affair.id,
            attemptId: launch.data.attemptId,
            executionGeneration: launch.data.executionGeneration,
            launchOperationId: launch.data.launchOperationId,
          },
        } as const
        const inspection = await policy.inspectCurrentPage(context)
        if (!inspection.success) throw new Error(inspection.error.message)
        const afterInspect = webAffairService.getProjectSnapshot(WORKSPACE_ID)
        if (!afterInspect.success) throw new Error(afterInspect.error.message)
        expect(afterInspect.data.affairs[0].articlePublishing?.checkpoints[0]).toMatchObject({
          stepId: 'open-editor',
          status: 'completed',
        })
        expect(draftRecoveryCoordinator.verifyExactDraftPage).toHaveBeenCalledOnce()
        const reporter = {
          workspaceId: WORKSPACE_ID,
          affairId: affair.id,
          attemptId: launch.data.attemptId,
          executionGeneration: launch.data.executionGeneration,
          launchOperationId: launch.data.launchOperationId,
          conversationId: launch.data.conversationId,
          agentRunId: launch.data.agentRunId,
        }
        for (const stepId of ['verify-account', 'upload-assets'] as const) {
          const read = await policy.inspectCurrentPage(context)
          if (!read.success) throw new Error(read.error.message)
          if (stepId === 'verify-account') continue
          const input = {
            workspaceRef: { kind: 'local' as const, path: directory },
            affairId: affair.id,
            attemptId: launch.data.attemptId,
            stepId,
            status: 'completed' as const,
            evidence: '当前精确页面读回：同账号同草稿，已保存，无待上传图片',
          }
          const running = await webAffairService.reportArticlePublishingCheckpoint(
            { ...input, status: 'running' },
            WORKSPACE_ID,
            reporter,
          )
          if (!running.success) throw new Error(running.error.message)
          const verifying = await webAffairService.reportArticlePublishingCheckpoint(
            { ...input, status: 'verifying' },
            WORKSPACE_ID,
            reporter,
          )
          if (!verifying.success) throw new Error(verifying.error.message)
          const trusted = policy.authorizeTrustedReport(
            'article_publishing_report_checkpoint',
            input,
            context,
            reporter,
          )
          if (!trusted.success) throw new Error(trusted.error.message)
          const result = await webAffairService.reportArticlePublishingCheckpoint(
            input,
            WORKSPACE_ID,
            trusted.data,
          )
          if (!result.success) throw new Error(result.error.message)
        }
        // 必须继续到原流程的实际未完成写入，不能只断言首次 inspect 成功。
        await policy.inspectCurrentPage(context)
        const task = browserTaskRuntime.getActiveTaskForConversation(launch.data.conversationId)!
        const decision = await policy.classifyAction(
          task,
          'fill',
          { selector: '#body', value: '# Article' },
          page as never,
          context,
        )
        expect(decision?.kind).toBe('allow-once')
        if (decision?.kind !== 'allow-once') throw new Error(JSON.stringify(decision))
        await policy.consumeSideEffect(task, decision.sideEffectKey, context)
        const persistDispatch =
          webAffairService.dispatchArticlePublishingSideEffect.bind(webAffairService)
        vi.spyOn(webAffairService, 'dispatchArticlePublishingSideEffect').mockImplementation(
          async (...args) => {
            const result = await persistDispatch(...args)
            if (scenario === 'cancel-after-persist') abort.abort()
            if (scenario === 'reload-after-persist') viewIdentity.documentGeneration += 1
            return result
          },
        )
        const dispatch = await policy.assertSideEffectDispatchAllowed(
          task,
          decision.sideEffectKey,
          context,
        )
        if (scenario !== 'continue') {
          expect(dispatch).toThrow()
          expect(page.fill).not.toHaveBeenCalled()
          return
        }
        dispatch()
        await page.fill()
        await policy.completeMutation(task, 'fill', page as never, context)
        expect(page.fill).toHaveBeenCalledOnce()
        const bodyInput = {
          workspaceRef: { kind: 'local' as const, path: directory },
          affairId: affair.id,
          attemptId: launch.data.attemptId,
          stepId: 'fill-body',
          evidence: '原草稿正文写入后重新只读核验',
        }
        for (const status of ['running', 'verifying'] as const) {
          const result = await webAffairService.reportArticlePublishingCheckpoint(
            { ...bodyInput, status },
            WORKSPACE_ID,
            reporter,
          )
          if (!result.success) throw new Error(result.error.message)
        }
        await policy.inspectCurrentPage(context)
        const bodyReporter = policy.authorizeTrustedReport(
          'article_publishing_report_checkpoint',
          { ...bodyInput, status: 'completed' },
          context,
          reporter,
        )
        if (!bodyReporter.success) throw new Error(bodyReporter.error.message)
        const bodyComplete = await webAffairService.reportArticlePublishingCheckpoint(
          { ...bodyInput, status: 'completed' },
          WORKSPACE_ID,
          bodyReporter.data,
        )
        if (!bodyComplete.success) throw new Error(bodyComplete.error.message)
        const continued = webAffairService.getProjectSnapshot(WORKSPACE_ID)
        if (!continued.success) throw new Error(continued.error.message)
        expect(continued.data.affairs[0].articlePublishing?.execution.currentStepId).toBe(
          'fill-fields',
        )
        expect(continued.data.affairs[0].articlePublishing?.sideEffects).toEqual([
          expect.objectContaining({
            kind: 'save-draft',
            status: 'reconciled',
            executionGeneration: 1,
          }),
          expect.objectContaining({ kind: 'save-draft', status: 'verified' }),
        ])
      } finally {
        publishingService.dispose()
        await webAffairService.flush()
      }
    },
  )
})

async function createRecoverableAffair(
  service: WebAffairService,
  directory: string,
  markdownPath: string,
  modifiedAt: number,
  size: number,
) {
  const created = await service.createArticlePublishingAffair(
    {
      preview: {
        source: { markdownPath, modifiedAt, size },
        title: 'Article',
        summary: '',
        assets: [],
        blockers: [],
        warnings: [],
      },
      accountId: ACCOUNT_ID,
      fields: { title: 'Article', summary: '', tags: [], category: '' },
      workspaceRef: { kind: 'local', path: directory },
    },
    WORKSPACE_ID,
  )
  if (!created.success) throw new Error(created.error.message)
  const started = await service.acquireArticlePublishingAttempt(created.data.id, WORKSPACE_ID)
  if (!started.success) throw new Error(started.error.message)
  const attempt = started.data.attempts[0]
  const now = new Date().toISOString()
  const common = {
    attemptId: attempt.id,
    executionGeneration: attempt.executionGeneration,
    launchOperationId: attempt.launchOperationId,
    status: 'active' as const,
    boundAt: now,
    lastObservedAt: now,
  }
  const bound = await service.bindArticlePublishingRuntime(
    created.data.id,
    attempt.id,
    attempt.executionGeneration,
    attempt.launchOperationId,
    [
      {
        ...common,
        id: randomUUID(),
        kind: 'agent-run',
        conversationId: 'old-conversation',
        agentRunId: 'old-run',
        agentRuntimeEpoch: 1,
        agentRuntimeBindingKey: 'old-binding',
      },
      {
        ...common,
        id: randomUUID(),
        kind: 'browser-tab',
        tabId: 'tab-a',
        browserViewRuntimeGeneration: 30,
        webContentsId: 300,
      },
      {
        ...common,
        id: randomUUID(),
        kind: 'browser-task',
        browserTaskRunId: OLD_TASK_ID,
        tabId: 'tab-a',
        browserViewRuntimeGeneration: 30,
        webContentsId: 300,
        playwrightConnectionGeneration: 30,
        playwrightPageBindingGeneration: 30,
      },
    ],
    WORKSPACE_ID,
  )
  if (!bound.success) throw new Error(bound.error.message)
  const anchored = await service.recordArticlePublishingDraftAnchor(
    created.data.id,
    attempt.id,
    attempt.executionGeneration,
    attempt.launchOperationId,
    DRAFT_URL,
    WORKSPACE_ID,
    OLD_TASK_ID,
  )
  if (!anchored.success) throw new Error(anchored.error.message)
  const observed = await service.recordArticlePublishingPageObservation(
    {
      affairId: created.data.id,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      browserTaskRunId: OLD_TASK_ID,
      draftId: '164148817',
      platformAccountId: 'csdn:test-user',
      normalizedTitle: 'Article',
      url: DRAFT_URL,
      saveState: 'saved',
    },
    WORKSPACE_ID,
  )
  if (!observed.success) throw new Error(observed.error.message)
  const oldSave = await service.reserveArticlePublishingSideEffect(
    created.data.id,
    attempt.id,
    attempt.executionGeneration,
    'save-draft',
    'autosave:fill-body:old',
    OLD_TASK_ID,
    WORKSPACE_ID,
  )
  if (!oldSave.success) throw new Error(oldSave.error.message)
  const oldKey = oldSave.data.articlePublishing!.sideEffects[0].key
  const consumed = await service.consumeArticlePublishingSideEffect(
    created.data.id,
    attempt.id,
    attempt.executionGeneration,
    oldKey,
    OLD_TASK_ID,
    WORKSPACE_ID,
  )
  if (!consumed.success) throw new Error(consumed.error.message)
  const dispatched = await service.dispatchArticlePublishingSideEffect(
    created.data.id,
    attempt.id,
    attempt.executionGeneration,
    oldKey,
    OLD_TASK_ID,
    WORKSPACE_ID,
  )
  if (!dispatched.success) throw new Error(dispatched.error.message)
  const handedOff = await service.handoffAttempt(
    {
      workspaceRef: { kind: 'local', path: directory },
      affairId: created.data.id,
      attemptId: attempt.id,
      reason: 'cross-service recovery test',
    },
    WORKSPACE_ID,
  )
  if (!handedOff.success) throw new Error(handedOff.error.message)
  return created.data
}

function createWebAffairService(directory: string): WebAffairService {
  const now = new Date().toISOString()
  return new WebAffairService(
    () =>
      ({
        schemaVersion: 3,
        revision: 1,
        websites: [
          {
            id: WEBSITE_ID,
            name: 'CSDN',
            origin: 'https://www.csdn.net',
            entryUrl: 'https://editor.csdn.net/md/',
            createdAt: now,
            updatedAt: now,
          },
        ],
        principals: [
          {
            id: PRINCIPAL_ID,
            kind: 'personal',
            name: 'Author',
            createdAt: now,
            updatedAt: now,
          },
        ],
        accounts: [
          {
            id: ACCOUNT_ID,
            websiteId: WEBSITE_ID,
            principalId: PRINCIPAL_ID,
            label: 'CSDN test',
            browserProfileId: 'csdn-profile',
            createdAt: now,
            updatedAt: now,
          },
        ],
        accountGroups: [],
      }) as never,
    new WebAffairStore(join(directory, 'affairs.json')),
    undefined,
    undefined,
    () => ({
      success: true,
      data: {
        webResourceRef: { accountId: ACCOUNT_ID },
        title: 'CSDN',
        entryUrl: 'https://editor.csdn.net/md/',
        browserProfileId: 'csdn-profile',
      },
    }),
  )
}

function exactDraft() {
  return {
    draftId: '164148817',
    url: DRAFT_URL,
    platformAccountId: 'csdn:test-user',
    normalizedTitle: 'Article',
  }
}

interface PageRuntimeIdentity {
  tabId: string
  browserViewRuntimeGeneration: number
  webContentsId: number
  playwrightConnectionGeneration: number
  playwrightPageBindingGeneration: number
}
