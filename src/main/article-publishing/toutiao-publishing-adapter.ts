import { parseToutiaoPublicationUrl, readToutiaoPublication } from './toutiao-publication'
import type { Page } from 'playwright-core'
import type { CsdnDraftListProbe, CsdnPageProbe } from './csdn-publishing-adapter'
import { parsePlatformDraftAnchor } from '../../shared/article-publishing/platform-draft-anchor'

export const TOUTIAO_MANAGEMENT_URL = 'https://mp.toutiao.com/profile_v4/manage/draft'
export const TOUTIAO_MUSIC_LABEL = '开启后可在小视频场景分发，获得更多曝光'
// The visible text is nested in a span. :text-is selects the smallest text node
// container, whereas the clickable associated checkbox owner is its label.
export const TOUTIAO_DISABLE_MUSIC_SELECTOR = `label:has-text("${TOUTIAO_MUSIC_LABEL}")`

/** Read the visible composer and the same document’s observed, read-only draft endpoint.
 * No credentials, internal store or signed URLs leave the page. */
export async function readToutiaoPage(page: Page) {
  if (new URL(page.url()).origin !== 'https://mp.toutiao.com')
    throw new Error('当前不是头条创作后台')
  return page.evaluate(async () => {
    const observedUrl = location.href
    const observedDocument = performance.timeOrigin
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }
    const editors = [
      ...document.querySelectorAll<HTMLElement>('div.ProseMirror[contenteditable="true"]'),
    ].filter(visible)
    const editor = editors.length === 1 ? editors[0] : undefined
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(visible)
    const identities = links
      .filter(
        (a) =>
          !editor || Boolean(a.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING),
      )
      .flatMap((a) => {
        const u = new URL(a.href)
        return ['https://www.toutiao.com', 'https://toutiao.com'].includes(u.origin)
          ? (/^\/c\/user\/(\d+)\/?$/u.exec(u.pathname)?.[1] ?? [])
          : []
      })
    const ids = [...new Set(identities)]
    const text = editor?.innerText ?? ''
    const option = (labelText: string) => {
      const labels = [...document.querySelectorAll('label')].filter(
        (e) => visible(e) && e.textContent?.trim() === labelText,
      )
      const label = labels.length === 1 ? labels[0] : undefined
      const control = label?.control ?? label?.querySelector('input[type="checkbox"]')
      if (!(control instanceof HTMLInputElement) || control.type !== 'checkbox')
        return {
          label: labelText,
          checked: null,
          reason: '未读到唯一关联复选框，不能按文字或颜色推测',
        }
      return {
        label: labelText,
        checked: control.indeterminate ? null : control.checked,
        reason: control.indeterminate ? '复选框为未决状态' : undefined,
      }
    }
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(visible)
    const save = buttons.filter(
      (b) => b.matches('button.save-draft') && b.textContent?.trim() === '存草稿',
    )
    const publish = buttons.filter(
      (b) => b.matches('button.publish-content') && b.textContent?.trim() === '发布',
    )
    const drafts = links.flatMap((a) => {
      const u = new URL(a.href)
      const id = u.searchParams.get('draft_id')
      return u.origin === location.origin &&
        u.pathname === '/profile_v4/weitoutiao/publish' &&
        u.searchParams.getAll('draft_id').length === 1 &&
        id &&
        /^\d{1,24}$/u.test(id)
        ? [
            {
              draftId: id,
              url: `${u.origin}${u.pathname}?draft_id=${id}`,
              title: a.innerText.trim(),
            },
          ]
        : []
    })
    const observedDraftReads = performance.getEntriesByType('resource').flatMap((entry) => {
      try {
        const url = new URL(entry.name)
        return url.origin === location.origin &&
          url.pathname === '/mp/agw/draft/get_ugc_draft' &&
          ['fetch', 'xmlhttprequest'].includes((entry as PerformanceResourceTiming).initiatorType)
          ? [url.href]
          : []
      } catch {
        return []
      }
    })
    let draftReadDiagnostic = '未观察到本页原稿读取请求'
    let stored: { code?: unknown; draft?: { gid?: unknown; origin_draft?: unknown } } | undefined
    let original: { content?: unknown; images?: unknown } | undefined
    const observedRead = observedDraftReads.at(-1)
    if (editor && observedRead) {
      try {
        const response = await fetch(observedRead, {
          method: 'GET',
          credentials: 'include',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        })
        if (response.ok) {
          const raw = await response.text()
          if (raw.length > 1_000_000) throw new Error('response_too_large')
          stored = JSON.parse(raw)
          if (typeof stored?.draft?.origin_draft === 'string')
            original = JSON.parse(stored.draft.origin_draft)
          draftReadDiagnostic = '已回读平台原稿'
        } else draftReadDiagnostic = `原稿读取 HTTP ${response.status}`
      } catch {
        draftReadDiagnostic = '原稿回读失败，未采纳保存证据'
      }
    }
    let galleryRoot = editor?.parentElement
    while (
      galleryRoot &&
      galleryRoot !== document.body &&
      !/共\s*\d+\s*张[，,]?\s*还能上传/u.test(galleryRoot.innerText)
    )
      galleryRoot = galleryRoot.parentElement
    const count =
      galleryRoot && galleryRoot !== document.body
        ? Number(/共\s*(\d+)\s*张/u.exec(galleryRoot.innerText)?.[1] ?? NaN)
        : NaN
    const imageIdentity = (src: string) => {
      try {
        const url = new URL(src)
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.port ||
          !['p3-sign.toutiaoimg.com', 'p11-sign.toutiaoimg.com'].includes(url.hostname)
        )
          return null
        return /^\/(tos-cn-i-ezhpy3drpa\/[a-f0-9]{32})(?:~[^/]*)?$/u.exec(url.pathname)?.[1] ?? null
      } catch {
        return null
      }
    }
    const readImages = () =>
      galleryRoot && galleryRoot !== document.body
        ? [...galleryRoot.querySelectorAll('span.item')].filter(visible).map((e) => {
            const src =
              /^url\(["']?(.*?)["']?\)$/u.exec(getComputedStyle(e).backgroundImage)?.[1] ?? ''
            return { src, id: imageIdentity(src) }
          })
        : []
    const beforeImages = readImages()
    const images = await Promise.all(
      beforeImages.slice(0, 18).map(async ({ src, id }) => {
        const loaded = id
          ? await new Promise<boolean>((resolve) => {
              const img = new Image()
              const timer = setTimeout(() => {
                img.onload = null
                img.onerror = null
                resolve(false)
              }, 3000)
              img.onload = () => {
                clearTimeout(timer)
                resolve(img.naturalWidth > 0 && img.naturalHeight > 0)
              }
              img.onerror = () => {
                clearTimeout(timer)
                resolve(false)
              }
              img.src = src
            })
          : false
        return { src: id ? `https://p3-sign.toutiaoimg.com/${id}` : '', alt: '', loaded }
      }),
    )
    const afterImages = readImages()
    const unchanged =
      location.href === observedUrl &&
      performance.timeOrigin === observedDocument &&
      editor?.isConnected === true &&
      editor.innerText === text &&
      beforeImages.length === afterImages.length &&
      beforeImages.every((img, i) => img.src === afterImages[i]?.src)
    const imageEnumerationComplete =
      unchanged &&
      Number.isInteger(count) &&
      count <= 18 &&
      beforeImages.length === count &&
      images.every((img) => img.src && img.loaded)
    const savedImages = Array.isArray(original?.images) ? original.images : []
    const normalized = (value: string) => value.replace(/[\s\u200b]/gu, '')
    const storedContent = typeof original?.content === 'string' ? original.content : ''
    const bodyMatches =
      Boolean(text) &&
      storedContent.length > 0 &&
      (normalized(storedContent) === normalized(text) ||
        normalized(
          new DOMParser().parseFromString(storedContent, 'text/html').body.textContent ?? '',
        ) === normalized(text))
    const galleryMatches =
      Array.isArray(original?.images) &&
      imageEnumerationComplete &&
      savedImages.length === images.length &&
      savedImages.every((item, index) => {
        if (!item || typeof item !== 'object') return false
        const record = item as { url?: unknown; uri?: unknown }
        return (
          typeof record.url === 'string' &&
          imageIdentity(record.url) === beforeImages[index]?.id &&
          typeof record.uri === 'string' &&
          record.uri === beforeImages[index]?.id
        )
      })
    const draftId = new URL(observedUrl).searchParams.get('draft_id')
    const saved = Boolean(
      unchanged &&
      ids.length === 1 &&
      stored?.code === 0 &&
      draftId &&
      stored.draft?.gid === draftId &&
      bodyMatches &&
      galleryMatches,
    )
    draftReadDiagnostic += `；返回码 ${typeof stored?.code === 'number' ? stored.code : '未知'}；原稿ID ${stored?.draft?.gid === draftId ? '一致' : '不一致'}；全文 ${bodyMatches ? '一致' : '不一致'}；逐图 ${galleryMatches ? '一致' : '未通过'}（页面 ${images.length} / 原稿 ${savedImages.length}）；当前文档 ${unchanged ? '未变化' : '已变化'}`
    return {
      observedAt: new Date().toISOString(),
      url: location.href,
      uid: ids.length === 1 ? ids[0] : undefined,
      editorRecognized:
        !!editor &&
        save.length === 1 &&
        publish.length === 1 &&
        location.pathname === '/profile_v4/weitoutiao/publish',
      text,
      title:
        text
          .split('\n')
          .find((line) => line.trim())
          ?.trim() ?? '',
      options: [
        option('头条首发'),
        { ...option('开启后可在小视频场景分发，获得更多曝光'), label: '开启配乐' },
        ...[
          '取材网络',
          '引用站内',
          '个人观点，仅供参考',
          '引用AI',
          '虚构演绎，故事经历',
          '投资观点，仅供参考',
          '健康医疗分享，仅供参考',
        ].map(option),
      ],
      hasSaveControl: save.length === 1 && !save[0].disabled,
      hasPublishControl: publish.length === 1 && !publish[0].disabled,
      assistantVisible:
        [
          ...document.querySelectorAll(
            '.byte-drawer-wrapper.publish-assistant-old-drawer .byte-drawer-mask',
          ),
        ].filter(visible).length === 1,
      management: location.pathname === '/profile_v4/manage/draft',
      drafts,
      draftReadDiagnostic,
      images,
      imageEnumerationComplete,
      saved,
      // Paths only: enough to identify the platform's observed draft read boundary,
      // without leaking signed query values, headers or response payloads.
      draftReadPaths: [
        ...new Set(
          performance.getEntriesByType('resource').flatMap((entry) => {
            const resource = entry as PerformanceResourceTiming
            if (!['fetch', 'xmlhttprequest'].includes(resource.initiatorType)) return []
            try {
              const url = new URL(entry.name)
              return url.origin === location.origin &&
                /draft/iu.test(url.pathname) &&
                url.pathname.length <= 200
                ? [url.pathname]
                : []
            } catch {
              return []
            }
          }),
        ),
      ].slice(0, 8),
    }
  })
}

