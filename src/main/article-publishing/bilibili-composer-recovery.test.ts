import { describe, expect, it } from 'vitest'
import { canRetryEmptyBilibiliComposer } from './bilibili-composer-recovery'

describe('B站 empty composer retry', () => {
  it.each([
    'reconciled-missing',
    'unknown-upload',
    'has-image',
    'has-title',
    'wrong-account',
    'incomplete-images',
    'uploaded-asset',
    'publish-unknown',
    'body-stage',
    'unconfirmed-missing',
  ] as const)('%s', (mode) => {
    const state = {
      adapterId: 'bilibili',
      composer: { platformAccountId: '3546384070347419' },
      publication: { status: mode === 'publish-unknown' ? 'result-unknown' : 'not-started' },
      execution: { currentStepId: mode === 'body-stage' ? 'fill-body' : 'upload-assets' },
      assets: [
        {
          id: 'first',
          status: mode === 'uploaded-asset' ? 'uploaded' : 'retryable-failed',
          manualResolution: mode === 'unconfirmed-missing' ? undefined : { status: 'missing' },
        },
      ],
      sideEffects: [
        {
          kind: 'upload-asset',
          targetId: 'first:attempt-2',
          dispatchedAt: 'now',
          status: mode === 'unknown-upload' ? 'result-unknown' : 'rejected',
        },
      ],
    }
    const probe = {
      adapterId: 'bilibili',
      url: 'https://t.bilibili.com/',
      platformAccountId: mode === 'wrong-account' ? '00000' : '3546384070347419',
      editor: {
        recognized: true,
        initialDraftBodyEmpty: true,
        bodyTextLength: 0,
        images: mode === 'has-image' ? [{ src: '' }] : [],
        imageEnumerationComplete: mode !== 'incomplete-images',
      },
      title: { value: mode === 'has-title' ? 'other draft' : '' },
    }
    expect(canRetryEmptyBilibiliComposer(state as never, probe as never)).toBe(
      mode === 'reconciled-missing',
    )
  })
})
