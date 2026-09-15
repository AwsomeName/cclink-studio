import { describe, expect, it } from 'vitest'
import { ArticlePublishingBrowserPolicy } from './article-publishing-browser-policy'

const policy = ArticlePublishingBrowserPolicy.prototype as unknown as {
  inspectionProves: (kind: string, params: Record<string, unknown>, evidence: unknown) => boolean
}
describe('Toutiao interrupted before file dispatch', () => {
  it.each([
    { never: true, complete: true, known: false, extra: false, expected: true },
    { never: false, complete: true, known: false, extra: false, expected: false },
    { never: true, complete: false, known: false, extra: false, expected: false },
    { never: true, complete: true, known: true, extra: false, expected: false },
    { never: true, complete: true, known: false, extra: true, expected: false },
  ])('only permits a proven never-dispatched missing image: %j', (f) => {
    expect(
      policy.inspectionProves(
        'asset-absent',
        { assetId: 'cover' },
        {
          scope: {
            adapterId: 'toutiao',
            assets: [
              {
                id: 'cover',
                status: 'reconciling',
                uploadAttemptCount: 1,
                uploadNeverDispatched: f.never,
                platformUrl: f.known ? 'https://known' : undefined,
              },
            ],
          },
          inspection: {
            matchedAssets: {},
            editor: {
              recognized: true,
              imageEnumerationComplete: f.complete,
              images: f.extra ? [{ src: 'https://unassigned' }] : [],
            },
          },
        },
      ),
    ).toBe(f.expected)
  })
})

import { canResumeUnsubmittedToutiaoImage } from './toutiao-unsubmitted-upload'
import type { ArticlePublishingState } from '../../shared/article-publishing/article-publishing-types'

describe('Toutiao exact saved-draft handshake before any upload reservation', () => {
  it.each([
    'ready',
    'reserved',
    'dispatched',
    'unknown-image',
    'incomplete',
    'other-draft',
    'other-account',
    'unsaved',
    'known-url',
    'other-platform',
  ])('settles only proven unsubmitted preparation: %s', (mode) => {
    const asset = {
      id: 'local:cover',
      kind: 'local',
      status: 'reconciling',
      platformUrl: mode === 'known-url' ? 'https://known' : undefined,
    }
    const state = {
      adapterId: mode === 'other-platform' ? 'csdn' : 'toutiao',
      fields: { title: 'Title' },
      draft: { platformDraftId: '123', platformAccountId: '456' },
      assets: [asset],
      sideEffects: ['reserved', 'dispatched'].includes(mode)
        ? [{ kind: 'upload-asset', targetId: 'local:cover:attempt-1', status: mode }]
        : [],
    } as unknown as ArticlePublishingState
    expect(
      canResumeUnsubmittedToutiaoImage(state, state.assets[0], {
        draftId: mode === 'other-draft' ? '999' : '123',
        platformAccountId: mode === 'other-account' ? '999' : '456',
        normalizedTitle: 'Title',
        saveState: mode === 'unsaved' ? 'unknown' : 'saved',
        imageEnumerationComplete: mode !== 'incomplete',
        images: mode === 'unknown-image' ? [{ src: 'https://unknown', loaded: true }] : [],
      }),
    ).toBe(mode === 'ready')
  })
})
