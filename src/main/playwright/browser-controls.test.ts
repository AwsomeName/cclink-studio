import { describe, expect, it, vi } from 'vitest'
import { sanitizeBrowserControls, readBrowserControls } from './browser-controls'
import { executePlaywrightAction } from './playwright-actions'

describe('bounded browser controls', () => {
  it('reads visible icon toolbar selectors without inventing icon labels or reading input values', async () => {
    class Input {}
    class Anchor {}
    vi.stubGlobal('HTMLInputElement', Input)
    vi.stubGlobal('HTMLAnchorElement', Anchor)
    vi.stubGlobal('CSS', { escape: (v: string) => v })
    vi.stubGlobal('getComputedStyle', (e: { hidden?: boolean }) => ({
      display: e.hidden ? 'none' : 'block',
      visibility: 'visible',
      cursor: 'pointer',
    }))
    const make = (id: string, textContent: string, hidden = false) => ({
      id,
      tagName: 'DIV',
      classList: [],
      children: [],
      textContent,
      hidden,
      getBoundingClientRect: () => ({ width: 20, height: 20 }),
      getAttribute: () => null,
      matches: (s: string) => s.includes('div,span,label'),
    })
    const send = make('send', '发布'),
      icon = make('icon', ''),
      hidden = make('hidden', 'secret', true)
    const parent = { ...make('parent', '发布'), children: [send] }
    const nodes = [parent, send, icon, hidden]
    const root = {
      ...make('root', ''),
      contains: (node: unknown) => nodes.includes(node as typeof send),
      querySelectorAll: (s: string) => (s === 'div,span,label' ? nodes : []),
    }
    vi.stubGlobal('document', {
      querySelectorAll: (s: string) => nodes.filter((e) => `#${e.id}` === s),
    })
    const page = {
      url: () => 'https://t.bilibili.com/',
      locator: () => ({
        count: async () => 1,
        evaluate: async (fn: (v: unknown) => unknown) => fn(root),
      }),
    }
    try {
      const result = await readBrowserControls(page as never, 'main > section:nth-child(1)')
      expect(result.controls).toHaveLength(2)
      expect(result.controls.map((c) => [c.selector, c.label])).toEqual([
        ['#send', '发布'],
        ['#icon', ''],
      ])
      expect(JSON.stringify(result)).not.toContain('secret')
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('preserves checked, unchecked and mixed distinctly without inventing unchecked for missing state', () => {
    const controls = sanitizeBrowserControls(
      [true, false, 'mixed', undefined].map((checked) => ({
        tag: 'input',
        type: 'checkbox',
        label: '头条首发',
        disabled: false,
        checked: checked as boolean | 'mixed' | undefined,
      })),
    )
    expect(controls.map((c) => c.checked)).toEqual([true, false, 'mixed', undefined])
  })
  it('keeps actual navigation links but excludes secret and non-web destinations and arbitrary fields', () => {
    const raw = [
      'https://mp.toutiao.com/profile_v4/manage/content/all',
      'https://example.com/?token=secret',
      'javascript:alert(1)',
      'https://user:password@example.com/',
      'https://example.com/?session_id=secret',
    ].map((href) => ({
      tag: 'a',
      label: '管理页',
      href,
      disabled: false,
      value: 'secret-value',
      html: 'secret-html',
    }))
    const controls = sanitizeBrowserControls(raw)
    expect(controls[0].href).toBe(raw[0].href)
    expect(controls.slice(1).every((c) => c.href === undefined)).toBe(true)
    expect(JSON.stringify(controls)).not.toMatch(/secret|password|javascript/)
  })
  it('bounds result size and labels', () => {
    const controls = sanitizeBrowserControls(
      Array.from({ length: 100 }, () => ({
        tag: 'button',
        label: 'x'.repeat(1000),
        disabled: false,
      })),
    )
    expect(controls).toHaveLength(80)
    expect(controls[0].label).toHaveLength(160)
  })
  it('requires a unique visible scope and never falls back to whole-page HTML', async () => {
    const evaluate = vi.fn(),
      content = vi.fn()
    const page = { locator: () => ({ count: async () => 2, evaluate }), content }
    await expect(readBrowserControls(page as never, 'main')).rejects.toThrow('唯一')
    await expect(
      executePlaywrightAction(page as never, { type: 'extract', controls: true }),
    ).rejects.toThrow('可见范围')
    expect(evaluate).not.toHaveBeenCalled()
    expect(content).not.toHaveBeenCalled()
  })
})
