import { createHash } from 'node:crypto'
import type { Page } from 'playwright-core'
import { CSDN_ARTICLE_MANAGEMENT_URL, CsdnPublishingAdapter } from './csdn-publishing-adapter'
import type { ArticlePublishingPlatformSnapshot } from '../../shared/article-publishing/article-publishing-types'

export interface CsdnDraftRecoveryResult {
  draftId: string
  url: string
  snapshot: ArticlePublishingPlatformSnapshot
  evidenceHash: string
  observedAt: string
}

interface RecoverExactDraftInput {
  expectedDraftId: string
  expectedSnapshot: ArticlePublishingPlatformSnapshot
  navigate: (url: string) => Promise<Page>
}

interface RecoverExactPublicationInput {
  expectedArticleId: string
  expectedSnapshot: ArticlePublishingPlatformSnapshot
  navigate: (url: string) => Promise<Page>
}

/**
 * Main-owned, stateless recovery orchestration. It may navigate visible CSDN pages and read the
 * versioned adapter projection, but WebAffairService remains the only persistent state owner.
 */
export class CsdnDraftRecoveryCoordinator {
  constructor(private readonly adapter = new CsdnPublishingAdapter()) {}

  async recoverExactDraft(input: RecoverExactDraftInput): Promise<CsdnDraftRecoveryResult> {
    let page = await input.navigate(CSDN_ARTICLE_MANAGEMENT_URL)
    let list = await this.adapter.probeDraftList(page)
    if (!list.pageSupported) {
      throw new Error('CSDN 草稿管理页面版本无法识别，已停止恢复')
    }
    if (!list.draftSectionUrl) {
      throw new Error('当前 CSDN 管理页无法确认草稿箱入口，已停止恢复')
    }
    if (
      !list.platformAccountId ||
      list.platformAccountId !== input.expectedSnapshot.platformAccountId
    ) {
      throw new Error('CSDN 草稿箱不能证明当前登录的是原平台账号，已停止恢复')
    }
    if (!sameUrl(list.draftSectionUrl, page.url())) {
      page = await input.navigate(list.draftSectionUrl)
      list = await this.adapter.probeDraftList(page)
      if (!list.pageSupported) {
        throw new Error('CSDN 草稿箱页面版本无法识别，已停止恢复')
      }
      if (
        !list.platformAccountId ||
        list.platformAccountId !== input.expectedSnapshot.platformAccountId
      ) {
        throw new Error('CSDN 草稿箱切换后无法证明仍是原平台账号，已停止恢复')
      }
    }
    const matches = list.candidates.filter(
      (candidate) => candidate.draftId === input.expectedDraftId,
    )
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `当前登录账号的草稿列表没有找到原草稿 ${input.expectedDraftId}；已停止且不会新建文章`
          : `草稿列表返回多个相同 ID 的候选 ${input.expectedDraftId}；已停止自动选择`,
      )
    }

    page = await input.navigate(matches[0].url)
    const editor = await this.adapter.probe(page)
    if (!editor.editor.recognized || editor.draftId !== input.expectedDraftId) {
      throw new Error(`候选页面不能证明是原 CSDN 草稿 ${input.expectedDraftId}`)
    }
    if (
      !editor.platformAccountId ||
      editor.platformAccountId !== input.expectedSnapshot.platformAccountId
    ) {
      throw new Error('原草稿编辑页不能证明当前登录的是原平台账号，已停止恢复')
    }
    const snapshot = await this.adapter.captureSavedEditorSnapshot(page, editor)
    if (!snapshot) {
      throw new Error('原草稿无法取得正文、全部图片和已保存状态的完整快照，已停止恢复')
    }
    if (snapshot.snapshotHash !== input.expectedSnapshot.snapshotHash) {
      throw new Error('原草稿的账号、正文、图片或保存状态已变化，已停止且不会自动覆盖')
    }
    const observedAt = new Date().toISOString()
    const evidenceHash = createHash('sha256')
      .update(
        JSON.stringify({
          adapterId: editor.adapterId,
          adapterVersion: editor.adapterVersion,
          draftListEvidenceHash: list.evidenceHash,
          editorEvidenceHash: editor.evidenceHash,
          snapshotHash: snapshot.snapshotHash,
          draftId: input.expectedDraftId,
          observedAt,
        }),
      )
      .digest('hex')
    return {
      draftId: input.expectedDraftId,
      url: editor.url,
      snapshot,
      evidenceHash,
      observedAt,
    }
  }

  async recoverExactPublication(input: RecoverExactPublicationInput): Promise<{
    url: string
    evidenceHash: string
    observedAt: string
  }> {
    let page = await input.navigate(CSDN_ARTICLE_MANAGEMENT_URL)
    const management = await this.adapter.probe(page)
    if (
      management.pageKind !== 'management' ||
      !management.platformAccountId ||
      management.platformAccountId !== input.expectedSnapshot.platformAccountId
    ) {
      throw new Error('CSDN 文章管理页不能证明当前登录的是原平台账号')
    }
    const matches = management.publishedLinks.filter(
      (link) => parseCsdnPublishedArticleId(link.url) === input.expectedArticleId,
    )
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `文章管理页尚未找到与原草稿 ID 相同的公开文章 ${input.expectedArticleId}`
          : `文章管理页返回多个相同 ID 的公开文章 ${input.expectedArticleId}`,
      )
    }
    page = await input.navigate(matches[0].url)
    const published = await this.adapter.probe(page)
    if (
      published.pageKind !== 'published-article' ||
      published.publishedArticleId !== input.expectedArticleId ||
      published.platformAccountId !== input.expectedSnapshot.platformAccountId ||
      normalizeText(published.title.value) !== input.expectedSnapshot.normalizedTitle
    ) {
      throw new Error('公开页面不能同时证明原文章 ID、平台账号和标题')
    }
    const observedAt = new Date().toISOString()
    const evidenceHash = createHash('sha256')
      .update(
        JSON.stringify({
          adapterId: published.adapterId,
          adapterVersion: published.adapterVersion,
          expectedArticleId: input.expectedArticleId,
          managementEvidenceHash: management.evidenceHash,
          publishedEvidenceHash: published.evidenceHash,
          observedAt,
        }),
      )
      .digest('hex')
    return { url: published.url, evidenceHash, observedAt }
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function parseCsdnPublishedArticleId(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'blog.csdn.net') return null
    return /^\/[^/]+\/article\/details\/(\d+)/u.exec(url.pathname)?.[1] ?? null
  } catch {
    return null
  }
}

function sameUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href
  } catch {
    return false
  }
}
