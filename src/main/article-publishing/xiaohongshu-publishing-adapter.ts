import { readXiaohongshuPublication } from './xiaohongshu-publication'
import type { CsdnPageProbe, CsdnDraftListProbe } from './csdn-publishing-adapter'
import {
  XIAOHONGSHU_SAVE_SELECTOR,
  XIAOHONGSHU_PUBLISH_SELECTOR,
} from './xiaohongshu-publish-control'
import type { Page } from 'playwright-core'
import { readXiaohongshuLocalDrafts, requireXiaohongshuDraft } from './xiaohongshu-local-draft'

/** Small read-only projection of the editor's own current model, cross-checked with rendered content. */
export async function readXiaohongshuEditor(page: Page) {
  if (new URL(page.url()).origin !== 'https://creator.xiaohongshu.com')
    throw new Error('不是小红书创作后台')
  return page.evaluate(() => {
    type PlatformStore = { $state: Record<string, unknown> }
    type PlatformApp = {
      config: {
        globalProperties: {
          $store?: {
            state?: { Auth?: { userInfo?: { userId?: string; userName?: string; redId?: string } } }
          }
          $pinia?: { _s: Map<string, PlatformStore> }
        }
      }
    }
    type Root = Element & { __vue_app__?: PlatformApp }
    const identity = (document.querySelector('#app') as Root | null)?.__vue_app__?.config
      .globalProperties.$store?.state?.Auth?.userInfo
    const apps = Array.from(document.querySelectorAll('div')).flatMap(
      (e) => (e as Root).__vue_app__?.config.globalProperties.$pinia ?? [],
    )
    const publisher = apps.length === 1 ? apps[0]._s.get('publisher')?.$state : undefined
    const draft = apps.length === 1 ? apps[0]._s.get('draft')?.$state : undefined
    const settings = apps.length === 1 ? apps[0]._s.get('settings')?.$state : undefined
    const titleInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="填写标题会有更多赞哦"]',
    )
    const body = document.querySelector<HTMLElement>('.tiptap.ProseMirror[contenteditable="true"]')
    const liveImages = Array.from(document.querySelectorAll<HTMLImageElement>('.img-list img'))
    const imageList = Array.isArray(draft?.imgList)
      ? (draft.imgList as Array<{
          fileId?: string
          url?: string
          status?: number
          file?: { name?: string }
          fileMetadata?: { width?: number; height?: number }
        }>)
      : []
    const images = imageList.map((img) => {
      const visible = liveImages.find(
        (el) => el.src === img.url || (img.fileId && el.src.includes(img.fileId)),
      )
      const src = visible?.currentSrc || visible?.src || ''
      return {
        fileId: img.fileId ?? '',
        name: img.file?.name ?? '',
        src: src.split('?')[0],
        width: img.fileMetadata?.width ?? visible?.naturalWidth ?? 0,
        height: img.fileMetadata?.height ?? visible?.naturalHeight ?? 0,
        loaded:
          (img.status === 2 || img.status === 5) && !!visible?.complete && visible.naturalWidth > 0,
      }
    })
    const title = titleInput?.value ?? ''
    const description = typeof draft?.desc === 'string' ? draft.desc : ''
    const descriptionHtml = typeof draft?.descInnerHTML === 'string' ? draft.descInnerHTML : ''
    const normalize = (text: string) => text.replace(/\s/gu, '')
    const template = document.createElement('template')
    template.innerHTML = descriptionHtml
    const renderedMatches =
      !!body &&
      normalize(body.innerText) === normalize(description) &&
      normalize(template.content.textContent ?? '') === normalize(description) &&
      draft?.title === title
    const uid = identity?.userId
    return {
      observedAt: new Date().toISOString(),
      url: location.origin + location.pathname + location.search,
      uid: typeof uid === 'string' && /^[\da-f]{24}$/iu.test(uid) ? uid : undefined,
      displayName: identity?.userName,
      redId: identity?.redId,
      draftId: typeof publisher?.draftId === 'string' ? publisher.draftId : undefined,
      publishedNoteId: typeof publisher?.noteId === 'string' ? publisher.noteId : undefined,
      fromDraft: publisher?.isFromDraft === true,
      title,
      description,
      descriptionHtml,
      renderedMatches,
      editorRecognized: !!body && !!titleInput && apps.length === 1,
      images,
      imageEnumerationComplete:
        Array.isArray(draft?.imgList) && images.length === liveImages.length,
      privacy: { type: (settings?.privacyInfo as { type?: number } | undefined)?.type },
      scheduled: settings?.postTiming === true,
      hasSaveControl:
        document.querySelectorAll('xhs-publish-btn[save-text="暂存离开"][save-disabled="false"]')
          .length === 1,
      hasPublishControl:
        document.querySelectorAll('xhs-publish-btn[submit-text="发布"][submit-disabled="false"]')
          .length === 1,
    }
  })
}

