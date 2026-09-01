import { createHash } from 'node:crypto'
import type { Page } from 'playwright-core'
import { parseCsdnDraftAnchor } from '../../shared/article-publishing/csdn-draft-anchor'

const MAX_PROBED_IMAGES = 24
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface CsdnPageImageProbe {
  src: string
  alt: string
}

export interface CsdnPageProbe {
  adapterId: 'csdn'
  adapterVersion: 1
  observedAt: string
  evidenceHash: string
  url: string
  pageKind: 'editor' | 'published-article' | 'management' | 'unsupported'
  draftId?: string
  publishedArticleId?: string
  editor: {
    recognized: boolean
    bodySelector?: string
    bodyTextLength: number
    imageEnumerationComplete: boolean
    images: CsdnPageImageProbe[]
    fileInputSelector?: string
  }
  title: {
    selector?: string
    value: string
  }
  selectors: {
    openEditor?: string
    body?: string
    title?: string
    summary?: string
    tags?: string
    category?: string
    cover?: string
    fileInput?: string
    uploadConfirm?: string
    save?: string
    publish?: string
  }
  saveState: 'saved' | 'saving' | 'unknown'
  saveEvidence?: string
  publishedLinks: Array<{ url: string; title: string }>
}

interface RawCsdnPageProbe {
  url: string
  pageKind: CsdnPageProbe['pageKind']
  publishedArticleId?: string
  bodySelector?: string
  bodyTextLength: number
  imageEnumerationComplete: boolean
  images: CsdnPageImageProbe[]
  fileInputSelector?: string
  titleSelector?: string
  titleValue: string
  selectors: CsdnPageProbe['selectors']
  saveState: CsdnPageProbe['saveState']
  saveEvidence?: string
  publishedLinks: Array<{ url: string; title: string }>
}

/**
 * Versioned, read-only CSDN page adapter. It executes one bounded DOM probe and returns selectors
 * only when they identify exactly one visible top-document element. Unknown page shapes fail
 * closed instead of asking the Agent to try more selectors.
 */
export class CsdnPublishingAdapter {
  readonly id = 'csdn' as const
  readonly version = 1 as const

