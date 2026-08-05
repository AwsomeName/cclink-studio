import { describe, expect, it } from 'vitest'
import {
  createEmptyWebAffairDraft,
  createWebAffairDraftTab,
  isWebAffairDraftEmpty,
} from './web-affair-draft'

describe('web affair draft tab', () => {
  it('creates a workbench draft instead of a sidebar form', () => {
    const workspaceRef = { kind: 'local' as const, path: '/tmp/project-a' }
    const tab = createWebAffairDraftTab(workspaceRef)

    expect(tab).toEqual(
      expect.objectContaining({
        type: 'web-affair',
        title: '新建事务',
        workspaceRef,
        webAffair: expect.objectContaining({ affairId: null }),
      }),
    )
    expect(tab.webAffair.draft?.nodeTitles).toHaveLength(5)
  })

  it('marks user-entered draft content as non-empty', () => {
    const draft = createEmptyWebAffairDraft()
    expect(isWebAffairDraftEmpty(draft)).toBe(true)
    expect(isWebAffairDraftEmpty({ ...draft, objective: '提交 Apple 审核' })).toBe(false)
  })
})
