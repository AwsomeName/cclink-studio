import { describe, expect, it, vi } from 'vitest'
import { ArticlePublishingService } from './article-publishing-service'

const WORKSPACE_REF = { kind: 'local' as const, path: '/workspace' }

describe('ArticlePublishingService', () => {
  it('launches and binds the Agent, BrowserTask, visible tab and CDP entirely in main', async () => {
    const affairId = '33333333-3333-4333-8333-333333333333'
    const attemptId = '44444444-4444-4444-8444-444444444444'
    const browserTaskRunId = '55555555-5555-4555-8555-555555555555'
    const launchOperationId = 'launch-a'
    const affair = {
      id: affairId,
      kind: 'article-publishing',
      title: 'Article',
      flow: { nodes: [{ id: '66666666-6666-4666-8666-666666666666' }] },
      attempts: [
        {
          id: attemptId,
          status: 'preparing',
          executionGeneration: 1,
          launchOperationId,
          profileId: 'profile-a',
          accountId: '22222222-2222-4222-8222-222222222222',
          entryUrl: 'https://editor.csdn.net/md/',
        },
      ],
      articlePublishing: {
        accountId: '22222222-2222-4222-8222-222222222222',
        source: {
          markdownPath: '/workspace/article.md',
          contentHash: 'c'.repeat(64),
        },
        assets: [],
        checkpoints: [{ stepId: 'open-editor', status: 'pending' }],
        sideEffects: [],
        execution: {
          status: 'preparing',
          currentAttemptId: attemptId,
          currentGeneration: 1,
          currentLaunchOperationId: launchOperationId,
        },
        publication: { status: 'not-started' },
      },
    }
    const draftAffair = {
      ...affair,
      attempts: [],
      articlePublishing: {
        ...affair.articlePublishing,
        execution: { status: 'draft', currentGeneration: 0 },
      },
    }
    const fileService = {
      readTextDocument: vi.fn(async () => ({
        path: '/workspace/article.md',
        content: '# Article',
        size: 9,
        modifiedAt: 123,
        hash: 'c'.repeat(64),
      })),
    }
    const bindArticlePublishingRuntime = vi.fn(async () => ({
      success: true,
      data: affair,
    }))
    const rebindArticlePublishingBrowserRuntime = vi.fn(async () => ({
      success: true,
      data: affair,
    }))
    const webAffairService = {
      getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [draftAffair] } })),
      acquireArticlePublishingAttempt: vi.fn(async () => ({ success: true, data: affair })),
      bindArticlePublishingRuntime,
      rebindArticlePublishingBrowserRuntime,
      reconcileArticlePublishingRuntime: vi.fn(async () => ({ success: true, data: affair })),
    }
    const browserTask = {
      id: browserTaskRunId,
      tabId: 'tab-a',
      status: 'running',
      correlation: {} as Record<string, unknown>,
    }
    const agentBridge = {
      onRuntimeEvent: vi.fn(() => () => undefined),
      getRuntimeIdentity: vi.fn(() => ({
        agentRuntimeBindingKey: 'agent-binding-a',
        agentRuntimeEpoch: 7,
      })),
      sendMessage: vi.fn(async (_message, conversationId, context) => {
        await context?.onRunPrepared?.({
          conversationId,
          runId: `run-${launchOperationId}`,
          browserTaskRunId,
        })
        // A real Agent Run remains pending after onRunPrepared. startTask must return the
        // durable launch receipt without waiting for this completion Promise.
        return await new Promise<never>(() => undefined)
      }),
      getActiveBrowserTask: vi.fn(() => browserTask),
      getRunStatus: vi.fn(() => ({ status: 'running' })),
    }
    let pageRuntimeBound: ((identity: Record<string, number | string>) => void) | undefined
    const browserManager = {
      waitForAccountView: vi.fn(async () => 'tab-a'),
      getCurrentURL: vi.fn(() => 'https://editor.csdn.net/md/'),
      navigate: vi.fn(async () => undefined),
      ensurePlaywrightPage: vi.fn(async () => undefined),
      onPageRuntimeBound: vi.fn((callback) => {
        pageRuntimeBound = callback
        return () => undefined
      }),
      getViewRuntimeIdentity: vi.fn(() => ({
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
      })),
    }
    const browserTaskRuntime = {
      updateCorrelation: vi.fn((_taskRunId: string, patch: Record<string, unknown>) => {
        Object.assign(browserTask.correlation, patch)
        return browserTask
      }),
      onTaskChanged: vi.fn(() => () => undefined),
      onActionLogChanged: vi.fn(() => () => undefined),
      getTask: vi.fn(() => browserTask),
    }
    let pageBinding = {
      generation: 4,
      connectionGeneration: 3,
      webContentsId: 20,
    }
    const playwrightBridge = {
      ensureConnected: vi.fn(async () => undefined),
      switchToPage: vi.fn(async () => undefined),
      getConnectionGeneration: vi.fn(() => pageBinding.connectionGeneration),
      getPageBindingIdentity: vi.fn(() => pageBinding),
      isConnected: vi.fn(() => true),
    }
    const service = new ArticlePublishingService(
      fileService as never,
      webAffairService as never,
      async (path) => path,
      {
        getAgentBridge: () => agentBridge as never,
        getBrowserManager: () => browserManager as never,
        getBrowserTaskRuntime: () => browserTaskRuntime as never,
        getPlaywrightBridge: () => playwrightBridge as never,
      },
    )

    const result = await service.startTask(
      { workspaceRef: WORKSPACE_REF, affairId },
      '11111111-1111-4111-8111-111111111111',
    )

    expect(result.success).toBe(true)
    expect(browserManager.waitForAccountView).toHaveBeenCalledOnce()
    expect(agentBridge.sendMessage).toHaveBeenCalledOnce()
    expect(agentBridge.sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      `article-publishing-${affairId}`,
      expect.objectContaining({
        disableBuiltinTools: true,
        allowedTools: expect.arrayContaining([
          'mcp__cclink_studio__browser_click',
          'mcp__cclink_studio__article_publishing_inspect_page',
          'mcp__cclink_studio__article_publishing_report_checkpoint',
          'mcp__cclink_studio__web_affair_finish_attempt',
        ]),
        articlePublishingPolicy: {
          origin: 'article-publishing',
          workspaceId: '11111111-1111-4111-8111-111111111111',
          affairId,
          attemptId,
          executionGeneration: 1,
          launchOperationId,
        },
        onRunPrepared: expect.any(Function),
      }),
    )
    const launchOptions = agentBridge.sendMessage.mock.calls[0]?.[2]
    expect(launchOptions?.allowedTools).not.toContain('mcp__cclink_studio__browser_*')
    expect(browserTaskRuntime.updateCorrelation).toHaveBeenCalledWith(
      browserTaskRunId,
      expect.objectContaining({
        affairExecutionGeneration: 1,
        affairLaunchOperationId: launchOperationId,
        playwrightConnectionGeneration: 3,
        playwrightPageBindingGeneration: 4,
      }),
    )
    expect(bindArticlePublishingRuntime).toHaveBeenCalledWith(
      affairId,
      attemptId,
      1,
      launchOperationId,
      expect.arrayContaining([
        expect.objectContaining({ kind: 'agent-run', agentRuntimeEpoch: 7 }),
        expect.objectContaining({ kind: 'browser-tab', webContentsId: 20 }),
        expect.objectContaining({ kind: 'browser-task', browserTaskRunId }),
      ]),
      '11111111-1111-4111-8111-111111111111',
    )

    affair.attempts[0].status = 'running-ai'
    affair.articlePublishing.execution.status = 'running'
    ;(webAffairService.getProjectSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      data: { affairs: [affair] },
    })
    pageBinding = { generation: 5, connectionGeneration: 4, webContentsId: 20 }
    pageRuntimeBound?.({
      tabId: 'tab-a',
      browserViewRuntimeGeneration: 2,
      webContentsId: 20,
      playwrightConnectionGeneration: 4,
      playwrightPageBindingGeneration: 5,
    })
    await vi.waitFor(() => expect(rebindArticlePublishingBrowserRuntime).toHaveBeenCalledOnce())

    expect(rebindArticlePublishingBrowserRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        affairId,
        attemptId,
        previousPlaywrightConnectionGeneration: 3,
        previousPlaywrightPageBindingGeneration: 4,
        playwrightConnectionGeneration: 4,
        playwrightPageBindingGeneration: 5,
      }),
    )
    expect(browserTaskRuntime.updateCorrelation).toHaveBeenLastCalledWith(browserTaskRunId, {
      playwrightConnectionGeneration: 4,
      playwrightPageBindingGeneration: 5,
    })
    expect(rebindArticlePublishingBrowserRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      browserTaskRuntime.updateCorrelation.mock.invocationCallOrder.at(-1)!,
    )
    expect(webAffairService.reconcileArticlePublishingRuntime).not.toHaveBeenCalled()
    service.dispose()
  })

  it('resumes by navigating to the persisted platform draft before starting the Agent', async () => {
    const draftUrl = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'
    const harness = createResumeHarness({ draftUrl, visibleUrl: 'https://mp.csdn.net/' })

    const result = await harness.service.startTask(
      { workspaceRef: WORKSPACE_REF, affairId: harness.affairId },
      '11111111-1111-4111-8111-111111111111',
    )

    expect(result.success).toBe(true)
    expect(harness.browserManager.waitForAccountView).toHaveBeenCalledWith(
      '/workspace',
      'profile-a',
      '22222222-2222-4222-8222-222222222222',
      draftUrl,
      8_000,
      'original-editor-tab',
    )
    expect(harness.browserManager.navigate).toHaveBeenCalledWith('tab-a', draftUrl)
    expect(harness.browserManager.navigate.mock.invocationCallOrder[0]).toBeLessThan(
      harness.agentBridge.sendMessage.mock.invocationCallOrder[0],
    )
    expect(harness.agentBridge.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining(`draftUrl=${draftUrl}`),
      expect.any(String),
      expect.any(Object),
    )
    harness.service.dispose()
  })

  it('refuses to guess a new editor for a legacy partial Attempt without a draft anchor', async () => {
    const harness = createResumeHarness({ visibleUrl: 'https://editor.csdn.net/md/' })

    const result = await harness.service.startTask(
      { workspaceRef: WORKSPACE_REF, affairId: harness.affairId },
      '11111111-1111-4111-8111-111111111111',
    )

    expect(result).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('打开原 CSDN 草稿') },
    })
    expect(harness.browserManager.navigate).not.toHaveBeenCalled()
    expect(harness.agentBridge.sendMessage).not.toHaveBeenCalled()
    expect(harness.webAffairService.reconcileArticlePublishingRuntime).toHaveBeenCalledOnce()
    harness.service.dispose()
  })

  it('refuses to start while another article publishing Attempt owns Browser and Agent', async () => {
    const harness = createResumeHarness({
      draftUrl: 'https://mp.csdn.net/mp_blog/creation/editor/164148817',
      visibleUrl: 'https://mp.csdn.net/',
    })
    const snapshot = harness.webAffairService.getProjectSnapshot()
    const otherAffair = structuredClone(snapshot.data.affairs[0])
    otherAffair.id = '77777777-7777-4777-8777-777777777777'
    otherAffair.title = '另一篇文章'
    otherAffair.articlePublishing.execution.status = 'running'
    harness.webAffairService.getProjectSnapshot.mockReturnValue({
      success: true,
      data: {
        affairs: [...snapshot.data.affairs, otherAffair],
      },
    })

    const result = await harness.service.startTask(
      { workspaceRef: WORKSPACE_REF, affairId: harness.affairId },
      '11111111-1111-4111-8111-111111111111',
    )

    expect(result).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('另一条文章发布任务正在占用 Browser/Agent') },
    })
    expect(harness.webAffairService.acquireArticlePublishingAttempt).toHaveBeenCalledOnce()
    expect(harness.agentBridge.sendMessage).not.toHaveBeenCalled()
    harness.service.dispose()
  })

  it('freezes a healthy-but-stalled runtime before bounded escalation to human handling', async () => {
    vi.useFakeTimers()
    try {
      const now = new Date('2026-08-30T12:00:00.000Z')
      vi.setSystemTime(now)
      const attempt = {
        id: '44444444-4444-4444-8444-444444444444',
        status: 'running-ai',
        executionGeneration: 1,
        launchOperationId: 'launch-a',
      }
      const affair = {
        id: '33333333-3333-4333-8333-333333333333',
        attempts: [attempt],
        articlePublishing: {
          execution: {
            status: 'running',
            currentAttemptId: attempt.id,
            currentGeneration: 1,
            currentLaunchOperationId: 'launch-a',
            runtimeCheck: undefined as { suspectedAt: string } | undefined,
          },
        },
      }
      const reconcileArticlePublishingRuntime = vi.fn(async () => ({
        success: true,
        data: affair,
      }))
      const webAffairService = {
        getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [affair] } })),
        reconcileArticlePublishingRuntime,
      }
      const runtime = createActiveRuntime(now.getTime() - 10 * 60_000 - 1)
      const service = new ArticlePublishingService(
        {} as never,
        webAffairService as never,
        async (path) => path,
        healthyRuntimeDependencies(),
      )

      await (service as never as { probeRuntime(value: unknown): Promise<void> }).probeRuntime(
        runtime,
      )
      expect(reconcileArticlePublishingRuntime).toHaveBeenLastCalledWith(
        expect.objectContaining({
          source: 'lease-expired',
          observedStatus: 'owner-alive',
          reasonCode: 'PROGRESS_LEASE_EXPIRED',
        }),
      )

      affair.attempts[0].status = 'checking-runtime'
      affair.articlePublishing.execution.status = 'checking-runtime'
      affair.articlePublishing.execution.runtimeCheck = {
        suspectedAt: new Date(now.getTime() - 60_001).toISOString(),
      }
      await (service as never as { probeRuntime(value: unknown): Promise<void> }).probeRuntime(
        runtime,
      )
      expect(reconcileArticlePublishingRuntime).toHaveBeenLastCalledWith(
        expect.objectContaining({
          source: 'lease-expired',
          observedStatus: 'owner-alive-no-progress',
          reasonCode: 'NO_VERIFIABLE_PROGRESS',
        }),
      )
      service.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves a missing exact owner identity through checking-runtime to interrupted', async () => {
    vi.useFakeTimers()
    try {
      const now = new Date('2026-08-30T12:00:00.000Z')
      vi.setSystemTime(now)
      const attempt = {
        id: '44444444-4444-4444-8444-444444444444',
        status: 'running-ai',
        executionGeneration: 1,
        launchOperationId: 'launch-a',
      }
      const affair = {
        id: '33333333-3333-4333-8333-333333333333',
        attempts: [attempt],
        articlePublishing: {
          execution: {
            status: 'running',
            currentAttemptId: attempt.id,
            currentGeneration: 1,
            currentLaunchOperationId: 'launch-a',
            runtimeCheck: undefined as { suspectedAt: string } | undefined,
          },
        },
      }
      const reconcileArticlePublishingRuntime = vi.fn(async () => ({
        success: true,
        data: affair,
      }))
      const webAffairService = {
        getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [affair] } })),
        reconcileArticlePublishingRuntime,
      }
      const dependencies = healthyRuntimeDependencies()
      dependencies.getBrowserTaskRuntime = () => ({ getTask: vi.fn(() => null) }) as never
      const runtime = createActiveRuntime(now.getTime())
      const service = new ArticlePublishingService(
        {} as never,
        webAffairService as never,
        async (path) => path,
        dependencies,
      )

      await (service as never as { probeRuntime(value: unknown): Promise<void> }).probeRuntime(
        runtime,
      )
      expect(reconcileArticlePublishingRuntime).toHaveBeenLastCalledWith(
        expect.objectContaining({
          observedStatus: 'owner-lost',
          reasonCode: 'RUNTIME_OWNER_LOST',
        }),
      )

      affair.attempts[0].status = 'checking-runtime'
      affair.articlePublishing.execution.status = 'checking-runtime'
      affair.articlePublishing.execution.runtimeCheck = {
        suspectedAt: new Date(now.getTime() - 60_001).toISOString(),
      }
      await (service as never as { probeRuntime(value: unknown): Promise<void> }).probeRuntime(
        runtime,
      )
      expect(reconcileArticlePublishingRuntime).toHaveBeenLastCalledWith(
        expect.objectContaining({
          observedStatus: 'owner-lost',
          reasonCode: 'RUNTIME_ORPHAN_CONFIRMED',
        }),
      )
      service.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets an explicit runtime check unlock a confirmed orphan immediately', async () => {
    const runtime = createActiveRuntime(Date.now())
    const attempt = {
      id: runtime.attemptId,
      status: 'running-ai',
      executionGeneration: runtime.executionGeneration,
      launchOperationId: runtime.launchOperationId,
    }
    const affair = {
      id: runtime.affairId,
      attempts: [attempt],
      articlePublishing: {
        execution: {
          status: 'running',
          currentAttemptId: runtime.attemptId,
          currentGeneration: runtime.executionGeneration,
          currentLaunchOperationId: runtime.launchOperationId,
        },
      },
    }
    const reconcileArticlePublishingRuntime = vi.fn(async (input: { observedStatus?: string }) => {
      if (input.observedStatus === 'owner-lost') {
        attempt.status = 'interrupted'
        affair.articlePublishing.execution.status = 'interrupted'
      }
      return { success: true, data: affair }
    })
    const dependencies = healthyRuntimeDependencies()
    dependencies.getBrowserTaskRuntime = () => ({ getTask: vi.fn(() => null) }) as never
    const service = new ArticlePublishingService(
      {} as never,
      {
        getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [affair] } })),
        reconcileArticlePublishingRuntime,
      } as never,
      async (path) => path,
      dependencies,
    )
    ;(
      service as never as { activeRuntimes: Map<string, ReturnType<typeof createActiveRuntime>> }
    ).activeRuntimes.set(runtime.attemptId, runtime)

    const result = await service.checkRuntime(
      {
        workspaceRef: WORKSPACE_REF,
        affairId: runtime.affairId,
        attemptId: runtime.attemptId,
        executionGeneration: runtime.executionGeneration,
        launchOperationId: runtime.launchOperationId,
      },
      runtime.workspaceId,
    )

    expect(result).toMatchObject({
      success: true,
      data: { articlePublishing: { execution: { status: 'interrupted' } } },
    })
    expect(reconcileArticlePublishingRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'user-check',
        observedStatus: 'owner-lost',
        reasonCode: 'RUNTIME_ORPHAN_CONFIRMED',
      }),
    )
    service.dispose()
  })

  it('allows only one bounded continuation for a healthy runtime generation', async () => {
    const runtime = createActiveRuntime(Date.now())
    const attempt = {
      id: runtime.attemptId,
      executionGeneration: runtime.executionGeneration,
      launchOperationId: runtime.launchOperationId,
    }
    const affair = {
      id: runtime.affairId,
      attempts: [attempt],
      articlePublishing: {
        execution: {
          status: 'checking-runtime',
          currentAttemptId: runtime.attemptId,
          currentGeneration: runtime.executionGeneration,
          currentLaunchOperationId: runtime.launchOperationId,
        },
      },
    }
    const reconcileArticlePublishingRuntime = vi.fn(async () => ({
      success: true,
      data: affair,
    }))
    const service = new ArticlePublishingService(
      {} as never,
      {
        getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [affair] } })),
        reconcileArticlePublishingRuntime,
      } as never,
      async (path) => path,
      healthyRuntimeDependencies(),
    )
    ;(
      service as never as { activeRuntimes: Map<string, ReturnType<typeof createActiveRuntime>> }
    ).activeRuntimes.set(runtime.attemptId, runtime)
    const input = {
      workspaceRef: WORKSPACE_REF,
      affairId: runtime.affairId,
      attemptId: runtime.attemptId,
      executionGeneration: runtime.executionGeneration,
      launchOperationId: runtime.launchOperationId,
    }

    const results = await Promise.all([
      service.continueRuntime(input, runtime.workspaceId),
      service.continueRuntime(input, runtime.workspaceId),
    ])
    expect(results.filter((result) => result.success)).toHaveLength(1)
    expect(results.filter((result) => !result.success)).toEqual([
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: expect.stringContaining('已经使用过一次') }),
      }),
    ])
    expect(reconcileArticlePublishingRuntime).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('creates a task after re-inspecting only the Markdown source fields', async () => {
    const markdown = '# 可执行文章\n\n摘要。'
    const fileService = {
      readTextDocument: vi.fn(async () => ({
        path: '/workspace/article.md',
        content: markdown,
        size: Buffer.byteLength(markdown),
        modifiedAt: 123,
        hash: 'c'.repeat(64),
      })),
    }
    const webAffairService = {
      createArticlePublishingAffair: vi.fn(async (input) => ({
        success: true,
        data: { id: '33333333-3333-4333-8333-333333333333', input },
      })),
    }
    const service = new ArticlePublishingService(
      fileService as never,
      webAffairService as never,
      async (path) => path,
    )

    const result = await service.createTask(
      {
        workspaceRef: WORKSPACE_REF,
        markdownPath: '/workspace/article.md',
        accountId: '22222222-2222-4222-8222-222222222222',
        fields: {
          title: '可执行文章',
          summary: '摘要。',
          tags: ['Electron'],
          category: '',
        },
      },
      '11111111-1111-4111-8111-111111111111',
    )

    expect(result.success).toBe(true)
    expect(webAffairService.createArticlePublishingAffair).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '22222222-2222-4222-8222-222222222222',
        preview: expect.objectContaining({ title: '可执行文章', blockers: [] }),
      }),
      '11111111-1111-4111-8111-111111111111',
    )
  })

  it('extracts title and deduplicates inline, reference and HTML image occurrences by content hash', async () => {
    const markdown = [
      '---',
      'title: 可恢复文章',
      '---',
      '',
      '第一段摘要。',
      '',
      '![图一](./assets/a.png)',
      '![重复图][same]',
      '<img src="./assets/b.webp" alt="图二">',
      '',
      '[same]: ./assets/a.png',
    ].join('\n')
    const files: Record<string, { content: string; size: number }> = {
      '/workspace/assets/a.png': { content: Buffer.from('same').toString('base64'), size: 4 },
      '/workspace/assets/b.webp': { content: Buffer.from('other').toString('base64'), size: 5 },
    }
    const fileService = {
      readTextDocument: vi.fn(async () => ({
        path: '/workspace/article.md',
        content: markdown,
        size: Buffer.byteLength(markdown),
        modifiedAt: 123,
        hash: 'a'.repeat(64),
      })),
      stat: vi.fn(async (path: string) => ({
        path,
        name: path.split('/').pop(),
        type: 'file',
        size: files[path].size,
        modifiedAt: 123,
        createdAt: 123,
      })),
      readFile: vi.fn(async (path: string) => ({
        content: files[path].content,
        encoding: 'base64',
      })),
    }
    const service = new ArticlePublishingService(
      fileService as never,
      {} as never,
      async (path) => path,
    )

    const result = await service.inspectSource({
      workspaceRef: WORKSPACE_REF,
      markdownPath: '/workspace/article.md',
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.title).toBe('可恢复文章')
    expect(result.data.summary).toBe('第一段摘要。')
    expect(result.data.assets).toHaveLength(2)
    expect(
      result.data.assets.find((asset) => asset.displayPath === 'assets/a.png')?.occurrences,
    ).toHaveLength(2)
    expect(
      result.data.assets.find((asset) => asset.displayPath === 'assets/b.webp')?.occurrences[0].alt,
    ).toBe('图二')
    expect(result.data.blockers).toEqual([])
  })

  it('blocks missing and unsupported local images before opening a webpage', async () => {
    const markdown = '# Bad\n\n![svg](./bad.svg)\n\n![missing](./missing.png)'
    const fileService = {
      readTextDocument: vi.fn(async () => ({
        path: '/workspace/article.md',
        content: markdown,
        size: Buffer.byteLength(markdown),
        modifiedAt: 123,
        hash: 'b'.repeat(64),
      })),
      stat: vi.fn(async () => {
        throw new Error('ENOENT')
      }),
      readFile: vi.fn(async () => {
        throw new Error('ENOENT')
      }),
    }
    const service = new ArticlePublishingService(
      fileService as never,
      {} as never,
      async (path) => path,
    )
    const result = await service.inspectSource({
      workspaceRef: WORKSPACE_REF,
      markdownPath: '/workspace/article.md',
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不支持的图片格式'),
        expect.stringContaining('图片不可用'),
      ]),
    )
  })
})

