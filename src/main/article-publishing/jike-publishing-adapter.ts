import type { Page } from 'playwright-core'
import type { CsdnDraftListProbe, CsdnPageProbe } from './csdn-publishing-adapter'
import { jikeImageIdentity, parseJikePublicationUrl, readJikePublication } from './jike-publication'

export const JIKE_EDITOR_URL = 'https://web.okjike.com/following'

export async function readJikeComposer(page: Page) {
  if (new URL(page.url()).origin !== 'https://web.okjike.com') throw new Error('当前不是即刻页面')
  return page.evaluate(() => {
    const visible = (e: Element) => {
      const rect = e.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const selectorFor = (element: Element | undefined): string | undefined => {
      if (!element) return undefined
      const candidates = [
        element.id ? `#${CSS.escape(element.id)}` : '',
        element.getAttribute('role')
          ? `${element.tagName.toLowerCase()}[role=${JSON.stringify(element.getAttribute('role'))}]`
          : '',
        element.getAttribute('type')
          ? `${element.tagName.toLowerCase()}[type=${JSON.stringify(element.getAttribute('type'))}]`
          : '',
      ].filter(Boolean)
      for (const candidate of candidates)
        if (document.querySelectorAll(candidate).length === 1) return candidate
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
    const editors = Array.from(
      document.querySelectorAll<HTMLElement>('[contenteditable="true"][role="textbox"]'),
    ).filter(visible)
    const editor = editors.length === 1 ? editors[0] : undefined
    const form = editor?.closest('form')
    const root =
      form?.closest<HTMLElement>('[role="presentation"]') ?? form?.parentElement?.parentElement
    const sends = Array.from(
      form?.querySelectorAll<HTMLButtonElement>('button[type="submit"]') ?? [],
    ).filter((button) => visible(button) && button.textContent?.trim() === '发送')
    const files = Array.from(
      root?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? [],
    ).filter((input) => /image\/png|image\/jpeg/u.test(input.accept))
    const restoreDraft = Array.from(
      document.querySelectorAll<HTMLElement>('[title="恢复草稿"]'),
    ).filter(visible)
    const isJikeImageUrl = (raw: string) => {
      try {
        return ['cdnv2.ruguoapp.com', 'cdn.ruguoapp.com'].includes(new URL(raw).hostname)
      } catch {
        return false
      }
    }
    let pendingDraftRestore:
      | {
          content: string
          uploads: Array<{ platformUrl: string; fileName: string }>
          attachmentIdsUnique: boolean
        }
      | undefined
    try {
      const raw = localStorage.getItem('ORIGINAL_POST_DRAFT')
      const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined
      const attachment = value?.attachment as
        | { ids?: unknown; map?: Record<string, unknown> }
        | undefined
      const ids = Array.isArray(attachment?.ids)
        ? attachment.ids.filter((id): id is string => typeof id === 'string')
        : []
      const uniqueIds = [...new Set(ids)]
      const uploads = uniqueIds.flatMap((id) => {
        const item = attachment?.map?.[id] as
          | {
              file?: { path?: unknown; relativePath?: unknown }
              status?: unknown
              type?: unknown
              cdn?: { file?: { fileUrl?: unknown; key?: unknown; success?: unknown } }
            }
          | undefined
        const fileName =
          typeof item?.file?.relativePath === 'string'
            ? item.file.relativePath.replace(/^\.\//u, '')
            : ''
        const fileUrl = item?.cdn?.file?.fileUrl
        const key = item?.cdn?.file?.key
        if (
          !fileName ||
          fileName.includes('/') ||
          item?.status !== 'UPLOADED' ||
          item.type !== 'PICTURE' ||
          item.cdn?.file?.success !== true ||
          typeof fileUrl !== 'string' ||
          typeof key !== 'string'
        )
          return []
        try {
          const url = new URL(fileUrl)
          const pathKey = decodeURIComponent(url.pathname.replace(/^\//u, ''))
          return isJikeImageUrl(url.href) && pathKey === key && !key.includes('/')
            ? [{ platformUrl: `${url.origin}/${encodeURIComponent(key)}`, fileName }]
            : []
        } catch {
          return []
        }
      })
      if (
        typeof value?.content === 'string' &&
        ids.length > 0 &&
        uploads.length === uniqueIds.length
      )
        pendingDraftRestore = {
          content: value.content,
          uploads,
          attachmentIdsUnique: uniqueIds.length === ids.length,
        }
    } catch {
      // A malformed platform draft is never restored automatically.
    }
    const profileIds = [
      ...new Set(
        Array.from(root?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []).flatMap((anchor) => {
          try {
            const url = new URL(anchor.href)
            return url.origin === 'https://web.okjike.com'
              ? (/^\/u\/([0-9a-f-]{36})\/?$/iu.exec(url.pathname)?.[1] ?? [])
              : []
          } catch {
            return []
          }
        }),
      ),
    ]
    const previewImages = Array.from(root?.querySelectorAll<HTMLImageElement>('img') ?? []).filter(
      (img) =>
        visible(img) &&
        !img.closest('a[href^="/u/"]') &&
        (/^(blob:|data:)/u.test(img.currentSrc || img.src) ||
          isJikeImageUrl(img.currentSrc || img.src)),
    )
    const attachmentRoots = Array.from(
      root?.querySelectorAll<HTMLElement>('[aria-roledescription="sortable"]') ?? [],
    ).filter(visible)
    const removeAttachments = Array.from(
      root?.querySelectorAll<HTMLElement>('[aria-label="移除附件"][title="移除附件"]') ?? [],
    ).filter(visible)
    const uploadReceipts = previewImages.map((img) => {
      const fiberKey = Object.keys(img).find((key) => key.startsWith('__reactFiber$'))
      let fiber = fiberKey ? (img as unknown as Record<string, unknown>)[fiberKey] : undefined
      for (let depth = 0; fiber && depth < 32; depth += 1) {
        const current = fiber as {
          memoizedProps?: {
            data?: {
              file?: File
              cdn?: { file?: { fileUrl?: string; key?: string } }
            }
          }
          return?: unknown
        }
        const file = current.memoizedProps?.data?.file
        const uploaded = current.memoizedProps?.data?.cdn?.file
        if (file instanceof File && uploaded?.fileUrl && uploaded.key) {
          try {
            const url = new URL(uploaded.fileUrl)
            const key = decodeURIComponent(url.pathname.replace(/^\//u, ''))
            if (
              url.protocol === 'https:' &&
              !url.username &&
              !url.password &&
              isJikeImageUrl(url.href) &&
              key === uploaded.key &&
              !key.includes('/')
            )
              return {
                platformUrl: `${url.origin}/${encodeURIComponent(key)}`,
                fileName: file.name,
                size: file.size,
                lastModified: file.lastModified,
              }
          } catch {
            // Keep the preview unresolved until the native receipt becomes readable.
          }
        }
        fiber = current.return
      }
      return undefined
    })
    const recoveredUploads = uploadReceipts.filter(
      (receipt): receipt is NonNullable<typeof receipt> => Boolean(receipt),
    )
    const images = previewImages.flatMap((img, index) => {
      const source = img.currentSrc || img.src
      const stable = isJikeImageUrl(source)
        ? source.split('?')[0]
        : uploadReceipts[index]?.platformUrl
      return stable
        ? [{ src: stable, alt: img.alt, loaded: img.complete && img.naturalWidth > 0 }]
        : []
    })
    const allRecoveredUploads = [
      ...recoveredUploads,
      ...(pendingDraftRestore?.uploads.filter(
        (upload) =>
          !recoveredUploads.some((receipt) => receipt.platformUrl === upload.platformUrl) &&
          images.some((image) => image.loaded && image.src === upload.platformUrl),
      ) ?? []),
    ]
    const text = editor?.innerText.replace(/\n$/u, '') ?? ''
    return {
      observedAt: new Date().toISOString(),
      url: location.href,
      accountId: profileIds.length === 1 ? profileIds[0] : undefined,
      recognized: Boolean(editor && form && root && sends.length === 1),
      bodySelector: selectorFor(editor),
      fileInputSelector: files.length === 1 ? selectorFor(files[0]) : undefined,
      publishSelector: sends.length === 1 && !sends[0].disabled ? selectorFor(sends[0]) : undefined,
      restoreDraftSelector:
        restoreDraft.length === 1 && localStorage.getItem('ORIGINAL_POST_DRAFT')
          ? selectorFor(restoreDraft[0])
          : undefined,
      attachmentHoverSelector:
        attachmentRoots.length > 0 ? selectorFor(attachmentRoots[0]) : undefined,
      removeAttachmentSelector:
        removeAttachments.length === 1 ? selectorFor(removeAttachments[0]) : undefined,
      text,
      images,
      recoveredUploads: allRecoveredUploads,
      pendingDraftRestore,
      imageEnumerationComplete: Boolean(root) && images.length === previewImages.length,
      diagnostic: `正文 ${editors.length}；发送 ${sends.length}；上传控件 ${files.length}；账号候选 ${profileIds.length}；图片回执 ${allRecoveredUploads.length}/${previewImages.length}`,
    }
  })
}

export class JikePublishingAdapter {
  async probe(page: Page): Promise<CsdnPageProbe> {
    if (parseJikePublicationUrl(page.url())) {
      const live = await readJikePublication(page)
      return {
        adapterId: 'jike',
        adapterVersion: 1,
        observedAt: live.observedAt,
        url: live.url,
        platformAccountId: live.accountId,
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
        publishedLinks: live.recognized
          ? [{ url: live.url, title: live.text.split('\n')[0] ?? '' }]
          : [],
        publicationBlocker: live.recognized ? undefined : '即刻公开页正文或作者不能唯一核验',
      }
    }
    const live = await readJikeComposer(page)
    return {
      adapterId: 'jike',
      adapterVersion: 1,
      observedAt: live.observedAt,
      url: live.url,
      platformAccountId: live.accountId,
      pageKind: live.recognized ? 'editor' : 'unsupported',
      editor: {
        recognized: live.recognized,
        bodySelector: live.bodySelector,
        bodyTextLength: live.text.length,
        initialDraftBodyEmpty: !live.text,
        imageEnumerationComplete: live.imageEnumerationComplete,
        images: live.images,
        recoveredUploads: live.recoveredUploads,
        pendingDraftRestore: live.pendingDraftRestore,
        fileInputSelector: live.fileInputSelector,
      },
      title: { value: live.text.split('\n')[0] ?? '' },
      fieldValues: { title: live.text.split('\n')[0] ?? '' },
      selectors: {
        body: live.bodySelector,
        restoreDraft: live.restoreDraftSelector,
        attachmentHover: live.attachmentHoverSelector,
        removeAttachment: live.removeAttachmentSelector,
        fileInput: live.fileInputSelector,
        publish: live.publishSelector,
      },
      saveState: 'unknown',
      publishedLinks: [],
      publicationBlocker: !live.recognized || !live.accountId ? live.diagnostic : undefined,
    }
  }

  async probeDraftList(page: Page): Promise<CsdnDraftListProbe> {
    return {
      adapterId: 'jike',
      adapterVersion: 1,
      observedAt: new Date().toISOString(),
      platformAccountId: (await readJikeComposer(page)).accountId,
      pageSupported: false,
      candidates: [],
    }
  }

  async verifyBody(page: Page, html: string) {
    const live = parseJikePublicationUrl(page.url())
      ? await readJikePublication(page)
      : await readJikeComposer(page)
    return page.evaluate(
      ({ html, live, actualImageIds }) => {
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const expectedImages = Array.from(doc.querySelectorAll('img')).map((img) => ({
          src: img.src,
          alt: img.alt,
        }))
        doc.querySelectorAll('img').forEach((img) => img.remove())
        const normalize = (value: string) => value.replace(/[\s\u200b]/gu, '')
        const expectedText = doc.body.textContent ?? ''
        const textMatches = live.recognized && normalize(expectedText) === normalize(live.text)
        const expectedIds = expectedImages.map((image) => {
          try {
            const url = new URL(image.src)
            return decodeURIComponent(url.pathname.replace(/^\//u, ''))
          } catch {
            return null
          }
        })
        const images = expectedImages.map((image, index) => ({
          ...image,
          index,
          actualSrc: live.images[index]?.src ?? '',
          precedingCharacters: 0,
          matches: Boolean(
            live.images[index]?.loaded &&
            expectedIds[index] &&
            expectedIds[index] === actualImageIds[index],
          ),
        }))
        return {
          matches:
            textMatches &&
            live.imageEnumerationComplete &&
            images.length === live.images.length &&
            images.every((image) => image.matches),
          textMatches,
          textEvidence: `即刻现场正文期望 ${normalize(expectedText).length} 字符，实际 ${normalize(live.text).length} 字符；未声明草稿已保存`,
          expectedImages: images.length,
          actualImages: live.images.length,
          images,
        }
      },
      { html, live, actualImageIds: live.images.map((image) => jikeImageIdentity(image.src)) },
    )
  }
}
