import { expect, it } from 'vitest'
import type { ArticlePublishingState } from './article-publishing-types'
import { reduceUnsubmittedTags } from './reduce-unsubmitted-tags'

function fixture(): ArticlePublishingState {
  return {
    adapterId: 'juejin',
    adapterVersion: 1,
    source: { markdownPath: '/article.md', modifiedAt: 1, size: 1 },
    accountId: 'account',
    websiteId: 'website',
    fields: {
      title: 'Article',
      summary: 'Summary',
      tags: ['人工智能', '智能眼镜'],
      category: '人工智能',
    },
    assets: [],
    sideEffects: [],
    execution: { status: 'interrupted', currentGeneration: 2, currentStepId: 'fill-fields' },
    executionProtocol: { version: 1, recentTransitions: [] },
    publication: { status: 'not-started' },
    draft: { platformDraftId: '123', url: 'https://juejin.cn/editor/drafts/123' },
    checkpoints: ['fill-body', 'fill-fields', 'save-draft', 'publish'].map((stepId) => ({
      stepId,
      label: stepId,
      adapterVersion: 1,
      status: 'completed',
      resumePolicy: 'reconcile-then-run',
      attemptCount: 1,
      evidence: ['historical evidence'],
    })),
  }
}
it('preserves draft, body, assets and history while requiring downstream re-verification', () => {
  const state = fixture()
  const next = reduceUnsubmittedTags(state, state.fields.tags, ['人工智能'])
  expect(next.fields.tags).toEqual(['人工智能'])
  expect(next.draft).toEqual(state.draft)
  expect(next.source).toBe(state.source)
  expect(next.assets).toBe(state.assets)
  expect(next.sideEffects).toBe(state.sideEffects)
  expect(next.checkpoints.map((c) => c.status)).toEqual([
    'completed',
    'needs-reconcile',
    'pending',
    'pending',
  ])
  expect(state.fields.tags).toHaveLength(2)
  expect(() => reduceUnsubmittedTags(next, state.fields.tags, ['人工智能'])).toThrow()
})
it.each(['running', 'result-unknown', 'published'] as const)('rejects %s executions', (status) => {
  const state = fixture()
  state.execution.status = status
  expect(() => reduceUnsubmittedTags(state, state.fields.tags, ['人工智能'])).toThrow()
})
it.each(['dispatched', 'result-unknown', 'published'] as const)(
  'rejects %s publications',
  (status) => {
    const state = fixture()
    state.publication.status = status
    expect(() => reduceUnsubmittedTags(state, state.fields.tags, ['人工智能'])).toThrow()
  },
)
it.each([{ tags: [] }, { tags: ['新增'] }, { tags: ['人工智能', '人工智能'] }])(
  'rejects invalid retained tags %j',
  ({ tags }) => {
    const state = fixture()
    expect(() => reduceUnsubmittedTags(state, state.fields.tags, tags)).toThrow()
  },
)
it('rejects unresolved side effects and any previous publication dispatch even with reset-looking status', () => {
  const state = fixture()
  state.sideEffects = [{ kind: 'save-draft', status: 'result-unknown' } as never]
  expect(() => reduceUnsubmittedTags(state, state.fields.tags, ['人工智能'])).toThrow()
  state.sideEffects = [{ kind: 'publish', status: 'rejected' } as never]
  expect(() => reduceUnsubmittedTags(state, state.fields.tags, ['人工智能'])).toThrow()
})
