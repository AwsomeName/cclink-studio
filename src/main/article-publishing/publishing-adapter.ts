import type { Page } from 'playwright-core'
import { CsdnPublishingAdapter } from './csdn-publishing-adapter'
import { ZhihuPublishingAdapter, ZHIHU_MANAGEMENT_URL } from './zhihu-publishing-adapter'

export class PublishingAdapter {
  private readonly csdn = new CsdnPublishingAdapter()
  private readonly zhihu = new ZhihuPublishingAdapter()
  private forPage(page: Page) {
    return new URL(page.url()).hostname.endsWith('.zhihu.com') ? this.zhihu : this.csdn
  }
  documentGeneration(page: Page) {
    return this.csdn.documentGeneration(page)
  }
  probe(page: Page) {
    return this.forPage(page).probe(page)
  }
  probeDraftList(page: Page) {
    return this.forPage(page).probeDraftList(page)
  }
  verifyBody(page: Page, html: string) {
    return this.forPage(page).verifyBody(page, html)
  }
}
export function publishingPlatform(id: 'csdn' | 'zhihu') {
  return id === 'zhihu'
    ? {
        label: '知乎',
        editorUrl: 'https://zhuanlan.zhihu.com/write',
        managementUrl: ZHIHU_MANAGEMENT_URL,
        origins: ['https://www.zhihu.com', 'https://zhuanlan.zhihu.com'],
      }
    : {
        label: 'CSDN',
        editorUrl: 'https://mp.csdn.net/mp_blog/creation/editor',
        managementUrl: 'https://mp.csdn.net/mp_blog/manage/article',
        origins: [
          'https://csdn.net',
          'https://www.csdn.net',
          'https://mp.csdn.net',
          'https://app-blog.csdn.net',
          'https://editor.csdn.net',
          'https://blog.csdn.net',
        ],
      }
}