export class XiaohongshuPublishingAdapter {
  async probe(page: Page): Promise<CsdnPageProbe> {
    if (new URL(page.url()).origin === 'https://www.xiaohongshu.com') {
      const live = await readXiaohongshuPublication(page)
      return {
        adapterId: 'xiaohongshu',
        adapterVersion: 1,
        observedAt: live.observedAt,
        url: live.url,
        platformAccountId: live.uid,
        publishedArticleId: live.noteId,
        pageKind: live.renderedMatches ? 'published-article' : 'unsupported',
        editor: {
          recognized: false,
          imageEnumerationComplete: live.imageEnumerationComplete,
          bodyTextLength: live.description.length,
          images: live.images.map((i) => ({ src: i.src, alt: '', loaded: i.loaded })),
        },
        title: { value: live.title },
        selectors: {},
        saveState: 'unknown',
        publishedLinks: live.renderedMatches ? [{ url: live.url, title: live.title }] : [],
        publicationBlocker: live.renderedMatches
          ? undefined
          : '作品详情尚未与平台记录一致，不能认定公开成功',
      }
    }
    const live = await readXiaohongshuEditor(page)
    let saveState: 'saved' | 'unknown' = 'unknown'
    let saveEvidence: string | undefined
    if (live.uid && live.draftId && live.editorRecognized && live.fromDraft) {
      const checked = await this.inspectDraft(page, {
        draftId: live.draftId,
        uid: live.uid,
        title: live.title,
      })
      saveState = checked.saveState
      saveEvidence = checked.saveEvidence
    }
    const images = live.images.map((img) => ({
      src: img.fileId ? `https://sns-creator-preview.xhscdn.com/${img.fileId}` : '',
      alt: '',
      loaded: img.loaded,
    }))
    return {
      adapterId: 'xiaohongshu',
      adapterVersion: 1,
      observedAt: live.observedAt,
      url: live.url,
      platformAccountId: live.uid,
      draftId: live.draftId,
      pageKind: live.editorRecognized ? 'editor' : 'unsupported',
      editor: {
        recognized: live.editorRecognized,
        bodySelector: live.editorRecognized
          ? '.tiptap.ProseMirror[contenteditable="true"]'
          : undefined,
        bodyTextLength: live.description.length,
        imageEnumerationComplete: live.imageEnumerationComplete,
        images,
        fileInputSelector: live.editorRecognized
          ? '.img-list input[type="file"][multiple]'
          : undefined,
      },
      title: { value: live.title, selector: 'input[placeholder="填写标题会有更多赞哦"]' },
      selectors: live.editorRecognized
        ? {
            body: '.tiptap.ProseMirror[contenteditable="true"]',
            title: 'input[placeholder="填写标题会有更多赞哦"]',
            fileInput: '.img-list input[type="file"][multiple]',
            save: live.hasSaveControl ? XIAOHONGSHU_SAVE_SELECTOR : undefined,
            publish:
              live.hasPublishControl && live.privacy?.type === 0 && !live.scheduled
                ? XIAOHONGSHU_PUBLISH_SELECTOR
                : undefined,
          }
        : {},
      submissionUnavailableReason:
        live.editorRecognized && (live.privacy?.type !== 0 || live.scheduled)
          ? '当前不是公开、非定时发布设置，需先确认平台设置'
          : undefined,
      fieldValues: { title: live.title },
      saveState,
      saveEvidence,
      publishedLinks: [],
    }
  }