function createResumeHarness(options: { draftUrl?: string; visibleUrl: string }) {
  const affairId = '33333333-3333-4333-8333-333333333333'
  const attemptId = '44444444-4444-4444-8444-444444444444'
  const browserTaskRunId = '55555555-5555-4555-8555-555555555555'
  const nodeId = '66666666-6666-4666-8666-666666666666'
  const accountId = '22222222-2222-4222-8222-222222222222'
  const resumedAttempt = {
    id: attemptId,
    status: 'preparing',
    executionGeneration: 2,
    launchOperationId: 'launch-b',
    profileId: 'profile-a',
    accountId,
    nodeId,
    entryUrl: 'https://editor.csdn.net/md/',
  }
  const articlePublishing = {
    adapterId: 'csdn',
    adapterVersion: 1,
    accountId,
    source: {
      markdownPath: '/workspace/article.md',
      contentHash: 'c'.repeat(64),
    },
    assets: [],
    checkpoints: [
      {
        stepId: 'upload-assets',
        label: '上传图片',
        status: 'needs-reconcile',
      },
    ],
    sideEffects: [{ kind: 'save-draft', status: 'verified' }],
    execution: {
      status: 'preparing',
      currentAttemptId: attemptId,
      currentGeneration: 2,
      currentLaunchOperationId: 'launch-b',
      currentStepId: 'upload-assets',
    },
    draft: options.draftUrl ? { url: options.draftUrl } : undefined,
    publication: { status: 'not-started' },
  }
  const resumedAffair = {
    id: affairId,
    kind: 'article-publishing',
    title: 'Article',
    flow: { nodes: [{ id: nodeId }] },
    attempts: [resumedAttempt],
    articlePublishing,
  }
  const interruptedAffair = {
    ...resumedAffair,
    attempts: [
      {
        ...resumedAttempt,
        status: 'interrupted',
        executionGeneration: 1,
        launchOperationId: 'launch-a',
        tabId: 'original-editor-tab',
      },
    ],
    articlePublishing: {
      ...articlePublishing,
      execution: {
        ...articlePublishing.execution,
        status: 'interrupted',
        currentGeneration: 1,
        currentLaunchOperationId: 'launch-a',
      },
    },
  }
  const fileService = {
    readTextDocument: vi.fn(async () => ({
      path: '/workspace/article.md',
      content: '# Article',
      size: 9,
      modifiedAt: 123,
      hash: 'c'.repeat(64),
    })),
  }
  const webAffairService = {
    getProjectSnapshot: vi.fn(() => ({
      success: true,
      data: { affairs: [interruptedAffair] },
    })),
    acquireArticlePublishingAttempt: vi.fn(async () => {
      const current = webAffairService.getProjectSnapshot()
      const conflict = current.data.affairs.find(
        (candidate) =>
          candidate.id !== affairId &&
          ['preparing', 'running', 'checking-runtime', 'waiting-human'].includes(
            candidate.articlePublishing?.execution.status ?? '',
          ),
      )
      return conflict
        ? {
            success: false,
            error: {
              code: 'INVALID_INPUT',
              message: `另一条文章发布任务正在占用 Browser/Agent：${conflict.title}；请先完成或终止它`,
            },
          }
        : { success: true, data: resumedAffair }
    }),
    recordArticlePublishingDraftAnchor: vi.fn(async () => ({
      success: true,
      data: resumedAffair,
    })),
    bindArticlePublishingRuntime: vi.fn(async () => ({ success: true, data: resumedAffair })),
    rebindArticlePublishingBrowserRuntime: vi.fn(async () => ({
      success: true,
      data: resumedAffair,
    })),
    reconcileArticlePublishingRuntime: vi.fn(async () => ({
      success: true,
      data: resumedAffair,
    })),
  }
  const browserTask = {
    id: browserTaskRunId,
    tabId: 'tab-a',
    status: 'running',
    correlation: {} as Record<string, unknown>,
  }
  const agentBridge = {
    onRuntimeEvent: vi.fn(() => () => undefined),
    getRuntimeIdentity: vi.fn(() => ({
      agentRuntimeBindingKey: 'agent-binding-a',
      agentRuntimeEpoch: 1,
    })),
    sendMessage: vi.fn(async (_message, conversationId, context) => {
      await context?.onRunPrepared?.({
        conversationId,
        runId: 'run-launch-b',
        browserTaskRunId,
      })
      return { runId: 'run-launch-b' }
    }),
    getActiveBrowserTask: vi.fn(() => browserTask),
    getRunStatus: vi.fn(() => ({ status: 'running' })),
  }
  let currentUrl = options.visibleUrl
  const browserManager = {
    waitForAccountView: vi.fn(async () => 'tab-a'),
    getCurrentURL: vi.fn(() => currentUrl),
    navigate: vi.fn(async (_tabId: string, url: string) => {
      currentUrl = url
    }),
    ensurePlaywrightPage: vi.fn(async () => undefined),
    onPageRuntimeBound: vi.fn(() => () => undefined),
    getViewRuntimeIdentity: vi.fn(() => ({
      browserViewRuntimeGeneration: 2,
      webContentsId: 20,
    })),
  }
  const browserTaskRuntime = {
    updateCorrelation: vi.fn((_taskRunId: string, patch: Record<string, unknown>) => {
      Object.assign(browserTask.correlation, patch)
      return browserTask
    }),
    onTaskChanged: vi.fn(() => () => undefined),
    onActionLogChanged: vi.fn(() => () => undefined),
    getTask: vi.fn(() => browserTask),
  }
  const playwrightBridge = {
    ensureConnected: vi.fn(async () => undefined),
    switchToPage: vi.fn(async () => undefined),
    getConnectionGeneration: vi.fn(() => 3),
    getPageBindingIdentity: vi.fn(() => ({
      generation: 4,
      connectionGeneration: 3,
      webContentsId: 20,
    })),
    isConnected: vi.fn(() => true),
  }
  const service = new ArticlePublishingService(
    fileService as never,
    webAffairService as never,
    async (path) => path,
    {
      getAgentBridge: () => agentBridge as never,
      getBrowserManager: () => browserManager as never,
      getBrowserTaskRuntime: () => browserTaskRuntime as never,
      getPlaywrightBridge: () => playwrightBridge as never,
    },
  )
  return {
    affairId,
    service,
    browserManager,
    agentBridge,
    webAffairService,
  }
}

