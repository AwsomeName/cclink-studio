import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  buildFromTemplate: vi.fn(),
}))

vi.mock('electron', () => ({
  clipboard: { writeText: mocks.writeText },
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
}))

import { buildBrowserContextMenuTemplate, normalizeBrowserContext } from './browser-context-menu'

function context() {
  return normalizeBrowserContext(
    { workspaceKey: '/workspace/a', tabId: 'tab-1', profileId: 'v2ex' },
    'https://www.v2ex.com/',
    {
      selectionText: 'selected',
      linkURL: 'https://www.v2ex.com/t/1',
      mediaType: 'none',
      editFlags: { canCopy: true },
    },
  )!
}

function webContents() {
  return {
    isDestroyed: vi.fn(() => false),
    canGoBack: vi.fn(() => true),
    canGoForward: vi.fn(() => false),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    delete: vi.fn(),
    selectAll: vi.fn(),
  }
}

describe('browser context menu', () => {
  beforeEach(() => vi.clearAllMocks())

  it('bounds text and rejects executable URLs before building a context', () => {
    const parsed = normalizeBrowserContext(
      { workspaceKey: '/workspace/a', tabId: 'tab-1', profileId: null },
      'https://example.com/',
      {
        selectionText: `${'a'.repeat(9_000)}\0`,
        linkURL: 'javascript:alert(1)',
        srcURL: 'https://example.com/image.png',
        mediaType: 'image',
      },
    )

    expect(parsed?.selectionText).toHaveLength(8_000)
    expect(parsed?.selectionText).not.toContain('\0')
    expect(parsed?.linkUrl).toBeNull()
    expect(parsed?.srcUrl).toBe('https://example.com/image.png')
  })

  it('keeps new-tab and Agent requests bound to workspace, tab and profile', () => {
    const requestOpenTab = vi.fn()
    const requestAgentMount = vi.fn()
    const wc = webContents()
    const template = buildBrowserContextMenuTemplate({
      context: context(),
      webContents: wc as never,
      validate: () => true,
      requestOpenTab,
      requestAgentMount,
    })

    template.find((item) => item.id === 'open-link')?.click?.({} as never, {} as never, {} as never)
    template
      .find((item) => item.id === 'send-selection-to-agent')
      ?.click?.({} as never, {} as never, {} as never)

    expect(requestOpenTab).toHaveBeenCalledWith({
      initialUrl: 'https://www.v2ex.com/t/1',
      workspaceKey: '/workspace/a',
      profileId: 'v2ex',
      forceNew: true,
    })
    expect(requestAgentMount).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceKey: '/workspace/a',
        tabId: 'tab-1',
        profileId: 'v2ex',
        source: 'selection',
        text: 'selected',
      }),
    )
  })

  it('invalidates every callback when the bound view token is stale', () => {
    const wc = webContents()
    const requestOpenTab = vi.fn()
    const template = buildBrowserContextMenuTemplate({
      context: context(),
      webContents: wc as never,
      validate: () => false,
      requestOpenTab,
      requestAgentMount: vi.fn(),
    })

    template.find((item) => item.id === 'back')?.click?.({} as never, {} as never, {} as never)
    template.find((item) => item.id === 'open-link')?.click?.({} as never, {} as never, {} as never)

    expect(wc.goBack).not.toHaveBeenCalled()
    expect(requestOpenTab).not.toHaveBeenCalled()
  })
})
