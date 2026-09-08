import type { Page } from 'playwright-core'
import type { CsdnPageProbe, CsdnDraftListProbe } from './csdn-publishing-adapter'

export const ZHIHU_MANAGEMENT_URL =
  'https://www.zhihu.com/creator/manage/creation/draft?type=article'

/** Bounded read-only observations of the signed-in article editor. No publishing state here. */
export class ZhihuPublishingAdapter {
  async probe(page: Page): Promise<CsdnPageProbe> {
    return page.evaluate(async () => {
      const imageUrl = (value: string) => {
        const u = new URL(value)
        u.search = ''
        return u.href
      }
      const normalize = (value: string) => value.replace(/[\s\u200b]/gu, '')
      const editor = document.querySelector<HTMLElement>(
        '.public-DraftEditor-content[contenteditable="true"]',
      )
      const titleInput = document.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="请输入标题（最多 100 个字）"]',
      )
      const id = /^\/p\/(\d+)(?:\/edit)?\/?$/u.exec(location.pathname)?.[1]
      const isEditor = location.hostname === 'zhuanlan.zhihu.com' && Boolean(editor && titleInput)
      const publicBody = !isEditor
        ? document.querySelector<HTMLElement>('.Post-RichTextContainer .RichText')
        : null
      const body = isEditor ? editor : publicBody
      // These GET endpoints are the editor's own observed account and current-draft reads.
      const meResponse = await fetch('https://www.zhihu.com/api/v4/me', { credentials: 'include' })
      const me = meResponse.ok ? await meResponse.json() : null
      let draft = null
      if (isEditor && id) {
        const response = await fetch(`/api/articles/${id}/draft`, { credentials: 'include' })
        if (response.ok) draft = await response.json()
      }
      const unique = (selector: string) =>
        document.querySelectorAll(selector).length === 1 ? selector : undefined
      const images = Array.from(body?.querySelectorAll<HTMLImageElement>('img') ?? []).map(
        (img) => ({
          src: imageUrl(img.currentSrc || img.src),
          alt: img.alt,
          loaded:
            img.complete &&
            img.naturalWidth > 0 &&
            /^https:\/\/(?:pic-private\.zhihu\.com|[^/]+\.zhimg\.com)\//u.test(
              img.currentSrc || img.src,
            ),
        }),
      )
      const draftBody = new DOMParser().parseFromString(
        typeof draft?.content === 'string' ? draft.content : '',
        'text/html',
      ).body
      const savedImages = Array.from(draftBody.querySelectorAll('img')).map((img) =>
        imageUrl(img.getAttribute('src') ?? ''),
      )
      const bodyClone = body?.cloneNode(true) as HTMLElement | undefined
      bodyClone
        ?.querySelectorAll('button, figcaption, [contenteditable="false"] button')
        .forEach((e) => e.remove())
      const bodyText = bodyClone?.textContent ?? ''
      const saved = Boolean(
        isEditor &&
        id &&
        String(draft?.id) === id &&
        draft?.author?.url_token === me?.url_token &&
        titleInput?.value === draft?.title &&
        normalize(bodyText) === normalize(draftBody.textContent ?? '') &&
        savedImages.length === images.length &&
        savedImages.every((src, index) => src === images[index].src),
      )
      const publicAuthor = document.querySelector<HTMLAnchorElement>(
        '.Post-Header a[href*="/people/"], .Post-Author a[href*="/people/"]',
      )
      const publicAccount = publicAuthor
        ? /\/people\/([^/?#]+)/u.exec(publicAuthor.href)?.[1]
        : undefined
      const publishButtons = Array.from(document.querySelectorAll('button')).filter(
        (b) => b.textContent?.trim() === '发布' && b.getBoundingClientRect().width > 0,
      )
      const imageInput = isEditor
        ? unique('input[type="file"][accept^="image/webp,image/jpg"]')
        : undefined
      const title = titleInput?.value ?? document.querySelector('h1.Post-Title')?.textContent ?? ''
      const publishedLinks = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href]'),
      ).flatMap((a) => {
        try {
          const u = new URL(a.href)
          return u.origin === 'https://zhuanlan.zhihu.com' && /^\/p\/\d+\/?$/u.test(u.pathname)
            ? [{ url: u.href, title: a.textContent?.trim() ?? '' }]
            : []
        } catch {
          return []
        }
      })
      const pageKind = isEditor
        ? 'editor'
        : publicBody && id
          ? 'published-article'
          : location.pathname.startsWith('/creator/manage/')
            ? 'management'
            : 'unsupported'
      const statusRegion =
        document.querySelector('.Post-Status, .Post-ReviewStatus')?.textContent ?? ''
      return {
        adapterId: 'zhihu' as const,
        adapterVersion: 1 as const,
        observedAt: new Date().toISOString(),
        url: location.href,
        platformAccountId:
          isEditor && draft
            ? draft.author?.url_token === me?.url_token
              ? me.url_token
              : undefined
            : pageKind === 'published-article'
              ? publicAccount
              : me?.url_token,
        pageKind,
        ...(isEditor && id ? { draftId: id } : {}),
        ...(pageKind === 'published-article' ? { publishedArticleId: id } : {}),
        editor: {
          recognized: isEditor,
          bodySelector: isEditor
            ? '.public-DraftEditor-content[contenteditable="true"]'
            : undefined,
          bodyTextLength: normalize(bodyText).length,
          imageEnumerationComplete: Boolean(body),
          images,
          fileInputSelector: imageInput,
        },
        title: {
          selector: isEditor ? 'textarea[placeholder="请输入标题（最多 100 个字）"]' : undefined,
          value: title,
        },
        selectors: {
          body: isEditor ? '.public-DraftEditor-content[contenteditable="true"]' : undefined,
          title: isEditor ? 'textarea[placeholder="请输入标题（最多 100 个字）"]' : undefined,
          fileInput: imageInput,
          publish: isEditor && publishButtons.length === 1 ? 'button:text-is("发布")' : undefined,
        },
        fieldValues: { title },
        saveState: saved ? ('saved' as const) : ('unknown' as const),
        saveEvidence: saved
          ? `知乎原稿 GET 回读：账号、draftId、标题、正文和 ${images.length} 张图片与编辑器一致`
          : '编辑器与知乎原稿回读尚未一致',
        publicationBlocker: /审核中|审核未通过|仅自己可见/u.test(statusRegion)
          ? statusRegion.slice(0, 500)
          : undefined,
        publishedLinks,
      }
    })
  }

  async probeDraftList(page: Page): Promise<CsdnDraftListProbe> {
    const probe = await this.probe(page)
    const candidates = await page
      .locator('.CreationManage-CreationCard > a:has(.CreationCardTitle-wrapper)')
      .evaluateAll((links) =>
        links.flatMap((link) => {
          const a = link as HTMLAnchorElement
          const match = /^https:\/\/zhuanlan\.zhihu\.com\/p\/(\d+)\/edit(?:[?#].*)?$/u.exec(a.href)
          return match
            ? [{ draftId: match[1], url: a.href, title: a.textContent?.trim() ?? '' }]
            : []
        }),
      )
    return {
      adapterId: 'zhihu',
      adapterVersion: 1,
      observedAt: probe.observedAt,
      platformAccountId: probe.platformAccountId,
      pageSupported: probe.pageKind === 'management',
      draftSectionUrl: ZHIHU_MANAGEMENT_URL,
      candidates,
    }
  }
  async verifyBody(page: Page, expectedHtml: string) {
    // Public articles lazy-load images only after their viewport is visited.
    if (/^https:\/\/zhuanlan\.zhihu\.com\/p\/\d+\/?$/u.test(page.url())) {
      const pictures = page.locator('.Post-RichTextContainer .RichText img')
      for (let index = 0; index < (await pictures.count()); index++) {
        await pictures.nth(index).scrollIntoViewIfNeeded({ timeout: 3000 })
      }
    }
    return page.evaluate((html) => {
      const normalize = (text: string) => text.replace(/[\s\u200b]/gu, '')
      const expected = new DOMParser().parseFromString(html, 'text/html').body
      const frames = document.querySelectorAll(
        '.public-DraftEditor-content[contenteditable="true"]',
      )
      const publicBodies = document.querySelectorAll('.Post-RichTextContainer .RichText')
      const actual =
        publicBodies.length === 1
          ? publicBodies[0]
          : /\/edit\/?$/u.test(location.pathname) && frames.length === 1
            ? frames[0]
            : null
      const imageSelector = 'img:not(.cke_widget_drag_handler[data-cke-widget-drag-handler="1"])'
      // Read a clone so image controls and caption placeholders do not alter body evidence.
      const clean = (root: Element) => {
        const clone = root.cloneNode(true) as Element
        for (const control of clone.querySelectorAll('button, figcaption')) control.remove()
        if (publicBodies.length === 1) {
          for (const link of clone.querySelectorAll(
            'a.RichContent-EntityWord[data-paste-text="true"]',
          )) {
            try {
              const url = new URL(link.getAttribute('href') ?? '')
              if (
                url.origin === 'https://zhida.zhihu.com' &&
                url.pathname === '/search' &&
                url.searchParams.get('zhida_source') === 'entity' &&
                url.searchParams.get('q') === link.textContent &&
                !Array.from(expected.querySelectorAll('a[href]')).some(
                  (original) => original.getAttribute('href') === link.getAttribute('href'),
                )
              )
                link.replaceWith(clone.ownerDocument.createTextNode(link.textContent ?? ''))
            } catch {
              /* Unexpected links remain subject to exact link verification. */
            }
          }
        }
        return clone
      }
      const cleanActual = actual ? clean(actual) : null
      const linkTarget = (link: Element) => {
        const raw = link.getAttribute('href') ?? ''
        try {
          const url = new URL(raw)
          return url.origin === 'https://link.zhihu.com' && url.pathname === '/'
            ? (url.searchParams.get('target') ?? raw)
            : raw
        } catch {
          return raw
        }
      }
      // Compare the platform's existing image identifier across its private-draft
      // and public CDN URL forms. No content/asset digest is calculated or persisted.
      const imageIdentity = (raw: string) => {
        try {
          const url = new URL(raw)
          if (
            url.protocol === 'https:' &&
            (url.hostname === 'pic-private.zhihu.com' || /^pic\d+\.zhimg\.com$/u.test(url.hostname))
          )
            return (
              /^\/(?:80\/)?(v2-[a-f0-9]{32})(?:~resize:\d+:q\d+|_\d+w)\.(?:png|jpg|webp)$/u.exec(
                url.pathname,
              )?.[1] ?? raw
            )
        } catch {
          /* Unrecognized addresses never match a platform image. */
        }
        return raw
      }
      const expectedLinks = Array.from(expected.querySelectorAll('a[href]'))
      const actualLinks = Array.from(cleanActual?.querySelectorAll('a[href]') ?? [])
      const linksMatch =
        expectedLinks.length === actualLinks.length &&
        expectedLinks.every(
          (link, index) =>
            linkTarget(link) === (actualLinks[index] ? linkTarget(actualLinks[index]) : undefined),
        )
      // Zhihu replaces a bare URL's caption with the target page title. Verify the exact
      // link target and its known title metadata, then compare its original URL caption.
      for (const [index, link] of expectedLinks.entries()) {
        const shown = actualLinks[index]
        if (
          shown &&
          link.textContent === link.getAttribute('href') &&
          linkTarget(shown) === link.getAttribute('href') &&
          ((publicBodies.length === 1 &&
            shown.getAttribute('data-draft-type') === 'text-link' &&
            shown.classList.contains('external')) ||
            normalize(shown.textContent ?? '') ===
              normalize(
                shown.getAttribute('data-draft-title') ??
                  (publicBodies.length === 1 ? shown.getAttribute('title') : null) ??
                  '',
              ))
        )
          shown.textContent = link.textContent
      }
      const describe = (root: Element, liveRoot = root) => {
        const liveImages = Array.from(liveRoot.querySelectorAll<HTMLImageElement>(imageSelector))
        return Array.from(root.querySelectorAll<HTMLImageElement>(imageSelector)).map(
          (img, index) => {
            const range = root.ownerDocument.createRange()
            range.selectNodeContents(root)
            range.setEndBefore(img)
            return {
              src: (img.getAttribute('src') ?? '').split('?')[0],
              alt: img.alt,
              precedingText: normalize(range.toString()),
              loaded: liveImages[index]?.complete === true && liveImages[index].naturalWidth > 0,
            }
          },
        )
      }
      const wanted = describe(expected)
      const observed = cleanActual && actual ? describe(cleanActual, actual) : []
      const images = wanted.map((image, index) => ({
        index,
        src: image.src,
        alt: image.alt,
        matches:
          observed.filter((i) => imageIdentity(i.src) === imageIdentity(image.src)).length ===
            wanted.filter((i) => imageIdentity(i.src) === imageIdentity(image.src)).length &&
          imageIdentity(observed[index]?.src ?? '') === imageIdentity(image.src) &&
          // Zhihu strips alt on paste; identity, count, order, position and load remain mandatory.
          observed[index]?.precedingText === image.precedingText &&
          observed[index]?.loaded === true,
        actualSrc: observed[index]?.src ?? '',
        precedingCharacters: observed[index]?.precedingText.length ?? 0,
      }))
      const expectedText = normalize(expected.textContent ?? '')
      const actualText = normalize(cleanActual?.textContent ?? '')
      const textMatches = Boolean(actual && actualText === expectedText && linksMatch)
      let difference = 0
      while (
        difference < expectedText.length &&
        expectedText[difference] === actualText[difference]
      )
        difference++
      const textEvidence =
        `正文期望 ${expectedText.length} 字符，实际 ${actualText.length} 字符` +
        (textMatches
          ? '；内容与链接目标一致（忽略编辑器零宽占位，链接卡片按原地址核对）'
          : `；首个差异位置 ${difference}，期望「${expectedText.slice(difference, difference + 40)}」，实际「${actualText.slice(difference, difference + 40)}」`)
      return {
        matches: textMatches && observed.length === wanted.length && images.every((i) => i.matches),
        textMatches,
        textEvidence,
        expectedImages: wanted.length,
        actualImages: observed.length,
        images,
      }
    }, expectedHtml)
  }
}
