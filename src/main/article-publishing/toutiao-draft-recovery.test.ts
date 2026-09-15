import { describe, expect, it, vi } from 'vitest'
import { locateToutiaoDraft } from './toutiao-draft-recovery'
import { TOUTIAO_MANAGEMENT_URL } from './toutiao-publishing-adapter'
import { CsdnDraftRecoveryCoordinator } from './csdn-draft-recovery-coordinator'

function fixture(draftId = '1876018407641100') {
  const accountReady = vi.fn(async () => {})
  const edit = { count: async () => 1, isVisible: async () => true, click: vi.fn(async () => {}) }
  const row = { getByText: () => edit }
  const title = {
    count: vi.fn(async () => 1),
    first: () => ({ waitFor: async () => {} }),
    getByText: () => ({ count: async () => 0 }),
    locator: () => row,
  }
  const popup = {
    url: () => `https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=${draftId}`,
    waitForLoadState: async () => {},
    locator: () => ({ waitFor: async () => {}, first: () => ({ waitFor: accountReady }) }),
    evaluate: vi.fn(async () => ({
      url: `https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=${draftId}`,
      uid: '3777529577766638',
      title: '原标题',
      saved: true,
    })),
  }
  const page = {
    url: () => TOUTIAO_MANAGEMENT_URL,
    locator: () => ({ filter: () => title, first: () => ({ waitFor: accountReady }) }),
    evaluate: vi.fn(async () => ({ management: true, uid: '3777529577766638' })),
    waitForEvent: vi.fn(async () => popup),
  }
  return { page, title, edit, accountReady, popup }
}
const expected = { draftId: '1876018407641100', uid: '3777529577766638', title: '原标题' }

describe('Toutiao management recovery', () => {
  it.each(['valid', 'uid', 'title', 'saved', 'missing-account'] as const)(
    'requires exact saved editor proof when the management header is absent: %s',
    async (mode) => {
      const f = fixture()
      f.page.evaluate.mockResolvedValue({ management: true, uid: undefined } as never)
      const visibleEditor = {
        url: () => f.popup.url(),
        waitForTimeout: async () => {},
        isClosed: () => false,
      }
      const observe = vi.fn(async (_event: { id: string; status: string }) => {})
      const probe = vi.fn(async (page: unknown) => {
        expect(page).toBe(visibleEditor)
        return {
          adapterId: 'toutiao',
          url: f.popup.url(),
          draftId: expected.draftId,
          observedAt: new Date().toISOString(),
          editor: { recognized: true, images: [] },
          platformAccountId:
            mode === 'missing-account' ? undefined : mode === 'uid' ? '999' : expected.uid,
          title: { value: mode === 'title' ? '其他标题' : expected.title },
          saveState: mode === 'saved' ? 'unknown' : 'saved',
        }
      })
      const result = new CsdnDraftRecoveryCoordinator(
        { probe } as never,
        TOUTIAO_MANAGEMENT_URL,
      ).recoverExactDraft({
        expectedDraftId: expected.draftId,
        expectedPlatformAccountId: expected.uid,
        expectedTitle: expected.title,
        observe,
        navigate: async (url) => (url === TOUTIAO_MANAGEMENT_URL ? f.page : visibleEditor) as never,
      })
      if (mode === 'valid')
        expect(await result).toMatchObject({
          draftId: expected.draftId,
          platformAccountId: expected.uid,
        })
      else await expect(result).rejects.toThrow()
      expect(f.edit.click).toHaveBeenCalledOnce()
      expect(f.popup.evaluate).not.toHaveBeenCalled()
      const accountCompleted = observe.mock.calls.some(
        ([event]) =>
          (event as { id: string; status: string }).id === 'recovery.account' &&
          (event as { status: string }).status === 'completed',
      )
      expect(accountCompleted).toBe(mode === 'valid')
    },
  )
  it('does not reinterpret ambiguous management accounts as a missing header', async () => {
    const f = fixture()
    f.page.evaluate.mockResolvedValue({
      management: true,
      uid: undefined,
      accountIdentityCount: 2,
    } as never)
    await expect(locateToutiaoDraft(f.page as never, expected, () => {})).rejects.toThrow(
      '账号不一致',
    )
    expect(f.edit.click).not.toHaveBeenCalled()
  })
  it('uses the actual single popup URL and checks its exact ID before returning it', async () => {
    const f = fixture()
    expect(await locateToutiaoDraft(f.page as never, expected, () => {})).toContain(
      `draft_id=${expected.draftId}`,
    )
    expect(f.edit.click).toHaveBeenCalledTimes(1)
  })
  it('does not treat a same-title popup with another ID as the original', async () => {
    const f = fixture('999')
    await expect(locateToutiaoDraft(f.page as never, expected, () => {})).rejects.toThrow(
      'ID 与原任务不一致',
    )
    expect(f.edit.click).toHaveBeenCalledTimes(1)
  })
  it('does not click for duplicate rows, wrong accounts or a cancelled recovery', async () => {
    const duplicate = fixture()
    duplicate.title.count.mockResolvedValue(2)
    await expect(locateToutiaoDraft(duplicate.page as never, expected, () => {})).rejects.toThrow(
      '不唯一',
    )
    expect(duplicate.edit.click).not.toHaveBeenCalled()
    const wrong = fixture()
    wrong.page.evaluate.mockResolvedValue({ management: true, uid: '999' })
    await expect(locateToutiaoDraft(wrong.page as never, expected, () => {})).rejects.toThrow(
      '账号不一致',
    )
    expect(wrong.edit.click).not.toHaveBeenCalled()
    const cancelled = fixture()
    await expect(
      locateToutiaoDraft(cancelled.page as never, expected, () => {
        throw new Error('cancelled')
      }),
    ).rejects.toThrow('cancelled')
    expect(cancelled.edit.click).not.toHaveBeenCalled()
  })
})
