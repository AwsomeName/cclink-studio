import { describe, expect, it } from 'vitest'
import { canRetryConfirmedMissingWeiboComposer } from './weibo-composer-recovery'

function fixture() {
  return {
    state: {
      adapterId: 'weibo',
      composer: { platformAccountId: '5961101548' },
      publication: { status: 'not-started' },
      execution: { currentStepId: 'upload-assets' },
      assets: [
        {
          id: 'first',
          kind: 'local',
          status: 'retryable-failed',
          platformUrl: undefined as string | undefined,
          verifiedAt: undefined as string | undefined,
          manualResolution: { status: 'missing' },
          uploadAttempts: [{ status: 'retryable-failed' }],
        },
        {
          id: 'second',
          kind: 'local',
          status: 'pending',
          uploadAttempts: [] as Array<{ status: string }>,
        },
      ],
      sideEffects: [
        {
          kind: 'upload-asset',
          targetId: 'first:attempt-2',
          dispatchedAt: 'previous-run',
          status: 'rejected',
        },
      ],
    },
    probe: {
      adapterId: 'weibo',
      url: 'https://weibo.com/',
      platformAccountId: '5961101548',
      editor: {
        recognized: true,
        initialDraftBodyEmpty: true,
        bodyTextLength: 0,
        imageEnumerationComplete: true,
        images: [] as Array<{ src: string }>,
      },
      title: { value: '' },
    },
  }
}

describe('Weibo same-task recovery after explicit missing-image confirmation', () => {
  it('admits only the reconciled upload stage and preserves the input history', () => {
    const { state, probe } = fixture()
    const before = structuredClone(state)
    expect(canRetryConfirmedMissingWeiboComposer(state as never, probe as never)).toBe(true)
    expect(state).toEqual(before)
  })

  it.each([
    'unknown-upload',
    'not-confirmed',
    'present-confirmation',
    'wrong-account',
    'missing-account',
    'wrong-page',
    'unrecognized',
    'incomplete-images',
    'has-image',
    'has-body',
    'has-title',
    'body-stage',
    'publication-unknown',
    'reserved-publish',
    'body-write',
    'uploaded-asset',
    'prior-success',
    'pending-with-history',
    'unmatched-effect',
    'other-platform',
  ])('rejects %s without resolving or repeating any side effect', (scenario) => {
    const { state, probe } = fixture()
    switch (scenario) {
      case 'unknown-upload':
        state.sideEffects[0].status = 'result-unknown'
        break
      case 'not-confirmed':
        state.assets[0].manualResolution = undefined
        break
      case 'present-confirmation':
        state.assets[0].manualResolution = { status: 'present' }
        break
      case 'wrong-account':
        probe.platformAccountId = '999999'
        break
      case 'missing-account':
        state.composer.platformAccountId = ''
        probe.platformAccountId = ''
        break
      case 'wrong-page':
        probe.url = 'https://weibo.com/another'
        break
      case 'unrecognized':
        probe.editor.recognized = false
        break
      case 'incomplete-images':
        probe.editor.imageEnumerationComplete = false
        break
      case 'has-image':
        probe.editor.images.push({ src: 'existing-image' })
        break
      case 'has-body':
        probe.editor.bodyTextLength = 12
        break
      case 'has-title':
        probe.title.value = 'existing title'
        break
      case 'body-stage':
        state.execution.currentStepId = 'fill-body'
        break
      case 'publication-unknown':
        state.publication.status = 'result-unknown'
        break
      case 'reserved-publish':
        state.sideEffects.push({
          kind: 'publish',
          targetId: 'final',
          dispatchedAt: '',
          status: 'reserved',
        })
        break
      case 'body-write':
        state.sideEffects[0].kind = 'save-draft'
        break
      case 'uploaded-asset':
        state.assets[0].platformUrl = 'https://wx1.sinaimg.cn/large/a.jpg'
        break
      case 'prior-success':
        state.assets[0].uploadAttempts.push({ status: 'succeeded' })
        break
      case 'pending-with-history':
        state.assets[1].uploadAttempts.push({ status: 'retryable-failed' })
        break
      case 'unmatched-effect':
        state.sideEffects[0].targetId = 'other:attempt-2'
        break
      case 'other-platform':
        state.adapterId = 'bilibili'
        break
    }
    expect(canRetryConfirmedMissingWeiboComposer(state as never, probe as never)).toBe(false)
  })
})
