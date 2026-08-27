import { describe, expect, it } from 'vitest'
import { CSDN_ARTICLE_PUBLISHING_PLAN } from '@shared/article-publishing/article-publishing-plan'
import {
  createArticleMarkdownOpenDialogOptions,
  formatArticlePublishingAccountOption,
} from './article-publishing-tab'

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
