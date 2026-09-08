import { describe, expect, it, vi } from 'vitest'
import { WebAffairToolModule } from '.'

describe('WebAffairToolModule', () => {
  it('keeps execution facts and unknown effects readable without returning or mutating audit history', async () => {
    const policy = {
      origin: 'article-publishing' as const,
      workspaceId: 'workspace-a-id',
      affairId: 'affair-1',
      attemptId: 'attempt-1',
      executionGeneration: 3,
      launchOperationId: 'launch-3',
    }
    const affair = {
      id: 'affair-1',
      kind: 'article-publishing',
      events: [{ message: 'old-event'.repeat(10_000) }],
      attempts: [
        { id: 'old-attempt', runtimeBindings: [] },
        {
          id: 'attempt-1',
          profileId: 'private-profile',
          executionGeneration: 3,
          launchOperationId: 'launch-3',
          processedRuntimeEventIds: ['old-runtime'],
          runtimeBindings: [
            { executionGeneration: 2, launchOperationId: 'old' },
            { executionGeneration: 3, launchOperationId: 'launch-3', status: 'active' },
          ],
        },
      ],
      articlePublishing: {
        execution: {
          currentAttemptId: 'attempt-1',
          currentGeneration: 3,
          currentStepId: 'fill-body',
        },
        checkpoints: [
          { stepId: 'open-editor', status: 'completed' },
          { stepId: 'fill-body', status: 'running' },
        ],
        assets: [
          {
            id: 'asset-1',
            status: 'result-unknown',
            uploadAttempts: [{ status: 'result-unknown' }],
          },
        ],
        sideEffects: [
          { key: 'unknown-save', status: 'result-unknown' },
          { key: 'old-save', status: 'reconciled' },
        ],
        publication: { status: 'result-unknown' },
        executionProtocol: {
          current: { operationRunId: 'current-operation' },
          recentTransitions: [{ note: 'old-transition'.repeat(5000) }],
        },
      },
    }
    const before = JSON.stringify(affair)
    const service = {
      getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [affair] } })),
      reportArticlePublishingCheckpoint: vi.fn(async () => ({ success: true, data: affair })),
    }
    const module = new WebAffairToolModule(service as never, async () => 'workspace-a-id')
    const context = {
      workspaceKey: '/workspace/a',
      conversationId: 'conversation-a',
      agentRunId: 'run-a',
      articlePublishingPolicy: policy,
    }
    for (const tool of ['web_affair_get', 'article_publishing_report_checkpoint']) {
      const result = (await module.execute(
        tool,
        { affairId: 'affair-1', attemptId: 'attempt-1', stepId: 'fill-body', status: 'verifying' },
        context,
      )) as any
      expect(result.success).toBe(true)
      expect(result.historyOmitted).toBeTruthy()
      expect(JSON.stringify(result).length).toBeLessThan(4000)
      expect(result.data.attempts).toHaveLength(1)
      expect(result.data.attempts[0].runtimeBindings).toHaveLength(1)
      expect(result.data.attempts[0]).not.toHaveProperty('profileId')
      expect(result.data.articlePublishing.sideEffects).toEqual(
        affair.articlePublishing.sideEffects,
      )
      expect(result.data.articlePublishing.assets).toEqual(affair.articlePublishing.assets)
      expect(result.data.articlePublishing.publication.status).toBe('result-unknown')
      expect(result.data.articlePublishing.executionProtocol.current.operationRunId).toBe(
        'current-operation',
      )
    }
    expect(JSON.stringify(affair)).toBe(before)
  })

  it('projects one affair without exposing another state owner', async () => {
    const service = {
      getProjectSnapshot: vi.fn(() => ({
        success: true,
        data: {
          schemaVersion: 3,
          revision: 1,
          workspaceId: 'workspace-a-id',
          unassignedAffairCount: 0,
          affairs: [{ id: 'affair-1', title: '目标事务' }],
        },
      })),
    }
    const module = new WebAffairToolModule(service as never, async () => 'workspace-a-id')

    await expect(
      module.execute('web_affair_get', { affairId: 'affair-1' }, { workspaceKey: '/workspace/a' }),
    ).resolves.toEqual({ success: true, data: { id: 'affair-1', title: '目标事务' } })
    expect(service.getProjectSnapshot).toHaveBeenCalledWith('workspace-a-id')
  })

  it('stores AI flow changes as pending proposals instead of applying them directly', async () => {
    const proposeFlowDiff = vi.fn(async () => ({ success: true, data: { id: 'affair-1' } }))
    const module = new WebAffairToolModule(
      { proposeFlowDiff } as never,
      async () => 'workspace-a-id',
    )
    const operations = [
      {
        kind: 'add-node',
        tempId: 'extra',
        title: '补正',
        nodeType: 'human-task',
        executor: 'user',
      },
    ]

    await module.execute(
      'web_affair_propose_flow_diff',
      {
        affairId: '11111111-1111-4111-8111-111111111111',
        baseVersion: 2,
        reason: '网页出现补正要求',
        operations,
        impacts: ['新增人工步骤'],
      },
      { workspaceKey: '/workspace/a' },
    )

    expect(proposeFlowDiff).toHaveBeenCalledWith(
      {
        workspaceRef: { kind: 'local', path: '/workspace/a' },
        affairId: '11111111-1111-4111-8111-111111111111',
        baseVersion: 2,
        reason: '网页出现补正要求',
        operations,
        impacts: ['新增人工步骤'],
        proposedBy: 'ai',
      },
      'workspace-a-id',
    )
  })

  it('rejects affair access when the Agent session has no local workspace', async () => {
    const getProjectSnapshot = vi.fn()
    const module = new WebAffairToolModule({ getProjectSnapshot } as never, async () => null)

    await expect(module.execute('web_affair_get', { affairId: 'affair-1' })).resolves.toMatchObject(
      {
        success: false,
        error: { code: 'WORKSPACE_REQUIRED' },
      },
    )
    expect(getProjectSnapshot).not.toHaveBeenCalled()
  })

  it('rejects article progress reports without a main-issued execution identity', async () => {
    const reportArticlePublishingCheckpoint = vi.fn()
    const module = new WebAffairToolModule(
      { reportArticlePublishingCheckpoint } as never,
      async () => 'workspace-a-id',
    )

    await expect(
      module.execute(
        'article_publishing_report_checkpoint',
        { affairId: 'affair-1', attemptId: 'attempt-1', stepId: 'open-editor', status: 'running' },
        { workspaceKey: '/workspace/a', conversationId: 'conversation-a', agentRunId: 'run-a' },
      ),
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } })
    expect(reportArticlePublishingCheckpoint).not.toHaveBeenCalled()
  })

  it('injects the trusted generation and run identity instead of accepting model identity fields', async () => {
    const reportArticlePublishingCheckpoint = vi.fn(async () => ({ success: true }))
    const module = new WebAffairToolModule(
      { reportArticlePublishingCheckpoint } as never,
      async () => 'workspace-a-id',
    )
    const policy = {
      origin: 'article-publishing' as const,
      workspaceId: 'workspace-a-id',
      affairId: 'affair-1',
      attemptId: 'attempt-1',
      executionGeneration: 3,
      launchOperationId: 'launch-3',
    }

    await module.execute(
      'article_publishing_report_checkpoint',
      { affairId: 'affair-1', attemptId: 'attempt-1', stepId: 'open-editor', status: 'running' },
      {
        workspaceKey: '/workspace/a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        articlePublishingPolicy: policy,
      },
    )

    expect(reportArticlePublishingCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ affairId: 'affair-1', attemptId: 'attempt-1' }),
      'workspace-a-id',
      {
        workspaceId: 'workspace-a-id',
        affairId: 'affair-1',
        attemptId: 'attempt-1',
        executionGeneration: 3,
        launchOperationId: 'launch-3',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
      },
    )

    await expect(
      module.execute(
        'web_affair_get',
        { affairId: 'affair-2' },
        {
          workspaceKey: '/workspace/a',
          conversationId: 'conversation-a',
          agentRunId: 'run-a',
          articlePublishingPolicy: policy,
        },
      ),
    ).resolves.toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } })
  })
})
