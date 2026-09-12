import { describe, expect, it, vi } from 'vitest'
import { locateToutiaoDraft } from './toutiao-draft-recovery'
import { TOUTIAO_MANAGEMENT_URL } from './toutiao-publishing-adapter'

function fixture(draftId = '1876018407641100') {
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
  }
  const page = {
    url: () => TOUTIAO_MANAGEMENT_URL,
    locator: () => ({ filter: () => title }),
    evaluate: vi.fn(async () => ({ management: true, uid: '3777529577766638' })),
    waitForEvent: vi.fn(async () => popup),
  }
  return { page, title, edit }
}
const expected = { draftId: '1876018407641100', uid: '3777529577766638', title: '原标题' }

describe('Toutiao management recovery', () => {
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
