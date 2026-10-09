import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActivityBar } from './ActivityBar'

describe('ActivityBar', () => {
  it('groups entries by task flow and keeps the intended order', () => {
    const markup = renderToStaticMarkup(createElement(ActivityBar))

    expect(markup).toContain('role="group" aria-label="工作"')
    expect(markup).toContain('role="group" aria-label="资源"')
    expect(markup).toContain('role="group" aria-label="流程"')

    const labels = [
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
      '生产',
    ]
    const positions = labels.map((label) => markup.indexOf(`title="${label}"`))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(markup.indexOf('title="设置"')).toBeGreaterThan(positions.at(-1) ?? -1)
  })

  it('shows short labels and group headings without requiring hover', () => {
    const markup = renderToStaticMarkup(createElement(ActivityBar))
    for (const label of [
      '文件',
      '会话',
      '浏览器',
      '终端',
      '角色',
      '账号',
      '数据',
      '账目',
      '远程',
      '发布',
      '事务',
      '定时',
      '生产',
      '设置',
    ]) {
      expect(markup).toContain(`class="activity-bar-label" aria-hidden="true">${label}</span>`)
    }
    for (const group of ['工作', '资源', '流程']) {
      expect(markup).toContain(`class="activity-bar-group-label" aria-hidden="true">${group}</div>`)
    }
    expect(markup.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(13)
  })
})
