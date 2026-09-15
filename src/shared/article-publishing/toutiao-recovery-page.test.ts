import { describe, expect, it } from 'vitest'
import type { ArticlePublishingState } from './article-publishing-types'
import { toutiaoRecoveryPage } from './toutiao-recovery-page'

function state() {
  return {
    adapterId: 'toutiao',
    execution: {
      status: 'interrupted',
      currentStepId: 'upload-assets',
      currentAttemptId: 'attempt',
      currentGeneration: 12,
      currentLaunchOperationId: 'launch',
    },
    publication: { status: 'not-started' },
    assets: [{ status: 'reconciling' }],
    draft: { recovery: { status: 'verified', executionGeneration: 12 } },
    executionProtocol: {
      current: {
        definitionId: 'runtime.prepare-first-inspect',
        status: 'interrupted',
        attemptId: 'attempt',
        executionGeneration: 12,
        launchOperationId: 'launch',
        runtime: {
          tabId: 'verified-draft-page',
          browserViewRuntimeGeneration: 1,
          webContentsId: 2,
          playwrightConnectionGeneration: 3,
          playwrightPageBindingGeneration: 4,
        },
      },
    },
  } as ArticlePublishingState
}

describe('Toutiao saved draft image reconciliation page', () => {
  it('uses the current verified operation without creating an Agent binding or resolving the image', () => {
    const input = state()
    const before = structuredClone(input)
    expect(toutiaoRecoveryPage(input)?.tabId).toBe('verified-draft-page')
    expect(input).toEqual(before)
  })
  it.each([
    [
      'another platform',
      (s: ArticlePublishingState) => {
        s.adapterId = 'weibo'
      },
    ],
    [
      'running Agent',
      (s: ArticlePublishingState) => {
        s.execution.status = 'running'
      },
    ],
    [
      'publication dispatched',
      (s: ArticlePublishingState) => {
        s.publication.status = 'result-unknown'
      },
    ],
    [
      'wrong checkpoint',
      (s: ArticlePublishingState) => {
        s.execution.currentStepId = 'publish'
      },
    ],
    [
      'no unknown image',
      (s: ArticlePublishingState) => {
        s.assets = []
      },
    ],
    [
      'stale recovery',
      (s: ArticlePublishingState) => {
        s.draft!.recovery!.executionGeneration--
      },
    ],
    [
      'stale operation',
      (s: ArticlePublishingState) => {
        s.executionProtocol.current!.executionGeneration--
      },
    ],
    [
      'other attempt',
      (s: ArticlePublishingState) => {
        s.executionProtocol.current!.attemptId = 'old'
      },
    ],
    [
      'other launch',
      (s: ArticlePublishingState) => {
        s.executionProtocol.current!.launchOperationId = 'old'
      },
    ],
    [
      'no page identity',
      (s: ArticlePublishingState) => {
        s.executionProtocol.current!.runtime = undefined
      },
    ],
  ])('refuses %s', (_name, change) => {
    const input = state()
    change(input)
    expect(toutiaoRecoveryPage(input)).toBeUndefined()
  })
})