  async probeDraftList(page: Page): Promise<CsdnDraftListProbe> {
    const live = await readXiaohongshuEditor(page)
    const drafts = await readXiaohongshuLocalDrafts(page)
    return {
      adapterId: 'xiaohongshu',
      adapterVersion: 1,
      observedAt: live.observedAt,
      platformAccountId: live.uid,
      pageSupported: !!live.uid,
      candidates: drafts
        .filter((d) => d.uid === live.uid)
        .map((d) => ({
          draftId: d.draftId,
          title: d.title,
          url: 'https://creator.xiaohongshu.com/publish/publish?target=image',
        })),
    }
  }

  async verifyBody(page: Page, expectedHtml: string) {
    const live =
      new URL(page.url()).origin === 'https://www.xiaohongshu.com'
        ? await readXiaohongshuPublication(page)
        : await readXiaohongshuEditor(page)
    return page.evaluate(
      ({ expectedHtml, live }) => {
        const doc = new DOMParser().parseFromString(expectedHtml, 'text/html')
        doc.querySelector('h1')?.remove()
        const expectedImages = Array.from(doc.querySelectorAll('img')).map((img) => ({
          src: img.src,
          alt: img.alt,
        }))
        doc.querySelectorAll('img').forEach((img) => img.remove())
        const normalize = (v: string) => v.replace(/\s/gu, '')
        const textMatches =
          live.renderedMatches &&
          normalize(doc.body.textContent ?? '') === normalize(live.description)
        const images = expectedImages.map((img, index) => ({
          index,
          src: img.src,
          alt: img.alt,
          actualSrc: live.images[index]?.src ?? '',
          precedingCharacters: 0,
          matches:
            !!live.images[index]?.loaded &&
            img.src === `https://sns-creator-preview.xhscdn.com/${live.images[index]?.fileId}`,
        }))
        return {
          matches:
            textMatches && images.length === live.images.length && images.every((i) => i.matches),
          textMatches,
          textEvidence: `小红书独立图集；正文期望 ${normalize(doc.body.textContent ?? '').length} 字符，实际 ${normalize(live.description).length} 字符`,
          expectedImages: images.length,
          actualImages: live.images.length,
          images,
        }
      },
      { expectedHtml, live },
    )
  }

  async inspectDraft(page: Page, expected: { draftId: string; uid: string; title: string }) {
    const beforeUrl = page.url()
    const live = await readXiaohongshuEditor(page)
    const drafts = await readXiaohongshuLocalDrafts(page)
    const saved = requireXiaohongshuDraft(drafts, expected)
    const after = await readXiaohongshuEditor(page)
    if (
      page.url() !== beforeUrl ||
      live.uid !== after.uid ||
      live.draftId !== after.draftId ||
      live.title !== after.title ||
      live.descriptionHtml !== after.descriptionHtml ||
      JSON.stringify(live.images) !== JSON.stringify(after.images)
    )
      throw new Error('小红书原稿在回读期间变化，旧证据已废弃')
    if (live.uid !== expected.uid || live.draftId !== expected.draftId || !live.fromDraft)
      throw new Error('小红书当前编辑现场不是指定账号的原草稿')
    if (!live.editorRecognized || !live.renderedMatches || live.title !== expected.title)
      throw new Error('小红书正文或标题与当前编辑模型不一致')
    const imagesSaved =
      live.imageEnumerationComplete &&
      live.images.length === saved.images.length &&
      live.images.every(
        (img, i) =>
          img.loaded &&
          img.fileId === saved.images[i].fileId &&
          img.width === saved.images[i].width &&
          img.height === saved.images[i].height,
      )
    const textSaved =
      live.title === saved.title &&
      live.description === saved.description &&
      live.descriptionHtml === saved.descriptionHtml
    return {
      ...live,
      savedAt: saved.savedAt,
      saveState: imagesSaved && textSaved ? ('saved' as const) : ('unknown' as const),
      saveEvidence: `本地原稿 ${saved.draftId} · 账号 ${saved.uid} · ${saved.images.length} 张图 · ${saved.savedAt}`,
    }
  }
}
