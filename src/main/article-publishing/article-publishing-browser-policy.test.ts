import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { BilibiliPublishingAdapter } from './bilibili-publishing-adapter'
import { WeiboPublishingAdapter } from './weibo-publishing-adapter'
import { CsdnPublishingAdapter } from './csdn-publishing-adapter'
import { TOUTIAO_DISABLE_MUSIC_SELECTOR } from './toutiao-publishing-adapter'
vi.mock('./article-body', () => ({ prepareArticleBody: vi.fn(async () => '<p>Article</p>') }))
vi.spyOn(CsdnPublishingAdapter.prototype, 'verifyBody').mockResolvedValue({
  matches: true,
  textMatches: true,
  textEvidence: '正文一致',
  expectedImages: 0,
  actualImages: 0,
  images: [],
})
vi.spyOn(WeiboPublishingAdapter.prototype, 'verifyBody').mockResolvedValue({
  matches: true,
  textMatches: true,
  textEvidence: 'current composer',
  expectedImages: 0,
  actualImages: 0,
  images: [],
})
import {
  ArticlePublishingBrowserPolicy,
  CSDN_ARTICLE_SUPPORTED_ORIGINS,
} from './article-publishing-browser-policy'

const DRAFT_URL = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'

function createPolicy(options?: {
  adapterId?: 'csdn' | 'weibo' | 'toutiao' | 'bilibili'
  musicChecked?: boolean | null
  weiboUid?: string
  stepId?: string
  publicationStatus?: string
  allowPublish?: boolean
  publicationBlocker?: string
  assetId?: string
  platformUrl?: string
  assetStatus?: string
  executionStatus?: string
  draftUrl?: string | null
  recovery?: Record<string, unknown>
  imageEnumerationComplete?: boolean
  images?: Array<{ src: string; alt: string; loaded?: boolean }>
  publishedLinks?: Array<{ url: string; title: string }>
  awaitRuntimeConvergence?: (attemptId: string) => Promise<void>
  duringProbe?: () => void
  beforeComplete?: () => void
  bodyFrameSelector?: string
  initialDraftBodyEmpty?: boolean
  initialDraftBodyText?: string
  titleValue?: string
  summary?: string
  tags?: string[]
  tagEditor?: { openSelector?: string; inputSelector?: string; pendingValue: string }
  fieldValues?: Record<string, string>
  sideEffects?: Array<Record<string, unknown>>
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
      adapterId: options?.adapterId ?? 'csdn',
      ...(['weibo', 'bilibili'].includes(options?.adapterId ?? '')
        ? {
            composer: {
              platformAccountId: '5961101548',
              allowPublish: options?.allowPublish ?? false,
            },
          }
        : {}),
      adapterVersion: 1,
      accountId: 'account-a',
      source: { markdownPath: '/workspace/article.md', modifiedAt: 1, size: 10 },
      fields: {
        title: 'Article',
        summary: options?.summary ?? '',
        tags: options?.tags ?? [],
        category: '',
      },
      assets: [
        {
          id: options?.assetId ?? 'asset-a',
          kind: 'local',
          sourcePath: '/workspace/a.png',
          platformUrl: options?.platformUrl,
          displayPath: 'a.png',
          occurrences: [],
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
      sideEffects: options?.sideEffects ?? [],
      publication: { status: options?.publicationStatus ?? 'not-started' },
      draft:
        options?.draftUrl === null
          ? undefined
          : {
              platformDraftId: '164148817',
              platformAccountId: options?.adapterId === 'toutiao' ? '12345' : 'csdn:test-user',
              normalizedTitle: 'Article',
              url: options?.draftUrl ?? DRAFT_URL,
              ...(options?.recovery ? { recovery: options.recovery } : {}),
            },
    },
  })
  const webAffairService = {
    recordBilibiliSubmissionObservation: vi.fn().mockResolvedValue({ success: true, data: {} }),
    recordBilibiliSubmissionReceipt: vi.fn().mockResolvedValue({ success: true, data: {} }),
    recordArticlePublishingImageObservation: vi.fn().mockResolvedValue({ success: true, data: {} }),
    recordArticlePublishingPlanResults: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getProjectSnapshot: vi.fn(() => ({
      success: true,
      data: {
        affairs: [snapshotAffair()],
      },
    })),
    reserveArticlePublishingSideEffect,
    recordArticlePublishingDraftAnchor,
    recordArticlePublishingPageObservation: vi.fn().mockResolvedValue({ success: true, data: {} }),
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
  const startActionLog = vi.fn(() => ({ id: 'verified-read' }))
  const succeedActionLog = vi.fn()
  const policy = new ArticlePublishingBrowserPolicy(
    webAffairService as never,
    async () => 'workspace-a',
    {
      getPageById: () => inspectionPage,
      getPageBindingIdentity: () => currentPageBinding,
    } as never,
    {
      startActionLog,
      succeedActionLog,
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
    startActionLog,
    succeedActionLog,
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
            ...(options?.adapterId === 'toutiao'
              ? {
                  uid: '12345',
                  editorRecognized: true,
                  text: 'Article',
                  title: 'Article',
                  observedAt: new Date().toISOString(),
                  options: [{ label: '开启配乐', checked: options.musicChecked }],
                }
              : {}),
            ...(options?.adapterId === 'weibo'
              ? {
                  uid: options.weiboUid ?? '5961101548',
                  recognized: true,
                  text: ['open-editor', 'upload-assets'].includes(options?.stepId ?? '')
                    ? ''
                    : 'Article',
                  publishSelector: selectors.publish,
                  fileInputSelector: selectors.fileInput,
                  privacy: true,
                }
              : {}),
            ...(options?.adapterId === 'bilibili'
              ? {
                  uid: '5961101548',
                  recognized: true,
                  text: options.stepId === 'publish' ? 'Article' : '',
                  title: options.stepId === 'publish' ? 'Article' : '',
                  publishSelector: selectors.publish,
                  uploadSelector: selectors.fileInput,
                  immediatePublishPresent: Boolean(selectors.publish),
                  visibility: options.stepId === 'publish' ? 'public' : 'unknown',
                  observedAt: new Date().toISOString(),
                }
              : {}),
            url,
            pageKind,
            publicationBlocker: options?.publicationBlocker,
            bodySelector: selectors['body'] ?? '#body',
            bodyFrameSelector: options?.bodyFrameSelector,
            bodyTextLength: 100,
            initialDraftBodyEmpty: options?.initialDraftBodyEmpty,
            initialDraftBodyText: options?.initialDraftBodyText,
            accountHrefCandidates: ['https://blog.csdn.net/test-user'],
            imageEnumerationComplete: options?.imageEnumerationComplete ?? false,
            images: options?.images ?? [],
            fileInputSelector: selectors['fileInput'],
            titleSelector: selectors['title'] ?? '#title',
            titleValue: options?.titleValue ?? 'Article',
            selectors,
            tagEditor: options?.tagEditor,
            fieldValues: options?.fieldValues,
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
  it.each([
    'disabled-entry',
    'authorized-retry',
    'private',
    'scheduled',
    'changed-body',
    'damaged-body-structure',
    'changed-title',
    'changed-account',
    'changed-image',
  ])('revalidates the confirmation phase with a disabled original entry (%s)', async (mode) => {
    const image = 'https://i0.hdslb.com/bfs/new_dyn/fixture.png'
    const verification = vi
      .spyOn(BilibiliPublishingAdapter.prototype, 'verifyBody')
      .mockResolvedValue({
        matches: true,
        textMatches: true,
        textEvidence: 'frozen',
        expectedImages: 1,
        actualImages: 1,
        images: [{ src: image, actualSrc: image, matches: true, alt: '' }],
      } as never)
    const { policy, inspect, webAffairService } = createPolicy({
      adapterId: 'bilibili',
      stepId: 'publish',
      allowPublish: true,
      draftUrl: null,
      platformUrl: image,
      imageEnumerationComplete: true,
      images: [{ src: image, alt: '', loaded: true }],
    })
    const page = await inspect({ publish: '#publish' }, 'https://t.bilibili.com/')
    const events = new EventEmitter()
    Object.assign(page, { on: events.on.bind(events), off: events.off.bind(events) })
    let submission: Awaited<ReturnType<typeof policy.preparePublicationSubmit>> = null
    const click = vi.fn(async () => {
      const request = {
        method: () => 'POST',
        url: () => 'https://api.bilibili.com/x/dynamic/feed/create/dyn',
        postDataJSON: () => ({
          dyn_req: {
            content: { contents: [{ raw_text: 'Article' }] },
            pics: [{ img_src: image }],
          },
        }),
      }
      events.emit('request', request)
      events.emit('response', {
        status: () => 200,
        request: () => request,
        json: async () => ({ code: 0, data: { dyn_id_str: '1246694229973925912' } }),
      })
    })
    try {
      if (mode === 'authorized-retry') {
        const snapshot = webAffairService.getProjectSnapshot()
        const state = snapshot.data.affairs[0].articlePublishing
        state.publication.status = 'result-unknown'
        Object.assign(state, {
          bilibiliRetry: {
            attemptId: 'attempt-a',
            executionGeneration: 1,
            previousEffectKey: 'old',
            authorizedAt: new Date().toISOString(),
          },
        })
        state.sideEffects = [
          { key: 'old', kind: 'publish', executionGeneration: 0, status: 'result-unknown' },
        ]
        webAffairService.getProjectSnapshot.mockReturnValue(snapshot)
      }
      submission = await policy.preparePublicationSubmit(
        task as never,
        'publish-key',
        page as never,
        context,
      )
      expect(submission).not.toBeNull()
      const evaluateComposer = (page as Record<string, unknown>).evaluate as (
        ...args: unknown[]
      ) => Promise<Record<string, unknown>>
      Object.assign(page, {
        frameLocator: () => ({ getByRole: () => ({ waitFor: async () => undefined }) }),
        getByRole: () => ({ waitFor: async () => undefined, click }),
        evaluate: async (fn: unknown, args: unknown) =>
          args
            ? {
                ...(await evaluateComposer(fn, args)),
                publishSelector: undefined,
                immediatePublishPresent: mode !== 'scheduled',
                bodyStructureValid: mode !== 'damaged-body-structure',
                visibility: mode === 'private' ? 'private' : 'public',
                text: mode === 'changed-body' ? 'changed' : 'Article',
                title: mode === 'changed-title' ? 'changed' : 'Article',
                uid: mode === 'changed-account' ? '1234567890' : '5961101548',
                images: [{ src: image, alt: '', loaded: mode !== 'changed-image' }],
              }
            : 'recognized',
      })
      submission!.arm()
      if (['disabled-entry', 'authorized-retry'].includes(mode)) {
        await submission!.finish()
        expect(click).toHaveBeenCalledTimes(1)
        expect(webAffairService.recordBilibiliSubmissionReceipt).toHaveBeenCalledTimes(1)
      } else {
        await expect(submission!.finish()).rejects.toThrow('首次确认前')
        expect(click).not.toHaveBeenCalled()
        expect(webAffairService.recordBilibiliSubmissionReceipt).not.toHaveBeenCalled()
      }
    } finally {
      await submission?.dispose()
      verification.mockRestore()
    }
  })

  it('keeps receipt-only recovery independent of a failed B站 confirmation and persists it once', async () => {
    const image = 'https://i0.hdslb.com/bfs/new_dyn/fixture.png'
    const verification = vi
      .spyOn(BilibiliPublishingAdapter.prototype, 'verifyBody')
      .mockResolvedValue({
        matches: true,
        textMatches: true,
        textEvidence: 'same frozen text',
        expectedImages: 1,
        actualImages: 1,
        images: [{ src: image, actualSrc: image, matches: true, alt: '' }],
      } as never)
    const { policy, inspect, webAffairService } = createPolicy({
      adapterId: 'bilibili',
      stepId: 'publish',
      allowPublish: true,
      draftUrl: null,
      platformUrl: image,
      imageEnumerationComplete: true,
      images: [{ src: image, alt: '', loaded: true }],
    })
    const page = await inspect({ publish: '#publish' }, 'https://t.bilibili.com/')
    const events = new EventEmitter()
    Object.assign(page, { on: events.on.bind(events), off: events.off.bind(events) })
    let submission: Awaited<ReturnType<typeof policy.preparePublicationSubmit>> = null
    const click = vi.fn()
    try {
      submission = await policy.preparePublicationSubmit(
        task as never,
        'publish-key',
        page as never,
        context,
      )
      expect(submission).not.toBeNull()
      Object.assign(page, {
        frameLocator: () => ({ getByRole: () => ({ waitFor: async () => undefined }) }),
        getByRole: () => ({ waitFor: async () => undefined, click }),
        evaluate: async () => '规范文档不可读',
      })
      submission!.arm()
      await expect(submission!.finish()).rejects.toThrow('规范文档不可读')
      const recovery = submission!.finish(false)
      const request = {
        method: () => 'POST',
        url: () => 'https://api.bilibili.com/x/dynamic/feed/create/dyn',
        postDataJSON: () => ({
          dyn_req: { content: { contents: [{ raw_text: 'Article' }] }, pics: [{ img_src: image }] },
        }),
      }
      events.emit('request', request)
      events.emit('response', {
        status: () => 200,
        request: () => request,
        json: async () => ({ code: 0, data: { dyn_id_str: '1246694229973925912' } }),
      })
      await recovery
      await submission!.finish(false)
      await expect(submission!.finish()).rejects.toThrow('规范文档不可读')
      expect(click).not.toHaveBeenCalled()
      expect(webAffairService.recordBilibiliSubmissionReceipt).toHaveBeenCalledTimes(1)
      expect(webAffairService.recordBilibiliSubmissionReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ postId: '1246694229973925912', sideEffectKey: 'publish-key' }),
        'workspace-a',
      )
    } finally {
      await submission?.dispose()
      verification.mockRestore()
    }
    expect(webAffairService.recordBilibiliSubmissionObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        observation: {
          confirmationAttempted: false,
          requestObserved: true,
          observationEnded: true,
          requestMatch: 'matched',
          responseStatus: 200,
          platformCode: 0,
        },
      }),
      'workspace-a',
    )
    expect(events.listenerCount('request') + events.listenerCount('response')).toBe(0)
  })

  it.each([true, false])(
    'records B站 public image and body evidence in publication steps (matches=%s)',
    async (matches) => {
      const platformUrl = 'https://i0.hdslb.com/bfs/new_dyn/picture.png'
      const { policy, webAffairService } = createPolicy({ adapterId: 'bilibili', platformUrl })
      const snapshot = webAffairService.getProjectSnapshot()
      const state = snapshot.data.affairs[0].articlePublishing
      state.assets[0].occurrences = [{ index: 0 }] as never
      webAffairService.getProjectSnapshot.mockReturnValue(snapshot)
      const adapter = Reflect.get(policy, 'adapter')
      const verify = vi.spyOn(adapter, 'verifyBody').mockResolvedValue({
        matches,
        textMatches: matches,
        textEvidence: 'actual public body',
        images: [{ src: platformUrl, index: 0, matches }],
      })
      try {
        await Reflect.get(policy, 'verifyFrozenBody').call(
          policy,
          {
            workspaceId: 'workspace-a',
            affairId: 'affair-a',
            adapterId: 'bilibili',
            assets: state.assets,
          },
          { url: () => 'https://t.bilibili.com/112233445566778899' },
          () => true,
        )
        const results = webAffairService.recordArticlePublishingPlanResults.mock.calls[0][0].results
        expect(results[0]).toMatchObject({
          id: 'asset.asset-a.published',
          status: matches ? 'completed' : 'waiting',
        })
        if (!matches)
          expect(results[1]).toMatchObject({ id: 'publication.verify', status: 'waiting' })
        expect(
          results.some(
            (r: { id: string }) => r.id === 'body.verify' || r.id.endsWith('.placement'),
          ),
        ).toBe(false)
      } finally {
        verify.mockRestore()
      }
    },
  )

  it('only disables currently checked Toutiao music, then requires fresh evidence before another click', async () => {
    const options = {
      adapterId: 'toutiao' as const,
      stepId: 'publish',
      assetStatus: 'pending',
      draftUrl: 'https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=164148817',
      musicChecked: true,
    }
    const { policy, inspect, webAffairService } = createPolicy(options)
    const page = await inspect({}, options.draftUrl)
    const params = { selector: TOUTIAO_DISABLE_MUSIC_SELECTOR }
    expect(
      await policy.classifyAction(task as never, 'click', params, page as never, context),
    ).toMatchObject({ kind: 'allow' })
    expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
    options.musicChecked = false
    expect(
      await policy.classifyAction(task as never, 'click', params, page as never, context),
    ).toMatchObject({ kind: 'runtime-error' })
  })
  it.each(['generation', 'cancel', 'submitted'] as const)(
    'does not change Toutiao music after %s',
    async (mode) => {
      const url = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=164148817'
      const { policy, inspect, advanceDocument } = createPolicy({
        adapterId: 'toutiao',
        stepId: 'publish',
        assetStatus: 'pending',
        draftUrl: url,
        musicChecked: true,
        publicationStatus: mode === 'submitted' ? 'dispatched' : 'not-started',
      })
      const page = await inspect({}, url)
      if (mode === 'generation') advanceDocument()
      const signal = new AbortController()
      if (mode === 'cancel') signal.abort()
      expect(
        await policy.classifyAction(
          task as never,
          'click',
          { selector: TOUTIAO_DISABLE_MUSIC_SELECTOR },
          page as never,
          { ...context, abortSignal: signal.signal },
        ),
      ).not.toMatchObject({ kind: 'allow' })
    },
  )
  it('allows a bounded Weibo single-image upload without claiming a saved draft', async () => {
    const { policy, inspect, webAffairService } = createPolicy({
      adapterId: 'weibo',
      draftUrl: null,
      stepId: 'upload-assets',
      assetStatus: 'uploading',
      imageEnumerationComplete: true,
    })
    const page = await inspect({ fileInput: '#upload' }, 'https://weibo.com/')
    expect(
      await policy.classifyAction(
        task as never,
        'uploadFile',
        { selector: '#upload', paths: ['/workspace/a.png'] },
        page as never,
        context,
      ),
    ).toMatchObject({ kind: 'allow-once' })
    await expect(
      policy.preparePublicationSubmit(task as never, 'upload-key', page as never, context),
    ).resolves.toBeNull()
    expect(webAffairService.recordArticlePublishingDraftAnchor).not.toHaveBeenCalled()
    expect(webAffairService.recordArticlePublishingPageObservation).not.toHaveBeenCalled()
  })

  it('allows a bounded Bilibili upload on its attested native composer without inventing a draft', async () => {
    const { policy, inspect, webAffairService } = createPolicy({
      adapterId: 'bilibili',
      draftUrl: null,
      stepId: 'upload-assets',
      assetStatus: 'uploading',
      imageEnumerationComplete: true,
    })
    const selector = 'div.bili-dyn-publishing__tools__item.pic'
    const page = await inspect({ fileInput: selector }, 'https://t.bilibili.com/')
    expect(
      await policy.classifyAction(
        task as never,
        'uploadFile',
        { selector, paths: ['/workspace/a.png'] },
        page as never,
        context,
      ),
    ).toMatchObject({ kind: 'allow-once' })
    expect(webAffairService.recordArticlePublishingDraftAnchor).not.toHaveBeenCalled()
  })

  it('blocks Weibo submit even with a current matching composer and publish selector', async () => {
    const { policy, inspect, webAffairService } = createPolicy({
      adapterId: 'weibo',
      draftUrl: null,
      stepId: 'publish',
      imageEnumerationComplete: true,
    })
    const page = await inspect({ publish: '#publish' }, 'https://weibo.com/')
    Reflect.set(page, 'locator', () => ({
      count: async () => 1,
      isVisible: async () => true,
      evaluate: async () => ({ label: '发送', type: 'button', role: 'button' }),
    }))
    expect(
      await policy.classifyAction(
        task as never,
        'click',
        { selector: '#publish' },
        page as never,
        context,
      ),
    ).toMatchObject({ kind: 'handoff' })
    expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
  })

  it('records the wrong Weibo UID as a concrete page-check blocker', async () => {
    const { inspect, webAffairService } = createPolicy({
      adapterId: 'weibo',
      draftUrl: null,
      stepId: 'open-editor',
      weiboUid: '1234567890',
      assetStatus: 'pending',
      imageEnumerationComplete: true,
    })
    await inspect({}, 'https://weibo.com/', 'editor', false)
    expect(webAffairService.completeArticlePublishingFirstInspect).not.toHaveBeenCalled()
    expect(webAffairService.recordArticlePublishingPlanResults).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [
          expect.objectContaining({
            id: 'page.inspect',
            status: 'waiting',
            evidence: expect.stringContaining('1234567890'),
          }),
        ],
      }),
      expect.any(Function),
    )
  })

  it('records the exact image and reason when a real upload dispatch is rejected', async () => {
    const { policy, inspect, webAffairService } = createPolicy({
      stepId: 'upload-assets',
      assetStatus: 'pending',
    })
    const page = await inspect({ fileInput: '#upload' })
    const decision = await policy.classifyAction(
      task as never,
      'uploadFile',
      { selector: '#upload', paths: ['/workspace/a.png'] },
      page as never,
      context,
    )
    expect(decision).toMatchObject({ kind: 'unknown' })
    expect(webAffairService.recordArticlePublishingPlanResults).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [
          expect.objectContaining({
            id: 'asset.asset-a.dispatch',
            status: 'failed',
            evidence: expect.stringContaining('a.png'),
            reason: expect.stringContaining('uploading'),
          }),
        ],
      }),
      expect.any(Function),
    )
  })

  it('records a real visible adapter read for verification-only BrowserTask completion, never a hidden read', async () => {
    const harness = createPolicy({ stepId: 'verify-publication' })
    await harness.inspect(
      {},
      'https://blog.csdn.net/test-user/article/details/164148817',
      'published-article',
    )
    expect(harness.startActionLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'article_publishing_inspect_page', taskRunId: 'task-a' }),
    )
    expect(harness.succeedActionLog).toHaveBeenCalledWith('verified-read')
    harness.startActionLog.mockClear()
    harness.succeedActionLog.mockClear()
    harness.hideView()
    await harness.inspect({}, DRAFT_URL, 'editor', false)
    expect(harness.startActionLog).not.toHaveBeenCalled()
    expect(harness.succeedActionLog).not.toHaveBeenCalled()
  })

  it('only submits frozen tags through the inspected input and separates the search buffer from article writes', async () => {
    const harness = createPolicy({
      stepId: 'fill-fields',
      tags: ['软件测试'],
      tagEditor: {
        openSelector: '#add-tag',
        inputSelector: '#tag-query',
        pendingValue: '软件测试',
      },
      fieldValues: { tags: '' },
    })
    await harness.inspect({ tags: '#tag-query', title: '#title' })
    const page = { url: () => DRAFT_URL, locator: () => ({ inputValue: async () => '软件测试' }) }
    expect(
      await harness.policy.classifyAction(
        task as never,
        'click',
        { selector: '#add-tag' },
        page as never,
        context,
      ),
    ).toMatchObject({ kind: 'allow' })
    expect(
      await harness.policy.classifyAction(
        task as never,
        'fill',
        { selector: '#tag-query', value: '软件测试' },
        page as never,
        context,
      ),
    ).toMatchObject({ kind: 'allow' })
    expect(harness.webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
    expect(
      await harness.policy.classifyAction(
        task as never,
        'fill',
        { selector: '#tag-query', value: '未授权标签' },
        page as never,
        context,
      ),
    ).toMatchObject({ kind: 'runtime-error' })
    await harness.policy.classifyAction(
      task as never,
      'press',
      { selector: '#tag-query', key: 'Enter' },
      page as never,
      context,
    )
    expect(harness.webAffairService.reserveArticlePublishingSideEffect).toHaveBeenCalledWith(
      'affair-a',
      'attempt-a',
      1,
      'save-draft',
      expect.stringContaining('autosave:fill-fields:tags:'),
      'task-a',
      'workspace-a',
    )
  })

  it('cannot complete all platform fields using only a matching title when summary is unreadable', async () => {
    const { policy, webAffairService, inspect } = createPolicy({
      stepId: 'fill-fields',
      summary: 'Required summary',
    })
    await inspect({ title: '#title' })
    expect(webAffairService.recordArticlePublishingPlanResults).toHaveBeenCalledWith(
      expect.objectContaining({
        results: expect.arrayContaining([
          expect.objectContaining({ id: 'field.summary.verify', status: 'waiting' }),
        ]),
      }),
      expect.any(Function),
    )
    expect(
      policy.authorizeTrustedReport(
        'article_publishing_report_checkpoint',
        { stepId: 'fill-fields', status: 'completed' },
        context,
        reporter(),
      ),
    ).toMatchObject({ success: false })
  })

  it('permits only the bounded title seed in the attested first-draft body frame, not full content or another frame', async () => {
    const { policy, inspect } = createPolicy({
      stepId: 'open-editor',
      draftUrl: null,
      initialDraftBodyEmpty: true,
      bodyFrameSelector: 'iframe.cke_wysiwyg_frame',
      sideEffects: [
        {
          targetId: 'initial-draft:title',
          executionGeneration: 1,
          browserTaskRunId: 'task-a',
          status: 'dispatched',
        },
      ],
    })
    const page = await inspect(
      { body: '#body', title: '#title' },
      'https://mp.csdn.net/mp_blog/creation/editor',
    )
    const params = {
      frameAction: 'fill',
      frameSelector: 'iframe.cke_wysiwyg_frame',
      selector: '#body',
      value: 'Article',
    }
    expect(
      await policy.classifyAction(task as never, 'frameExecute', params, page as never, context),
    ).toMatchObject({ kind: 'allow-once' })
    for (const changed of [
      { ...params, value: 'full article content' },
      { ...params, frameSelector: 'iframe.ai-chat' },
    ]) {
      expect(
        await policy.classifyAction(task as never, 'frameExecute', changed, page as never, context),
      ).toMatchObject({ kind: 'runtime-error' })
    }
  })

  it('hit-tests the initial save before creating a response observer or consuming its capability', async () => {
    const { policy, inspect, webAffairService } = createPolicy({
      stepId: 'open-editor',
      draftUrl: null,
      initialDraftBodyEmpty: true,
      initialDraftBodyText: 'Article',
      sideEffects: [{ key: 'initial-save', targetId: 'initial-draft:save', status: 'reserved' }],
    })
    const page = await inspect(
      { title: '#title', save: '#save' },
      'https://mp.csdn.net/mp_blog/creation/editor',
    )
    const click = vi.fn().mockRejectedValue(new Error('AI drawer covers save'))
    ;(page as Record<string, unknown>).locator = () => ({ click })
    await expect(
      policy.prepareInitialDraftSave(task as never, 'initial-save', page as never, context),
    ).rejects.toThrow('covers save')
    expect(click).toHaveBeenCalledWith({ trial: true, timeout: 3_000 })
    expect(webAffairService.recordArticlePublishingDraftAnchor).not.toHaveBeenCalled()
  })

  it.each(['open-editor', 'verify-account', 'fill-body'])(
    'only closes the attested CSDN drawer at %s',
    async (stepId) => {
      const { policy, inspect, webAffairService, advanceDocument } = createPolicy({
        stepId,
        bodyFrameSelector: 'iframe.cke_wysiwyg_frame',
      })
      const page = await inspect({
        dismissAssistant: '.edit-drawer-content > img.edit-title-close',
      })
      const params = { selector: '.edit-drawer-content > img.edit-title-close' }
      expect(
        await policy.classifyAction(task as never, 'click', params, page as never, context),
      ).toMatchObject({ kind: 'allow' })
      expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
      advanceDocument()
      expect(
        await policy.classifyAction(task as never, 'click', params, page as never, context),
      ).not.toMatchObject({ kind: 'allow' })
    },
  )

  it.each(['fill-fields', 'save-draft', 'publish'])(
    'closes only the attested tag popup before %s',
    async (stepId) => {
      const { policy, inspect, webAffairService, advanceDocument } = createPolicy({ stepId })
      const selector = '.mark_selection_box .modal__close-button[aria-label="关闭"]'
      const page = await inspect({ dismissTagEditor: selector })
      expect(
        await policy.classifyAction(task as never, 'click', { selector }, page as never, context),
      ).toMatchObject({ kind: 'allow' })
      expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
      advanceDocument()
      expect(
        await policy.classifyAction(task as never, 'click', { selector }, page as never, context),
      ).not.toMatchObject({ kind: 'allow' })
    },
  )

  it('only allows the frozen title in a proven empty first editor, not arbitrary no-ID writes', async () => {
    const { policy, inspect, webAffairService } = createPolicy({
      stepId: 'open-editor',
      draftUrl: null,
      initialDraftBodyEmpty: true,
      initialDraftBodyText: 'Article',
      titleValue: '',
    })
    const page = await inspect(
      { title: '#title', save: '#save' },
      'https://mp.csdn.net/mp_blog/creation/editor',
    )
    expect(
      await policy.classifyAction(
        task as never,
        'fill',
        { selector: '#title', value: 'Other' },
        page as never,
        context,
      ),
    ).toMatchObject({ kind: 'runtime-error' })
    expect(
      await policy.classifyAction(
        task as never,
        'fill',
        { selector: '#title', value: 'Article' },
        page as never,
        context,
      ),
    ).toMatchObject({ kind: 'allow-once' })
    expect(webAffairService.reserveArticlePublishingSideEffect).toHaveBeenCalledWith(
      'affair-a',
      'attempt-a',
      1,
      'save-draft',
      'initial-draft:title',
      'task-a',
      'workspace-a',
    )
  })

  it.each([true, false])(
    'requires the same-run seed authorization before first save: %s',
    async (authorized) => {
      const { policy, inspect } = createPolicy({
        stepId: 'open-editor',
        draftUrl: null,
        initialDraftBodyEmpty: true,
        initialDraftBodyText: 'Article',
        sideEffects: authorized
          ? [
              {
                targetId: 'initial-draft:body',
                executionGeneration: 1,
                browserTaskRunId: 'task-a',
                status: 'dispatched',
              },
            ]
          : [],
      })
      const page = await inspect(
        { title: '#title', save: '#save' },
        'https://mp.csdn.net/mp_blog/creation/editor',
      )
      expect(
        await policy.classifyAction(
          task as never,
          'click',
          { selector: '#save' },
          page as never,
          context,
        ),
      ).toMatchObject({ kind: authorized ? 'allow-once' : 'runtime-error' })
    },
  )

  it('allows only the attested CSDN body iframe fill and reserves its autosave effect', async () => {
    const { policy, inspect, webAffairService } = createPolicy({
      stepId: 'fill-body',
      bodyFrameSelector: 'iframe.cke_wysiwyg_frame',
    })
    const page = await inspect({ body: 'body.cke_editable[contenteditable="true"]' })
    const action = {
      frameSelector: 'iframe.cke_wysiwyg_frame',
      frameAction: 'fill',
      selector: 'body.cke_editable[contenteditable="true"]',
      value: 'Test',
    }
    await expect(
      policy.classifyAction(task as never, 'frameExecute', action, page as never, context),
    ).resolves.toMatchObject({ kind: 'allow-once' })
    expect(webAffairService.reserveArticlePublishingSideEffect).toHaveBeenCalledOnce()
    for (const changed of [
      { ...action, frameSelector: 'iframe[src*="aiChatNew"]' },
      { ...action, frameAction: 'click' },
      { ...action, selector: 'input[type="password"]' },
    ]) {
      await expect(
        policy.classifyAction(task as never, 'frameExecute', changed, page as never, context),
      ).resolves.toMatchObject({ kind: 'runtime-error' })
    }
    await expect(
      policy.classifyAction(task as never, 'fill', action, page as never, context),
    ).resolves.toMatchObject({ kind: 'runtime-error' })
    expect(webAffairService.reserveArticlePublishingSideEffect).toHaveBeenCalledOnce()
  })

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

  it('refuses publication completion when the public body or images do not match', async () => {
    vi.mocked(CsdnPublishingAdapter.prototype.verifyBody).mockResolvedValueOnce({
      matches: false,
      textMatches: true,
      textEvidence: 'text matches but image missing',
      expectedImages: 1,
      actualImages: 0,
      images: [],
    })
    const { policy, inspect } = createPolicy({
      stepId: 'verify-publication',
      publicationStatus: 'result-unknown',
    })
    const url = 'https://blog.csdn.net/example/article/details/123456'
    await inspect({}, url, 'published-article')
    const reporter = {
      workspaceId: 'workspace-a',
      affairId: 'affair-a',
      attemptId: 'attempt-a',
      executionGeneration: 1,
      launchOperationId: 'launch-a',
      conversationId: 'conversation-a',
      agentRunId: 'run-a',
    }
    expect(
      policy.authorizeTrustedReport(
        'web_affair_finish_attempt',
        { outcome: 'succeeded', url },
        context,
        reporter,
      ).success,
    ).toBe(false)
    expect(
      policy.authorizeTrustedReport(
        'article_publishing_report_checkpoint',
        { stepId: 'verify-publication', status: 'completed', outputRefs: { publicationUrl: url } },
        context,
        reporter,
      ).success,
    ).toBe(false)
  })

  it.each(['审核未通过', '审核中', '仅自己可见'])(
    'refuses author-visible success when CSDN reports %s',
    async (publicationBlocker) => {
      const { policy, inspect, webAffairService } = createPolicy({
        stepId: 'verify-publication',
        publicationStatus: 'result-unknown',
        publicationBlocker,
      })
      const url = 'https://blog.csdn.net/example/article/details/123456'
      await inspect({}, url, 'published-article')
      expect(
        policy.authorizeTrustedReport(
          'web_affair_finish_attempt',
          { outcome: 'succeeded', url },
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
        success: false,
        error: { message: expect.stringContaining(publicationBlocker) },
      })
      expect(webAffairService.recordArticlePublishingPlanResults).toHaveBeenCalledWith(
        expect.objectContaining({
          results: expect.arrayContaining([
            expect.objectContaining({
              id: 'publication.verify',
              reason: expect.stringContaining(publicationBlocker),
            }),
          ]),
        }),
        expect.any(Function),
      )
    },
  )

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

  it.each(['authorized', 'no-authorization', 'already-dispatched'])(
    'bounds rebuilding a previously uploaded image: %s',
    async (mode) => {
      const { policy, inspect, webAffairService } = createPolicy({
        adapterId: 'bilibili',
        allowPublish: true,
        assetStatus: 'pending',
        draftUrl: null,
        imageEnumerationComplete: true,
      })
      await inspect({ fileInput: '#upload' }, 'https://t.bilibili.com/')
      const snapshot = webAffairService.getProjectSnapshot()
      const state = snapshot.data.affairs[0].articlePublishing
      state.publication.status = 'result-unknown'
      Object.assign(state.assets[0], { uploadAttempts: [{ number: 1, status: 'succeeded' }] })
      state.sideEffects = [
        { key: 'old', kind: 'publish', executionGeneration: 0, status: 'result-unknown' },
        {
          key: 'old-upload',
          kind: 'upload-asset',
          executionGeneration: 0,
          status: 'verified',
          targetId: 'asset-a:attempt-1',
          dispatchedAt: 'old',
        },
        ...(mode === 'already-dispatched'
          ? [
              {
                key: 'new-upload',
                kind: 'upload-asset',
                executionGeneration: 1,
                status: 'result-unknown',
                targetId: 'asset-a:attempt-2',
                dispatchedAt: 'new',
              },
            ]
          : []),
      ]
      if (mode !== 'no-authorization')
        Object.assign(state, {
          bilibiliRetry: {
            attemptId: 'attempt-a',
            executionGeneration: 1,
            previousEffectKey: 'old',
            authorizedAt: new Date().toISOString(),
          },
        })
      webAffairService.getProjectSnapshot.mockReturnValue(snapshot)
      await inspect({ fileInput: '#upload' }, 'https://t.bilibili.com/')
      expect(
        policy.authorizeTrustedReport(
          'article_publishing_report_asset',
          { assetId: 'asset-a', status: 'uploading' },
          context,
          reporter(),
        ).success,
      ).toBe(mode === 'authorized')
    },
  )

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

  it('accepts an uploaded image only with an observed per-file URL visible in the editor', async () => {
    const platformUrl = 'https://img-blog.csdnimg.cn/transformed.png'
    const { policy, inspect } = createPolicy({
      assetStatus: 'verifying',
      imageEnumerationComplete: true,
      platformUrl,
      images: [{ src: platformUrl, alt: 'image', loaded: true }],
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

  it('rejects an Agent mapping another visible image to a local file without a trusted upload observation', async () => {
    const platformUrl = 'https://img-blog.csdnimg.cn/other.png'
    const { policy, inspect } = createPolicy({
      assetStatus: 'verifying',
      imageEnumerationComplete: true,
      images: [{ src: platformUrl, alt: 'other' }],
    })
    await inspect({})
    expect(
      policy.authorizeTrustedReport(
        'article_publishing_report_asset',
        { assetId: 'asset-a', status: 'uploaded', platformUrl },
        context,
        reporter(),
      ),
    ).toMatchObject({ success: false })
  })

  it.each(['matched', 'ambiguous', 'stale'] as const)(
    'observes the one-file image delta with colon-containing IDs: %s',
    async (mode) => {
      const assetId = 'local:images/a.png'
      const fixture = createPolicy({
        assetId,
        assetStatus: 'uploading',
        imageEnumerationComplete: true,
        sideEffects: [
          {
            key: 'upload-key',
            kind: 'upload-asset',
            targetId: `${assetId}:attempt-1`,
            status: 'dispatched',
          },
        ],
      })
      const page = (await fixture.inspect({ fileInput: '#body-upload' })) as {
        evaluate: () => Promise<Record<string, unknown>>
      }
      const observer = await fixture.policy.prepareImageUpload(
        task as never,
        'upload-key',
        page as never,
        context,
      )
      expect(observer).not.toBeNull()
      const original = page.evaluate
      page.evaluate = async () => ({
        ...(await original()),
        images: [
          { src: 'https://i-blog.csdnimg.cn/direct/one.png', alt: '', loaded: true },
          ...(mode === 'ambiguous'
            ? [{ src: 'https://i-blog.csdnimg.cn/direct/two.png', alt: '', loaded: true }]
            : []),
        ],
      })
      if (mode === 'stale') fixture.advanceDocument()
      if (mode === 'matched') {
        await observer!.finish()
        expect(
          fixture.webAffairService.recordArticlePublishingImageObservation,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            assetId,
            platformUrl: 'https://i-blog.csdnimg.cn/direct/one.png',
            sideEffectKey: 'upload-key',
          }),
          expect.any(Function),
        )
      } else {
        await expect(observer!.finish()).rejects.toThrow(mode === 'stale' ? '改代' : '多张')
        expect(
          fixture.webAffairService.recordArticlePublishingImageObservation,
        ).not.toHaveBeenCalled()
      }
    },
  )

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
      expect.stringMatching(/^autosave:fill-fields:title:[0-9a-f-]{36}$/),
      'task-a',
      'workspace-a',
    )
  })

  it('never adopts an unrelated visible numeric draft for a fresh task', async () => {
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
    ).resolves.toMatchObject({ kind: 'runtime-error' })
    expect(webAffairService.recordArticlePublishingDraftAnchor).not.toHaveBeenCalled()
    expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
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

describe('CSDN automatic save readback', () => {
  it('allows only the freshly signed body iframe for selector-based reads', async () => {
    const setup = createPolicy({
      stepId: 'fill-body',
      bodyFrameSelector: 'iframe.cke_wysiwyg_frame',
    })
    const page = await setup.inspect({ body: '#body' })
    const params = { frameSelector: 'iframe.cke_wysiwyg_frame', selector: '#body' }
    await expect(
      setup.policy.classifyAction(task as never, 'frameContent', params, page as never, context),
    ).resolves.toEqual({ kind: 'allow' })
    await expect(
      setup.policy.classifyAction(
        task as never,
        'frameContent',
        { ...params, frameSelector: 'iframe.ai-chat' },
        page as never,
        context,
      ),
    ).resolves.toMatchObject({ kind: 'runtime-error' })
    setup.advanceDocument()
    await expect(
      setup.policy.classifyAction(task as never, 'frameContent', params, page as never, context),
    ).resolves.toMatchObject({ kind: 'runtime-error' })
  })
  it('waits for the real 60-second autosave without replaying a page mutation', async () => {
    const setup = createPolicy({ stepId: 'fill-body' })
    const page = (await setup.inspect({ body: '#body' })) as any
    const raw = await page.evaluate()
    let elapsed = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsed)
    page.evaluate = vi.fn(async () => ({ ...raw, savedDraftMatches: elapsed >= 60_000 }))
    page.waitForTimeout = vi.fn(async (ms: number) => {
      elapsed += ms
    })
    try {
      await setup.policy.completeMutation(task as never, 'frameExecute', page, context)
      expect(elapsed).toBe(60_000)
      expect(setup.webAffairService.recordArticlePublishingPageObservation).toHaveBeenCalledOnce()
      expect(setup.webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })

  it('keeps the result unknown after the bounded deadline, even with a stale saved toast', async () => {
    const setup = createPolicy({ stepId: 'fill-body' })
    const page = (await setup.inspect({ body: '#body' })) as any
    const raw = await page.evaluate()
    let elapsed = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsed)
    page.evaluate = vi.fn(async () => ({ ...raw, savedDraftMatches: false }))
    page.waitForTimeout = vi.fn(async (ms: number) => {
      elapsed += ms
    })
    try {
      await expect(
        setup.policy.completeMutation(task as never, 'frameExecute', page, context),
      ).rejects.toThrow('无法读回')
      expect(elapsed).toBe(75_000)
      expect(setup.webAffairService.recordArticlePublishingPageObservation).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })

  it.each(['cancel', 'document', 'binding', 'view'] as const)(
    'discards a saved response when %s changes during readback',
    async (change) => {
      const setup = createPolicy({ stepId: 'fill-body' })
      const page = (await setup.inspect({ body: '#body' })) as any
      const raw = await page.evaluate()
      const cancel = new AbortController()
      page.evaluate = vi.fn(async () => {
        if (change === 'cancel') cancel.abort()
        if (change === 'document') setup.advanceDocument()
        if (change === 'binding') setup.advancePageBinding()
        if (change === 'view') setup.hideView()
        return { ...raw, savedDraftMatches: true }
      })
      await expect(
        setup.policy.completeMutation(task as never, 'frameExecute', page, {
          ...context,
          abortSignal: cancel.signal,
        }),
      ).rejects.toThrow('结果未知')
      expect(setup.webAffairService.recordArticlePublishingPageObservation).not.toHaveBeenCalled()
    },
  )
})

it.each(['same', 'wrong-id', 'wrong-owner'])(
  'keeps the original Zhihu identity when its stored URL has become public: %s',
  (scenario) => {
    const { policy } = createPolicy({ stepId: 'verify-publication' })
    const url = 'https://zhuanlan.zhihu.com/p/2080754524944339658'
    const result = Reflect.get(policy, 'resolvePublishedUrl').call(
      policy,
      { url },
      {
        scope: {
          adapterId: 'zhihu',
          draftUrl: url,
          expectedPlatformDraftId: '2080754524944339658',
          expectedPlatformAccountId: 'owner',
          expectedTitle: 'Article',
          assets: [],
        },
        inspection: {
          pageKind: 'published-article',
          url,
          title: { value: 'Article' },
          platformAccountId: scenario === 'wrong-owner' ? 'other' : 'owner',
          publishedArticleId:
            scenario === 'wrong-id' ? '2080754524944339659' : '2080754524944339658',
        },
      },
    )
    expect(result).toBe(scenario === 'same' ? url : null)
  },
)
