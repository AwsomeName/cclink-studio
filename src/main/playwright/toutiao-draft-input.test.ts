import type { Page } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'
import { fillToutiaoDraft, uploadToutiaoDraftImage } from './toutiao-draft-input'
import {
  readToutiaoPage,
  TOUTIAO_BODY_SELECTOR,
  TOUTIAO_FILE_SELECTOR,
} from '../article-publishing/toutiao-publishing-adapter'

vi.mock('../article-publishing/toutiao-publishing-adapter', async (original) => ({
  ...(await original<typeof import('../article-publishing/toutiao-publishing-adapter')>()),
  readToutiaoPage: vi.fn(),
}))
function fixture(url = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=123') {
  const events: string[] = []
  const page = {
    url: () => url,
    locator: (selector: string) => ({
      count: async () => 1,
      isVisible: async () => true,
      isEnabled: async () => true,
      innerText: async () => '存草稿',
      fill: async () => {
        events.push(`fill:${selector}`)
      },
      press: async () => {
        events.push(`press:${selector}`)
      },
      setInputFiles: async () => {
        events.push('upload')
      },
    }),
    waitForTimeout: async () => {},
  }
  return { page: page as unknown as Page, events }
}
describe('Toutiao native saved draft mutations', () => {
  it('persists the native insertion before durable gallery identity becomes available', async () => {
    const { page, events } = fixture()
    const original = page.locator.bind(page)
    vi.spyOn(page, 'locator').mockImplementation((selector) =>
      selector === '.byte-drawer:visible:has(input[type="file"])'
        ? ({
            count: async () => 1,
            evaluate: async () => true,
            getByRole: () => ({
              count: async () => 1,
              isVisible: async () => true,
              isEnabled: async () => true,
              click: async () => {
                events.push('confirm-insertion')
              },
            }),
          } as never)
        : original(selector),
    )
    const before = {
      url: page.url(),
      uid: '12345',
      editorRecognized: true,
      imageEnumerationComplete: true,
      hasFileInput: true,
      images: [],
    }
    vi.mocked(readToutiaoPage)
      .mockResolvedValueOnce(before as never)
      .mockResolvedValueOnce(before as never)
      .mockResolvedValueOnce(before as never)
      .mockImplementationOnce(async () => {
        expect(events).toEqual(['upload', 'confirm-insertion', 'press:button.save-draft'])
        return {
          ...before,
          images: [{ src: 'https://image', loaded: true }],
        } as never
      })
    await uploadToutiaoDraftImage(page, TOUTIAO_FILE_SELECTOR, ['/a.png'], () => {})
    expect(events).toEqual(['upload', 'confirm-insertion', 'press:button.save-draft'])
  })
  it('fills the frozen body then activates only the draft save control', async () => {
    const { page, events } = fixture()
    await fillToutiaoDraft(page, TOUTIAO_BODY_SELECTOR, '标题\n正文', () => {})
    expect(events).toEqual([`fill:${TOUTIAO_BODY_SELECTOR}`, 'press:button.save-draft'])
  })
  it('does not save after the current-operation permit is revoked', async () => {
    const { page, events } = fixture()
    let calls = 0
    await expect(
      fillToutiaoDraft(page, TOUTIAO_BODY_SELECTOR, '标题', () => {
        if (++calls > 1) throw new Error('stale')
      }),
    ).rejects.toThrow('stale')
    expect(events).toEqual([`fill:${TOUTIAO_BODY_SELECTOR}`])
  })
  it.each([
    'https://evil.test/profile_v4/weitoutiao/publish?draft_id=123',
    'https://mp.toutiao.com/profile_v4/weitoutiao/publish',
    'https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=123&draft_id=456',
  ])('rejects an unbound draft before writing: %s', async (url) => {
    const { page, events } = fixture(url)
    await expect(fillToutiaoDraft(page, TOUTIAO_BODY_SELECTOR, '标题', () => {})).rejects.toThrow(
      '绑定原草稿',
    )
    expect(events).toEqual([])
  })
  it('requires both a current permit and exactly one frozen upload', async () => {
    const { page, events } = fixture()
    await expect(uploadToutiaoDraftImage(page, TOUTIAO_FILE_SELECTOR, ['/a.png'])).rejects.toThrow(
      '派发许可',
    )
    await expect(
      uploadToutiaoDraftImage(page, TOUTIAO_FILE_SELECTOR, ['/a.png', '/b.png'], () => {}),
    ).rejects.toThrow('一张')
    expect(events).toEqual([])
  })
  it.each([false, true])(
    'saves only after a unique loaded gallery addition; ambiguous=%s',
    async (ambiguous) => {
      const { page, events } = fixture()
      const before = {
        url: page.url(),
        uid: '12345',
        editorRecognized: true,
        imageEnumerationComplete: true,
        hasFileInput: true,
        images: [],
      }
      vi.mocked(readToutiaoPage)
        .mockResolvedValueOnce(before as never)
        .mockResolvedValueOnce({
          ...before,
          images: (ambiguous ? ['a', 'b'] : ['a']).map((src) => ({ src, loaded: true })),
        } as never)
      const action = uploadToutiaoDraftImage(page, TOUTIAO_FILE_SELECTOR, ['/a.png'], () => {})
      if (ambiguous) {
        await expect(action).rejects.toThrow('不唯一')
        expect(events).toEqual(['upload'])
      } else {
        await action
        expect(events).toEqual(['upload', 'press:button.save-draft'])
      }
    },
  )
})
