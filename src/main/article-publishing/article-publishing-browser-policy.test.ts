import { describe, expect, it, vi } from 'vitest'
import {
  ArticlePublishingBrowserPolicy,
  CSDN_ARTICLE_SUPPORTED_ORIGINS,
} from './article-publishing-browser-policy'

const DRAFT_URL = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'

function createPolicy(options?: {
  stepId?: string
  publicationStatus?: string
  assetStatus?: string
  executionStatus?: string
  draftUrl?: string | null
  recovery?: Record<string, unknown>
  imageEnumerationComplete?: boolean
  images?: Array<{ src: string; alt: string }>
  publishedLinks?: Array<{ url: string; title: string }>
  awaitRuntimeConvergence?: (attemptId: string) => Promise<void>
  duringProbe?: () => void
  beforeComplete?: () => void
}) {
  let documentGeneration = 1
  let viewVisible = true
  let inspectionPage: Record<string, unknown> | null = null
  const activeTask = structuredClone(task) as unknown as {
    id: string
    tabId: string
    status: string
    correlation: Record<string, unknown> & { playwrightPageBindingGeneration: number }
  }
  let currentPageBinding = {
    webContentsId: 20,
    connectionGeneration: 3,
    generation: 4,
  }
  const reserveArticlePublishingSideEffect = vi.fn().mockResolvedValue({
    success: true,
    data: {},
  })
  const handoffAttempt = vi.fn().mockResolvedValue({ success: true, data: {} })
  const recordArticlePublishingDraftAnchor = vi.fn().mockResolvedValue({
    success: true,
    data: {},
  })
  const activeBrowserBinding = {
    kind: 'browser-task',
    status: 'active',
    browserTaskRunId: 'task-a',
    executionGeneration: 1,
    launchOperationId: 'launch-a',
    tabId: 'tab-a',
    browserViewRuntimeGeneration: 2,
    webContentsId: 20,
    playwrightConnectionGeneration: 3,
    playwrightPageBindingGeneration: 4,
  }
  let currentOperation: Record<string, unknown> | undefined = {
    operationRunId: 'operation-a',
    revision: 1,
    definitionId: 'page.first-inspect',
    checkpointId: options?.stepId ?? 'upload-assets',
    status: 'ready',
    owner: 'agent',
    attemptId: 'attempt-a',
    executionGeneration: 1,
    launchOperationId: 'launch-a',
    startSummary: '等待首次只读检查',
    goalSummary: '核验当前页面',
    lastTransitionAt: '2026-09-07T00:00:00.000Z',
  }
  const snapshotAffair = () => ({
    id: 'affair-a',
    kind: 'article-publishing',
    attempts: [
      {
        id: 'attempt-a',
        accountId: 'account-a',
        status: 'running-ai',
        executionGeneration: 1,
        launchOperationId: 'launch-a',
        browserTaskRunId: 'task-a',
        runtimeBindings: [activeBrowserBinding],
      },
    ],
    articlePublishing: {
      adapterId: 'csdn',
      adapterVersion: 1,
      accountId: 'account-a',
      source: { markdownPath: '/workspace/article.md', modifiedAt: 1, size: 10 },
      fields: { title: 'Article', summary: '', tags: [], category: '' },
      assets: [
        {
          id: 'asset-a',
          kind: 'local',
          sourcePath: '/workspace/a.png',
          displayPath: 'a.png',
          status: options?.assetStatus ?? 'uploaded',
          uploadAttempts: [],
        },
      ],
      execution: {
        status: options?.executionStatus ?? 'running',
        currentAttemptId: 'attempt-a',
        currentStepId: options?.stepId ?? 'upload-assets',
        currentGeneration: 1,
        currentLaunchOperationId: 'launch-a',
      },
      executionProtocol: {
        current: currentOperation,
        recentTransitions: [],
      },
      sideEffects: [],
      publication: { status: options?.publicationStatus ?? 'not-started' },
      draft:
        options?.draftUrl === null
          ? undefined
          : {
              platformDraftId: '164148817',
              platformAccountId: 'csdn:test-user',
              normalizedTitle: 'Article',
              url: options?.draftUrl ?? DRAFT_URL,
              ...(options?.recovery ? { recovery: options.recovery } : {}),
            },
    },
  })
  const webAffairService = {
    getProjectSnapshot: vi.fn(() => ({
      success: true,
      data: {
        affairs: [snapshotAffair()],
      },
    })),
    reserveArticlePublishingSideEffect,
    recordArticlePublishingDraftAnchor,
    handoffAttempt,
    startArticlePublishingFirstInspect: vi.fn(async (input: Record<string, unknown>) => {
      const operation = currentOperation
      if (
        !operation ||
        operation.operationRunId !== input.expectedOperationRunId ||
        operation.revision !== input.expectedOperationRevision
      ) {
        return { success: false, error: { message: 'operation 已过期' } }
      }
      currentOperation = {
        ...operation,
        revision: Number(operation.revision) + 1,
        status: 'running',
        runtime: input.runtime,
      }
      return { success: true, data: snapshotAffair() }
    }),
    completeArticlePublishingFirstInspect: vi.fn(
      async (input: Record<string, unknown>, isCurrent?: () => boolean) => {
        options?.beforeComplete?.()
        if (isCurrent && !isCurrent()) return { success: false, error: { message: '观察已过期' } }
        if (
          currentOperation?.operationRunId !== input.expectedOperationRunId ||
          currentOperation?.revision !== input.expectedOperationRevision
        ) {
          return { success: false, error: { message: 'operation 已过期' } }
        }
        currentOperation = undefined
        return { success: true, data: snapshotAffair() }
      },
    ),
    failArticlePublishingCurrentOperation: vi.fn().mockResolvedValue({ success: true, data: {} }),
  }
  const policy = new ArticlePublishingBrowserPolicy(
    webAffairService as never,
    async () => 'workspace-a',
    {
      getPageById: () => inspectionPage,
      getPageBindingIdentity: () => currentPageBinding,
    } as never,
    {
      getActiveTaskForConversation: () => structuredClone(activeTask),
      getTask: () => structuredClone(activeTask),
    } as never,
    options?.awaitRuntimeConvergence,
    {
      getViewRuntimeIdentity: () => ({
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        documentGeneration,
      }),
      isViewVisible: () => viewVisible,
    } as never,
  )
  return {
    policy,
    webAffairService,
    advanceDocument: () => {
      documentGeneration += 1
    },
    hideView: () => {
      viewVisible = false
    },
    advancePageBinding: () => {
      currentPageBinding = { ...currentPageBinding, generation: 5 }
      activeTask.correlation.playwrightPageBindingGeneration = 5
    },
    convergeStoredBinding: () => {
      activeBrowserBinding.playwrightPageBindingGeneration =
        activeTask.correlation.playwrightPageBindingGeneration
    },
    clearCurrentOperation: () => {
      currentOperation = undefined
    },
    inspect: async (
      selectors: Record<string, string>,
      url = DRAFT_URL,
      pageKind: 'editor' | 'published-article' | 'management' | 'unsupported' = 'editor',
      expectSuccess = true,
    ) => {
      inspectionPage = {
        isClosed: () => false,
        url: () => url,
        evaluate: async () => {
          options?.duringProbe?.()
          return {
            url,
            pageKind,
            bodySelector: selectors['body'] ?? '#body',
            bodyTextLength: 100,
            accountHrefCandidates: ['https://blog.csdn.net/test-user'],
            imageEnumerationComplete: options?.imageEnumerationComplete ?? false,
            images: options?.images ?? [],
            fileInputSelector: selectors['fileInput'],
            titleSelector: selectors['title'] ?? '#title',
            titleValue: 'Article',
            selectors,
            saveStatusTexts: ['草稿已保存'],
            publishedLinks: options?.publishedLinks ?? [],
          }
        },
      }
      const result = await policy.inspectCurrentPage(context)
      expect(result.success).toBe(expectSuccess)
      return expectSuccess ? inspectionPage : result
    },
  }
}

