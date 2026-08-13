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
      'CCLink 远程',
      '事务',
      '定时任务',
      '生产',
    ]
    const positions = labels.map((label) => markup.indexOf(`title="${label}"`))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(markup.indexOf('title="设置"')).toBeGreaterThan(positions.at(-1) ?? -1)
  })
})
