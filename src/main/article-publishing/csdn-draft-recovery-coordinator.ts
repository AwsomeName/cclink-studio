import { openXiaohongshuLocalDraft } from './xiaohongshu-draft-recovery'
import type { ArticlePublishingDetailResult } from '../../shared/article-publishing/article-publishing-types'
import type { Page } from 'playwright-core'
import { CSDN_ARTICLE_MANAGEMENT_URL, CsdnPublishingAdapter } from './csdn-publishing-adapter'

export interface CsdnDraftRecoveryResult {
  draftId: string
  url: string
  platformAccountId: string
  normalizedTitle: string
  observedAt: string
  images?: Array<{ src: string; loaded?: boolean }>
  imageEnumerationComplete?: boolean
}

type PlanObservation = (
  result: Pick<ArticlePublishingDetailResult, 'id' | 'status' | 'evidence' | 'reason'>,
) => Promise<void>

interface RecoverExactDraftInput {
  observe?: PlanObservation
  expectedDraftId: string
  expectedPlatformAccountId: string
  expectedTitle: string
  navigate: (url: string) => Promise<Page>
  assertActive?: () => void
}

interface RecoverExactPublicationInput {
  visiblePublicationUrl?: string
  expectedPlatformAccountId: string
  expectedTitle: string
  navigate: (url: string) => Promise<Page>
}

interface VerifyExactDraftPageInput {
  observe?: PlanObservation
  page: Page
  expectedDraftId: string
  expectedPlatformAccountId: string
  expectedTitle: string
}

/** Main-owned recovery. It locates the persisted draft again and only reads current page facts. */
export class CsdnDraftRecoveryCoordinator {
  constructor(
    private readonly adapter: Pick<
      CsdnPublishingAdapter,
      'probe' | 'probeDraftList'
    > = new CsdnPublishingAdapter(),
    private readonly managementUrl = CSDN_ARTICLE_MANAGEMENT_URL,
  ) {}

