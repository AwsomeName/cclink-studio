import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CSDN_ARTICLE_PUBLISHING_PLAN } from '@shared/article-publishing/article-publishing-plan'
import {
  articlePublishingPreviewDefinitions,
  createArticleMarkdownOpenDialogOptions,
  formatArticlePublishingAccountOption,
  getArticlePublishingAgentStartError,
  getArticlePublishingFileDetails,
  getArticlePublishingRuntimeBinding,
} from './article-publishing-tab'

it('does not replay browser focus from a late launch receipt after the user returns to cancel', () => {
  const source = readFileSync(new URL('./ArticlePublishingTab.tsx', import.meta.url), 'utf8')
  const launch = source.slice(
    source.indexOf('const executeTask ='),
    source.indexOf('const startTask ='),
  )
  expect(launch).toContain('await reload()')
  expect(launch).not.toContain('activateTab(')
})

describe('article publishing Markdown picker', () => {
  it('opens in the current local workspace by default', () => {
    expect(
      createArticleMarkdownOpenDialogOptions({
        kind: 'local',
        path: '/Users/apple/project',
      }),
    ).toEqual({
      title: '选择要发布的 Markdown',
      defaultPath: '/Users/apple/project',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    })
  })
})

describe('article publishing account option', () => {
  it('uses the account identifier instead of a captured webpage title', () => {
    expect(formatArticlePublishingAccountOption(' 13800138000 ')).toBe('CSDN · 13800138000')
    expect(formatArticlePublishingAccountOption('13800138000')).not.toContain('首页-CSDN创作中心')
  })
})

describe('article publishing file details', () => {
  it('separates the file name, workspace location, and absolute path', () => {
    expect(
      getArticlePublishingFileDetails(
        '/Users/apple/project/articles/assets/cover.png',
        '/Users/apple/project',
      ),
    ).toEqual({
      fileName: 'cover.png',
      workspaceRelativePath: 'articles/assets/cover.png',
      absolutePath: '/Users/apple/project/articles/assets/cover.png',
    })
  })

  it('keeps an out-of-workspace path explicit instead of inventing a relative location', () => {
    expect(
      getArticlePublishingFileDetails('/Users/apple/shared/cover.png', '/Users/apple/project'),
    ).toMatchObject({
      fileName: 'cover.png',
      workspaceRelativePath: null,
    })
  })
})

describe('article publishing execution plan', () => {
  it('shows the complete CSDN plan before execution', () => {
    expect(CSDN_ARTICLE_PUBLISHING_PLAN.map((step) => step.label)).toEqual([
      '打开 CSDN 编辑页',
      '核验账号与页面',
      '上传并核验正文图片',
      '填写并核验正文',
      '填写平台字段',
      '保存并复核草稿',
      '执行常规单篇发布',
      '核验文章结果',
    ])
  })
})

describe('article publishing Agent binding', () => {
  it('restores the current Attempt conversation and supports legacy deterministic ids', () => {
    const affair = {
      id: 'affair-1',
      attempts: [
        { id: 'attempt-old' },
        { id: 'attempt-current', conversationId: 'article-publishing-explicit' },
      ],
      articlePublishing: { execution: { currentAttemptId: 'attempt-current' } },
    }

    expect(getArticlePublishingRuntimeBinding(affair as never)).toEqual({
      attemptId: 'attempt-current',
      conversationId: 'article-publishing-explicit',
    })
    delete affair.attempts[1].conversationId
    expect(getArticlePublishingRuntimeBinding(affair as never)).toEqual({
      attemptId: 'attempt-current',
      conversationId: 'article-publishing-affair-1',
    })
  })
})

describe('article publishing Agent launch result', () => {
  it('rejects ignored sends instead of pretending the Agent started', () => {
    expect(getArticlePublishingAgentStartError({ status: 'ignored', reason: 'busy' })).toBe(
      'Agent 未接收发布任务（busy）',
    )
  })

  it('accepts only a confirmed Agent run', () => {
    expect(getArticlePublishingAgentStartError({ status: 'accepted' })).toBeNull()
    expect(
      getArticlePublishingAgentStartError({ status: 'failed', error: 'runtime offline' }),
    ).toBe('runtime offline')
  })
})

it('previews the selected platform recovery branch without inventing observed success', () => {
  const input = {
    adapterId: 'zhihu' as const,
    assets: [],
    fields: { title: 'AIR', summary: '', tags: [], category: '' },
    existingDraftUrl: 'https://zhuanlan.zhihu.com/p/2081699689099945915/edit',
  }
  const steps = articlePublishingPreviewDefinitions(input)
  expect(steps.some((s) => s.id.startsWith('recovery.'))).toBe(true)
  expect(steps.some((s) => s.id.startsWith('initial.'))).toBe(false)
  expect(steps.some((s) => s.id.startsWith('field.summary.'))).toBe(false)
  expect(steps.every((s) => !('status' in s))).toBe(true)
  expect(
    articlePublishingPreviewDefinitions({
      ...input,
      existingDraftUrl: 'https://juejin.cn/editor/drafts/123',
    }).some((s) => s.id.startsWith('recovery.')),
  ).toBe(false)
  expect(formatArticlePublishingAccountOption('深芯智造', '知乎')).toBe('知乎 · 深芯智造')
})
