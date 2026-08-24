import { describe, expect, it } from 'vitest'
import { getBrowserTabMode, isValidBrowserTabMode } from './browser-tab-mode'

describe('browser tab mode', () => {
  it('recognizes ordinary browsing without a named Profile or account binding', () => {
    expect(getBrowserTabMode({ browserProfile: null })).toBe('ordinary')
    expect(isValidBrowserTabMode({})).toBe(true)
  })

  it('recognizes saved accounts and account drafts', () => {
    expect(
      getBrowserTabMode({
        browserProfile: 'account-profile',
        webResourceRef: { accountId: 'account-1' },
      }),
    ).toBe('account')
    expect(
      getBrowserTabMode({
        browserProfile: 'draft-profile',
        webResourceDraftRef: { draftId: 'draft-1' },
      }),
    ).toBe('account-draft')
  })

  it('rejects Profile-only, owner-only, and conflicting bindings', () => {
    expect(getBrowserTabMode({ browserProfile: 'profile-only' })).toBe('invalid')
    expect(getBrowserTabMode({ webResourceRef: { accountId: 'account-1' } })).toBe('invalid')
    expect(
      getBrowserTabMode({
        browserProfile: 'conflict',
        webResourceRef: { accountId: 'account-1' },
        webResourceDraftRef: { draftId: 'draft-1' },
      }),
    ).toBe('invalid')
  })

  it('treats malformed restored references as invalid instead of throwing', () => {
    expect(getBrowserTabMode({ browserProfile: '' })).toBe('invalid')
    expect(getBrowserTabMode({ browserProfile: '   ' })).toBe('invalid')
    expect(getBrowserTabMode({ webResourceRef: { accountId: '' } })).toBe('invalid')
    expect(getBrowserTabMode({ webResourceDraftRef: { draftId: '' } })).toBe('invalid')
    expect(
      getBrowserTabMode({
        browserProfile: 'profile-a',
        webResourceRef: { accountId: 42 } as never,
      }),
    ).toBe('invalid')
  })
})
