import { describe, expect, it, vi } from 'vitest'
import {
  ArticlePublishingBrowserPolicy,
  CSDN_ARTICLE_SUPPORTED_ORIGINS,
} from './article-publishing-browser-policy'

function createPolicy(options?: {
  stepId?: string
  publicationStatus?: string
  assetStatus?: string
  executionStatus?: string
}) {
  const reserveArticlePublishingSideEffect = vi.fn().mockResolvedValue({
    success: true,
    data: {},
  })
  const handoffAttempt = vi.fn().mockResolvedValue({ success: true, data: {} })
  const webAffairService = {
    getProjectSnapshot: vi.fn().mockReturnValue({
      success: true,
      data: {
        affairs: [
          {
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
                runtimeBindings: [
                  {
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
                  },
                ],
              },
            ],
            articlePublishing: {
              adapterId: 'csdn',
              adapterVersion: 1,
              accountId: 'account-a',
              source: { contentHash: 'a'.repeat(64) },
              assets: [
                {
                  id: 'asset-a',
                  kind: 'local',
                  sourcePath: '/workspace/a.png',
                  status: options?.assetStatus ?? 'uploaded',
                  uploadAttempts: [],
                },
              ],
              execution: {
                status: options?.executionStatus ?? 'running',
                currentAttemptId: 'attempt-a',
                currentStepId: options?.stepId ?? 'upload-assets',
                currentGeneration: 1,
              },
              publication: { status: options?.publicationStatus ?? 'not-started' },
            },
          },
        ],
      },
    }),
    reserveArticlePublishingSideEffect,
    handoffAttempt,
  }
  return {
    policy: new ArticlePublishingBrowserPolicy(
      webAffairService as never,
      async () => 'workspace-a',
    ),
    webAffairService,
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
  trustedWorkspace: {
    kind: 'local' as const,
    rootPath: '/workspace',
    workspaceKey: '/workspace',
  },
}

describe('ArticlePublishingBrowserPolicy', () => {
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
    const { policy } = createPolicy()
    const locator = {
      count: vi.fn().mockResolvedValue(1),
      isVisible: vi.fn().mockResolvedValue(true),
      evaluate: vi.fn().mockResolvedValue({ label: '确认上传', type: '', role: 'button' }),
    }
    const page = {
      url: () => 'https://app-blog.csdn.net/csdn/aiChatNew',
      locator: vi.fn().mockReturnValue(locator),
    }

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

  it('hands legal and account-impact controls to the user', async () => {
    const { policy } = createPolicy()
    const page = {
      url: () => 'https://app-blog.csdn.net/csdn/aiChatNew',
      locator: () => ({
        count: async () => 1,
        isVisible: async () => true,
        evaluate: async () => ({ label: '确认原创声明', type: '', role: 'button' }),
      }),
    }

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
    const { policy, webAffairService } = createPolicy({ stepId: 'publish' })
    const page = {
      url: () => 'https://app-blog.csdn.net/csdn/aiChatNew',
      locator: () => ({
        count: async () => 1,
        isVisible: async () => true,
        evaluate: async () => ({ label: '发布博客', type: 'submit', role: 'button' }),
      }),
    }

    await expect(
      policy.classifyAction(
        task as never,
        'click',
        { selector: 'button:has-text("发布博客")' },
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
      expect.any(String),
      'task-a',
      'workspace-a',
    )
  })

  it('persists a write-ahead marker before a field mutation that may autosave', async () => {
    const { policy, webAffairService } = createPolicy({ stepId: 'fill-fields' })
    const page = { url: () => 'https://app-blog.csdn.net/csdn/aiChatNew' }

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
      expect.stringMatching(/^autosave:fill-fields:[a-f0-9]{64}$/),
      expect.any(String),
      'task-a',
      'workspace-a',
    )
  })

  it('stops page mutations on a supported origin when the page is not an editor page', async () => {
    const { policy } = createPolicy()
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
    ).resolves.toMatchObject({ kind: 'unknown' })
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
    ).resolves.toMatchObject({ kind: 'unknown' })
    expect(webAffairService.reserveArticlePublishingSideEffect).not.toHaveBeenCalled()
  })

  it('keeps verification checkpoints read-only', async () => {
    const { policy } = createPolicy({ stepId: 'verify-publication' })
    const page = { url: () => 'https://blog.csdn.net/example/article/details/1' }

    await expect(
      policy.classifyAction(task as never, 'click', { selector: 'button' }, page as never, context),
    ).resolves.toMatchObject({ kind: 'unknown' })
  })
})
