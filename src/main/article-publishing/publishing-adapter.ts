import { WeiboPublishingAdapter } from './weibo-publishing-adapter'
import { XiaohongshuPublishingAdapter } from './xiaohongshu-publishing-adapter'
import { JuejinPublishingAdapter } from './juejin-publishing-adapter'
import type { ArticlePublishingState } from '../../shared/article-publishing/article-publishing-types'
import type { Page } from 'playwright-core'
import { CsdnPublishingAdapter } from './csdn-publishing-adapter'
import { ZhihuPublishingAdapter, ZHIHU_MANAGEMENT_URL } from './zhihu-publishing-adapter'

export class PublishingAdapter {
  private readonly weibo = new WeiboPublishingAdapter()
  private readonly xiaohongshu = new XiaohongshuPublishingAdapter()
  private readonly juejin = new JuejinPublishingAdapter()
  private readonly csdn = new CsdnPublishingAdapter()
  private readonly zhihu = new ZhihuPublishingAdapter()
  private forPage(page: Page) {
    if (new URL(page.url()).origin === 'https://weibo.com') return this.weibo
    if (['creator.xiaohongshu.com', 'www.xiaohongshu.com'].includes(new URL(page.url()).hostname))
      return this.xiaohongshu
    if (new URL(page.url()).hostname === 'juejin.cn') return this.juejin
    return new URL(page.url()).hostname.endsWith('.zhihu.com') ? this.zhihu : this.csdn
  }
  documentGeneration(page: Page) {
    return this.csdn.documentGeneration(page)
  }
  probe(page: Page, fields?: ArticlePublishingState['fields'], draftId?: string) {
    if (new URL(page.url()).hostname === 'juejin.cn')
      return this.juejin.probe(page, fields, draftId)
    return this.forPage(page).probe(page)
  }
  probeDraftList(page: Page) {
    return this.forPage(page).probeDraftList(page)
  }
  verifyBody(page: Page, html: string) {
    return this.forPage(page).verifyBody(page, html)
  }
}
export function publishingPlatform(id: 'csdn' | 'zhihu' | 'juejin' | 'xiaohongshu' | 'weibo') {
  if (id === 'weibo')
    return {
      label: '微博',
      editorUrl: 'https://weibo.com/',
      managementUrl: 'https://weibo.com/',
      origins: ['https://weibo.com'],
    }
  if (id === 'xiaohongshu')
    return {
      label: '小红书',
      editorUrl: 'https://creator.xiaohongshu.com/publish/publish?target=image',
      managementUrl: 'https://creator.xiaohongshu.com/publish/publish?target=image',
      origins: ['https://creator.xiaohongshu.com', 'https://www.xiaohongshu.com'],
    }
  if (id === 'juejin')
    return {
      label: '掘金',
      editorUrl: 'https://juejin.cn/editor/drafts/new?v=2',
      managementUrl: 'https://juejin.cn/editor/drafts',
      origins: ['https://juejin.cn'],
    }
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