  async recoverExactDraft(input: RecoverExactDraftInput): Promise<CsdnDraftRecoveryResult> {
    await input.observe?.({
      id: 'recovery.management',
      status: 'running',
      evidence: this.managementUrl,
    })
    if (new URL(this.managementUrl).origin === 'https://creator.xiaohongshu.com') {
      const page = await input.navigate(this.managementUrl)
      await input.observe?.({
        id: 'recovery.management',
        status: 'completed',
        evidence: '已打开小红书本地草稿箱所在发布页',
      })
      return openXiaohongshuLocalDraft(
        page,
        {
          draftId: input.expectedDraftId,
          uid: input.expectedPlatformAccountId,
          title: input.expectedTitle,
        },
        () => input.assertActive?.(),
        input.observe,
      )
    }
    let page = await input.navigate(this.managementUrl)
    let list = await this.readSettledPage(
      page,
      () => this.adapter.probeDraftList(page),
      (value) =>
        value.pageSupported &&
        Boolean(value.platformAccountId) &&
        Boolean(value.draftSectionUrl || value.draftSectionTabName),
      input.assertActive,
    )
    input.assertActive?.()
    if (!list.pageSupported || (!list.draftSectionUrl && !list.draftSectionTabName)) {
      throw new Error('当前 平台页面无法确认草稿箱入口，已停止恢复')
    }
    await input.observe?.({
      id: 'recovery.management',
      status: 'completed',
      evidence: `管理页可识别；草稿箱入口 ${list.draftSectionTabName ?? list.draftSectionUrl}`,
    })
    await input.observe?.({
      id: 'recovery.account',
      status: list.platformAccountId === input.expectedPlatformAccountId ? 'completed' : 'failed',
      evidence: `期望 ${input.expectedPlatformAccountId}；实际 ${list.platformAccountId ?? '不可读'}`,
    })
    this.requireAccount(list.platformAccountId, input.expectedPlatformAccountId, '草稿管理页')
    await input.observe?.({
      id: 'recovery.locate',
      status: 'running',
      evidence: `正在草稿箱查找 draftId ${input.expectedDraftId}`,
    })
    if (list.draftSectionTabName) {
      // CSDN hydrates the count after the tab appears: 草稿箱(0) can become 草稿箱(2).
      // The count is not identity. Keep an exact semantic match and require one visible tab.
      const tab = page.getByRole('tab', { name: /^草稿箱\s*(?:[（(]\d+[）)])?$/u })
      if ((await tab.count()) !== 1 || !(await tab.isVisible())) {
        throw new Error('草稿箱入口在使用前已变化，已停止恢复')
      }
      input.assertActive?.()
      await tab.click()
      // 同 URL SPA 切换后重新读管理页，绝不复用“全部文章”中的候选。
      for (let retry = 0; retry < 20; retry += 1) {
        list = await this.adapter.probeDraftList(page)
        input.assertActive?.()
        if (!list.pageSupported) throw new Error('草稿箱切换后页面身份已变化')
        this.requireAccount(list.platformAccountId, input.expectedPlatformAccountId, '草稿箱')
        if (list.candidates.some((candidate) => candidate.draftId === input.expectedDraftId)) break
        await page.waitForTimeout(250)
      }
    } else if (list.draftSectionUrl && !sameUrl(list.draftSectionUrl, page.url())) {
      page = await input.navigate(list.draftSectionUrl)
      list = await this.adapter.probeDraftList(page)
      if (!list.pageSupported) throw new Error('平台草稿箱页面版本无法识别，已停止恢复')
      this.requireAccount(list.platformAccountId, input.expectedPlatformAccountId, '草稿箱')
    }

    const matches = list.candidates.filter(
      (candidate) => candidate.draftId === input.expectedDraftId,
    )
    await input.observe?.({
      id: 'recovery.locate',
      status: matches.length === 1 ? 'completed' : 'failed',
      evidence: `draftId ${input.expectedDraftId}；匹配 ${matches.length} 项`,
      ...(matches.length !== 1 ? { reason: '原稿不是唯一匹配；不会新建替代稿' } : {}),
    })
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `草稿箱没有找到原草稿 ${input.expectedDraftId}；已停止且不会新建文章`
          : `草稿箱返回多个相同 ID 的草稿 ${input.expectedDraftId}；需要人工选择`,
      )
    }
    await input.observe?.({ id: 'recovery.open', status: 'running', evidence: matches[0].url })
    page = await input.navigate(matches[0].url)
    input.assertActive?.()
    return this.verifyExactDraftPage({
      observe: input.observe,
      page,
      expectedDraftId: input.expectedDraftId,
      expectedPlatformAccountId: input.expectedPlatformAccountId,
      expectedTitle: input.expectedTitle,
    })
  }

  async verifyExactDraftPage(input: VerifyExactDraftPageInput): Promise<CsdnDraftRecoveryResult> {
    const editor = await this.readSettledPage(
      input.page,
      () => this.adapter.probe(input.page),
      (value) =>
        value.editor.recognized &&
        Boolean(value.platformAccountId) &&
        value.saveState === 'saved' &&
        value.editor.images.every((image) => image.loaded !== false),
    )
    await input.observe?.({
      id: 'recovery.open',
      status:
        editor.editor.recognized && editor.draftId === input.expectedDraftId
          ? 'completed'
          : 'failed',
      evidence: editor.url,
    })
    for (const [field, expected, actual] of [
      ['account', input.expectedPlatformAccountId, editor.platformAccountId ?? '不可读'],
      ['id', input.expectedDraftId, editor.draftId ?? '不可读'],
      ['title', normalizeText(input.expectedTitle), normalizeText(editor.title.value)],
      ['saved', 'saved', editor.saveState],
    ])
      await input.observe?.({
        id: `recovery.verify.${field}`,
        status: expected === actual && editor.editor.recognized ? 'completed' : 'failed',
        evidence: `期望 ${expected}；实际 ${actual} · ${editor.url}`,
        ...(expected !== actual ? { reason: '原稿核验不一致，禁止写入' } : {}),
      })
    if (!editor.editor.recognized || editor.draftId !== input.expectedDraftId) {
      throw new Error(`候选页面不是原 平台草稿 ${input.expectedDraftId}`)
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
      images: editor.editor.images,
      imageEnumerationComplete: editor.editor.imageEnumerationComplete,
    }
  }

  async recoverExactPublication(input: RecoverExactPublicationInput): Promise<{
    url: string
    observedAt: string
  }> {
    if (input.visiblePublicationUrl) {
      const page = await input.navigate(input.visiblePublicationUrl)
      const published = await this.readSettledPage(
        page,
        () => this.adapter.probe(page),
        (probe) => probe.pageKind === 'published-article' && Boolean(probe.platformAccountId),
      )
      this.requireAccount(
        published.platformAccountId,
        input.expectedPlatformAccountId,
        '公开文章页',
      )
      if (
        published.pageKind !== 'published-article' ||
        normalizeText(published.title.value) !== normalizeText(input.expectedTitle)
      )
        throw new Error('可见发布结果不是原账号原文章，已停止只读恢复')
      return { url: published.url, observedAt: published.observedAt }
    }
    let page = await input.navigate(this.managementUrl)
    const management = await this.readSettledPage(
      page,
      () => this.adapter.probe(page),
      (probe) =>
        probe.pageKind === 'management' &&
        Boolean(probe.platformAccountId) &&
        probe.publishedLinks.length > 0,
    )
    if (management.pageKind !== 'management') {
      throw new Error('当前页面不是可识别的 平台文章管理页')
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
    const published = await this.readSettledPage(
      page,
      () => this.adapter.probe(page),
      (probe) =>
        probe.pageKind === 'published-article' &&
        Boolean(probe.platformAccountId) &&
        Boolean(probe.title.value.trim()),
    )
    if (published.pageKind !== 'published-article') {
      throw new Error('候选页面不是可识别的 平台公开文章')
    }
    this.requireAccount(published.platformAccountId, input.expectedPlatformAccountId, '公开文章页')
    if (normalizeText(published.title.value) !== expectedTitle) {
      throw new Error('公开文章标题与任务标题不一致')
    }
    return { url: published.url, observedAt: published.observedAt }
  }

  private requireAccount(actual: string | undefined, expected: string, pageLabel: string): void {
    if (!actual || actual !== expected) {
      throw new Error(`${pageLabel}不是原平台账号，已停止恢复`)
    }
  }

  /** loadURL may settle before CSDN's redirect/hydration and CKEditor frame. Retry reads only. */
  private async readSettledPage<T>(
    page: Page,
    read: () => Promise<T>,
    ready: (value: T) => boolean,
    assertActive?: () => void,
  ): Promise<T> {
    const deadline = Date.now() + 10_000
    for (let attempt = 0; ; attempt += 1) {
      assertActive?.()
      try {
        const result = await read()
        assertActive?.()
        if (ready(result) || Date.now() >= deadline || attempt >= 39) return result
      } catch (error) {
        if (
          Date.now() >= deadline ||
          attempt >= 39 ||
          page.isClosed() ||
          !/execution context was destroyed|cannot find context|frame was detached/iu.test(
            String(error),
          )
        )
          throw error
      }
      await page.waitForTimeout(250)
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
