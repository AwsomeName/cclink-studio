import type { Page } from 'playwright-core'
import { CSDN_ARTICLE_MANAGEMENT_URL, CsdnPublishingAdapter } from './csdn-publishing-adapter'

export interface CsdnDraftRecoveryResult {
  draftId: string
  url: string
  platformAccountId: string
  normalizedTitle: string
  observedAt: string
}

interface RecoverExactDraftInput {
  expectedDraftId: string
  expectedPlatformAccountId: string
  expectedTitle: string
  navigate: (url: string) => Promise<Page>
}

interface RecoverExactPublicationInput {
  expectedPlatformAccountId: string
  expectedTitle: string
  navigate: (url: string) => Promise<Page>
}

interface VerifyExactDraftPageInput {
  page: Page
  expectedDraftId: string
  expectedPlatformAccountId: string
  expectedTitle: string
}

/** Main-owned recovery. It locates the persisted draft again and only reads current page facts. */
export class CsdnDraftRecoveryCoordinator {
  constructor(private readonly adapter = new CsdnPublishingAdapter()) {}

  async recoverExactDraft(input: RecoverExactDraftInput): Promise<CsdnDraftRecoveryResult> {
    let page = await input.navigate(CSDN_ARTICLE_MANAGEMENT_URL)
    let list = await this.adapter.probeDraftList(page)
    if (!list.pageSupported || !list.draftSectionUrl) {
      throw new Error('当前 CSDN 页面无法确认草稿箱入口，已停止恢复')
    }
    this.requireAccount(list.platformAccountId, input.expectedPlatformAccountId, '草稿管理页')
    if (!sameUrl(list.draftSectionUrl, page.url())) {
      page = await input.navigate(list.draftSectionUrl)
      list = await this.adapter.probeDraftList(page)
      if (!list.pageSupported) throw new Error('CSDN 草稿箱页面版本无法识别，已停止恢复')
      this.requireAccount(list.platformAccountId, input.expectedPlatformAccountId, '草稿箱')
    }

    const matches = list.candidates.filter(
      (candidate) => candidate.draftId === input.expectedDraftId,
    )
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `草稿箱没有找到原草稿 ${input.expectedDraftId}；已停止且不会新建文章`
          : `草稿箱返回多个相同 ID 的草稿 ${input.expectedDraftId}；需要人工选择`,
      )
    }
    page = await input.navigate(matches[0].url)
    return this.verifyExactDraftPage({
      page,
      expectedDraftId: input.expectedDraftId,
      expectedPlatformAccountId: input.expectedPlatformAccountId,
      expectedTitle: input.expectedTitle,
    })
  }

  async verifyExactDraftPage(input: VerifyExactDraftPageInput): Promise<CsdnDraftRecoveryResult> {
    const editor = await this.adapter.probe(input.page)
    if (!editor.editor.recognized || editor.draftId !== input.expectedDraftId) {
      throw new Error(`候选页面不是原 CSDN 草稿 ${input.expectedDraftId}`)
    }
    this.requireAccount(editor.platformAccountId, input.expectedPlatformAccountId, '草稿编辑页')
    const normalizedTitle = normalizeText(editor.title.value)
    if (normalizedTitle !== normalizeText(input.expectedTitle)) {
      throw new Error('原草稿标题与任务标题不一致；已停止自动写入，请人工确认')
    }
    if (editor.saveState !== 'saved') {
      throw new Error('原草稿当前不是“已保存”状态；已停止自动写入')
    }
    return {
      draftId: input.expectedDraftId,
      url: editor.url,
      platformAccountId: input.expectedPlatformAccountId,
      normalizedTitle,
      observedAt: editor.observedAt,
    }
  }

  async recoverExactPublication(input: RecoverExactPublicationInput): Promise<{
    url: string
    observedAt: string
  }> {
    let page = await input.navigate(CSDN_ARTICLE_MANAGEMENT_URL)
    const management = await this.adapter.probe(page)
    if (management.pageKind !== 'management') {
      throw new Error('当前页面不是可识别的 CSDN 文章管理页')
    }
    this.requireAccount(management.platformAccountId, input.expectedPlatformAccountId, '文章管理页')
    const expectedTitle = normalizeText(input.expectedTitle)
    const matches = management.publishedLinks.filter(
      (link) => normalizeText(link.title) === expectedTitle,
    )
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `文章管理页尚未找到标题为“${input.expectedTitle}”的公开文章`
          : `文章管理页有多个同名公开文章“${input.expectedTitle}”；需要人工选择`,
      )
    }
    page = await input.navigate(matches[0].url)
    const published = await this.adapter.probe(page)
    if (published.pageKind !== 'published-article') {
      throw new Error('候选页面不是可识别的 CSDN 公开文章')
    }
    this.requireAccount(published.platformAccountId, input.expectedPlatformAccountId, '公开文章页')
    if (normalizeText(published.title.value) !== expectedTitle) {
      throw new Error('公开文章标题与任务标题不一致')
    }
    return { url: published.url, observedAt: published.observedAt }
  }

  private requireAccount(actual: string | undefined, expected: string, pageLabel: string): void {
    if (!actual || actual !== expected) {
      throw new Error(`${pageLabel}不是原 CSDN 账号，已停止恢复`)
    }
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function sameUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href
  } catch {
    return false
  }
}
