import type { Frame, Page } from 'playwright-core'
import { parseCsdnDraftAnchor } from '../../shared/article-publishing/csdn-draft-anchor'

export const CSDN_ARTICLE_MANAGEMENT_URL = 'https://mp.csdn.net/mp_blog/manage/article'
export const CSDN_ACCOUNT_EVIDENCE_REGION_SELECTOR =
  'header, [role="banner"], .csdn-toolbar, .toolbar-container, [class*="user-info" i], [class*="userInfo"]'
export const CSDN_SAVE_STATUS_SELECTOR =
  '.autosave-tip, [aria-live], [data-testid*="save" i], [class*="save-status" i], [class*="saveStatus"], [class*="draft-status" i]'

export interface CsdnPageImageProbe {
  src: string
  alt: string
  loaded?: boolean
}

export interface CsdnPageProbe {
  adapterId: 'csdn' | 'zhihu' | 'juejin' | 'xiaohongshu' | 'weibo'
  adapterVersion: 1
  observedAt: string
  url: string
  platformAccountId?: string
  pageKind: 'editor' | 'published-article' | 'management' | 'unsupported'
  draftId?: string
  publishedArticleId?: string
  editor: {
    recognized: boolean
    bodySelector?: string
    bodyFrameSelector?: string
    bodyTextLength: number
    /** Current CKEditor is empty and below CSDN's automatic-save threshold. */
    initialDraftBodyEmpty?: boolean
    initialDraftBodyText?: string
    imageEnumerationComplete: boolean
    images: CsdnPageImageProbe[]
    fileInputSelector?: string
  }
  title: {
    selector?: string
    value: string
  }
  selectors: {
    openPublishSettings?: string
    openEditor?: string
    dismissAssistant?: string
    dismissTagEditor?: string
    body?: string
    title?: string
    summary?: string
    tags?: string
    category?: string
    cover?: string
    imageOpen?: string
    fileInput?: string
    uploadConfirm?: string
    save?: string
    publish?: string
  }
  tagEditor?: { openSelector?: string; inputSelector?: string; pendingValue: string }
  fieldValues?: Partial<Record<'title' | 'summary' | 'tags' | 'category' | 'cover', string>>
  saveState: 'saved' | 'saving' | 'unknown'
  saveEvidence?: string
  publicationBlocker?: string
  submissionUnavailableReason?: string
  publishedLinks: Array<{ url: string; title: string }>
}

interface RawCsdnPageProbe {
  publicationBlocker?: string
  url: string
  pageKind: CsdnPageProbe['pageKind']
  publishedArticleId?: string
  bodySelector?: string
  bodyFrameSelector?: string
  bodyTextLength: number
  initialDraftBodyEmpty?: boolean
  initialDraftBodyText?: string
  accountHrefCandidates: string[]
  imageEnumerationComplete: boolean
  images: CsdnPageImageProbe[]
  fileInputSelector?: string
  titleSelector?: string
  titleValue: string
  selectors: CsdnPageProbe['selectors']
  tagEditor?: CsdnPageProbe['tagEditor']
  fieldValues?: CsdnPageProbe['fieldValues']
  saveStatusTexts: string[]
  savedDraftMatches?: boolean
  publishedLinks: Array<{ url: string; title: string }>
}

export interface CsdnDraftListCandidate {
  draftId: string
  url: string
  title: string
}

export interface CsdnDraftListProbe {
  adapterId: 'csdn' | 'zhihu' | 'juejin' | 'xiaohongshu' | 'weibo'
  adapterVersion: 1
  observedAt: string
  platformAccountId?: string
  pageSupported: boolean
  draftSectionUrl?: string
  draftSectionTabName?: string
  candidates: CsdnDraftListCandidate[]
}

interface RawCsdnDraftListProbe {
  url: string
  draftSectionUrl?: string
  draftSectionTabName?: string
  accountHrefCandidates: string[]
  links: Array<{ url: string; title: string }>
}

/**
 * Read-only CSDN adapter: bounded DOM and the current rich editor's signed draft read client.
 * Selectors identify one visible element in the top document or the specific CKEditor iframe.
 * Unknown page shapes fail closed instead of asking the Agent to guess selectors.
 */