const task = {
  id: 'task-a',
  tabId: 'tab-a',
  goal: 'publish',
  status: 'running',
  startedAt: 1,
  downloadIds: [],
  correlation: {
    workspaceKey: '/workspace',
    conversationId: 'conversation-a',
    agentRunId: 'run-a',
    agentSessionRef: null,
    profileId: 'profile-a',
    accountId: 'account-a',
    affairId: 'affair-a',
    affairAttemptId: 'attempt-a',
    affairExecutionGeneration: 1,
    affairLaunchOperationId: 'launch-a',
    browserViewRuntimeGeneration: 2,
    webContentsId: 20,
    playwrightConnectionGeneration: 3,
    playwrightPageBindingGeneration: 4,
  },
} as const

const context = {
  conversationId: 'conversation-a',
  agentRunId: 'run-a',
  articlePublishingPolicy: {
    origin: 'article-publishing' as const,
    workspaceId: 'workspace-a',
    affairId: 'affair-a',
    attemptId: 'attempt-a',
    executionGeneration: 1,
    launchOperationId: 'launch-a',
  },
  trustedWorkspace: {
    kind: 'local' as const,
    rootPath: '/workspace',
    workspaceKey: '/workspace',
  },
}

describe('ArticlePublishingBrowserPolicy', () => {
  it('waits for an in-flight same-page rebind before failing the first inspect', async () => {
    let convergeStoredBinding = (): void => undefined
    const awaitRuntimeConvergence = vi.fn(async () => convergeStoredBinding())
    const harness = createPolicy({ awaitRuntimeConvergence })
    convergeStoredBinding = harness.convergeStoredBinding
    harness.advancePageBinding()

    await harness.inspect({ title: '#title' })

    expect(awaitRuntimeConvergence).toHaveBeenCalledWith('attempt-a')
    expect(harness.webAffairService.failArticlePublishingCurrentOperation).not.toHaveBeenCalled()
  })

  it('returns the bounded multi-origin CSDN execution scope', async () => {
    const { policy } = createPolicy()

    await expect(
      policy.resolveAllowedOrigins({
        workspacePath: '/workspace',
        affairId: 'affair-a',
        attemptId: 'attempt-a',
        accountId: 'account-a',
      }),
    ).resolves.toEqual([...CSDN_ARTICLE_SUPPORTED_ORIGINS])
  })

  it('allows a unique visible confirm-upload control located with Playwright syntax', async () => {
    const { policy, inspect } = createPolicy()
    const locator = {
      count: vi.fn().mockResolvedValue(1),
      isVisible: vi.fn().mockResolvedValue(true),
      evaluate: vi.fn().mockResolvedValue({ label: '确认上传', type: '', role: 'button' }),
    }
    const page = {
      url: () => DRAFT_URL,
      locator: vi.fn().mockReturnValue(locator),
    }
    await inspect({ uploadConfirm: 'button:has-text("确认上传")' })

    await expect(
      policy.classifyAction(
        task as never,
        'click',
        { selector: 'button:has-text("确认上传")' },
        page as never,
        context,
      ),
    ).resolves.toEqual({ kind: 'allow' })
  })

  it('rejects an Agent-guessed selector that was not signed by the current adapter probe', async () => {
    const { policy, inspect } = createPolicy({ stepId: 'fill-fields' })
    const page = { url: () => DRAFT_URL }
    await inspect({ title: '#adapter-title' })

    await expect(
      policy.classifyAction(
        task as never,
        'fill',
        { selector: '#agent-guessed-title', value: 'Article' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({
      kind: 'unknown',
      reason: expect.stringContaining('签发'),
    })
  })

  it('authorizes publication success only after reading back the exact public article and title', async () => {
    const { policy, inspect } = createPolicy({
      stepId: 'verify-publication',
      publicationStatus: 'result-unknown',
    })
    const publicationUrl = 'https://blog.csdn.net/example/article/details/123456'
    await inspect({}, publicationUrl, 'published-article')

    expect(
      policy.authorizeTrustedReport(
        'web_affair_finish_attempt',
        { outcome: 'succeeded', url: publicationUrl },
        context,
        {
          workspaceId: 'workspace-a',
          affairId: 'affair-a',
          attemptId: 'attempt-a',
          executionGeneration: 1,
          launchOperationId: 'launch-a',
          conversationId: 'conversation-a',
          agentRunId: 'run-a',
        },
      ),
    ).toMatchObject({
      success: true,
      data: { trustedPageEvidence: { kind: 'published', url: publicationUrl } },
    })
  })

  it('does not treat a same-title management link as proof that this attempt published it', async () => {
    const publicationUrl = 'https://blog.csdn.net/example/article/details/123456'
    const { policy, inspect } = createPolicy({
      stepId: 'verify-publication',
      publicationStatus: 'result-unknown',
      publishedLinks: [{ url: publicationUrl, title: 'Article' }],
    })
    await inspect({}, 'https://mp.csdn.net/mp_blog/manage/article', 'management')

    expect(
      policy.authorizeTrustedReport(
        'web_affair_finish_attempt',
        { outcome: 'succeeded', url: publicationUrl },
        context,
        reporter(),
      ),
    ).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('不能证明') },
    })
  })

  it('invalidates trusted evidence when the exact Page binding changes at the same URL', async () => {
    const { policy, inspect, advancePageBinding } = createPolicy({ stepId: 'verify-account' })
    await inspect({})
    advancePageBinding()

    expect(
      policy.authorizeTrustedReport(
        'article_publishing_report_checkpoint',
        { stepId: 'verify-account', status: 'completed' },
        context,
        reporter(),
      ),
    ).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('过期') },
    })
  })

  it('does not declare an old uncertain upload absent without comparable platform identity', async () => {
    const { policy, inspect } = createPolicy({
      assetStatus: 'reconciling',
      imageEnumerationComplete: true,
    })
    await inspect({})

    expect(
      policy.authorizeTrustedReport(
        'article_publishing_report_asset',
        { assetId: 'asset-a', status: 'uploading' },
        context,
        reporter(),
      ),
    ).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('不能证明') },
    })
  })

  it('accepts an uploaded image only when the reported platform URL is visible in the editor', async () => {
    const platformUrl = 'https://img-blog.csdnimg.cn/transformed.png'
    const { policy, inspect } = createPolicy({
      assetStatus: 'verifying',
      imageEnumerationComplete: true,
      images: [{ src: platformUrl, alt: 'image' }],
    })
    await inspect({})

    expect(
      policy.authorizeTrustedReport(
        'article_publishing_report_asset',
        { assetId: 'asset-a', status: 'uploaded', platformUrl },
        context,
        reporter(),
      ),
    ).toMatchObject({
      success: true,
      data: {
        trustedPageEvidence: {
          kind: 'asset-uploaded',
          url: DRAFT_URL,
        },
      },
    })
  })

  it('hands legal and account-impact controls to the user', async () => {
    const { policy, inspect } = createPolicy()
    const page = {
      url: () => DRAFT_URL,
      locator: () => ({
        count: async () => 1,
        isVisible: async () => true,
        evaluate: async () => ({ label: '确认原创声明', type: '', role: 'button' }),
      }),
    }
    await inspect({ uploadConfirm: 'button:has-text("确认原创声明")' })

    await expect(
      policy.classifyAction(
        task as never,
        'click',
        { selector: 'button:has-text("确认原创声明")' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({ kind: 'handoff' })
  })

  it('persists a one-shot marker before allowing the authorized final publication', async () => {
    const { policy, webAffairService, inspect } = createPolicy({ stepId: 'publish' })
    const page = {
      url: () => DRAFT_URL,
      locator: () => ({
        count: async () => 1,
        isVisible: async () => true,
        evaluate: async () => ({ label: '发布', type: 'submit', role: 'button' }),
      }),
    }
    await inspect({ publish: 'button:has-text("发布")' })

    await expect(
      policy.classifyAction(
        task as never,
        'click',
        { selector: 'button:has-text("发布")' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({ kind: 'allow-once' })
    expect(webAffairService.reserveArticlePublishingSideEffect).toHaveBeenCalledWith(
      'affair-a',
      'attempt-a',
      1,
      'publish',
      'final',
      'task-a',
      'workspace-a',
    )
  })

  it('discards the first inspect when Page binding changes while the adapter probe is running', async () => {
    let advancePageBinding = (): void => undefined
    const harness = createPolicy({ duringProbe: () => advancePageBinding() })
    advancePageBinding = harness.advancePageBinding

    const result = await harness.inspect({ title: '#title' }, DRAFT_URL, 'editor', false)

    expect(result).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('Runtime 尚未收敛') },
    })
    expect(harness.webAffairService.completeArticlePublishingFirstInspect).not.toHaveBeenCalled()
  })

  it('re-inspects after a same-URL document reload during the probe, without handing off', async () => {
    let once = true
    const harness = createPolicy({
      duringProbe: () => {
        if (once) {
          once = false
          harness.advanceDocument()
        }
      },
    })
    await harness.inspect({ title: '#title' })
    expect(harness.webAffairService.startArticlePublishingFirstInspect).toHaveBeenCalledTimes(2)
    expect(harness.webAffairService.completeArticlePublishingFirstInspect).toHaveBeenCalledOnce()
    expect(harness.webAffairService.handoffAttempt).not.toHaveBeenCalled()
  })

  it('discards evidence that changes while queued for completion and inspects again', async () => {
    let once = true
    const harness = createPolicy({
      beforeComplete: () => {
        if (once) {
          once = false
          harness.advanceDocument()
        }
      },
    })
    await harness.inspect({ title: '#title' })
    expect(harness.webAffairService.completeArticlePublishingFirstInspect).toHaveBeenCalledTimes(2)
  })

  it.each(['document', 'view'] as const)(
    'rejects signed selectors after %s identity changes',
    async (change) => {
      const harness = createPolicy({ stepId: 'fill-fields' })
      const page = await harness.inspect({ title: '#title' })
      if (change === 'document') harness.advanceDocument()
      else harness.hideView()
      const decision = await harness.policy.classifyAction(
        task as never,
        'fill',
        { selector: '#title', value: 'Article' },
        page as never,
        context,
      )
      expect(decision?.kind).not.toBe('allow-once')
      expect(harness.webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
    },
  )

  it('persists a write-ahead marker before a field mutation that may autosave', async () => {
    const { policy, webAffairService, inspect } = createPolicy({ stepId: 'fill-fields' })
    const page = { url: () => DRAFT_URL }
    await inspect({ title: '#title' })

    await expect(
      policy.classifyAction(
        task as never,
        'fill',
        { selector: '#title', value: 'Article title' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({ kind: 'allow-once' })
    expect(webAffairService.reserveArticlePublishingSideEffect).toHaveBeenCalledWith(
      'affair-a',
      'attempt-a',
      1,
      'save-draft',
      expect.stringMatching(/^autosave:fill-fields:[0-9a-f-]{36}$/),
      'task-a',
      'workspace-a',
    )
  })

  it('binds a visible stable draft before the first platform mutation', async () => {
    const { policy, webAffairService, inspect } = createPolicy({
      stepId: 'fill-fields',
      draftUrl: null,
    })
    const page = { url: () => DRAFT_URL }
    await inspect({ title: '#title' })

    await expect(
      policy.classifyAction(
        task as never,
        'fill',
        { selector: '#title', value: 'Article title' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({ kind: 'allow-once' })
    expect(webAffairService.recordArticlePublishingDraftAnchor).toHaveBeenCalledWith(
      'affair-a',
      'attempt-a',
      1,
      'launch-a',
      DRAFT_URL,
      'workspace-a',
      'task-a',
    )
    expect(
      webAffairService.recordArticlePublishingDraftAnchor.mock.invocationCallOrder[0],
    ).toBeLessThan(webAffairService.reserveArticlePublishingSideEffect.mock.invocationCallOrder[0])
  })

  it('rejects a write when the visible page belongs to a different draft', async () => {
    const { policy, webAffairService, clearCurrentOperation } = createPolicy({
      stepId: 'fill-fields',
    })
    clearCurrentOperation()
    const page = {
      url: () => 'https://mp.csdn.net/mp_blog/creation/editor/164148818',
    }

    await expect(
      policy.classifyAction(
        task as never,
        'fill',
        { selector: '#title', value: 'Wrong article' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({
      kind: 'unknown',
      reason: expect.stringContaining('原草稿'),
    })
    expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
  })

  it('rejects mutations when the current recovery generation has no exact page write permit', async () => {
    const { policy, webAffairService, inspect } = createPolicy({
      stepId: 'fill-fields',
      recovery: {
        operationId: 'recovery-a',
        executionGeneration: 1,
        status: 'locating',
        expectedDraftId: '164148817',
        startedAt: '2026-09-01T00:00:00.000Z',
      },
    })
    const page = { url: () => DRAFT_URL }
    await inspect({ title: '#title' })

    await expect(
      policy.classifyAction(
        task as never,
        'fill',
        { selector: '#title', value: 'Article title' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({
      kind: 'runtime-error',
      reason: expect.stringContaining('正在收敛'),
    })
    expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
  })

  it('keeps a recovered permit bound to the exact Runtime without comparing page content', async () => {
    const recovery = {
      operationId: 'recovery-a',
      executionGeneration: 1,
      status: 'verified',
      expectedDraftId: '164148817',
      expectedTitle: 'Article',
      startedAt: '2026-09-01T00:00:00.000Z',
      writePermit: {
        id: 'permit-a',
        recoveryOperationId: 'recovery-a',
        executionGeneration: 1,
        draftId: '164148817',
        tabId: 'tab-a',
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        playwrightConnectionGeneration: 3,
        playwrightPageBindingGeneration: 4,
        issuedAt: '2026-09-01T00:00:01.000Z',
      },
    }
    const { policy, inspect } = createPolicy({
      stepId: 'fill-fields',
      recovery,
      imageEnumerationComplete: true,
    })
    const page = (await inspect({ title: '#title' })) as {
      evaluate: () => Promise<Record<string, unknown>>
    }
    page.evaluate = async () => ({
      url: DRAFT_URL,
      pageKind: 'editor',
      bodySelector: '#body',
      bodyTextLength: 20,
      accountHrefCandidates: ['https://blog.csdn.net/test-user'],
      imageEnumerationComplete: true,
      images: [],
      titleSelector: '#title',
      titleValue: 'Article',
      selectors: { title: '#title' },
      saveStatusTexts: ['草稿已保存'],
      publishedLinks: [],
    })

    await expect(
      policy.classifyAction(
        task as never,
        'fill',
        { selector: '#title', value: 'Article title' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({ kind: 'allow-once' })
  })

  it('rejects a write on a generic editor that cannot be recovered after restart', async () => {
    const { policy, webAffairService, clearCurrentOperation } = createPolicy({
      stepId: 'fill-fields',
      draftUrl: null,
    })
    clearCurrentOperation()
    const page = { url: () => 'https://editor.csdn.net/md/' }

    await expect(
      policy.classifyAction(
        task as never,
        'fill',
        { selector: '#title', value: 'Unanchored article' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({
      kind: 'unknown',
      reason: expect.stringContaining('稳定草稿编号'),
    })
    expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
  })

  it('stops page mutations on a supported origin when the page is not an editor page', async () => {
    const { policy, clearCurrentOperation } = createPolicy()
    clearCurrentOperation()
    const page = { url: () => 'https://app-blog.csdn.net/account/settings' }

    await expect(
      policy.classifyAction(
        task as never,
        'fill',
        { selector: 'input', value: 'article title' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({ kind: 'unknown' })
  })

  it('fails closed instead of falling back to generic account rules for a stale article task', async () => {
    const { policy } = createPolicy({ executionStatus: 'waiting-human' })
    const page = { url: () => 'https://app-blog.csdn.net/csdn/aiChatNew' }

    await expect(
      policy.resolveAllowedOrigins({
        workspacePath: '/workspace',
        affairId: 'affair-a',
        attemptId: 'attempt-a',
        accountId: 'account-a',
      }),
    ).resolves.toEqual([])
    await expect(
      policy.classifyAction(task as never, 'fill', {}, page as never, context),
    ).resolves.toMatchObject({ kind: 'runtime-error' })
  })

  it('rejects a stale Browser/CDP owner epoch inside the same execution generation', async () => {
    const { policy, webAffairService } = createPolicy()
    const staleTask = {
      ...task,
      correlation: {
        ...task.correlation,
        playwrightPageBindingGeneration: 3,
      },
    }
    const page = { url: () => 'https://app-blog.csdn.net/csdn/aiChatNew' }

    await expect(
      policy.classifyAction(staleTask as never, 'fill', {}, page as never, context),
    ).resolves.toMatchObject({ kind: 'runtime-error' })
    expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
  })

  it('keeps verification checkpoints read-only', async () => {
    const { policy, clearCurrentOperation } = createPolicy({ stepId: 'verify-publication' })
    clearCurrentOperation()
    const page = { url: () => 'https://blog.csdn.net/example/article/details/1' }

    await expect(
      policy.classifyAction(task as never, 'click', { selector: 'button' }, page as never, context),
    ).resolves.toMatchObject({ kind: 'unknown' })
  })
})

function reporter() {
  return {
    workspaceId: 'workspace-a',
    affairId: 'affair-a',
    attemptId: 'attempt-a',
    executionGeneration: 1,
    launchOperationId: 'launch-a',
    conversationId: 'conversation-a',
    agentRunId: 'run-a',
  }
}
