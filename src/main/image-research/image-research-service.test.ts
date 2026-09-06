import { describe, expect, it, vi } from 'vitest'
import type { WebAffair } from '../../shared/web-affairs/web-affair-types'
import { ImageResearchService, parseXiaohongshuNoteId } from './image-research-service'

describe('ImageResearchService', () => {
  it('extracts one stable note identity from detail and search-result routes', () => {
    expect(parseXiaohongshuNoteId('/explore/66abc123def456?xsec_token=secret')).toBe(
      '66abc123def456',
    )
    expect(parseXiaohongshuNoteId('/search_result/77abc123def456?xsec_source=pc_search')).toBe(
      '77abc123def456',
    )
    expect(parseXiaohongshuNoteId('/search_result?keyword=奥森拍照')).toBeNull()
  })

  it('launches the first vertical slice with only four bounded tools and no builtin tools', async () => {
    const affair = imageResearchAffair()
    let launchOptions: Record<string, unknown> | undefined
    const transferAccountRecoveryLeaseToTask = vi.fn()
    const webAffairService = {
      startImageResearch: vi.fn(async () => ({ success: true, data: affair })),
      bindImageResearchAttempt: vi.fn(async () => ({ success: true, data: affair })),
      getProjectSnapshot: vi.fn(() => ({
        success: true,
        data: { affairs: [affair] },
      })),
    }
    const service = new ImageResearchService(webAffairService as never, {
      getAgentBridge: () =>
        ({
          sendMessage: async (
            _prompt: string,
            _conversationId: string,
            options: Record<string, unknown> & {
              onRunPrepared?: (input: {
                conversationId: string
                runId: string
                browserTaskRunId: string | null
              }) => Promise<void>
            },
          ) => {
            launchOptions = options
            await options.onRunPrepared?.({
              conversationId: `image-research-${affair.id}`,
              runId: `run-${affair.attempts[0].launchOperationId}`,
              browserTaskRunId: 'browser-task-a',
            })
          },
          onRuntimeEvent: vi.fn(() => () => undefined),
        }) as never,
      getBrowserManager: () =>
        ({
          waitForAccountView: vi.fn(async () => 'browser-tab-a'),
          ensurePlaywrightPage: vi.fn(async () => undefined),
          getViewRuntimeIdentity: vi.fn(() => ({
            tabId: 'browser-tab-a',
            browserViewRuntimeGeneration: 3,
            webContentsId: 9,
            documentGeneration: 2,
          })),
        }) as never,
      getBrowserTaskRuntime: () =>
        ({
          acquireAccountRecoveryLease: vi.fn(() => ({
            id: 'lease-a',
            accountId: affair.attempts[0].accountId,
            profileId: affair.attempts[0].profileId,
            affairId: affair.id,
            attemptId: affair.attempts[0].id,
            executionGeneration: 1,
            launchOperationId: affair.attempts[0].launchOperationId,
            acquiredAt: Date.now(),
          })),
          transferAccountRecoveryLeaseToTask,
          getTask: vi.fn(() => ({
            id: 'browser-task-a',
            status: 'running',
            tabId: 'browser-tab-a',
          })),
          finishTask: vi.fn(),
        }) as never,
    })

    await expect(service.start(affair.id, 'workspace-id')).resolves.toMatchObject({
      success: true,
    })
    expect(launchOptions).toMatchObject({
      disableBuiltinTools: true,
      imageResearchPolicy: {
        affairId: affair.id,
        attemptId: affair.attempts[0].id,
        executionGeneration: 1,
        launchOperationId: affair.attempts[0].launchOperationId,
      },
      allowedTools: [
        'mcp__cclink_studio__image_research_search',
        'mcp__cclink_studio__image_research_inspect_page',
        'mcp__cclink_studio__image_research_open_result',
        'mcp__cclink_studio__image_research_propose',
      ],
    })
    expect(launchOptions?.['allowedTools']).not.toContain('mcp__cclink_studio__browser_screenshot')
    expect(launchOptions?.['allowedTools']).not.toContain('mcp__cclink_studio__browser_*')
    expect(transferAccountRecoveryLeaseToTask).toHaveBeenCalledWith(
      'lease-a',
      'browser-task-a',
      expect.objectContaining({
        accountId: affair.imageResearch?.accountId,
        affairExecutionGeneration: 1,
      }),
    )
  })

  it('keeps the full account lease while the user views a candidate and releases it on close', async () => {
    const affair = imageResearchAffair()
    const candidateId = '88888888-8888-4888-8888-888888888888'
    affair.attempts[0].status = 'waiting-human'
    affair.imageResearch = {
      ...affair.imageResearch!,
      status: 'waiting-human',
      currentCandidateId: candidateId,
      candidates: [
        {
          id: candidateId,
          executionGeneration: 1,
          noteId: '66abc123def456',
          imageIndex: 0,
          title: '奥森湖边拍照',
          visibleText: ['奥森拍照'],
          sanitizedPageUrl: 'https://www.xiaohongshu.com/explore/66abc123def456',
          reopenPath: '/explore/66abc123def456',
          proposedAt: new Date().toISOString(),
        },
      ],
    }
    const releaseAccountRecoveryLease = vi.fn()
    const destroyView = vi.fn()
    const service = new ImageResearchService(
      {
        getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [affair] } })),
        markImageResearchCandidateSourceRecovery: vi.fn(async () => ({
          success: true,
          data: affair,
        })),
      } as never,
      {
        getAgentBridge: () => null,
        getBrowserManager: () =>
          ({
            waitForAccountView: vi.fn(async () => 'candidate-tab'),
            navigate: vi.fn(async () => undefined),
            getViewRuntimeIdentity: vi.fn(() => ({
              tabId: 'candidate-tab',
              browserViewRuntimeGeneration: 1,
              webContentsId: 10,
              documentGeneration: 1,
            })),
            executeJavaScriptInView: vi.fn(async () => ({
              url: 'https://www.xiaohongshu.com/explore/66abc123def456',
              title: '奥森湖边拍照',
              loginRequired: false,
              noteId: '66abc123def456',
              imageIndex: 0,
              totalImages: 1,
              visibleText: ['奥森湖边拍照'],
              results: [],
            })),
            destroyView,
            onViewDestroyed: vi.fn(),
          }) as never,
        getBrowserTaskRuntime: () =>
          ({
            acquireAccountRecoveryLease: vi.fn(() => ({
              id: 'candidate-lease',
              accountId: affair.attempts[0].accountId,
              profileId: affair.attempts[0].profileId,
              affairId: affair.id,
              attemptId: affair.attempts[0].id,
              executionGeneration: 1,
              launchOperationId: affair.attempts[0].launchOperationId,
              acquiredAt: Date.now(),
            })),
            releaseAccountRecoveryLease,
          }) as never,
      },
    )

    await expect(service.openCandidate(affair.id, affair.workspaceId!)).resolves.toMatchObject({
      success: true,
    })
    expect(releaseAccountRecoveryLease).not.toHaveBeenCalled()
    expect(service.closeCandidate(affair.id, affair.workspaceId!)).toMatchObject({ success: true })
    expect(destroyView).toHaveBeenCalledWith('candidate-tab')
    expect(releaseAccountRecoveryLease).toHaveBeenCalledWith('candidate-lease')
  })

  it('persists an unavailable source without disabling the candidate decision', async () => {
    const affair = imageResearchAffair()
    const candidateId = '88888888-8888-4888-8888-888888888888'
    affair.attempts[0].status = 'waiting-human'
    affair.imageResearch = {
      ...affair.imageResearch!,
      status: 'waiting-human',
      currentCandidateId: candidateId,
      candidates: [
        {
          id: candidateId,
          executionGeneration: 1,
          noteId: '66abc123def456',
          imageIndex: 0,
          title: '奥森湖边拍照',
          visibleText: [],
          sanitizedPageUrl: 'https://www.xiaohongshu.com/explore/66abc123def456',
          reopenPath: '/explore/66abc123def456',
          proposedAt: new Date().toISOString(),
        },
      ],
    }
    const markRecovery = vi.fn(async () => ({ success: true, data: affair }))
    const releaseLease = vi.fn()
    const service = new ImageResearchService(
      {
        getProjectSnapshot: vi.fn(() => ({ success: true, data: { affairs: [affair] } })),
        markImageResearchCandidateSourceRecovery: markRecovery,
      } as never,
      {
        getAgentBridge: () => null,
        getBrowserManager: () =>
          ({
            waitForAccountView: vi.fn(async () => 'candidate-tab'),
            navigate: vi.fn(async () => undefined),
            getViewRuntimeIdentity: vi.fn(() => ({
              tabId: 'candidate-tab',
              browserViewRuntimeGeneration: 1,
              webContentsId: 10,
              documentGeneration: 1,
            })),
            executeJavaScriptInView: vi.fn(async () => ({
              url: 'https://www.xiaohongshu.com/404',
              title: '404',
              loginRequired: false,
              noteId: null,
              imageIndex: 0,
              totalImages: 1,
              visibleText: [],
              results: [],
            })),
          }) as never,
        getBrowserTaskRuntime: () =>
          ({
            acquireAccountRecoveryLease: vi.fn(() => ({
              id: 'candidate-lease',
              accountId: affair.attempts[0].accountId,
              profileId: affair.attempts[0].profileId,
              affairId: affair.id,
              attemptId: affair.attempts[0].id,
              executionGeneration: 1,
              launchOperationId: affair.attempts[0].launchOperationId,
              acquiredAt: Date.now(),
            })),
            releaseAccountRecoveryLease: releaseLease,
          }) as never,
      },
    )

    await expect(service.openCandidate(affair.id, affair.workspaceId!)).resolves.toMatchObject({
      success: false,
    })
    expect(markRecovery).toHaveBeenCalledWith(
      affair.id,
      candidateId,
      'unavailable',
      expect.stringContaining('无法重新定位'),
      affair.workspaceId,
    )
    expect(releaseLease).toHaveBeenCalledWith('candidate-lease')
  })
})