export class CsdnPublishingAdapter {
  readonly id = 'csdn' as const
  readonly version = 1 as const
  private readonly documents = new WeakMap<Page, { generation: number; frames: Set<Frame> }>()

  /** Ephemeral invalidation only; publishing progress remains in WebAffair. */
  documentGeneration(page: Page): number {
    let state = this.documents.get(page)
    if (!state) {
      state = { generation: 0, frames: new Set() }
      this.documents.set(page, state)
      const tracked = state
      const changed = (frame: Frame): void => {
        if (tracked.frames.has(frame) || frame.url() === page.url()) {
          tracked.frames.add(frame)
          tracked.generation += 1
        }
      }
      for (const frame of page.frames?.() ?? []) {
        if (frame.url() === page.url()) tracked.frames.add(frame)
      }
      page.on?.('framenavigated', changed)
      page.on?.('framedetached', changed)
    }
    return state.generation
  }

  async verifyBody(page: Page, expectedHtml: string) {
    return page.evaluate((html) => {
      const normalize = (text: string) => text.replace(/[\s\u200b]/gu, '')
      const expected = new DOMParser().parseFromString(html, 'text/html').body
      const frames = document.querySelectorAll<HTMLIFrameElement>('iframe.cke_wysiwyg_frame')
      const publicBodies =
        location.hostname === 'blog.csdn.net' ? document.querySelectorAll('#content_views') : []
      const actual =
        publicBodies.length === 1
          ? publicBodies[0]
          : frames.length === 1
            ? frames[0].contentDocument?.querySelector('body.cke_editable')
            : null
      const imageSelector = 'img:not(.cke_widget_drag_handler[data-cke-widget-drag-handler="1"])'
      // Read a clone: CSDN overlays an “编辑” button and drag handle on every image.
      // They are editor controls, not article text, images or paragraph positions.
      const clean = (root: Element) => {
        const clone = root.cloneNode(true) as Element
        for (const control of clone.querySelectorAll(
          '[data-cke-widget-wrapper="1"] > .cke_widget_edit_container, [data-cke-widget-wrapper="1"] > .cke_widget_drag_handler_container',
        ))
          control.remove()
        return clone
      }
      const cleanActual = actual ? clean(actual) : null
      const expectedLinks = Array.from(expected.querySelectorAll('a[href]'))
      const actualLinks = Array.from(cleanActual?.querySelectorAll('a[href]') ?? [])
      const linksMatch =
        expectedLinks.length === actualLinks.length &&
        expectedLinks.every(
          (link, index) => link.getAttribute('href') === actualLinks[index]?.getAttribute('href'),
        )
      // CSDN replaces a bare URL's caption with the target page title. Verify the exact
      // link target and its known title metadata, then compare its original URL caption.
      for (const [index, link] of expectedLinks.entries()) {
        const shown = actualLinks[index]
        if (
          shown &&
          link.textContent === link.getAttribute('href') &&
          shown.getAttribute('href') === link.getAttribute('href') &&
          shown.textContent ===
            (shown.getAttribute('data-link-title') ??
              (publicBodies.length === 1 ? shown.getAttribute('title') : null))
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
              src: img.getAttribute('src') ?? '',
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
          observed[index]?.src === image.src &&
          observed[index]?.alt === image.alt &&
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

  async probe(page: Page): Promise<CsdnPageProbe> {
    const raw = await page.evaluate<
      RawCsdnPageProbe,
      { accountRegionSelector: string; saveStatusSelector: string }
    >(
      async ({ accountRegionSelector, saveStatusSelector }) => {
        const visible = (element: Element): boolean => {
          const html = element as HTMLElement
          const style = globalThis.getComputedStyle?.(html)
          const rect = html.getBoundingClientRect?.()
          return Boolean(
            style?.display !== 'none' &&
            style?.visibility !== 'hidden' &&
            (!rect || (rect.width > 0 && rect.height > 0)),
          )
        }
        const uniqueVisible = (
          selectors: string[],
        ): { element: Element; selector: string } | null => {
          for (const selector of selectors) {
            const elements = Array.from(document.querySelectorAll(selector)).filter(visible)
            if (elements.length === 1) return { element: elements[0], selector }
          }
          return null
        }
        const cssPath = (element: Element): string => {
          if (element.id) return `#${CSS.escape(element.id)}`
          const escapeAttributeValue = (value: string): string =>
            value
              .replace(/\\/gu, '\\\\')
              .replace(/"/gu, '\\"')
              .replace(/[\r\n\f]/gu, ' ')
          for (const attribute of ['data-testid', 'data-id', 'name', 'aria-label']) {
            const value = element.getAttribute(attribute)
            if (!value) continue
            const selector = `${element.tagName.toLowerCase()}[${attribute}="${escapeAttributeValue(value)}"]`
            if (document.querySelectorAll(selector).length === 1) return selector
          }
          const segments: string[] = []
          let current: Element | null = element
          while (current && current !== document.documentElement && segments.length < 6) {
            const parentElement: Element | null = current.parentElement
            if (!parentElement) break
            const tag = current.tagName.toLowerCase()
            const siblings: Element[] = Array.from(parentElement.children).filter(
              (candidate) => candidate.tagName === current?.tagName,
            )
            const index = siblings.indexOf(current) + 1
            segments.unshift(`${tag}:nth-of-type(${index})`)
            current = parentElement
          }
          return segments.length > 0 ? segments.join(' > ') : ''
        }
        const valueOf = (element: Element | undefined): string => {
          if (!element) return ''
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return element.value.trim()
          }
          return (element.textContent ?? '').trim()
        }
        const canonical = (value: string): string => {
          try {
            return new URL(value, location.href).href
          } catch {
            return ''
          }
        }

        const url = location.href
        const accountRegions = Array.from(document.querySelectorAll(accountRegionSelector)).filter(
          visible,
        )
        // CSDN hides its login toolbar on narrow panes. The dedicated logged-in avatar still
        // identifies the account; unrelated hidden profile links must never enter this evidence.
        const loginAvatars = Array.from(
          document.querySelectorAll(
            '.toolbar-container .toolbar-btn-login-new > a.hasAvatar[href]',
          ),
        )
        const accountAnchors =
          loginAvatars.length > 0
            ? loginAvatars
            : accountRegions.flatMap((region) =>
                Array.from(region.querySelectorAll('a[href]')).filter(visible),
              )
        const accountHrefCandidates = accountAnchors.map((anchor) =>
          canonical(anchor.getAttribute('href') ?? ''),
        )
        const publishedMatch = /^https:\/\/blog\.csdn\.net\/[^/]+\/article\/details\/(\d+)/u.exec(
          url,
        )
        const isEditorUrl =
          location.hostname === 'editor.csdn.net' ||
          (location.hostname === 'mp.csdn.net' &&
            /\/mp_blog\/creation\/editor(?:\/\d+)?\/?$/u.test(location.pathname))
        const isManagement =
          location.hostname === 'mp.csdn.net' &&
          /\/mp_blog\/manage\/article/u.test(location.pathname)
        let body = uniqueVisible([
          '[contenteditable="true"][role="textbox"]',
          '.ProseMirror[contenteditable="true"]',
          '.ql-editor[contenteditable="true"]',
          '.public-DraftEditor-content[contenteditable="true"]',
          '[data-contents="true"]',
          'textarea[name*="content" i]',
          'textarea[id*="content" i]',
        ])
        // Only CSDN's current rich-text editor, never the adjacent AI Chat iframe.
        const bodyFrameSelector = 'iframe.cke_wysiwyg_frame'
        const editorFrame = uniqueVisible([bodyFrameSelector])?.element as
          | HTMLIFrameElement
          | undefined
        const editorDocument = editorFrame?.contentDocument
        const frameBody = editorDocument?.querySelector('body.cke_editable[contenteditable="true"]')
        if (!body && frameBody && editorDocument?.URL === url) {
          body = { element: frameBody, selector: 'body.cke_editable[contenteditable="true"]' }
        }
        const usesFrame = Boolean(body?.element === frameBody && frameBody)
        const title = uniqueVisible([
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'input[name*="title" i]',
          'textarea[name*="title" i]',
          '#title',
        ])
        const summary = uniqueVisible(['textarea[placeholder*="摘要"]'])
        // Body images only: cover and feedback uploaders share the same input class.
        const imageOpen = uniqueVisible(['a.cke_button__imageoutside'])
        const uploadPane = uniqueVisible(['.up_img_model_box #pane-upimg'])
        const fileInputs = uploadPane
          ? Array.from(uploadPane.element.querySelectorAll('input[type="file"]'))
          : []
        const fileInput =
          fileInputs.length === 1
            ? {
                element: fileInputs[0],
                selector: '.up_img_model_box #pane-upimg input[type="file"]',
              }
            : null
        const controls = Array.from(
          document.querySelectorAll('button, input, textarea, select, [role="button"]'),
        ).filter(visible)
        const findControl = (pattern: RegExp): string | undefined => {
          const matches = controls.filter((element) => {
            const signature = [
              element.getAttribute('placeholder'),
              element.getAttribute('aria-label'),
              element.getAttribute('name'),
              element.getAttribute('value'),
              element.textContent,
            ]
              .filter(Boolean)
              .join(' ')
            return pattern.test(signature)
          })
          return matches.length === 1 ? cssPath(matches[0]) || undefined : undefined
        }
        const imageRoot = body?.element ?? null
        const imageElements = imageRoot
          ? Array.from(
              imageRoot.querySelectorAll<HTMLImageElement>(
                'img:not(.cke_widget_drag_handler[data-cke-widget-drag-handler="1"])',
              ),
            )
          : []
        const images = imageRoot
          ? imageElements
              .filter(visible)
              .slice(0, 24)
              .map((image) => ({
                src: canonical(image.getAttribute('src') ?? ''),
                alt: (image.getAttribute('alt') ?? '').trim(),
                loaded: image.complete && image.naturalWidth > 0,
              }))
              .filter((image) => Boolean(image.src))
          : []
        const saveStatusTexts = Array.from(document.querySelectorAll(saveStatusSelector))
          .filter(visible)
          .map((element) => (element.textContent ?? '').replace(/\s+/gu, ' ').trim())
          .filter(Boolean)
        const publishedLinks = Array.from(document.querySelectorAll('a[href]'))
          .filter(visible)
          .map((anchor) => {
            const url = canonical(anchor.getAttribute('href') ?? '')
            const articleId = /\/article\/details\/(\d+)/u.exec(url)?.[1]
            const row = anchor.closest('.article-list-item-mp')
            const titles =
              row && articleId
                ? Array.from(row.querySelectorAll('.article-list-item-txt a[href]')).filter(
                    (item) =>
                      canonical(item.getAttribute('href') ?? '').endsWith(
                        `/creation/editor/${articleId}`,
                      ),
                  )
                : []
            return {
              url,
              title: (titles.length === 1
                ? (titles[0].textContent ?? '')
                : (anchor.textContent ?? '')
              )
                .replace(/\s+/gu, ' ')
                .trim(),
            }
          })
          .filter((link) =>
            /^https:\/\/blog\.csdn\.net\/[^/]+\/article\/details\/\d+/u.test(link.url),
          )
          .slice(0, 40)
        let savedDraftMatches: boolean | undefined
        let initialDraftBodyEmpty = false
        let initialDraftBodyText: string | undefined
        if (isEditorUrl && usesFrame) {
          // The loaded editor's signed READ client is required by CSDN. Do not copy cookies,
          // keys or headers, and never call its write methods. A button/toast is not evidence.
          savedDraftMatches = false
          const draftId = /\/creation\/editor\/(\d+)\/?$/u.exec(location.pathname)?.[1]
          const entryScripts = Array.from(document.scripts)
            .map((script) => script.src)
            .filter((src) =>
              /^https:\/\/csdnimg\.cn\/release\/mpfev3\/mp_v3\/index-[\w-]+\.js$/u.test(src),
            )
          type Editor = { getData(): string; status: string }
          const getEditor = (): Editor | undefined =>
            (window as unknown as { CKEDITOR?: { instances?: { editor?: Editor } } }).CKEDITOR
              ?.instances?.editor
          const editor = getEditor()
          initialDraftBodyEmpty = Boolean(
            editor?.status === 'ready' &&
            editor.getData().length < 100 &&
            !valueOf(body?.element).trim() &&
            imageElements.length === 0,
          )
          if (
            editor?.status === 'ready' &&
            editor.getData().length < 100 &&
            imageElements.length === 0 &&
            valueOf(body?.element).trim().length <= 10
          ) {
            initialDraftBodyText = valueOf(body?.element).trim()
          }
          if (draftId && entryScripts.length === 1 && editor?.status === 'ready') {
            const initialContent = editor.getData().trim()
            const initialTitle = valueOf(title?.element)
            const initialSummary = valueOf(summary?.element)
            const savedBody = (html: string): string => {
              const parsed = new DOMParser().parseFromString(html, 'text/html')
              // CDN URL rotation is not a save failure or proof of a different image. Image
              // presence/identity is still handled by the existing per-asset reconciliation.
              for (const image of parsed.querySelectorAll('img')) {
                image.removeAttribute('src')
                image.removeAttribute('srcset')
              }
              return parsed.body.innerHTML.trim()
            }
            try {
              const module = (await import(/* @vite-ignore */ entryScripts[0])) as Record<
                string,
                unknown
              >
              const clients = Object.values(module).filter(
                (
                  value,
                ): value is {
                  getArticle(input: { id: string }): Promise<{
                    code: number
                    data?: {
                      article_id?: string
                      title?: string
                      content?: string
                      description?: string
                      status?: number
                    }
                  }>
                } =>
                  Boolean(
                    value &&
                    typeof value === 'object' &&
                    typeof (value as { getArticle?: unknown }).getArticle === 'function',
                  ),
              )
              if (clients.length === 1 && initialContent.length <= 2_000_000) {
                let timeout: ReturnType<typeof setTimeout> | undefined
                const response = await Promise.race([
                  clients[0].getArticle({ id: draftId }),
                  new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('CSDN draft read timed out')), 8000)
                  }),
                ]).finally(() => clearTimeout(timeout))
                const saved = response.data
                savedDraftMatches = Boolean(
                  response.code === 200 &&
                  saved?.status === 2 &&
                  String(saved.article_id) === draftId &&
                  saved.title?.trim() === initialTitle &&
                  typeof saved.content === 'string' &&
                  saved.content.length <= 2_000_000 &&
                  savedBody(saved.content) === savedBody(initialContent) &&
                  (!summary || saved.description?.trim() === initialSummary) &&
                  location.href === url &&
                  editorFrame?.contentDocument === editorDocument &&
                  getEditor() === editor &&
                  editor.getData().trim() === initialContent &&
                  valueOf(title?.element) === initialTitle &&
                  valueOf(summary?.element) === initialSummary &&
                  accountAnchors.every(
                    (anchor, index) =>
                      anchor.isConnected &&
                      canonical(anchor.getAttribute('href') ?? '') === accountHrefCandidates[index],
                  ),
                )
              }
            } catch {
              // Read unavailable or page changed: unknown, never promote a stale saved toast.
            }
          }
        }
        const selectors: CsdnPageProbe['selectors'] = {
          ...(uniqueVisible(['.mark_selection_box .modal__close-button[aria-label="关闭"]'])
            ? { dismissTagEditor: '.mark_selection_box .modal__close-button[aria-label="关闭"]' }
            : {}),
          ...(document.querySelectorAll('.edit-drawer-content > img.edit-title-close').length ===
            1 &&
          visible(document.querySelector('.edit-drawer-content > img.edit-title-close')!) &&
          document.querySelector(
            '.edit-drawer-content .iframe-box > iframe[src^="https://app-blog.csdn.net/csdn/aiChatNew?"]',
          )
            ? { dismissAssistant: '.edit-drawer-content > img.edit-title-close' }
            : {}),
          ...(findControl(/写文章|开始创作|新建文章|创建文章|write\s*(?:an?\s*)?article/iu)
            ? {
                openEditor: findControl(
                  /写文章|开始创作|新建文章|创建文章|write\s*(?:an?\s*)?article/iu,
                ),
              }
            : {}),
          ...(body ? { body: body.selector } : {}),
          ...(title ? { title: title.selector } : {}),
          ...(findControl(/摘要|简介|description|summary/iu)
            ? { summary: findControl(/摘要|简介|description|summary/iu) }
            : {}),
          ...(findControl(/标签|tag/iu) ? { tags: findControl(/标签|tag/iu) } : {}),
          ...(findControl(/分类|category/iu) ? { category: findControl(/分类|category/iu) } : {}),
          ...(findControl(/封面|cover/iu) ? { cover: findControl(/封面|cover/iu) } : {}),
          ...(imageOpen ? { imageOpen: imageOpen.selector } : {}),
          ...(fileInput?.selector ? { fileInput: fileInput.selector } : {}),
          ...(findControl(/确认上传|插入图片|插入所选|confirm\s*upload/iu)
            ? {
                uploadConfirm: findControl(/确认上传|插入图片|插入所选|confirm\s*upload/iu),
              }
            : {}),
          ...(findControl(/保存草稿|存为草稿|暂存|save\s*(?:as\s*)?draft/iu)
            ? { save: findControl(/保存草稿|存为草稿|暂存|save\s*(?:as\s*)?draft/iu) }
            : {}),
          ...(findControl(/发布博客|发布文章|立即发布|确认发布|^发布$|\bpublish\b/iu)
            ? { publish: findControl(/发布博客|发布文章|立即发布|确认发布|^发布$|\bpublish\b/iu) }
            : {}),
        }
        const tagOpen = uniqueVisible(['.mark_selection .tag__btn-tag'])
        const tagInput = uniqueVisible([
          '.mark-selection-popper input[placeholder="请输入文字搜索，Enter键入可添加自定义标签"]',
        ])
        const tagForms = document.querySelectorAll('input[type="hidden"][name="tags"]')
        const tagEditor =
          tagOpen && tagForms.length === 1
            ? {
                openSelector: cssPath(tagOpen.element),
                ...(tagInput ? { inputSelector: cssPath(tagInput.element) } : {}),
                pendingValue: tagInput ? valueOf(tagInput.element) : '',
              }
            : undefined
        if (tagEditor) selectors.tags = tagEditor.inputSelector ?? tagEditor.openSelector
        const fieldValues: Partial<
          Record<'title' | 'summary' | 'tags' | 'category' | 'cover', string>
        > = {}
        for (const field of ['title', 'summary', 'tags', 'category', 'cover'] as const) {
          const selector = selectors[field]
          if (!selector) continue
          let elements: NodeListOf<Element>
          try {
            elements = document.querySelectorAll(selector)
          } catch {
            continue
          }
          if (elements.length !== 1) continue
          const element = elements[0]
          // Buttons/labels are not field fieldValues. Compound tag/category widgets stay unsupported.
          if (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
          )
            fieldValues[field] = element.value
          else if (element instanceof HTMLElement && element.isContentEditable)
            fieldValues[field] = element.innerText
        }
        if (tagEditor) fieldValues.tags = (tagForms[0] as HTMLInputElement).value
        const reviewRegions = document.querySelectorAll(
          '.article-info-box .article-bar-top .bar-content.active',
        )
        const publicationBlocker =
          publishedMatch && reviewRegions.length === 1
            ? Array.from(reviewRegions[0].querySelectorAll('span'))
                .map((e) => (e.textContent ?? '').trim())
                .find((text) =>
                  /^(审核未通过|审核不通过|审核中|正在审核中|仅自己可见)$/u.test(text),
                )
            : undefined
        return {
          url,
          publicationBlocker,
          tagEditor,
          pageKind: publishedMatch
            ? 'published-article'
            : isEditorUrl && body
              ? 'editor'
              : isManagement
                ? 'management'
                : 'unsupported',
          ...(publishedMatch ? { publishedArticleId: publishedMatch[1] } : {}),
          accountHrefCandidates,
          ...(body ? { bodySelector: body.selector } : {}),
          ...(usesFrame ? { bodyFrameSelector } : {}),
          bodyTextLength: valueOf(body?.element).length,
          initialDraftBodyEmpty,
          initialDraftBodyText,
          imageEnumerationComplete: Boolean(body && imageElements.length <= 24),
          images,
          ...(fileInput ? { fileInputSelector: fileInput.selector } : {}),
          ...(title ? { titleSelector: title.selector } : {}),
          titleValue:
            valueOf(title?.element) ||
            (publishedMatch ? (document.querySelector('h1')?.textContent ?? '').trim() : ''),
          selectors,
          fieldValues,
          saveStatusTexts,
          ...(savedDraftMatches !== undefined ? { savedDraftMatches } : {}),
          publishedLinks,
        }
      },
      {
        accountRegionSelector: CSDN_ACCOUNT_EVIDENCE_REGION_SELECTOR,
        saveStatusSelector: CSDN_SAVE_STATUS_SELECTOR,
      },
    )
    const anchor = parseCsdnDraftAnchor(raw.url)
    const observedAt = new Date().toISOString()
    const platformAccountId = resolveCsdnPlatformAccountId(raw.url, raw.accountHrefCandidates)
    const status = classifyCsdnSaveStatus(raw.saveStatusTexts)
    const save =
      raw.savedDraftMatches === undefined || status.state === 'saving'
        ? status
        : raw.savedDraftMatches
          ? {
              state: 'saved' as const,
              evidence: 'CSDN 服务端原 draftId 的标题、正文与当前编辑器一致，状态为草稿',
            }
          : { state: 'unknown' as const }
    return {
      adapterId: this.id,
      adapterVersion: this.version,
      observedAt,
      url: raw.url,
      ...(platformAccountId ? { platformAccountId } : {}),
      pageKind: raw.pageKind,
      ...(raw.publicationBlocker ? { publicationBlocker: raw.publicationBlocker } : {}),
      ...(anchor ? { draftId: anchor.draftId } : {}),
      ...(raw.publishedArticleId ? { publishedArticleId: raw.publishedArticleId } : {}),
      editor: {
        recognized: raw.pageKind === 'editor',
        ...(raw.bodySelector ? { bodySelector: raw.bodySelector } : {}),
        ...(raw.bodyFrameSelector ? { bodyFrameSelector: raw.bodyFrameSelector } : {}),
        bodyTextLength: raw.bodyTextLength,
        initialDraftBodyEmpty: raw.initialDraftBodyEmpty === true,
        ...(raw.initialDraftBodyText !== undefined
          ? { initialDraftBodyText: raw.initialDraftBodyText }
          : {}),
        imageEnumerationComplete: raw.imageEnumerationComplete,
        images: raw.images,
        ...(raw.fileInputSelector ? { fileInputSelector: raw.fileInputSelector } : {}),
      },
      title: {
        ...(raw.titleSelector ? { selector: raw.titleSelector } : {}),
        value: raw.titleValue,
      },
      selectors: raw.selectors,
      tagEditor: raw.tagEditor,
      fieldValues: { ...raw.fieldValues, title: raw.titleValue },
      saveState: save.state,
      ...(save.evidence ? { saveEvidence: save.evidence } : {}),
      publishedLinks: raw.publishedLinks,
    }
  }

  async probeDraftList(page: Page): Promise<CsdnDraftListProbe> {
    const raw = await page.evaluate<RawCsdnDraftListProbe, string>((accountRegionSelector) => {
      const canonical = (value: string): string => {
        try {
          return new URL(value, location.href).href
        } catch {
          return ''
        }
      }
      const visible = (element: Element): boolean => {
        const html = element as HTMLElement
        const style = globalThis.getComputedStyle?.(html)
        const rect = html.getBoundingClientRect?.()
        return Boolean(
          style?.display !== 'none' &&
          style?.visibility !== 'hidden' &&
          (!rect || (rect.width > 0 && rect.height > 0)),
        )
      }
      const anchors = Array.from(document.querySelectorAll('a[href]')).filter(visible)
      const accountRegions = Array.from(document.querySelectorAll(accountRegionSelector)).filter(
        visible,
      )
      const loginAvatars = Array.from(
        document.querySelectorAll('.toolbar-container .toolbar-btn-login-new > a.hasAvatar[href]'),
      )
      const accountAnchors =
        loginAvatars.length > 0
          ? loginAvatars
          : accountRegions.flatMap((region) =>
              Array.from(region.querySelectorAll('a[href]')).filter(visible),
            )
      const draftSection = anchors.find((anchor) =>
        /草稿箱|草稿管理|drafts?/iu.test((anchor.textContent ?? '').replace(/\s+/gu, ' ').trim()),
      )
      // 真实创作中心的草稿箱是同 URL 的 tab，不一定存在 a[href]。
      const draftTabs = Array.from(document.querySelectorAll('[role="tab"]'))
        .filter(visible)
        .map((tab) => (tab.textContent ?? '').replace(/\s+/gu, ' ').trim())
        .filter((name) => /^草稿箱\s*(?:[（(]\d+[）)])?$/u.test(name))
      return {
        url: location.href,
        ...(draftTabs.length === 1 ? { draftSectionTabName: draftTabs[0] } : {}),
        accountHrefCandidates: accountAnchors.map((anchor) =>
          canonical(anchor.getAttribute('href') ?? ''),
        ),
        ...(draftSection
          ? { draftSectionUrl: canonical(draftSection.getAttribute('href') ?? '') }
          : {}),
        links: anchors
          .slice(0, 500)
          .map((anchor) => ({
            url: canonical(anchor.getAttribute('href') ?? ''),
            title: (anchor.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 320),
          }))
          .filter((link) => Boolean(link.url)),
      }
    }, CSDN_ACCOUNT_EVIDENCE_REGION_SELECTOR)
    let pageSupported = false
    try {
      const url = new URL(raw.url)
      pageSupported =
        url.hostname === 'mp.csdn.net' && /\/mp_blog\/manage\/article/iu.test(url.pathname)
    } catch {
      pageSupported = false
    }
    const candidatesById = new Map<string, CsdnDraftListCandidate>()
    for (const link of raw.links) {
      const anchor = parseCsdnDraftAnchor(link.url)
      if (!anchor || candidatesById.has(anchor.draftId)) continue
      candidatesById.set(anchor.draftId, {
        draftId: anchor.draftId,
        url: link.url,
        title: link.title,
      })
    }
    const candidates = [...candidatesById.values()]
    const observedAt = new Date().toISOString()
    const platformAccountId = resolveCsdnPlatformAccountId(raw.url, raw.accountHrefCandidates)
    const draftSectionUrl = normalizeCsdnManagementUrl(raw.draftSectionUrl)
    return {
      adapterId: this.id,
      adapterVersion: this.version,
      observedAt,
      ...(platformAccountId ? { platformAccountId } : {}),
      pageSupported,
      ...(draftSectionUrl ? { draftSectionUrl } : {}),
      ...(raw.draftSectionTabName ? { draftSectionTabName: raw.draftSectionTabName } : {}),
      candidates,
    }
  }
}

export function resolveCsdnPlatformAccountId(
  currentUrl: string,
  boundedAccountHrefs: readonly string[],
): string | undefined {
  const candidates: string[] = []
  for (const href of [currentUrl, ...boundedAccountHrefs]) {
    try {
      const url = new URL(href)
      if (url.hostname !== 'blog.csdn.net') continue
      const profile = /^\/([^/]+)\/?$/u.exec(url.pathname)
      const published = /^\/([^/]+)\/article\/details\/\d+/u.exec(url.pathname)
      const account = profile?.[1] ?? published?.[1]
      if (!account) continue
      const identity = `csdn:${decodeURIComponent(account)}`
      if (!candidates.includes(identity)) candidates.push(identity)
    } catch {
      // Ignore malformed hrefs from the bounded account region.
    }
  }
  return candidates.length === 1 ? candidates[0] : undefined
}

export function classifyCsdnSaveStatus(boundedStatusTexts: readonly string[]): {
  state: CsdnPageProbe['saveState']
  evidence?: string
} {
  const text = boundedStatusTexts.join(' ')
  const saving = /(正在保存|保存中)/u.exec(text)
  if (saving) return { state: 'saving', evidence: saving[0].trim() }
  const saved = /(草稿已保存(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?|已保存至草稿|保存成功)/u.exec(text)
  return saved ? { state: 'saved', evidence: saved[0].trim() } : { state: 'unknown' }
}

function normalizeCsdnManagementUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'mp.csdn.net' &&
      /\/mp_blog\/manage\/article/iu.test(url.pathname)
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}
