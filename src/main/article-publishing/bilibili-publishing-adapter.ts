import type { Page } from 'playwright-core'
import { readFile } from 'node:fs/promises'
import type { CsdnDraftListProbe, CsdnPageProbe } from './csdn-publishing-adapter'
import {
  bilibiliImageUrl,
  parseBilibiliPublicationUrl,
  readBilibiliPublication,
} from './bilibili-publication'

export const BILIBILI_EDITOR_URL = 'https://t.bilibili.com/'
export const BILIBILI_TITLE = 'input[placeholder="好的标题更容易获得支持，选填20字"]'
export const BILIBILI_BODY = 'div[placeholder="有什么想和大家分享的？"]'
export const BILIBILI_IMAGE_OPEN = 'div.bili-dyn-publishing__tools__item.pic'
export const BILIBILI_IMAGE_ADD = 'div.bili-pics-uploader__add'
export interface BilibiliImageSource {
  sourcePath: string
  platformUrl?: string
}

/** Only the native, visible dynamic composer. A temporary editor is not a saved draft. */
export async function readBilibiliComposer(
  page: Page,
  assets: readonly BilibiliImageSource[] = [],
) {
  if (page.url() !== BILIBILI_EDITOR_URL) throw new Error('当前不是 B站动态发布器')
  const live = await page.evaluate(
    async ({ titleSelector, bodySelector, imageOpen, imageAdd }) => {
      const visible = (e: Element) => {
        const rect = e.getBoundingClientRect(),
          style = getComputedStyle(e)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        )
      }
      const one = (selector: string) => {
        const nodes = [...document.querySelectorAll(selector)]
        return nodes.length === 1 && visible(nodes[0]) ? nodes[0] : undefined
      }
      const title = one(titleSelector) as HTMLInputElement | undefined
      const body = one(bodySelector) as HTMLElement | undefined
      const root = body?.closest('main > section:nth-child(1)')
      const recognized = Boolean(root && title && root.contains(title) && body?.isContentEditable)
      const avatar = one('a.header-entry-mini') as HTMLAnchorElement | undefined
      let uid: string | undefined
      if (avatar) {
        const url = new URL(avatar.href)
        if (url.origin === 'https://space.bilibili.com')
          uid = /^\/(\d{5,20})\/?$/u.exec(url.pathname)?.[1]
      }
      const sourceImages = root
        ? [...root.querySelectorAll<HTMLImageElement>('.bili-pics-uploader img')]
        : []
      const images = sourceImages.map((img) => ({
        src: img.currentSrc || img.src,
        alt: img.alt,
        loaded: visible(img) && img.complete && img.naturalWidth > 0,
      }))
      const items = root ? [...root.querySelectorAll<HTMLElement>('.bili-pics-uploader__item')] : []
      const previews = await Promise.all(
        items.map(async (item) => {
          const nodes = item.querySelectorAll('.bili-pics-uploader-item-preview__pic')
          const node = nodes.length === 1 ? nodes[0] : undefined
          const css = node ? getComputedStyle(node).backgroundImage : ''
          const dataUrl =
            /^url\(["']?(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)["']?\)$/u.exec(
              css,
            )?.[1] ?? ''
          let loaded = false
          if (node && visible(node) && item.classList.contains('success') && dataUrl) {
            const image = new Image()
            image.src = dataUrl
            loaded = await Promise.race([
              image
                .decode()
                .then(() => image.naturalWidth > 0 && image.naturalHeight > 0)
                .catch(() => false),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
            ])
          }
          return { dataUrl, loaded }
        }),
      )
      const uploadSelector =
        recognized && one(imageAdd) && root?.contains(one(imageAdd)!)
          ? imageAdd
          : recognized && one(imageOpen) && root?.contains(one(imageOpen)!)
            ? imageOpen
            : undefined
      const labels = root
        ? [...root.querySelectorAll<HTMLElement>('.bili-cascader-options__item-label')]
        : []
      const publicLabel = labels.filter((e) => e.textContent?.trim() === '所有用户可见')
      const privateLabel = labels.filter((e) => e.textContent?.trim() === '仅自己可见')
      const selected = (e: Element) =>
        e.closest('.bili-cascader-options__item')?.classList.contains('is-active') === true
      const visibility: 'public' | 'private' | 'unknown' =
        publicLabel.length === 1 && privateLabel.length === 1
          ? selected(publicLabel[0]) && !selected(privateLabel[0])
            ? 'public'
            : selected(privateLabel[0]) && !selected(publicLabel[0])
              ? 'private'
              : 'unknown'
          : 'unknown'
      const visibilityEntry = labels.filter(
        (e) => visible(e) && e.textContent?.trim() === '可见范围',
      )
      const settings = one('div.bili-dyn-publishing__settings__btn')
      const openSettingsSelector =
        visibility !== 'unknown'
          ? undefined
          : visibilityEntry.length === 1
            ? '.bili-dyn-publishing__settings .bili-cascader-options__item-label:text-is("可见范围")'
            : settings && root?.contains(settings)
              ? 'div.bili-dyn-publishing__settings__btn'
              : undefined
      // The native button changes its text to 定时发布 when scheduling is enabled.
      // Only expose the single visible immediate-publish control in this composer.
      const publishControls = root
        ? [...root.querySelectorAll<HTMLElement>('button,div,span')].filter(
            (e) =>
              visible(e) &&
              e.textContent?.trim() === '发布' &&
              ![...e.children].some((child) => child.textContent?.trim() === '发布'),
          )
        : []
      const publish = publishControls.length === 1 ? publishControls[0] : undefined
      const publishReady = Boolean(
        recognized &&
        uid &&
        visibility === 'public' &&
        body?.innerText.replace(/[\s\u200b]/gu, '') &&
        (previews.length
          ? previews.every((i) => i.loaded)
          : images.length && images.every((i) => i.loaded && /^https:\/\//u.test(i.src))) &&
        publish &&
        !publish.closest('[disabled],[aria-disabled="true"],[class*="disabled"]'),
      )
      return {
        observedAt: new Date().toISOString(),
        url: location.href,
        uid,
        recognized,
        title: title?.value ?? '',
        text: body?.innerText.replace(/\u200b/gu, '').trim() ?? '',
        images,
        previews,
        imageEnumerationComplete: recognized && images.every((i) => /^https:\/\//u.test(i.src)),
        uploadSelector,
        visibility,
        openSettingsSelector,
        publishSelector: publishReady ? 'main > section:nth-child(1) :text-is("发布")' : undefined,
        diagnostic: `标题 ${title ? 1 : 0}；正文 ${body ? 1 : 0}；发布器 ${recognized ? 1 : 0}；UID ${uid ?? '未读到'}；图集 ${images.length}`,
      }
    },
    {
      titleSelector: BILIBILI_TITLE,
      bodySelector: BILIBILI_BODY,
      imageOpen: BILIBILI_IMAGE_OPEN,
      imageAdd: BILIBILI_IMAGE_ADD,
    },
  )
  // Compare the native local preview to the authorized source bytes. No digest,
  // guessed CDN address or Agent report can establish this correspondence.
  const { previews = [], ...facts } = live
  const sources = previews.length
    ? await Promise.all(assets.map(async (a) => ({ ...a, bytes: await readFile(a.sourcePath) })))
    : []
  const images = previews.length
    ? previews.map((preview) => {
        const bytes = Buffer.from(preview.dataUrl.split(',')[1] ?? '', 'base64')
        const matches = sources.filter((a) => bytes.length > 0 && a.bytes.equals(bytes))
        const src =
          matches.length === 1 ? (bilibiliImageUrl(matches[0].platformUrl ?? '') ?? '') : ''
        return { src, alt: '', loaded: preview.loaded && Boolean(src) }
      })
    : live.images.map((i) => ({ ...i, src: bilibiliImageUrl(i.src) ?? i.src }))
  return {
    ...facts,
    images,
    imageEnumerationComplete:
      facts.recognized && images.every((i) => Boolean(bilibiliImageUrl(i.src))),
    publishSelector: images.every((i) => i.loaded) ? facts.publishSelector : undefined,
  }
}

export class BilibiliPublishingAdapter {
  async probe(page: Page, assets: readonly BilibiliImageSource[] = []): Promise<CsdnPageProbe> {
    if (parseBilibiliPublicationUrl(page.url())) {
      const live = await readBilibiliPublication(page)
      return {
        adapterId: 'bilibili',
        adapterVersion: 1,
        observedAt: live.observedAt,
        url: live.url,
        publishedArticleId: live.id,
        pageKind: live.recognized ? 'published-article' : 'unsupported',
        editor: {
          recognized: false,
          bodyTextLength: live.text.length,
          images: live.images,
          imageEnumerationComplete: live.imageEnumerationComplete,
        },
        title: { value: live.title },
        selectors: {},
        saveState: 'unknown',
        publishedLinks: [],
        publicationBlocker: live.recognized
          ? undefined
          : 'B站详情未完整展开、不是唯一原发图文，或未能读取正文',
      }
    }
    const live = await readBilibiliComposer(page, assets)
    return {
      adapterId: 'bilibili',
      adapterVersion: 1,
      observedAt: live.observedAt,
      url: live.url,
      platformAccountId: live.uid,
      pageKind: live.recognized ? 'editor' : 'unsupported',
      editor: {
        recognized: live.recognized,
        bodySelector: BILIBILI_BODY,
        bodyTextLength: live.text.length,
        initialDraftBodyEmpty: !live.text && !live.title,
        images: live.images,
        imageEnumerationComplete: live.imageEnumerationComplete,
        fileInputSelector: live.uploadSelector,
      },
      title: { selector: BILIBILI_TITLE, value: live.title },
      fieldValues: { title: live.title },
      selectors: live.recognized
        ? {
            body: BILIBILI_BODY,
            title: BILIBILI_TITLE,
            fileInput: live.uploadSelector,
            openPublishSettings: live.openSettingsSelector,
            publish: live.publishSelector,
          }
        : {},
      saveState: 'unknown',
      publishedLinks: [],
      bilibiliVisibility: live.visibility,
      submissionUnavailableReason: live.publishSelector
        ? undefined
        : '等待核验公开范围、正文、图片和唯一可用的即时发布按钮',
      publicationBlocker: !live.recognized || !live.uid ? live.diagnostic : undefined,
    }
  }
  async probeDraftList(page: Page): Promise<CsdnDraftListProbe> {
    return {
      adapterId: 'bilibili',
      adapterVersion: 1,
      observedAt: new Date().toISOString(),
      platformAccountId: (await readBilibiliComposer(page)).uid,
      pageSupported: false,
      candidates: [],
    }
  }
  async verifyBody(page: Page, html: string, assets: readonly BilibiliImageSource[] = []) {
    const live = parseBilibiliPublicationUrl(page.url())
      ? await readBilibiliPublication(page)
      : await readBilibiliComposer(page, assets)
    return page.evaluate(
      ({ html, live }) => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const expected = [...doc.querySelectorAll('img')].map((img) => ({
          src: img.src,
          alt: img.alt,
        }))
        doc.querySelectorAll('img,h1').forEach((e) => e.remove())
        const norm = (s: string) => s.replace(/[\s\u200b]/gu, '')
        const textMatches = live.recognized && norm(doc.body.textContent ?? '') === norm(live.text)
        const images = expected.map((img, index) => ({
          ...img,
          index,
          precedingCharacters: 0,
          actualSrc: live.images[index]?.src ?? '',
          matches: Boolean(live.images[index]?.loaded && live.images[index].src === img.src),
        }))
        return {
          matches:
            textMatches &&
            live.imageEnumerationComplete &&
            expected.length === live.images.length &&
            images.every((i) => i.matches),
          textMatches,
          textEvidence: `B站当前正文期望 ${norm(doc.body.textContent ?? '').length} 字符，实际 ${norm(live.text).length} 字符；标题独立核验，未声明保存`,
          expectedImages: images.length,
          actualImages: live.images.length,
          images,
        }
      },
      { html, live },
    )
  }
}
