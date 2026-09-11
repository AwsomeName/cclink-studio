import type { Page } from 'playwright-core'

/** The public note's server content plus its rendered title, body and image gallery. */
export async function readXiaohongshuPublication(page: Page) {
  const url = new URL(page.url())
  if (
    url.origin !== 'https://www.xiaohongshu.com' ||
    !/^\/explore\/[a-f\d]{24}\/?$/iu.test(url.pathname)
  )
    throw new Error('不是小红书作品详情页')
  return page.evaluate(() => {
    const id = location.pathname.split('/').filter(Boolean).at(-1)!
    const state = (
      window as Window & {
        __INITIAL_STATE__?: {
          note?: {
            noteDetailMap?: Record<
              string,
              {
                note?: {
                  noteId?: string
                  title?: string
                  desc?: string
                  type?: string
                  user?: { userId?: string }
                  imageList?: Array<{ fileId: string; width: number; height: number }>
                }
              }
            >
          }
        }
      }
    ).__INITIAL_STATE__
    const note = state?.note?.noteDetailMap?.[id]?.note
    const title = document.querySelector('#detail-title')?.textContent ?? ''
    const desc = document.querySelector('#detail-desc')?.textContent ?? ''
    const normalize = (v: string) => v.replace(/\s/gu, '')
    const nodes = Array.from(
      document.querySelectorAll<HTMLImageElement>(
        '.swiper-slide:not(.swiper-slide-duplicate) .note-slider-img img',
      ),
    )
    const images = (note?.imageList ?? []).map((img) => {
      const element = nodes.find(
        (el) => el.src.includes(`/${img.fileId}!`) || el.src.endsWith(`/${img.fileId}`),
      )
      return {
        ...img,
        src: element?.currentSrc || element?.src || '',
        loaded: !!element?.complete && element.naturalWidth > 0,
      }
    })
    return {
      observedAt: new Date().toISOString(),
      url: location.href,
      noteId: note?.noteId,
      uid: note?.user?.userId,
      title,
      description: desc,
      renderedMatches:
        note?.noteId === id &&
        note.type === 'normal' &&
        title === note.title &&
        normalize(desc) === normalize(note.desc ?? ''),
      imageEnumerationComplete: Array.isArray(note?.imageList) && images.length === nodes.length,
      images,
    }
  })
}
