import { describe, expect, it } from 'vitest'
import {
  canRebuildLostBilibiliComposer,
  canResumeRebuiltBilibiliComposer,
  canResumeExactBilibiliComposer,
  canRetryEmptyBilibiliComposer,
} from './bilibili-composer-recovery'

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

describe('B站 lost temporary composer rebuild', () => {
  const state = {
    adapterId: 'bilibili',
    composer: { platformAccountId: '3546384070347419' },
    publication: { status: 'not-started' },
    execution: { currentStepId: 'fill-fields' },
    assets: [
      {
        status: 'uploaded',
        platformUrl: 'https://i0.hdslb.com/one.png',
        verifiedAt: 'now',
      },
    ],
    sideEffects: [{ kind: 'upload-asset' }, { kind: 'save-draft' }],
  }
  const probe = {
    adapterId: 'bilibili',
    url: 'https://t.bilibili.com/',
    platformAccountId: '3546384070347419',
    editor: {
      recognized: true,
      initialDraftBodyEmpty: true,
      bodyTextLength: 0,
      imageEnumerationComplete: true,
      images: [],
    },
    title: { value: '' },
  }

  it('allows only a pre-submit verified gallery to rebuild in the exact empty account', () => {
    expect(canRebuildLostBilibiliComposer(state as never, probe as never, false)).toBe(true)
    expect(
      canRebuildLostBilibiliComposer(
        {
          ...state,
          sideEffects: [{ kind: 'upload-asset', dispatchedAt: 'now', status: 'verified' }],
        } as never,
        probe as never,
        false,
      ),
    ).toBe(false)
    expect(
      canRebuildLostBilibiliComposer(
        { ...state, sideEffects: [...state.sideEffects, { kind: 'publish' }] } as never,
        probe as never,
        false,
      ),
    ).toBe(false)
  })

  it('accepts preserved frozen body with a lost gallery but rejects unmatched text', () => {
    const preserved = {
      ...probe,
      editor: { ...probe.editor, initialDraftBodyEmpty: false, bodyTextLength: 404 },
    }
    expect(canRebuildLostBilibiliComposer(state as never, preserved as never, true)).toBe(true)
    expect(canRebuildLostBilibiliComposer(state as never, preserved as never, false)).toBe(false)
  })

  it('resumes an already persisted rebuild with matching frozen body', () => {
    const rebuilt = {
      ...state,
      execution: { currentStepId: 'upload-assets' },
      assets: [{ status: 'pending', uploadAttempts: [] }],
    }
    const preserved = {
      ...probe,
      editor: { ...probe.editor, initialDraftBodyEmpty: false, bodyTextLength: 404 },
    }
    expect(canResumeRebuiltBilibiliComposer(rebuilt as never, preserved as never, true)).toBe(true)
    expect(canResumeRebuiltBilibiliComposer(rebuilt as never, preserved as never, false)).toBe(
      false,
    )
  })
})

describe('B站 exact gallery resume', () => {
  const state = {
    adapterId: 'bilibili',
    composer: { platformAccountId: '3546384070347419' },
    publication: { status: 'not-started' },
    execution: { currentStepId: 'upload-assets' },
    assets: [
      { status: 'uploaded', platformUrl: 'https://i0.hdslb.com/one.png', verifiedAt: 'now' },
      { status: 'uploaded', platformUrl: 'https://i0.hdslb.com/two.png', verifiedAt: 'now' },
    ],
    sideEffects: [{ kind: 'upload-asset' }],
  }
  const probe = {
    adapterId: 'bilibili',
    url: 'https://t.bilibili.com/',
    platformAccountId: '3546384070347419',
    editor: {
      recognized: true,
      initialDraftBodyEmpty: true,
      bodyTextLength: 0,
      imageEnumerationComplete: false,
      images: [
        { src: 'https://i0.hdslb.com/one.png', loaded: true },
        { src: 'https://i0.hdslb.com/two.png', loaded: true },
      ],
    },
    title: { value: '' },
  }

  it('accepts only the exact ordered verified gallery even when enumeration confidence is low', () => {
    expect(canResumeExactBilibiliComposer(state as never, probe as never)).toBe(true)
    expect(
      canResumeExactBilibiliComposer(
        state as never,
        {
          ...probe,
          editor: { ...probe.editor, images: [...probe.editor.images].reverse() },
        } as never,
      ),
    ).toBe(false)
  })
})
