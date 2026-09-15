import type { Page } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'
import { ensureJuejinEditorMode } from './juejin-editor-mode'

function fixture(visible: boolean, tabs = 0) {
  const click = vi.fn(async () => {
    visible = true
  })
  const waitFor = vi.fn(async () => {
    if (!visible) throw new Error('pane stayed hidden')
  })
  const page = {
    locator: (selector: string) =>
      selector.startsWith('.bytemd-toolbar-tab')
        ? { count: async () => tabs, isVisible: async () => tabs > 0, click }
        : { count: async () => 1, isVisible: async () => visible, waitFor },
  } as unknown as Page
  return { page, click, waitFor }
}

describe('Juejin editor layout compatibility', () => {
  it.each(['edit', 'preview'] as const)(
    'uses an already visible %s pane without obsolete tabs',
    async (mode) => {
      const { page, click } = fixture(true)
      await ensureJuejinEditorMode(page, mode)
      expect(click).not.toHaveBeenCalled()
    },
  )
  it('switches a hidden pane using the existing unique tab and verifies visibility', async () => {
    const { page, click, waitFor } = fixture(false, 1)
    await ensureJuejinEditorMode(page, 'edit')
    expect(click).toHaveBeenCalledOnce()
    expect(waitFor).toHaveBeenCalledOnce()
  })
  it.each([0, 2])('fails closed with %i switch candidates and a hidden editor', async (tabs) => {
    const { page, click } = fixture(false, tabs)
    await expect(ensureJuejinEditorMode(page, 'edit')).rejects.toThrow('没有唯一可见切换入口')
    expect(click).not.toHaveBeenCalled()
  })
  it('does not switch after the dispatch permission has expired', async () => {
    const { page, click } = fixture(false, 1)
    let calls = 0
    await expect(
      ensureJuejinEditorMode(page, 'edit', () => {
        if (++calls === 2) throw new Error('expired')
      }),
    ).rejects.toThrow('expired')
    expect(click).not.toHaveBeenCalled()
  })
})
