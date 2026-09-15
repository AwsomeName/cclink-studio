import { describe, expect, it } from 'vitest'
import type { WebAffair } from '../../shared/web-affairs/web-affair-types'
import type { ArticlePublishingSourcePreview } from '../../shared/article-publishing/article-publishing-types'
import { canStartAfterUnsubmittedWeiboTask } from './weibo-unsubmitted-task'

describe('new document after a stopped preparation-only Weibo task', () => {
  it.each([
    'different',
    'same-path',
    'same-title',
    'authorized',
    'unknown',
    'publish-effect',
    'running',
    'active-binding',
    'missing-binding',
    'wrong-generation',
    'live-run',
    'missing-attempt',
  ])('%s preserves history and fails closed without proof of no submission', (mode) => {
    const previous = {
      attempts:
        mode === 'missing-attempt'
          ? []
          : [
              {
                id: 'attempt',
                status: mode === 'running' ? 'running-ai' : 'interrupted',
                runtimeBindings: (mode === 'missing-binding'
                  ? ['agent-run']
                  : ['agent-run', 'browser-task']
                ).map((kind) => ({
                  kind,
                  executionGeneration: mode === 'wrong-generation' ? 1 : 2,
                  status: mode === 'active-binding' ? 'active' : 'terminal',
                  endedAt: '2026-09-13T00:00:00Z',
                })),
              },
            ],
      articlePublishing: {
        adapterId: 'weibo',
        composer: { allowPublish: mode === 'authorized' },
        execution: {
          status: 'interrupted',
          currentAttemptId: 'attempt',
          currentGeneration: 2,
          ...(mode === 'live-run' ? { lastAgentRunId: 'run' } : {}),
        },
        publication: { status: mode === 'unknown' ? 'result-unknown' : 'not-started' },
        sideEffects: mode === 'publish-effect' ? [{ kind: 'publish', status: 'rejected' }] : [],
        source: { markdownPath: '/missing/old.md' },
        fields: { title: 'Old' },
      },
    } as unknown as WebAffair
    const preview = {
      source: { markdownPath: mode === 'same-path' ? '/missing/old.md' : '/new.md' },
      title: mode === 'same-title' ? ' O l d ' : 'New',
    } as ArticlePublishingSourcePreview
    const before = JSON.stringify(previous)
    expect(canStartAfterUnsubmittedWeiboTask(previous, preview)).toBe(mode === 'different')
    expect(JSON.stringify(previous)).toBe(before)
  })
})
