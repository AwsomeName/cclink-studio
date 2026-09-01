import { describe, expect, it } from 'vitest'
import { isSameCsdnDraft, parseCsdnDraftAnchor } from './csdn-draft-anchor'

describe('CSDN draft anchor', () => {
  it('canonicalizes the stable numeric draft URL without query or fragment data', () => {
    expect(
      parseCsdnDraftAnchor(
        'https://mp.csdn.net/mp_blog/creation/editor/164148817?spm=private#title',
      ),
    ).toEqual({
      draftId: '164148817',
      url: 'https://mp.csdn.net/mp_blog/creation/editor/164148817',
    })
  })

  it('rejects generic editor entry points because they do not identify an existing draft', () => {
    expect(parseCsdnDraftAnchor('https://editor.csdn.net/md/')).toBeNull()
    expect(parseCsdnDraftAnchor('https://mp.csdn.net/mp_blog/creation/editor')).toBeNull()
    expect(parseCsdnDraftAnchor('https://app-blog.csdn.net/csdn/aiChatNew')).toBeNull()
  })

  it('extracts stable draft IDs from current query-based CSDN editor routes', () => {
    expect(
      parseCsdnDraftAnchor('https://editor.csdn.net/md/?articleId=164148817&from=drafts'),
    ).toEqual({
      draftId: '164148817',
      url: 'https://editor.csdn.net/md/?articleId=164148817',
    })
    expect(
      parseCsdnDraftAnchor('https://mp.csdn.net/mp_blog/creation/editor?draftId=164148817'),
    ).toEqual({
      draftId: '164148817',
      url: 'https://mp.csdn.net/mp_blog/creation/editor?articleId=164148817',
    })
  })

  it('compares draft identity instead of incidental URL decoration', () => {
    expect(
      isSameCsdnDraft(
        'https://mp.csdn.net/mp_blog/creation/editor/164148817?from=list',
        'https://mp.csdn.net/mp_blog/creation/editor/164148817#body',
      ),
    ).toBe(true)
    expect(
      isSameCsdnDraft(
        'https://mp.csdn.net/mp_blog/creation/editor/164148817',
        'https://mp.csdn.net/mp_blog/creation/editor/164148818',
      ),
    ).toBe(false)
  })
})
