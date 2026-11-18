import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityBar } from './ActivityBar'

const countFixture = vi.hoisted(() => ({ value: 0 }))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: () => [countFixture.value, () => {}],
}))
beforeEach(() => {
  countFixture.value = 0
})

describe('ActivityBar', () => {
  it.each([
    [0, null],
    [1, '1'],
    [99, '99'],
    [100, '99+'],
  ] as const)('renders scheduled count %s with its queued/running meaning', (count, expected) => {
    countFixture.value = count
    const markup = renderToStaticMarkup(createElement(ActivityBar))
    if (expected === null) expect(markup).not.toContain('class="activity-bar-badge"')
    else {
      expect(markup).toContain('class="activity-bar-badge" role="status"')
      expect(markup).toContain(`aria-label="${count} 个任务排队或运行中">${expected}</span>`)
    }
  })
  it('keeps working features reachable while moving account and role management to settings', () => {
    const markup = renderToStaticMarkup(createElement(ActivityBar))
    expect(markup).toContain('aria-label="项目功能"')
    expect(markup).toContain('aria-label="工具"')
    for (const label of [
      '工作台',
      '文件',
      '会话',
      '浏览器',
      'Terminal',
      '公司经营',
      '公司账目',
      '文章发布',
      '事务',
      '定时任务',
      '数据源',
      '视频创作',
      '硬件生产',
      'CCLink 远程',
      '设置',
    ])
      expect(markup).toContain(`title="${label}"`)
    expect(markup).not.toContain('title="网站与账号"')
    expect(markup).not.toContain('title="角色"')
  })
})
