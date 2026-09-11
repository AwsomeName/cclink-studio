import type { Page } from 'playwright-core'
import type { CsdnDraftListProbe, CsdnPageProbe } from './csdn-publishing-adapter'
import {
  parseWeiboPublicationUrl,
  readWeiboPublication,
  weiboImageIdentity,
} from './weibo-publication'

/** Current visible composer only. No draft identity or persistence is inferred. */
export async function readWeiboComposer(page: Page) {
  if (new URL(page.url()).origin !== 'https://weibo.com') throw new Error('当前不是微博页面')
  return page.evaluate(() => {
    const visible = (e: Element) =>
      e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0
    const unique = (selector: string) => {
      const found = Array.from(document.querySelectorAll(selector)).filter(visible)
      return found.length === 1 ? found[0] : undefined
    }
    const selectorFor = (element: Element | undefined): string | undefined => {
      if (!element) return undefined
      const tag = element.tagName.toLowerCase()
      const candidates: string[] = []
      if (element.id) candidates.push(`#${CSS.escape(element.id)}`)
      for (const attribute of ['placeholder', 'accept', 'name']) {
        const value = element.getAttribute(attribute)
        if (value) candidates.push(`${tag}[${attribute}=${JSON.stringify(value)}]`)
      }
      if (element.classList.length)
        candidates.push(
          `${tag}.${Array.from(element.classList)
            .map((c) => CSS.escape(c))
            .join('.')}`,
        )
      for (const candidate of candidates)
        if (
          document.querySelectorAll(candidate).length === 1 &&
          document.querySelector(candidate) === element
        )
          return candidate
      const parts: string[] = []
      let current: Element | null = element
      while (current && current !== document.documentElement) {
        const parent: Element | null = current.parentElement
        if (!parent) return undefined
        parts.unshift(
          `${current.tagName.toLowerCase()}:nth-child(${Array.from(parent.children).indexOf(current) + 1})`,
        )
        current = parent
      }
      const selector = `html > ${parts.join(' > ')}`
      return document.querySelectorAll(selector).length === 1 ? selector : undefined
    }
    const textarea = unique('textarea[placeholder="有什么新鲜事想分享给大家？"]') as
      | HTMLTextAreaElement
      | undefined
    let root = textarea?.parentElement
    // Stop at the smallest composer containing its own send/privacy controls;
    // never enumerate the feed, other posts, or a different textarea.
    while (root && root !== document.body && root.querySelectorAll('textarea').length === 1) {
      if (
        Array.from(root.querySelectorAll('button')).some(
          (e) => visible(e) && e.textContent?.trim() === '发送',
        ) &&
        /公开/u.test(root.innerText)
      )
        break
      root = root.parentElement
    }
    if (!root || root === document.body || root.querySelectorAll('textarea').length !== 1)
      root = null
    const buttons = root ? Array.from(root.querySelectorAll('button')).filter(visible) : []
    const send = buttons.filter((e) => e.textContent?.trim() === '发送')
    const imageOpen = root
      ? Array.from(root.querySelectorAll('[title], [aria-label], button, span, a')).filter(
          (e) =>
            visible(e) &&
            e.textContent?.trim() === '图片' &&
            !Array.from(e.children).some((child) => child.textContent?.trim() === '图片'),
        )
      : []
    const inputs = root
      ? Array.from(root.querySelectorAll('input[type="file"]')).filter((e) =>
          /image|\.(?:png|jpe?g|gif|webp)/iu.test(e.getAttribute('accept') ?? ''),
        )
      : []
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(
      // The observed top navigation names the profile by its display name,
      // not “个人主页”. Only anchors before the composer belong to this region;
      // profile links in the following feed must never establish login identity.
      (a) =>
        visible(a) &&
        !!textarea &&
        Boolean(a.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        new URL(a.href).origin === 'https://weibo.com',
    )
    const ids = [
      ...new Set(
        links.flatMap((a) => /^\/u\/(\d{5,20})\/?$/u.exec(new URL(a.href).pathname)?.[1] ?? []),
      ),
    ]
    const imgs = root
      ? Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(
          (img) => visible(img) && /^https:\/\/wx\d+\.sinaimg\.cn\//u.test(img.src),
        )
      : []
    const images = imgs.map((img) => {
      const u = new URL(img.currentSrc || img.src)
      return {
        src: `${u.origin}${u.pathname}`,
        alt: '',
        loaded: img.complete && img.naturalWidth > 0,
      }
    })
    const text = textarea?.value ?? ''
    const privacy = root
      ? /公开/u.test(root.innerText) && !/仅自己可见|好友圈|粉丝可见|定时发布/u.test(root.innerText)
      : false
    return {
      observedAt: new Date().toISOString(),
      url: location.href,
      uid: ids.length === 1 ? ids[0] : undefined,
      recognized: !!root && !!textarea && send.length === 1,
      bodySelector: root ? selectorFor(textarea) : undefined,
      text,
      images,
      imageEnumerationComplete:
        !!root &&
        !Array.from(root.querySelectorAll<HTMLImageElement>('img')).some(
          (img) => visible(img) && /^(blob:|data:)/u.test(img.src),
        ),
      fileInputSelector: inputs.length === 1 ? selectorFor(inputs[0]) : undefined,
      imageOpenSelector: imageOpen.length === 1 ? selectorFor(imageOpen[0]) : undefined,
      publishSelector:
        privacy && send.length === 1 && !send[0].disabled ? selectorFor(send[0]) : undefined,
      privacy,
      diagnostic: `正文 ${textarea ? 1 : 0}；编辑区域 ${root ? 1 : 0}；发送 ${send.length}；上传控件 ${inputs.length}；图片入口 ${imageOpen.length}；账号候选 ${ids.length}`,
    }
  })
}

export class WeiboPublishingAdapter {
  async probe(page: Page): Promise<CsdnPageProbe> {
    if (parseWeiboPublicationUrl(page.url())) {
      const live = await readWeiboPublication(page)
      return {
        adapterId: 'weibo',
        adapterVersion: 1,
        observedAt: live.observedAt,
        url: live.url,
        platformAccountId: live.uid,
        publishedArticleId: live.id,
        pageKind: live.recognized ? 'published-article' : 'unsupported',
        editor: {
          recognized: false,
          bodyTextLength: live.text.length,
          imageEnumerationComplete: live.imageEnumerationComplete,
          images: live.images,
        },
        title: { value: live.text.split('\n')[0] ?? '' },
        selectors: {},
        saveState: 'unknown',
        publishedLinks:
          live.recognized && live.public
            ? [{ url: live.url, title: live.text.split('\n')[0] ?? '' }]
            : [],
        publicationBlocker: !live.recognized
          ? '微博公开页正文或作者不能唯一核验'
          : !live.public
            ? '未读到目标帖的公开标记'
            : undefined,
      }
    }
    const live = await readWeiboComposer(page)
    return {
      adapterId: 'weibo',
      adapterVersion: 1,
      observedAt: live.observedAt,
      url: live.url,
      platformAccountId: live.uid,
      pageKind: live.recognized ? 'editor' : 'unsupported',
      editor: {
        recognized: live.recognized,
        bodySelector: live.bodySelector,
        bodyTextLength: live.text.length,
        initialDraftBodyEmpty: !live.text,
        imageEnumerationComplete: live.imageEnumerationComplete,
        images: live.images,
        fileInputSelector: live.fileInputSelector,
      },
      title: { value: live.text.split('\n')[0] ?? '' },
      fieldValues: { title: live.text.split('\n')[0] ?? '' },
      selectors: {
        body: live.bodySelector,
        fileInput: live.fileInputSelector,
        imageOpen: live.imageOpenSelector,
        publish: live.publishSelector,
      },
      saveState: 'unknown',
      publishedLinks: [],
      submissionUnavailableReason: live.privacy ? undefined : '微博公开、非定时设置未核验通过',
      publicationBlocker: !live.recognized || !live.uid ? live.diagnostic : undefined,
    }
  }
  async probeDraftList(page: Page): Promise<CsdnDraftListProbe> {
    return {
      adapterId: 'weibo',
      adapterVersion: 1,
      observedAt: new Date().toISOString(),
      platformAccountId: (await readWeiboComposer(page)).uid,
      pageSupported: false,
      candidates: [],
    }
  }
  async verifyBody(page: Page, html: string) {
    const live = parseWeiboPublicationUrl(page.url())
      ? await readWeiboPublication(page)
      : await readWeiboComposer(page)
    return page.evaluate(
      ({ html, live, actualImageIds }) => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const expectedImages = Array.from(doc.querySelectorAll('img')).map((i) => ({
          src: i.src,
          alt: i.alt,
        }))
        doc.querySelectorAll('img').forEach((i) => i.remove())
        const norm = (v: string) => v.replace(/[\s\u200b]/gu, '')
        const textMatches = live.recognized && norm(doc.body.textContent ?? '') === norm(live.text)
        const imageId = (src: string) => {
          try {
            const u = new URL(src)
            return /^wx\d+\.sinaimg\.cn$/u.test(u.hostname)
              ? (/^([a-zA-Z0-9]+)\.(?:jpe?g|png|gif)$/iu.exec(
                  u.pathname.split('/').at(-1) ?? '',
                )?.[1] ?? null)
              : null
          } catch {
            return null
          }
        }
        const images = expectedImages.map((img, index) => ({
          ...img,
          index,
          actualSrc: live.images[index]?.src ?? '',
          precedingCharacters: 0,
          matches:
            !!live.images[index]?.loaded &&
            (img.src === live.images[index].src ||
              (actualImageIds[index] !== null && actualImageIds[index] === imageId(img.src))),
        }))
        return {
          matches:
            textMatches &&
            live.imageEnumerationComplete &&
            images.length === live.images.length &&
            images.every((i) => i.matches),
          textMatches,
          textEvidence: `微博现场正文期望 ${norm(doc.body.textContent ?? '').length} 字符，实际 ${norm(live.text).length} 字符；未声明草稿已保存`,
          expectedImages: images.length,
          actualImages: live.images.length,
          images,
        }
      },
      { html, live, actualImageIds: live.images.map((image) => weiboImageIdentity(image.src)) },
    )
  }
}