function imageResearchAffair(): WebAffair {
  const now = new Date().toISOString()
  const nodeId = '11111111-1111-4111-8111-111111111111'
  const attemptId = '22222222-2222-4222-8222-222222222222'
  const accountId = '33333333-3333-4333-8333-333333333333'
  return {
    id: '44444444-4444-4444-8444-444444444444',
    kind: 'image-research',
    workspaceId: '55555555-5555-4555-8555-555555555555',
    title: '奥森图片调研',
    objective: '查找候选',
    status: 'active',
    principalId: '66666666-6666-4666-8666-666666666666',
    websiteIds: ['77777777-7777-4777-8777-777777777777'],
    accountIds: [accountId],
    materials: [],
    flow: {
      version: 1,
      nodes: [
        {
          id: nodeId,
          title: '找候选',
          status: 'running',
          type: 'web-task',
          executor: 'ai',
          accountIds: [accountId],
          materialIds: [],
          successCriteria: ['找到候选'],
          availableTransitions: ['waiting-human'],
          createdAt: now,
          updatedAt: now,
        },
      ],
      edges: [],
    },
    attempts: [
      {
        id: attemptId,
        nodeId,
        number: 1,
        status: 'preparing',
        executionGeneration: 1,
        launchOperationId: 'launch-image-a',
        runtimeBindings: [],
        profileId: 'profile-xhs',
        accountId,
        entryUrl: 'https://www.xiaohongshu.com/explore',
        sideEffectKey: 'none',
        evidence: [],
        startedAt: now,
      },
    ],
    waitPlans: [],
    flowProposals: [],
    imageResearch: {
      adapterId: 'xiaohongshu',
      adapterVersion: 1,
      accountId,
      searchTerms: ['奥森拍照'],
      targetCount: 3,
      frozenAt: now,
      status: 'searching',
      candidates: [],
    },
    events: [],
    workspaceRef: { kind: 'local', path: '/tmp/workspace' },
    createdAt: now,
    updatedAt: now,
  }
}
