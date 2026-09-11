import type { Page } from 'playwright-core'
import MarkdownIt from 'markdown-it'
import type { ArticlePublishingState } from '../../shared/article-publishing/article-publishing-types'
import type { CsdnPageProbe, CsdnDraftListProbe } from './csdn-publishing-adapter'

/** Reads the visible editor and its own read-only draft endpoint. Owns no task state. */
export class JuejinPublishingAdapter {
  async probe(
    page: Page,
    fields?: ArticlePublishingState['fields'],
    expectedDraftId?: string,
  ): Promise<CsdnPageProbe> {
    const previewTab = page.locator('.bytemd-toolbar-tab:text-is("预览")')
    if (
      (await previewTab.count()) === 1 &&
      !(await previewTab.getAttribute('class'))?.includes('tab-active')
    ) {
      await previewTab.click()
    }
    const pictures = page.locator('.bytemd-preview img, .article-viewer.markdown-body img')
    for (let i = 0; i < (await pictures.count()); i++)
      await pictures.nth(i).scrollIntoViewIfNeeded({ timeout: 3000 })
    return page.evaluate(
      async ({ expected, expectedDraftId }) => {
        const read = async (path: string, body?: object) => {
          const r = await fetch(`https://api.juejin.cn${path}`, {
            credentials: 'include',
            ...(body
              ? {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(body),
                }
              : {}),
          })
          if (!r.ok) return null
          const result = await r.json()
          return result.err_no === 0 ? result.data : null
        }
        const me = await read('/user_api/v1/user/get')
        const draftId = /^\/editor\/drafts\/(\d+)\/?$/u.exec(location.pathname)?.[1]
        const postId = /^\/post\/(\d+)\/?$/u.exec(location.pathname)?.[1]
        const cm = (
          document.querySelector('.CodeMirror') as
            | (HTMLElement & { CodeMirror?: { getValue(): string } })
            | null
        )?.CodeMirror
        const titleInput = document.querySelector<HTMLInputElement>('input.title-input')
        const detail =
          draftId || expectedDraftId
            ? await read('/content_api/v1/article_draft/detail', {
                draft_id: draftId ?? expectedDraftId,
              })
            : null
        const draft = detail?.article_draft
        const isEditor = Boolean(cm && titleInput && draftId)
        const markdown = cm?.getValue()
        const body = document.querySelector(
          isEditor ? '.bytemd-preview .markdown-body' : '.article-viewer.markdown-body',
        )
        const unique = (s: string) => (document.querySelectorAll(s).length === 1 ? s : undefined)
        const visible = (s: string) => {
          const e = document.querySelector(s)
          return !!e && e.getBoundingClientRect().width > 0
        }
        const panel = visible('.category-list')
        const images = Array.from(body?.querySelectorAll<HTMLImageElement>('img') ?? []).map(
          (img) => ({
            src: (img.currentSrc || img.src).split('?')[0],
            alt: img.alt,
            loaded:
              img.complete &&
              img.naturalWidth > 0 &&
              /^https:\/\/(?:p0-xtjj-private\.juejin\.cn|p\d+-(?:juejin|jj|xtjj-sign)\.byteimg\.com)\//u.test(
                img.currentSrc || img.src,
              ),
          }),
        )
        const canonicalMarkdown = (value: string) =>
          value.replace(
            /(!\[[^\]\n]*\]\()(https:\/\/p0-xtjj-private\.juejin\.cn\/[^\s)]+)(\))/gu,
            (_all, before: string, raw: string, after: string) => {
              const url = new URL(raw)
              for (const key of [
                'policy',
                'rk3s',
                'x-orig-authkey',
                'x-orig-expires',
                'x-orig-sign',
              ])
                url.searchParams.delete(key)
              return before + url.href + after
            },
          )
        const savedBody = !!(
          isEditor &&
          draft?.id === draftId &&
          draft?.user_id === me?.user_id &&
          draft?.title === titleInput?.value &&
          typeof draft?.mark_content === 'string' &&
          typeof markdown === 'string' &&
          canonicalMarkdown(draft.mark_content) === canonicalMarkdown(markdown)
        )
        const title =
          titleInput?.value ?? document.querySelector('h1.article-title')?.textContent?.trim() ?? ''
        const accountLink = document.querySelector<HTMLAnchorElement>(
          '.author-info-box a[href^="/user/"]',
        )
        const author = accountLink ? /\/user\/(\d+)/u.exec(accountLink.href)?.[1] : undefined
        const category = detail?.category?.category_name ?? ''
        const panelCategory = document
          .querySelector('.category-list .item.active')
          ?.textContent?.trim()
        const panelSummary = document.querySelector<HTMLTextAreaElement>(
          'textarea[maxlength="100"]',
        )?.value
        const saved =
          savedBody &&
          (!panel ||
            (panelCategory === category &&
              panelSummary === draft?.brief_content &&
              Array.from(
                document.querySelectorAll('.tag-input[data-v-486f85f2] .byte-select__tag > span'),
              )
                .map((e) => e.textContent?.trim())
                .join(',') ===
                (detail?.tags ?? []).map((t: { tag_name: string }) => t.tag_name).join(',')))
        const tags = (detail?.tags ?? []).map((t: { tag_name: string }) => t.tag_name).join(',')
        const pageKind = isEditor
          ? 'editor'
          : postId && body
            ? 'published-article'
            : location.pathname === '/editor/drafts'
              ? 'management'
              : 'unsupported'
        const categorySelector =
          panel && expected?.category
            ? `.category-list .item:text-is(${JSON.stringify(expected.category)})`
            : undefined
        const wantedTag = expected?.tags.find(
          (tag) => !(detail?.tags ?? []).some((t: { tag_name: string }) => t.tag_name === tag),
        )
        const option =
          wantedTag &&
          Array.from(
            document.querySelectorAll('.tag-select-add-margin .byte-select-option'),
          ).filter(
            (e) => e.textContent?.trim() === wantedTag && e.getBoundingClientRect().width > 0,
          ).length === 1
        return {
          adapterId: 'juejin',
          adapterVersion: 1,
          observedAt: new Date().toISOString(),
          url: location.href,
          platformAccountId: isEditor
            ? draft?.user_id === me?.user_id
              ? me.user_id
              : undefined
            : postId
              ? author
              : me?.user_id,
          pageKind,
          draftId: isEditor
            ? draftId
            : postId && draft?.article_id === postId && draft?.user_id === me?.user_id
              ? draft.id
              : undefined,
          publishedArticleId: postId,
          editor: {
            recognized: isEditor,
            bodySelector: isEditor ? '.CodeMirror textarea' : undefined,
            bodyTextLength: markdown?.replace(/\s/gu, '').length ?? body?.textContent?.length ?? 0,
            imageEnumerationComplete: !!cm || !!body,
            images,
            fileInputSelector: isEditor ? unique('.CodeMirror') : undefined,
          },
          title: { value: title, selector: isEditor ? 'input.title-input' : undefined },
          selectors: {
            body: isEditor ? '.CodeMirror textarea' : undefined,
            title: isEditor ? 'input.title-input' : undefined,
            fileInput: isEditor ? unique('.CodeMirror') : undefined,
            openPublishSettings: isEditor && !panel ? 'button.xitu-btn:text-is("发布")' : undefined,
            summary: panel ? 'textarea[maxlength="100"]' : undefined,
            category: categorySelector,
            tags: option
              ? `.tag-select-add-margin .byte-select-option:text-is(${JSON.stringify(wantedTag)})`
              : undefined,
            publish: panel ? 'button:text-is("确定并发布")' : undefined,
          },
          ...(panel
            ? {
                tagEditor: {
                  inputSelector: unique('.tag-input[data-v-486f85f2] input'),
                  pendingValue: '',
                },
              }
            : {}),
          fieldValues: { title, summary: draft?.brief_content ?? '', category, tags },
          saveState: saved ? 'saved' : 'unknown',
          saveEvidence: saved
            ? '掘金草稿回读：原账号、draftId、标题、完整 Markdown 与当前编辑器一致'
            : '掘金草稿与当前编辑器尚未一致',
          publishedLinks:
            draft?.article_id && draft.article_id !== '0'
              ? [{ url: `https://juejin.cn/post/${draft.article_id}`, title }]
              : [],
        } satisfies CsdnPageProbe
      },
      { expected: fields, expectedDraftId },
    )
  }
  async probeDraftList(page: Page): Promise<CsdnDraftListProbe> {
    const probe = await this.probe(page)
    await page
      .waitForFunction(
        () =>
          Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).some((a) =>
            /^https:\/\/juejin\.cn\/editor\/drafts\/\d+$/u.test(a.href),
          ),
        undefined,
        { timeout: 8000 },
      )
      .catch(() => {})
    const candidates = await page.locator('a[href]').evaluateAll((links) =>
      links.flatMap((e) => {
        const a = e as HTMLAnchorElement
        const id = /^https:\/\/juejin\.cn\/editor\/drafts\/(\d+)$/u.exec(a.href)?.[1]
        return id ? [{ draftId: id, url: a.href, title: a.textContent?.trim() ?? '' }] : []
      }),
    )
    return {
      adapterId: 'juejin',
      adapterVersion: 1,
      observedAt: probe.observedAt,
      platformAccountId: probe.platformAccountId,
      pageSupported: probe.pageKind === 'management',
      draftSectionUrl: 'https://juejin.cn/editor/drafts',
      candidates,
    }
  }
  async verifyBody(page: Page, expectedHtml: string) {
    const markdown = await page.evaluate(() =>
      (
        document.querySelector('.CodeMirror') as
          | (HTMLElement & { CodeMirror?: { getValue(): string } })
          | null
      )?.CodeMirror?.getValue(),
    )
    const editorHtml =
      markdown === undefined
        ? undefined
        : new MarkdownIt({ html: false, linkify: false }).render(markdown)
    return page.evaluate(
      ({ expectedHtml, editorHtml }) => {
        const normalize = (s: string) => s.replace(/[\s\u200b]/gu, '')
        const expected = new DOMParser().parseFromString(expectedHtml, 'text/html').body
        const rawActual =
          editorHtml === undefined
            ? document.querySelector('.article-viewer.markdown-body')
            : new DOMParser().parseFromString(editorHtml, 'text/html').body
        const actual = rawActual?.cloneNode(true) as Element | undefined
        actual?.querySelectorAll('style, script').forEach((e) => e.remove())
        const target = (link: Element) => {
          const raw = link.getAttribute('href') ?? ''
          try {
            const u = new URL(raw)
            return u.origin === 'https://link.juejin.cn' && u.pathname === '/'
              ? (u.searchParams.get('target') ?? raw)
              : raw
          } catch {
            return raw
          }
        }
        if (editorHtml === undefined && actual) {
          const wantedLinks = Array.from(expected.querySelectorAll('a[href]'))
          const shownLinks = Array.from(actual.querySelectorAll('a[href]'))
          wantedLinks.forEach((original, index) => {
            const shown = shownLinks[index]
            const url = original.getAttribute('href') ?? ''
            if (
              shown &&
              target(shown) === url &&
              original.textContent === url &&
              shown.textContent === url.replace(/^https?:\/\//u, '')
            )
              shown.textContent = original.textContent
          })
        }
        const live = document.querySelector(
          editorHtml === undefined
            ? '.article-viewer.markdown-body'
            : '.bytemd-preview .markdown-body',
        )
        const describe = (root: Element | null | undefined) =>
          Array.from(root?.querySelectorAll<HTMLImageElement>('img') ?? []).map((img) => {
            const range = img.ownerDocument.createRange()
            range.selectNodeContents(root!)
            range.setEndBefore(img)
            return {
              src: (img.getAttribute('src') ?? '').split('?')[0],
              alt: img.alt,
              preceding: normalize(range.toString()),
            }
          })
        const wanted = describe(expected),
          found = describe(actual),
          loaded = Array.from(live?.querySelectorAll<HTMLImageElement>('img') ?? [])
        const imageKey = (raw: string) => {
          try {
            const url = new URL(raw)
            if (
              url.protocol === 'https:' &&
              /^(?:p0-xtjj-private\.juejin\.cn|p\d+-(?:juejin|jj|xtjj-sign)\.byteimg\.com)$/u.test(
                url.hostname,
              )
            )
              return url.pathname.split('~')[0]
          } catch {}
          return raw
        }
        const images = wanted.map((img, index) => ({
          index,
          src: img.src,
          alt: img.alt,
          actualSrc: found[index]?.src ?? '',
          precedingCharacters: found[index]?.preceding.length ?? 0,
          matches:
            imageKey(img.src) === imageKey(found[index]?.src ?? '') &&
            img.alt === found[index]?.alt &&
            img.preceding === found[index]?.preceding &&
            loaded[index]?.complete === true &&
            loaded[index].naturalWidth > 0,
        }))
        const links = (e: Element | null | undefined) =>
          Array.from(e?.querySelectorAll('a[href]') ?? []).map(target)
        const textMatches =
          !!actual &&
          normalize(actual.textContent ?? '') === normalize(expected.textContent ?? '') &&
          JSON.stringify(links(actual)) === JSON.stringify(links(expected))
        return {
          matches: textMatches && wanted.length === found.length && images.every((i) => i.matches),
          textMatches,
          textEvidence: `正文期望 ${normalize(expected.textContent ?? '').length} 字符，实际 ${normalize(actual?.textContent ?? '').length} 字符；内容及链接${textMatches ? '一致' : '不一致'}`,
          expectedImages: wanted.length,
          actualImages: found.length,
          images,
        }
      },
      { expectedHtml, editorHtml },
    )
  }
}