function createActiveRuntime(lastProgressAt: number) {
  return {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    affairId: '33333333-3333-4333-8333-333333333333',
    attemptId: '44444444-4444-4444-8444-444444444444',
    executionGeneration: 1,
    launchOperationId: 'launch-a',
    conversationId: 'conversation-a',
    agentRunId: 'run-a',
    agentRuntimeBindingKey: 'agent-binding-a',
    agentRuntimeEpoch: 7,
    browserTaskRunId: '55555555-5555-4555-8555-555555555555',
    tabId: 'tab-a',
    browserViewRuntimeGeneration: 2,
    webContentsId: 20,
    playwrightConnectionGeneration: 3,
    playwrightPageBindingGeneration: 4,
    lastOwnerAt: Date.now(),
    lastProgressAt,
    continuationUsed: false,
  }
}

function healthyRuntimeDependencies() {
  return {
    getAgentBridge: () =>
      ({
        getRunStatus: vi.fn(() => ({ status: 'running' })),
        getRuntimeIdentity: vi.fn(() => ({
          agentRuntimeEpoch: 7,
          agentRuntimeBindingKey: 'agent-binding-a',
        })),
      }) as never,
    getBrowserManager: () =>
      ({
        getViewRuntimeIdentity: vi.fn(() => ({
          browserViewRuntimeGeneration: 2,
          webContentsId: 20,
        })),
      }) as never,
    getBrowserTaskRuntime: () =>
      ({
        getTask: vi.fn(() => ({
          status: 'running',
          correlation: {
            affairExecutionGeneration: 1,
            affairLaunchOperationId: 'launch-a',
          },
        })),
      }) as never,
    getPlaywrightBridge: () =>
      ({
        getPageBindingIdentity: vi.fn(() => ({ generation: 4, webContentsId: 20 })),
        isConnected: vi.fn(() => true),
        getConnectionGeneration: vi.fn(() => 3),
      }) as never,
  }
}