  async probe(page: Page): Promise<CsdnPageProbe> {
    const raw = await page.evaluate<RawCsdnPageProbe>(() => {
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
      const publishedMatch = /^https:\/\/blog\.csdn\.net\/[^/]+\/article\/details\/(\d+)/u.exec(url)
      const isEditorUrl =
        location.hostname === 'editor.csdn.net' ||
        (location.hostname === 'mp.csdn.net' &&
          /\/mp_blog\/creation\/editor(?:\/\d+)?\/?$/u.test(location.pathname))
      const isManagement =
        location.hostname === 'mp.csdn.net' && /\/mp_blog\/manage\/article/u.test(location.pathname)
      const body = uniqueVisible([
        '[contenteditable="true"][role="textbox"]',
        '.ProseMirror[contenteditable="true"]',
        '.ql-editor[contenteditable="true"]',
        '.public-DraftEditor-content[contenteditable="true"]',
        '[data-contents="true"]',
        'textarea[name*="content" i]',
        'textarea[id*="content" i]',
      ])
      const title = uniqueVisible([
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        'input[name*="title" i]',
        'textarea[name*="title" i]',
        '#title',
      ])
      const fileInputs = Array.from(
        document.querySelectorAll('input[type="file"][accept*="image" i], input[type="file"]'),
      )
      const fileInput =
        fileInputs.length === 1
          ? { element: fileInputs[0], selector: cssPath(fileInputs[0]) }
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
      const imageElements = imageRoot ? Array.from(imageRoot.querySelectorAll('img')) : []
      const images = imageRoot
        ? imageElements
            .filter(visible)
            .slice(0, 24)
            .map((image) => ({
              src: canonical(image.getAttribute('src') ?? ''),
              alt: (image.getAttribute('alt') ?? '').trim(),
            }))
            .filter((image) => Boolean(image.src))
        : []
      const bodyText = valueOf(body?.element)
      const pageText = (document.body?.innerText ?? '').replace(/\s+/gu, ' ').trim()
      const savedMatch = /(草稿已保存(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?|已保存至草稿|保存成功)/u.exec(
        pageText,
      )
      const savingMatch = /(正在保存|保存中)/u.exec(pageText)
      const publishedLinks = Array.from(document.querySelectorAll('a[href]'))
        .map((anchor) => ({
          url: canonical(anchor.getAttribute('href') ?? ''),
          title: (anchor.textContent ?? '').replace(/\s+/gu, ' ').trim(),
        }))
        .filter((link) =>
          /^https:\/\/blog\.csdn\.net\/[^/]+\/article\/details\/\d+/u.test(link.url),
        )
        .slice(0, 40)
      return {
        url,
        pageKind: publishedMatch
          ? 'published-article'
          : isEditorUrl && body
            ? 'editor'
            : isManagement
              ? 'management'
              : 'unsupported',
        ...(publishedMatch ? { publishedArticleId: publishedMatch[1] } : {}),
        ...(body ? { bodySelector: body.selector } : {}),
        bodyTextLength: bodyText.length,
        imageEnumerationComplete: Boolean(body && imageElements.length <= 24),
        images,
        ...(fileInput ? { fileInputSelector: fileInput.selector } : {}),
        ...(title ? { titleSelector: title.selector } : {}),
        titleValue:
          valueOf(title?.element) ||
          (publishedMatch ? (document.querySelector('h1')?.textContent ?? '').trim() : ''),
        selectors: {
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
        },
        saveState: savedMatch ? 'saved' : savingMatch ? 'saving' : 'unknown',
        ...(savedMatch || savingMatch
          ? { saveEvidence: (savedMatch?.[0] ?? savingMatch?.[0] ?? '').trim() }
          : {}),
        publishedLinks,
      }
    })
    const anchor = parseCsdnDraftAnchor(raw.url)
    const observedAt = new Date().toISOString()
    const evidenceHash = createHash('sha256')
      .update(
        JSON.stringify({ adapterId: this.id, adapterVersion: this.version, observedAt, ...raw }),
      )
      .digest('hex')
    return {
      adapterId: this.id,
      adapterVersion: this.version,
      observedAt,
      evidenceHash,
      url: raw.url,
      pageKind: raw.pageKind,
      ...(anchor ? { draftId: anchor.draftId } : {}),
      ...(raw.publishedArticleId ? { publishedArticleId: raw.publishedArticleId } : {}),
      editor: {
        recognized: raw.pageKind === 'editor',
        ...(raw.bodySelector ? { bodySelector: raw.bodySelector } : {}),
        bodyTextLength: raw.bodyTextLength,
        imageEnumerationComplete: raw.imageEnumerationComplete,
        images: raw.images,
        ...(raw.fileInputSelector ? { fileInputSelector: raw.fileInputSelector } : {}),
      },
      title: {
        ...(raw.titleSelector ? { selector: raw.titleSelector } : {}),
        value: raw.titleValue,
      },
      selectors: raw.selectors,
      saveState: raw.saveState,
      ...(raw.saveEvidence ? { saveEvidence: raw.saveEvidence } : {}),
      publishedLinks: raw.publishedLinks,
    }
  }

  async matchAssetsByContentHash(
    page: Page,
    probe: CsdnPageProbe,
    contentHashes: string[],
  ): Promise<Record<string, string>> {
    const pendingHashes = new Set(contentHashes)
    const matched: Record<string, string> = {}
    const images = probe.editor.images.slice(0, MAX_PROBED_IMAGES)
    let nextIndex = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < images.length && pendingHashes.size > 0) {
        const image = images[nextIndex]
        nextIndex += 1
        try {
          const response = await page.context().request.get(image.src, { timeout: 5_000 })
          if (!response.ok()) continue
          const body = await response.body()
          if (body.byteLength > MAX_IMAGE_BYTES) continue
          const hash = createHash('sha256').update(body).digest('hex')
          if (!pendingHashes.has(hash)) continue
          matched[hash] = image.src
          pendingHashes.delete(hash)
        } catch {
          // A single inaccessible CDN image does not invalidate the rest of the deterministic probe.
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, images.length) }, () => worker()))
    return matched
  }
}