export class ToutiaoPublishingAdapter {
  async probe(page: Page, fields?: { title: string }): Promise<CsdnPageProbe> {
    if (parseToutiaoPublicationUrl(page.url())) {
      const live = await readToutiaoPublication(page, fields?.title ?? '')
      return {
        adapterId: 'toutiao',
        adapterVersion: 1,
        observedAt: live.observedAt,
        url: live.url,
        publishedArticleId: live.id,
        pageKind: live.recognized ? 'published-article' : 'unsupported',
        editor: {
          recognized: false,
          bodyTextLength: live.text.length,
          imageEnumerationComplete: live.imageEnumerationComplete,
          images: live.images,
        },
        title: {
          value:
            live.text
              .split('\n')
              .find((s) => s.trim())
              ?.trim() ?? '',
        },
        selectors: {},
        saveState: 'unknown',
        publishedLinks: live.recognized ? [{ url: live.url, title: live.title }] : [],
        publicationBlocker: live.recognized ? undefined : live.diagnostic,
      }
    }
    const live = await readToutiaoPage(page)
    const anchor = parsePlatformDraftAnchor(live.url)
    return {
      adapterId: 'toutiao',
      adapterVersion: 1,
      observedAt: live.observedAt,
      url: live.url,
      platformAccountId: live.uid,
      draftId: anchor?.adapterId === 'toutiao' ? anchor.draftId : undefined,
      pageKind: live.editorRecognized ? 'editor' : live.management ? 'management' : 'unsupported',
      editor: {
        recognized: live.editorRecognized,
        bodySelector: live.editorRecognized ? 'div.ProseMirror[contenteditable="true"]' : undefined,
        bodyTextLength: live.text.length,
        imageEnumerationComplete: live.imageEnumerationComplete === true,
        images: live.images ?? [],
      },
      title: { value: live.title },
      fieldValues: { title: live.title },
      selectors: live.editorRecognized
        ? {
            ...(live.hasPublishControl &&
            live.saved &&
            live.options.length === 9 &&
            live.options.every((o) => o.checked !== null) &&
            live.options.slice(0, 2).every((o) => o.checked === false)
              ? { publish: 'button.publish-content' }
              : {}),
            ...(live.options.find((o) => o.label === '开启配乐')?.checked === true
              ? { disableMusic: TOUTIAO_DISABLE_MUSIC_SELECTOR }
              : {}),
            ...(live.assistantVisible
              ? {
                  dismissAssistant:
                    '.byte-drawer-wrapper.publish-assistant-old-drawer .byte-drawer-mask',
                }
              : {}),
          }
        : {},
      saveState: live.saved === true ? 'saved' : 'unknown',
      toutiaoOptions: live.options,
      saveEvidence: `平台原稿回读：${live.draftReadDiagnostic ?? '未读取'}。页面实际草稿接口路径：${(live.draftReadPaths ?? []).join('、') || '未观察到'}`,
      submissionUnavailableReason:
        [
          ...live.options
            .filter(
              (o) =>
                o.checked === null || (['头条首发', '开启配乐'].includes(o.label) && o.checked),
            )
            .map(
              (o) =>
                `${o.label}：${o.checked === null ? o.reason : '仍已勾选，提交前必须关闭并回读'}`,
            ),
          ...(!live.hasPublishControl ? ['未识别唯一可用发布控件'] : []),
          ...(!live.saved ? ['原稿全文及逐图保存尚未核验'] : []),
          ...(live.options.length !== 9 ? ['平台选项未完整读取'] : []),
        ].join('；') || undefined,
      publishedLinks: [],
    }
  }
  async probeDraftList(page: Page): Promise<CsdnDraftListProbe> {
    const live = await readToutiaoPage(page)
    return {
      adapterId: 'toutiao',
      adapterVersion: 1,
      observedAt: live.observedAt,
      platformAccountId: live.uid,
      pageSupported: live.management,
      draftSectionUrl: live.management ? TOUTIAO_MANAGEMENT_URL : undefined,
      candidates: live.drafts,
    }
  }
  async verifyBody(page: Page, html: string) {
    const title = await page.evaluate(
      (html) =>
        new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelector('h1')
          ?.textContent?.trim() ?? '',
      html,
    )
    const publicPage = Boolean(parseToutiaoPublicationUrl(page.url()))
    const live = publicPage
      ? { ...(await readToutiaoPublication(page, title)), editorRecognized: true }
      : await readToutiaoPage(page)
    return page.evaluate(
      ({ html, live }) => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const expected = [...doc.querySelectorAll('img')].map((img) => ({
          src: img.src,
          alt: img.alt,
        }))
        doc.querySelectorAll('img').forEach((img) => img.remove())
        const norm = (value: string) => value.replace(/[\s\u200b]/gu, '')
        const textMatches =
          live.editorRecognized && norm(doc.body.textContent ?? '') === norm(live.text)
        const images = expected.map((image, index) => ({
          ...image,
          index,
          actualSrc: live.images[index]?.src ?? '',
          precedingCharacters: 0,
          matches: live.images[index]?.loaded === true && image.src === live.images[index]?.src,
        }))
        return {
          matches:
            textMatches &&
            live.imageEnumerationComplete &&
            expected.length === live.images.length &&
            images.every((img) => img.matches),
          textMatches,
          textEvidence: `头条正文期望 ${norm(doc.body.textContent ?? '').length} 字符，实际 ${norm(live.text).length} 字符；图集独立核验顺序与平台标识`,
          expectedImages: expected.length,
          actualImages: live.images.length,
          images,
        }
      },
      { html, live },
    )
  }
}
