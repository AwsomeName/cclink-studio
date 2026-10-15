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
  it('groups entries by task flow and keeps the intended order', () => {
    const markup = renderToStaticMarkup(createElement(ActivityBar))

    expect(markup).toContain('role="group" aria-label="工作"')
    expect(markup).toContain('role="group" aria-label="资源"')
    expect(markup).toContain('role="group" aria-label="流程"')

    const labels = [
      '公司经营',
      '文件',
      '会话',
      '浏览器',
      'Terminal',
      '角色',
      '网站与账号',
      '数据源',
      '公司账目',
      'CCLink 远程',
      '文章发布',
      '事务',
      '定时任务',
      '视频创作',
      '硬件生产',
    ]
    const positions = labels.map((label) => markup.indexOf(`title="${label}"`))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(markup.indexOf('title="设置"')).toBeGreaterThan(positions.at(-1) ?? -1)
  })

  it('shows complete labels and group headings without requiring hover', () => {
    const markup = renderToStaticMarkup(createElement(ActivityBar))
    for (const label of [
      '公司经营',
      '文件',
      '会话',
      '浏览器',
      '终端',
      '角色',
      '网站与账号',
      '数据源',
      '公司账目',
      'CCLink 远程',
      '文章发布',
      '事务',
      '定时任务',
      '视频创作',
      '硬件生产',
      '设置',
    ]) {
      expect(markup).toContain(`class="activity-bar-label" aria-hidden="true">${label}</span>`)
    }
    for (const group of ['工作', '资源', '流程']) {
      expect(markup).toContain(`class="activity-bar-group-label" aria-hidden="true">${group}</div>`)
    }
    expect(markup.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(15)
  })
})
