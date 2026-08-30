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
    const webAffairService = {
      getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [draftAffair] } })),
      startAttempt: vi.fn(async () => ({ success: true, data: affair })),
      markArticlePublishingAttemptStarted: vi.fn(async () => ({ success: true, data: affair })),
      bindArticlePublishingRuntime,
      reconcileArticlePublishingRuntime: vi.fn(async () => ({ success: true, data: affair })),
    }
    const agentBridge = {
      onRuntimeEvent: vi.fn(() => () => undefined),
      getRuntimeIdentity: vi.fn(() => ({
        agentRuntimeBindingKey: 'agent-binding-a',
        agentRuntimeEpoch: 7,
      })),
      sendMessage: vi.fn(async () => ({ runId: `run-${launchOperationId}` })),
      getActiveBrowserTask: vi.fn(() => ({
        id: browserTaskRunId,
        tabId: 'tab-a',
        status: 'running',
        correlation: {},
      })),
      getRunStatus: vi.fn(() => ({ status: 'running' })),
    }
    const browserManager = {
      waitForAccountView: vi.fn(async () => 'tab-a'),
      ensurePlaywrightPage: vi.fn(async () => undefined),
      getViewRuntimeIdentity: vi.fn(() => ({
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
      })),
    }
    const browserTaskRuntime = {
      updateCorrelation: vi.fn(),
      onTaskChanged: vi.fn(() => () => undefined),
      onActionLogChanged: vi.fn(() => () => undefined),
      getTask: vi.fn(() => ({ status: 'running', correlation: {} })),
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

    const result = await service.startTask(
      { workspaceRef: WORKSPACE_REF, affairId },
      '11111111-1111-4111-8111-111111111111',
    )
    service.dispose()

    expect(result.success).toBe(true)
    expect(browserManager.waitForAccountView).toHaveBeenCalledOnce()
    expect(agentBridge.sendMessage).toHaveBeenCalledOnce()
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
